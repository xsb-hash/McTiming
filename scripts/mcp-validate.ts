import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runProbe, safeProbeError, ProbeError } from "../src/server/mcd/probe";
import { loadLocalEnv } from "./load-local-env";
import { READ_ONLY_TOOLS } from "../src/server/mcd/read-only";
import { responseEvidence } from "./mcp-evidence";

// Stage 2 operator console; raw personal responses remain in process memory.
// A terminal in raw mode prevents credentials and subsequent input from echoing.
const env = loadLocalEnv();
env.MCTIMING_MODE ??= "live";
if (env.MCTIMING_MODE === "demo") {
  console.error("DEMO_BLOCKED: demo 模式禁止真实验证，未读取交互凭证，未发送请求。");
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error("TTY_REQUIRED: 请在本机交互终端运行，输入不会回显。");
  process.exit(1);
}
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
let buffer = "";
let pending: ((line: string) => void) | undefined;
process.stdin.on("data", (chunk: string) => {
  for (const char of chunk) {
    if (char === "\u0003") { process.stdin.setRawMode(false); process.exit(130); }
    if (char === "\r" || char === "\n") {
      if (pending) { const done = pending; pending = undefined; const line = buffer; buffer = ""; done(line); }
    } else if (char === "\u007f" || char === "\b") buffer = buffer.slice(0, -1);
    else if (pending && buffer.length < 65536) buffer += char;
  }
});
const readLine = () => new Promise<string>((resolveLine) => { pending = resolveLine; });

const evidenceRecords: unknown[] = [];
try {
  if (!env.MCD_MCP_TOKEN) {
    console.log("HIDDEN_TOKEN_INPUT_READY");
    env.MCD_MCP_TOKEN = (await readLine()).trim();
  }
  const summary = await runProbe({ env, onTools(tools) {
    const necessary = tools.filter((tool) => [...READ_ONLY_TOOLS, "delivery-create-address", "create-order"].includes(tool.name));
    const evidence = { capturedAt: new Date().toISOString(), source: "https://mcp.mcd.cn tools/list", tools: necessary };
    mkdirSync(resolve(".local"), { recursive: true });
    // Discovery schemas only, never business results or configuration.
    writeFileSync(resolve(".local/mcp-tool-schemas.json"), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ capturedAt: evidence.capturedAt, schemaCount: necessary.length, schemaFile: ".local/mcp-tool-schemas.json" }));
  } });
  console.log(JSON.stringify(summary));
  for (;;) {
    console.log("READ_ONLY_COMMAND_READY");
    const line = await readLine();
    if (line === "exit") break;
    try {
      const command = JSON.parse(line) as { tool?: string; arguments?: Record<string, unknown> };
      // Stage 2 allows query-order schema inspection only, not account order reads.
      if (!command.tool || command.tool === "query-order") throw new ProbeError("TOOL_BLOCKED");
      const args = command.arguments ?? {};
      const result = await runProbe({ env, tool: command.tool, arguments: args, onResult(response) {
        const record = { at: new Date().toISOString(), tool: command.tool, ...responseEvidence(command.tool!, response) };
        evidenceRecords.push(record);
        writeFileSync(resolve(".local/mcp-validation-evidence.json"), JSON.stringify(evidenceRecords, null, 2));
        console.log(JSON.stringify(record));
      } });
      console.log(JSON.stringify(result));
    } catch (error) { const safe = safeProbeError(error); console.log(JSON.stringify({ code: safe.code, message: safe.message })); }
  }
} catch (error) {
  const safe = safeProbeError(error);
  console.error(JSON.stringify({ at: new Date().toISOString(), code: safe.code, message: safe.message }));
  process.exitCode = 1;
} finally {
  delete env.MCD_MCP_TOKEN;
  buffer = "";
  process.stdin.setRawMode(false);
  process.stdin.pause();
}
