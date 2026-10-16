import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "@modelcontextprotocol/client";
import { runProbe, safeProbeError } from "../src/server/mcd/probe";

const env = { MCTIMING_MODE: "live", MCD_MCP_TOKEN: "mctiming-test-secret-canary" };
// Protocol-only fixture. These fields are synthetic, NOT McDonald's business schemas.
function mockMcp(options: { badList?: boolean; toolError?: boolean } = {}) {
  const methods: string[] = [];
  const fetchMock: FetchLike = vi.fn(async (_input, init) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer mctiming-test-secret-canary");
    expect(init?.redirect).toBe("error");
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init?.body));
    methods.push(request.method);
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    let result: unknown;
    switch (request.method) {
      case "initialize":
        result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "synthetic-test", version: "1" } };
        break;
      case "tools/list":
        result = options.badList ? { tools: "invalid" } : { tools: [
          { name: "query-meals", inputSchema: { type: "object", properties: { fixtureOnly: { type: "string" } }, required: ["fixtureOnly"], additionalProperties: false } },
          { name: "create-order", inputSchema: { type: "object" } },
        ] };
        break;
      case "tools/call":
        result = { isError: options.toolError ?? false, content: [{ type: "text", text: "SYNTHETIC_PRIVATE_RESPONSE_DO_NOT_PRINT" }] };
        break;
      default: throw new Error("Unexpected protocol call");
    }
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  });
  return { fetchMock, methods };
}

describe("read-only MCP probe (no real network)", () => {
  it("exposes discovered schemas and response to a local observer without changing public summary", async () => {
    const onTools = vi.fn();
    const onResult = vi.fn();
    const { fetchMock, methods } = mockMcp();
    const summary = await runProbe({ env, fetch: fetchMock, tool: "query-meals", arguments: { fixtureOnly: "synthetic" }, onTools, onResult });
    expect(onTools.mock.calls[0][0].some((tool: { name: string }) => tool.name === "create-order")).toBe(true);
    expect(onResult).toHaveBeenCalledOnce();
    expect(methods.filter((method) => method === "tools/call")).toHaveLength(1);
    expect(JSON.stringify(summary)).not.toContain("SYNTHETIC_PRIVATE_RESPONSE");
  });
  it.each([
    [{ MCTIMING_MODE: "demo" }, "DEMO_BLOCKED"],
    [{ MCTIMING_MODE: "live" }, "MISSING_TOKEN"],
  ] as const)("rejects non-network-ready configuration", async (settings, code) => {
    const fetchMock = vi.fn();
    await expect(runProbe({ env: settings, fetch: fetchMock })).rejects.toMatchObject({ code });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["delivery-create-address", "create-order", "auto-bind-coupons", "cancel-order", "pay", "draw-lottery", "unknown"])("blocks %s before connection", async (tool) => {
    const fetchMock = vi.fn();
    await expect(runProbe({ env, tool, fetch: fetchMock })).rejects.toMatchObject({ code: "TOOL_BLOCKED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uses the installed SDK to initialize and discover tools without calling any", async () => {
    const { fetchMock, methods } = mockMcp();
    const result = await runProbe({ env, fetch: fetchMock });
    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(result).toEqual({ scope: "initialize+tools/list", toolCount: 2, availableReadOnly: ["query-meals"] });
    expect(JSON.stringify(result)).not.toContain("create-order");
    expect(JSON.stringify(result)).not.toContain(env.MCD_MCP_TOKEN);
  });
  it("validates against the discovered schema and discards all business response content", async () => {
    const { fetchMock, methods } = mockMcp();
    const result = await runProbe({ env, fetch: fetchMock, tool: "query-meals", arguments: { fixtureOnly: "synthetic" } });
    expect(methods.filter((method) => method === "tools/call")).toHaveLength(1);
    expect(result.toolResponse).toBe("received-uninterpreted");
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_RESPONSE");
  });
  it("rejects arguments that do not match discovery before tools/call", async () => {
    const { fetchMock, methods } = mockMcp();
    await expect(runProbe({ env, fetch: fetchMock, tool: "query-meals", arguments: {} })).rejects.toMatchObject({ code: "ARGUMENTS" });
    expect(methods).not.toContain("tools/call");
  });
  it("does not assume a whitelisted tool is present on the server", async () => {
    const { fetchMock } = mockMcp();
    await expect(runProbe({ env, fetch: fetchMock, tool: "calculate-price" })).rejects.toMatchObject({ code: "TOOL_MISSING" });
  });
  it.each([[401, "AUTH"], [403, "AUTH"], [429, "RATE_LIMIT"], [503, "SERVER"]] as const)("reports HTTP %s safely", async (status, code) => {
    const fetchMock: FetchLike = async () => new Response("SYNTHETIC_PRIVATE_RESPONSE", { status });
    await expect(runProbe({ env, fetch: fetchMock })).rejects.toMatchObject({ code });
  });
  it("distinguishes network failure without returning the raw error", async () => {
    try {
      await runProbe({ env, fetch: async () => { throw new Error(env.MCD_MCP_TOKEN); } });
      expect.unreachable();
    } catch (error) {
      expect(safeProbeError(error).code).toBe("NETWORK");
      expect(safeProbeError(error).message).not.toContain(env.MCD_MCP_TOKEN);
    }
  });
  it("rejects malformed MCP responses", async () => {
    await expect(runProbe({ env, fetch: mockMcp({ badList: true }).fetchMock })).rejects.toMatchObject({ code: "PROTOCOL" });
  });
  it("does not report a tool execution error as success", async () => {
    await expect(runProbe({ env, fetch: mockMcp({ toolError: true }).fetchMock, tool: "query-meals", arguments: { fixtureOnly: "synthetic" } })).rejects.toMatchObject({ code: "TOOL_FAILURE" });
  });
});
