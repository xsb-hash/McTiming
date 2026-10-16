import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { ConfigError } from "../src/server/config";

export function loadLocalEnv(
  cwd = process.cwd(),
  inherited: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  let local: Record<string, string | undefined> = {};
  try {
    local = parseEnv(readFileSync(resolve(cwd, ".env.local"), "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw new ConfigError("无法加载 .env.local，请检查文件权限与格式；未输出文件内容。");
    }
  }
  const selected: Record<string, string | undefined> = {};
  for (const key of ["MCTIMING_MODE", "MCD_MCP_TOKEN", "NEXT_PUBLIC_MCD_MCP_TOKEN"]) {
    selected[key] = inherited[key] ?? local[key];
  }
  return selected;
}
