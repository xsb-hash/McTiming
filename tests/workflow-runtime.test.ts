import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const probe = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../src/server/mcd/probe", () => ({ runProbe: probe.run, ProbeError: class extends Error { code = "NETWORK"; } }));
import { getWorkflow, assertWorkflowOrigin } from "../src/server/workflow-runtime";
import { defaultForm } from "../src/domain/workflow";

describe("server mode and local request boundaries", () => {
  it("rejects cross-origin or non-loopback live requests", () => {
    const req = (host: string, origin: string) => new Request(`http://${host}/api/workflow`, { headers: { host, origin } });
    expect(() => assertWorkflowOrigin(req("127.0.0.1:3300", "http://evil.invalid"), "live")).toThrow("同源");
    expect(() => assertWorkflowOrigin(req("public.invalid", "http://public.invalid"), "live")).toThrow("回环");
    expect(() => assertWorkflowOrigin(req("127.0.0.1:3300", "http://127.0.0.1:3300"), "live")).not.toThrow();
    expect(() => assertWorkflowOrigin(new Request("http://localhost:3300/api/workflow", { headers: { host: "127.0.0.1:3300", origin: "http://127.0.0.1:3300" } }), "live")).not.toThrow();
  });
  it("runs the whole demo without invoking MCP and isolates browser sessions", async () => {
    vi.stubEnv("MCTIMING_MODE", "demo"); vi.stubEnv("MCD_MCP_TOKEN", ""); vi.stubEnv("NEXT_PUBLIC_MCD_MCP_TOKEN", "");
    try {
      const a = await getWorkflow(), b = await getWorkflow(); expect(a.id).not.toBe(b.id);
      const found = await a.workflow.dispatch({ action: "stores", revision: 1, ...(({ fulfillment, city, keyword, addressRef }) => ({ fulfillment, city, keyword, addressRef }))(defaultForm) });
      const result = await a.workflow.dispatch({ action: "recommend", revision: 2, form: { ...defaultForm, storeRef: found.stores[0].ref } });
      const reviewed = await a.workflow.dispatch({ action: "review", revision: 2, optionId: result.result!.budgetOptions[0].id });
      const created = await a.workflow.dispatch({ action: "checkout-confirm", revision: 2, draftId: reviewed.draft!.id, version: reviewed.draft!.checkout!.version, confirmed: true });
      expect(created.draft!.checkout!.state).toBe("created");
      expect(probe.run).not.toHaveBeenCalled();
      expect((await b.workflow.dispatch({ action: "bootstrap" })).draft).toBeNull();
      expect((await getWorkflow(a.id)).workflow).toBe(a.workflow);
    } finally { vi.unstubAllEnvs(); }
  });
  it("expires the old server session instead of reusing its draft", async () => {
    vi.stubEnv("MCTIMING_MODE", "demo"); vi.stubEnv("MCD_MCP_TOKEN", ""); vi.stubEnv("NEXT_PUBLIC_MCD_MCP_TOKEN", "");
    const start = Date.now(); const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    try {
      const old = await getWorkflow();
      const found = await old.workflow.dispatch({ action: "stores", revision: 1, fulfillment: "pickup", city: defaultForm.city, keyword: defaultForm.keyword, addressRef: defaultForm.addressRef });
      const result = await old.workflow.dispatch({ action: "recommend", revision: 2, form: { ...defaultForm, storeRef: found.stores[0].ref } });
      const reviewed = await old.workflow.dispatch({ action: "review", revision: 2, optionId: result.result!.budgetOptions[0].id });
      clock.mockReturnValue(start + 31 * 60_000);
      const fresh = await getWorkflow(old.id); expect(fresh.id).not.toBe(old.id);
      await expect(fresh.workflow.dispatch({ action: "checkout-confirm", revision: 2, draftId: reviewed.draft!.id, version: 1, confirmed: true })).rejects.toThrow("失效");
      expect((await fresh.workflow.dispatch({ action: "bootstrap" })).draft).toBeNull();
    } finally { clock.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("missing live credentials fails without connecting or falling back", async () => {
    vi.stubEnv("MCTIMING_MODE", "live"); vi.stubEnv("MCD_MCP_TOKEN", ""); vi.stubEnv("NEXT_PUBLIC_MCD_MCP_TOKEN", "");
    try {
      const { workflow } = await getWorkflow();
      await expect(workflow.dispatch({ action: "stores", revision: 1, fulfillment: "pickup", city: "唐山市", keyword: "路北区", addressRef: "" })).rejects.toThrow("未配置");
      expect(probe.run).not.toHaveBeenCalled();
      expect((await workflow.dispatch({ action: "bootstrap" })).stores).toEqual([]);
    } finally { vi.unstubAllEnvs(); }
  });
  it("accepts only verified store envelopes and projects no trace or extra fields", async () => {
    vi.stubEnv("MCTIMING_MODE", "live"); vi.stubEnv("MCD_MCP_TOKEN", "test-only"); vi.stubEnv("NEXT_PUBLIC_MCD_MCP_TOKEN", "");
    try {
      let success = true;
      probe.run.mockImplementation(async (options) => {
        expect(options.tool).toBe("query-nearby-stores");
        expect(options.arguments).toEqual({ beType: 1, searchType: 2, city: "唐山市", keyword: "路北区" });
        options.onResult({ structuredContent: { success, code: success ? 200 : 500, traceId: "private-trace", data: [{ storeCode: "test-store", storeName: "受控测试店", address: "受控测试地点", businessStatus: true, extraPrivateField: "private-value" }] } });
      });
      const { workflow } = await getWorkflow();
      const query = { action: "stores", revision: 1, fulfillment: "pickup", city: "唐山市", keyword: "路北区", addressRef: "" };
      const view = await workflow.dispatch(query);
      expect(view.stores).toHaveLength(1); expect(JSON.stringify(view)).not.toContain("private-");
      success = false;
      await expect(workflow.dispatch({ ...query, revision: 2 })).rejects.toThrow("无法验证");
      expect((await workflow.dispatch({ action: "bootstrap" })).stores).toEqual([]);
    } finally { vi.unstubAllEnvs(); }
  });
});
