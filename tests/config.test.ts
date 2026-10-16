import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseConfig } from "../src/server/config";
import { loadLocalEnv } from "../scripts/load-local-env";

vi.mock("server-only", () => ({}));
import { getPublicStatus } from "../src/server/status";

afterEach(() => vi.unstubAllEnvs());

describe("configuration isolation", () => {
  it("defaults to demo without a token", () => {
    expect(parseConfig({})).toEqual({ mode: "demo", token: "" });
  });
  it("normalizes real to live but does not invent a token", () => {
    expect(parseConfig({ MCTIMING_MODE: "real" })).toEqual({ mode: "live", token: "" });
  });
  it.each([
    { MCTIMING_MODE: "unknown" },
    { MCTIMING_MODE: "demo", MCD_MCP_TOKEN: "mctiming-test-secret-canary" },
    { NEXT_PUBLIC_MCD_MCP_TOKEN: "mctiming-test-secret-canary" },
    { MCTIMING_MODE: "live", MCD_MCP_TOKEN: "mctiming-test-secret-canary\nline" },
  ])("rejects unsafe configuration without echoing its value", (env) => {
    let message = "";
    try { parseConfig(env); } catch (error) { message = (error as Error).message; }
    expect(message).not.toBe("");
    expect(message).not.toContain("mctiming-test-secret-canary");
  });
  it("loads .env.local explicitly with inherited values taking precedence", () => {
    const dir = mkdtempSync(join(tmpdir(), "mctiming-config-"));
    const file = join(dir, ".env.local");
    try {
      writeFileSync(file, 'MCTIMING_MODE=live\nMCD_MCP_TOKEN="mctiming-test-secret-canary"\nUNRELATED=value\n');
      expect(loadLocalEnv(dir, {})).toMatchObject({ MCTIMING_MODE: "live", MCD_MCP_TOKEN: "mctiming-test-secret-canary" });
      expect(loadLocalEnv(dir, { MCD_MCP_TOKEN: "" }).MCD_MCP_TOKEN).toBe("");
      expect(loadLocalEnv(dir, {})).not.toHaveProperty("UNRELATED");
    } finally { unlinkSync(file); rmdirSync(dir); }
  });
  it("only returns a public status, never the live token or an invented success", () => {
    vi.stubEnv("MCTIMING_MODE", "live");
    vi.stubEnv("MCD_MCP_TOKEN", "mctiming-test-secret-canary");
    vi.stubEnv("NEXT_PUBLIC_MCD_MCP_TOKEN", "");
    expect(getPublicStatus()).toEqual({ mode: "live", configuration: "configured", mcpVerification: "not-verified" });
    expect(JSON.stringify(getPublicStatus())).not.toContain("mctiming-test-secret-canary");
    vi.stubEnv("MCD_MCP_TOKEN", "");
    expect(getPublicStatus().configuration).toBe("missing-token");
  });
});
