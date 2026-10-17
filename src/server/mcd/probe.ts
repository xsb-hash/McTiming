import {
  Client, StreamableHTTPClientTransport, SdkError, SdkErrorCode,
  type FetchLike, type JsonSchemaType, type Tool, type CallToolResult,
} from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import { ConfigError, parseConfig } from "../config";
import { READ_ONLY_TOOLS, isReadOnlyTool, type ReadOnlyTool } from "./read-only";

export const MCP_ENDPOINT = "https://mcp.mcd.cn";

const messages = {
  CONFIG: "本地配置无效，请检查模式及服务端环境变量。",
  DEMO_BLOCKED: "demo 模式禁止连接真实 MCP；本次未发送请求。",
  MISSING_TOKEN: "缺少 MCD_MCP_TOKEN；本次未发送请求。阶段 1 无需提供真实 Token。",
  AUTH: "MCP 鉴权失败，凭证可能无效、过期或权限不足。",
  NETWORK: "MCP 网络连接失败或超时，请检查网络后再手动运行。",
  RATE_LIMIT: "MCP 请求受到限流，请稍后手动重试。",
  SERVER: "MCP 服务暂时不可用，请稍后手动重试。",
  PROTOCOL: "MCP 协议或响应结构异常，不能认定接入成功。",
  TOOL_BLOCKED: "该工具不在已核实的只读白名单内；拒绝调用。",
  TOOL_MISSING: "官方工具列表未提供指定只读工具；未执行工具调用。",
  ARGUMENTS: "参数不符合本次发现的工具 schema；未执行工具调用。",
  TOOL_FAILURE: "工具返回执行错误；未输出原始响应，业务结果未验证。",
} as const;

export type ProbeCode = keyof typeof messages;

export class ProbeError extends Error {
  constructor(public readonly code: ProbeCode) {
    super(messages[code]);
    this.name = "ProbeError";
  }
}

export function safeProbeError(error: unknown): ProbeError {
  if (error instanceof ProbeError) return error;
  if (error instanceof ConfigError) return new ProbeError("CONFIG");
  if (SdkError.isInstance(error) && [SdkErrorCode.RequestTimeout, SdkErrorCode.ConnectionClosed].includes(error.code)) {
    return new ProbeError("NETWORK");
  }
  // Never reflect SDK messages, response bodies, headers, or stack traces into public output.
  return new ProbeError("PROTOCOL");
}

export type ProbeSummary = {
  scope: "initialize+tools/list";
  toolCount: number;
  availableReadOnly: ReadOnlyTool[];
  invokedTool?: ReadOnlyTool;
  toolResponse?: "received-uninterpreted";
};

type ProbeOptions = {
  env: Record<string, string | undefined>;
  tool?: string;
  arguments?: Record<string, unknown>;
  fetch?: FetchLike;
  // Local validation only. Callers must redact evidence before persistence or output.
  onTools?: (tools: Tool[]) => void;
  onResult?: (result: CallToolResult) => void;
};

export async function runProbe(options: ProbeOptions): Promise<ProbeSummary> {
  if (options.tool !== undefined && !isReadOnlyTool(options.tool)) throw new ProbeError("TOOL_BLOCKED");
  const config = parseConfig(options.env);
  if (config.mode !== "live") throw new ProbeError("DEMO_BLOCKED");
  if (!config.token) throw new ProbeError("MISSING_TOKEN");

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const guardedFetch: FetchLike = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== MCP_ENDPOINT || url.pathname !== "/" || url.search || url.username || url.password) {
      throw new ProbeError("PROTOCOL");
    }
    if (init?.method === "POST") {
      const rpc = JSON.parse(String(init.body)) as { method?: string; params?: { name?: unknown } };
      if (rpc.method === "tools/call") {
        if (!isReadOnlyTool(rpc.params?.name)) throw new ProbeError("TOOL_BLOCKED");
      } else if (!["initialize", "notifications/initialized", "tools/list", "notifications/cancelled"].includes(rpc.method ?? "")) {
        throw new ProbeError("PROTOCOL");
      }
    }
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(15_000);
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      response = await fetchImpl(input, { ...init, signal, redirect: "error" });
    } catch {
      throw new ProbeError("NETWORK");
    }
    if (response.status === 401 || response.status === 403) throw new ProbeError("AUTH");
    if (response.status === 429) throw new ProbeError("RATE_LIMIT");
    if (response.status >= 500) throw new ProbeError("SERVER");
    return response;
  };

  const client = new Client({ name: "mctiming-readonly-probe", version: "0.1.0" }, {
    capabilities: {}, listMaxPages: 20,
  });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_ENDPOINT), {
    requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
    fetch: guardedFetch,
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
  });

  try {
    // v2's default legacy handshake performs initialize and notifications/initialized.
    await client.connect(transport, { timeout: 15_000 });
    if (!client.getServerCapabilities()?.tools) throw new ProbeError("PROTOCOL");
    const { tools } = await client.listTools(undefined, { timeout: 15_000 });
    options.onTools?.(tools);
    const summary: ProbeSummary = {
      scope: "initialize+tools/list",
      toolCount: tools.length,
      availableReadOnly: READ_ONLY_TOOLS.filter((name) => tools.some((tool) => tool.name === name)),
    };
    if (options.tool !== undefined && isReadOnlyTool(options.tool)) {
      const tool = tools.find((item) => item.name === options.tool);
      if (!tool) throw new ProbeError("TOOL_MISSING");
      // The wire Tool type accepts arbitrary JSON; AJV still compiles and validates the schema.
      const validate = new AjvJsonSchemaValidator().getValidator(tool.inputSchema as JsonSchemaType);
      if (!validate(options.arguments ?? {}).valid) throw new ProbeError("ARGUMENTS");
      const result = await client.callTool({ name: options.tool, arguments: options.arguments ?? {} }, { timeout: 15_000 });
      options.onResult?.(result);
      if (result.isError) throw new ProbeError("TOOL_FAILURE");
      summary.invokedTool = options.tool;
      // No McDonald's business-response schema has been verified in stage 1.
      summary.toolResponse = "received-uninterpreted";
    }
    return summary;
  } catch (error) {
    throw safeProbeError(error);
  } finally {
    await client.close().catch(() => undefined);
  }
}
