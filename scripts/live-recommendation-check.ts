import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadLocalEnv } from "./load-local-env";
import { runProbe, safeProbeError } from "../src/server/mcd/probe";
import { createMcdAdapter } from "../src/server/mcd/adapter";
import { createRecommendationSession } from "../src/server/recommend";
import { createWorkflow } from "../src/server/workflow";
import { defaultForm } from "../src/domain/workflow";
import { detailSchema, menuSchema } from "../src/server/mcd/contracts";

// Explicit read-only validation. Persist only public product/configuration fields and counts.
const flags = parseArgs({ options: { city: { type: "string", default: "唐山市" }, keyword: { type: "string", default: "路北区" } }, strict: true }).values;
const env = loadLocalEnv();
const calls: object[] = [];
const scenarios: object[] = [];
const report = { startedAt: new Date().toISOString(), source: "current official MCP via locked project SDK", calls, scenarios };
mkdirSync(".local", { recursive: true });
const save = () => writeFileSync(".local/live-recommendation-check.json", JSON.stringify(report, null, 2));
const storeSchema = z.object({ success: z.literal(true), code: z.literal(200), data: z.array(z.object({ storeCode: z.string(), storeName: z.string(), businessStatus: z.boolean() })) });
async function call(tool: string, args: Record<string, unknown>) {
  let payload: unknown;
  const at = new Date().toISOString();
  try {
    await runProbe({ env, tool, arguments: args, onResult: result => { payload = result.structuredContent; } });
    const envelope = z.object({ success: z.boolean().optional(), code: z.number().optional(), data: z.unknown() }).parse(payload);
    const evidence: Record<string, unknown> = { at, tool, inputKeys: Object.keys(args), success: envelope.success, code: envelope.code };
    if (["query-meals", "query-meal-detail", "calculate-price"].includes(tool)) evidence.storeCode = args.storeCode;
    if (tool === "query-meal-detail") evidence.productCode = args.code;
    if (tool === "query-meals" && envelope.success) evidence.menu = menuSchema.parse(envelope.data);
    if (tool === "query-meal-detail" && envelope.success) evidence.detail = detailSchema.parse(envelope.data);
    if (tool === "calculate-price") {
      evidence.configuration = args.items; // This validator quotes no-coupon catalog candidates only.
      evidence.amounts = z.object({ price: z.number().optional(), productPrice: z.number().optional(), discount: z.number().optional(), deliveryPrice: z.number().optional(), packingPrice: z.number().optional(), tablewarePrice: z.number().optional() }).safeParse(envelope.data).data;
    }
    calls.push(evidence);
    return payload;
  } catch (error) { calls.push({ at, tool, error: safeProbeError(error).code }); throw error; }
  finally { save(); }
}
try {
  const workflow = createWorkflow({ mode: "live", engine: createRecommendationSession(createMcdAdapter(call)), stores: async () => storeSchema.parse(await call("query-nearby-stores", { beType: 1, searchType: 2, city: flags.city, keyword: flags.keyword })).data.map(s => ({ ref: s.storeCode, name: s.storeName, available: s.businessStatus, address: "", hours: "", reservations: [] })) });
  const search = { action: "stores", revision: 1, fulfillment: "pickup", city: flags.city, keyword: flags.keyword, addressRef: "" };
  const stores = (await workflow.dispatch(search)).stores.filter(s => s.available).slice(0, 2);
  for (const [index, store] of stores.entries()) {
    const revision = 2 + index * 2;
    if (index > 0) {
      await workflow.dispatch({ action: "invalidate", revision: revision - 1 });
      const cleared = await workflow.dispatch({ action: "bootstrap" });
      if (cleared.result || cleared.draft) throw new Error("Stale state survived");
    }
    const view = await workflow.dispatch({ action: "recommend", revision, form: { ...defaultForm, city: flags.city, keyword: flags.keyword, addressRef: "", storeRef: store.ref, budget: "25", likedTags: ["chicken", "sugar-free"] } });
    const result = view.result!;
    scenarios.push({ scenario: index === 0 ? "A" : "B", at: new Date().toISOString(), store: { code: store.ref, name: store.name }, input: { budgetFen: 2500, likedTags: ["chicken", "sugar-free"], excludedTags: [] }, referencePrices: result.referencePrices, coverage: result.coverage, issues: result.issues, unavailableItems: result.unavailableItems, verifiedFinalCount: result.budgetOptions.length, draft: view.draft, status: result.referencePrices.some(p => p.basis) ? "REAL_REFERENCE_PASSED" : "NO_VERIFIED_REFERENCE" });
    save();
    console.log(`场景 ${index === 0 ? "A" : "B"}：${result.referencePrices.length} 条当前官方参考结果；真实写操作 0。`);
  }
  if (stores.length < 2) scenarios.push({ scenario: "B", status: "MISSING_SECOND_STORE" });
  if (stores.length) {
    const callsBefore = calls.length;
    const view = await workflow.dispatch({ action: "recommend", revision: 6, form: { ...defaultForm, city: flags.city, keyword: flags.keyword, addressRef: "", storeRef: stores.at(-1)!.ref, likedTags: [], excludedTags: ["spicy"] } });
    scenarios.push({ scenario: "C", status: view.result?.coverage.attempted === 0 && !view.result?.referencePrices.length ? "REAL_EXCLUSION_BLOCK_PASSED" : "CHECK_REQUIRED", result: view.result ? { coverage: view.result.coverage, message: view.result.message, issues: view.result.issues, referenceCount: view.result.referencePrices.length } : null, calls: calls.length - callsBefore });
  }
  save();
  console.log("脱敏证据：.local/live-recommendation-check.json。参考结果不代表完整费用或交易验证成功。");
} catch (error) {
  scenarios.push({ status: "FAILED", error: safeProbeError(error).code }); save();
  console.error(safeProbeError(error).message); process.exitCode = 1;
}
