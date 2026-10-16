import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadLocalEnv } from "./load-local-env";
import { runProbe, safeProbeError, ProbeError } from "../src/server/mcd/probe";
import { phase5bRecord, redactPhase5b } from "./phase5b-evidence";
import { PHASE5B_READS, verifyPickup, type Phase5bRead } from "./phase5b-pickup";

const records: unknown[] = [];
const startedAt = new Date().toISOString();
const evidence: Record<string, unknown> = { startedAt, source: "official MCP via project runProbe", records };
const output = resolve(".local/phase5b-validation.json");
try {
  const flags = parseArgs({ options: { city: { type: "string" }, keyword: { type: "string" }, "budget-fen": { type: "string", default: "4000" }, help: { type: "boolean" } }, strict: true, allowPositionals: false }).values;
  if (flags.help) {
    console.log("用法：npm run mcp:phase5b -- --city 唐山市 --keyword 路北区 --budget-fen 4000\n仅只读验证，默认最多3个单人餐详情；预算为验证输入，不创建订单。显式配置live和本机Token；脱敏证据输出.local/phase5b-validation.json。");
  } else {
    if (!flags.city || !flags.keyword || !/^\d+$/.test(flags["budget-fen"]!) || !Number.isSafeInteger(Number(flags["budget-fen"])) || Number(flags["budget-fen"]) <= 0) throw new ProbeError("ARGUMENTS");
    const env = loadLocalEnv();
    // Never silently override demo. Reuse the fixed endpoint, SDK validation,
    // transport-level read whitelist, redaction and static errors of runProbe.
    evidence.connection = await runProbe({ env, onTools(tools) {
      mkdirSync(".local", { recursive: true });
      writeFileSync(".local/phase5b-schemas.json", JSON.stringify({ capturedAt: new Date().toISOString(), tools: tools.filter((t) => [...PHASE5B_READS, "delivery-query-stores", "delivery-create-address", "create-order", "query-order"].includes(t.name)) }, null, 2));
    } });
    const call = async (tool: Phase5bRead, args: Record<string, unknown>) => {
      if (!(PHASE5B_READS as readonly string[]).includes(tool)) throw new ProbeError("TOOL_BLOCKED");
      let payload: unknown;
      let observed = false;
      try {
        await runProbe({ env, tool, arguments: args, onResult(result) {
          observed = true;
          records.push(phase5bRecord(tool, args, result));
          payload = result.structuredContent;
        } });
      } catch (error) {
        if (!observed) records.push({ at: new Date().toISOString(), tool, arguments: redactPhase5b(tool, args, true), error: safeProbeError(error).code });
        throw error;
      } finally {
        writeFileSync(output, JSON.stringify(evidence, null, 2));
      }
      return payload;
    };
    await call("now-time-info", {});
    await call("delivery-query-addresses", {});
    await call("available-coupons", {});
    evidence.pickup = await verifyPickup(call, flags.city, flags.keyword, Number(flags["budget-fen"]));
    evidence.completedAt = new Date().toISOString();
    writeFileSync(output, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ status: "READ_ONLY_RUN_COMPLETED", evidenceFile: ".local/phase5b-validation.json", toolCalls: records.length, pickup: evidence.pickup }, null, 2));
    console.log("完成只读取证不等于推荐／交易验收通过。请检查recommendation状态和缺失费用；本命令不输出个人响应或券码。");
  }
} catch (error) {
  const safe = safeProbeError(error);
  evidence.failure = { code: safe.code, message: safe.message };
  mkdirSync(".local", { recursive: true });
  writeFileSync(output, JSON.stringify(evidence, null, 2));
  console.error(JSON.stringify(evidence.failure));
  process.exitCode = 1;
}
