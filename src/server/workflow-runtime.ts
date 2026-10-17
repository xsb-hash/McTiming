import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parseConfig } from "./config";
import { createConfiguredRecommendationSession } from "./recommend-runtime";
import { createWorkflow, WorkflowError } from "./workflow";

const lifetime = 30 * 60_000;
type Entry = { expires: number; workflow: Promise<ReturnType<typeof createWorkflow>> };
const sessions = new Map<string, Entry>();
export async function getWorkflow(cookie?: string) {
  const now = Date.now();
  for (const [key, entry] of sessions) if (entry.expires <= now) { sessions.delete(key); void entry.workflow.then((value) => value.invalidate()); }
  let id = cookie && sessions.has(cookie) ? cookie : undefined;
  if (!id) {
    if (sessions.size >= 500) throw new WorkflowError("当前会话较多，请稍后重试。", 503);
    id = randomUUID();
    const config = parseConfig(process.env);
    const workflow = createConfiguredRecommendationSession().then((engine) => createWorkflow({ sessionId: id, mode: config.mode, engine, stores: async (search) => {
      if (config.mode === "demo") return [
        { ref: "demo-store-1", name: "样例中央广场店", address: "样例城市 · 中央广场 1 层（虚构门店）", available: true, hours: "演示营业中", reservations: [] },
        { ref: "demo-store-2", name: "样例河畔公园店", address: "样例城市 · 河畔步行街 20 号（虚构门店）", available: true, hours: "演示营业中", reservations: [] },
      ];
      if (!config.token) throw new WorkflowError("本机未配置 MCP Token。请按 docs/MCP_SETUP.md 在服务端配置并重启。", 503);
      const { runProbe, ProbeError } = await import("./mcd/probe");
      let data: unknown;
      try {
        await runProbe({ env: { MCTIMING_MODE: "live", MCD_MCP_TOKEN: config.token }, tool: "query-nearby-stores", arguments: { beType: 1, searchType: 2, city: search.city, keyword: search.keyword }, onResult: (response) => { data = response.structuredContent; } });
      } catch (error) {
        throw new WorkflowError(error instanceof ProbeError ? `真实门店查询失败（${error.code}），未切换为演示数据。` : "真实门店查询失败，未切换为演示数据。", 502);
      }
      // Names/types from the saved stage-2 Schema. No availability default.
      const parsed = z.object({ success: z.literal(true), code: z.literal(200), data: z.array(z.object({ storeCode: z.string(), storeName: z.string(), address: z.string(), businessStatus: z.boolean(), businessStartTime: z.string().optional(), businessEndTime: z.string().optional(), reservation: z.boolean().optional(), reservationTimeOptions: z.array(z.object({ date: z.string(), reservationOptionText: z.string(), today: z.boolean() })).optional() })) }).safeParse(data);
      if (!parsed.success) throw new WorkflowError("官方门店返回结构无法验证，不能继续选店。", 502);
      return parsed.data.data.map((store) => ({ ref: store.storeCode, name: store.storeName, address: store.address, available: store.businessStatus, hours: store.businessStartTime && store.businessEndTime ? `${store.businessStartTime}–${store.businessEndTime}` : "营业时间未提供", reservations: store.reservation ? (store.reservationTimeOptions ?? []).map((slot) => `${slot.date}${slot.today ? "（今天）" : ""} ${slot.reservationOptionText}`) : [] }));
    } }));
    sessions.set(id, { expires: now + lifetime, workflow });
  }
  const entry = sessions.get(id)!;
  entry.expires = now + lifetime;
  return { id, workflow: await entry.workflow };
}

export function assertWorkflowOrigin(request: Request, mode: "demo" | "live") {
  // Next may normalize request.url to the bind address. Compare the browser's
  // Origin to Host, not that internal address; never trust X-Forwarded-Host.
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  let external: URL;
  try { external = new URL(origin ?? ""); } catch { throw new WorkflowError("仅接受同源网页请求。", 403); }
  if (!host || external.origin !== origin || external.host !== host || !["http:", "https:"].includes(external.protocol)) throw new WorkflowError("仅接受同源网页请求。", 403);
  if (mode === "live" && !["127.0.0.1", "localhost", "[::1]"].includes(external.hostname)) throw new WorkflowError("真实模式仅允许本机回环地址访问。", 403);
}
