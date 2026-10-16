import { modeSchema, type RuntimeMode } from "../domain/runtime";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type ServerConfig = { mode: RuntimeMode; token: string };

// The CLI also uses this parser; only the server boundary may read real environment values.
export function parseConfig(env: Record<string, string | undefined>): ServerConfig {
  if (env.NEXT_PUBLIC_MCD_MCP_TOKEN?.trim()) {
    throw new ConfigError("禁止使用 NEXT_PUBLIC_MCD_MCP_TOKEN；凭证只能保留在服务端。");
  }
  const modeResult = modeSchema.safeParse(env.MCTIMING_MODE ?? "demo");
  if (!modeResult.success) {
    throw new ConfigError("MCTIMING_MODE 必须是 demo 或 live（real 为 live 的别名）。");
  }
  const token = env.MCD_MCP_TOKEN?.trim() ?? "";
  if (modeResult.data === "demo" && token) {
    throw new ConfigError("demo 模式不接受真实凭证，请移除 MCD_MCP_TOKEN 后重启。");
  }
  if (/[\r\n]/.test(token)) {
    throw new ConfigError("MCD_MCP_TOKEN 格式无效：不能包含换行。");
  }
  return { mode: modeResult.data, token };
}
