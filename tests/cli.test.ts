import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const script = fileURLToPath(new URL("../scripts/mcp-smoke.ts", import.meta.url));

it("the actual CLI safely exits when the token is missing", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, MCTIMING_MODE: "live", MCD_MCP_TOKEN: "", NEXT_PUBLIC_MCD_MCP_TOKEN: "" },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("[MISSING_TOKEN]");
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("Authorization");
});

it("the actual CLI refuses a write tool without touching credentials", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", script, "--tool", "create-order"], {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, MCTIMING_MODE: "live", MCD_MCP_TOKEN: "", NEXT_PUBLIC_MCD_MCP_TOKEN: "" },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("[TOOL_BLOCKED]");
});
