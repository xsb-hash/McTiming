import { describe, expect, it, vi } from "vitest";
import { createRecommendationSession } from "../src/server/recommend";
import { createDemoRecommendationAdapter } from "../src/server/demo/recommend-adapter";
import { buildDataset, FIXED_TIME } from "../experiments/phase6a/dataset";
import { runProbe, safeProbeError } from "../src/server/mcd/probe";

describe("controlled system fault injection — never official end-to-end", () => {
  it.each(["empty", "timeout", "401", "429", "malformed"])("blocks %s menu data and revokes previous recommendations", async (fault) => {
    const test = (await buildDataset())[0];
    const adapter = createDemoRecommendationAdapter(() => FIXED_TIME);
    const engine = createRecommendationSession(adapter, () => FIXED_TIME);
    await engine.run(test.context, { ...test.request, budgetFen: 3500 });
    expect(engine.current()!.budgetOptions.length).toBeGreaterThan(0);
    adapter.load = async () => { if (fault === "empty") return { source: "demo", options: [], coupons: [], claimableHints: [], issues: [] }; if (fault === "malformed") return null as never; throw new Error(`controlled-${fault}`); };
    await engine.run(test.context, test.request);
    expect(engine.current()!.budgetOptions).toEqual([]); expect(engine.current()!.overBudgetOption).toBeNull();
    if (fault !== "empty") expect(engine.current()!.issues).toContain("菜单或优惠数据读取失败，未使用模拟数据替代。");
  });
  it("invalid template cannot preserve an earlier ready quote", async () => {
    const test = (await buildDataset())[0]; const engine = createRecommendationSession(createDemoRecommendationAdapter(() => FIXED_TIME), () => FIXED_TIME);
    await engine.run(test.context, test.request);
    await expect(engine.run(test.context, { ...test.request, template: "invented-template" })).rejects.toThrow();
    expect(engine.current()!.status).toBe("expired");
  });
  it("simulates transport timeout, sanitizes errors and never writes private data to logs", async () => {
    const info = vi.spyOn(console, "log"), warning = vi.spyOn(console, "warn"), errorLog = vi.spyOn(console, "error");
    const token = "test-only-phase6a-canary"; let calls = 0;
    try {
      await runProbe({ env: { MCTIMING_MODE: "live", MCD_MCP_TOKEN: token }, fetch: async () => { calls++; throw new DOMException(`${token}: private-body`, "TimeoutError"); } });
      expect.unreachable();
    } catch (error) {
      const safe = safeProbeError(error); expect(safe.code).toBe("NETWORK"); expect(safe.message).not.toContain(token); expect(safe.message).not.toContain("private-body");
    }
    expect(calls).toBe(1); expect(info).not.toHaveBeenCalled(); expect(warning).not.toHaveBeenCalled(); expect(errorLog).not.toHaveBeenCalled();
  });
});
