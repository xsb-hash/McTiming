import { readFileSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadLocalEnv } from "./load-local-env";
import { runProbe, safeProbeError, ProbeError } from "../src/server/mcd/probe";
import { isReadOnlyTool } from "../src/server/mcd/read-only";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    let flags;
    try {
      flags = parseArgs({ args: argv, options: {
        help: { type: "boolean" }, tool: { type: "string" }, "args-file": { type: "string" },
      }, strict: true, allowPositionals: false }).values;
    } catch { throw new ProbeError("ARGUMENTS"); }
    if (flags.help) {
      console.log("用法：npm run mcp:smoke [-- --tool <只读工具> --args-file .local/probe-args.json]\n默认只检测 initialize 与 tools/list。阶段 1 不使用真实 Token。详见 docs/MCP_SETUP.md。");
      return 0;
    }
    if (flags.tool !== undefined && !isReadOnlyTool(flags.tool)) throw new ProbeError("TOOL_BLOCKED");
    let args: Record<string, unknown> | undefined;
    if (flags["args-file"]) {
      if (!flags.tool) throw new ProbeError("ARGUMENTS");
      try {
        const path = resolve(flags["args-file"]);
        const inside = relative(resolve(".local"), path);
        if (!inside || inside.startsWith("..") || isAbsolute(inside) || statSync(path).size > 65_536) throw new Error();
        args = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(path, "utf8")));
      } catch { throw new ProbeError("ARGUMENTS"); }
    }
    const result = await runProbe({ env: loadLocalEnv(), tool: flags.tool, arguments: args });
    console.log(JSON.stringify(result, null, 2));
    console.log("仅完成本次协议检测；工具响应未作业务判定，不代表计价或交易能力已验证。页面仍标为尚未验证。");
    return 0;
  } catch (error) {
    const safe = safeProbeError(error);
    console.error(`[${safe.code}] ${safe.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
