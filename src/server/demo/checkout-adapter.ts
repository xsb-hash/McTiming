import { randomUUID } from "node:crypto";
import { generateCandidates } from "../../domain/recommend";
import { createDemoRecommendationAdapter } from "./recommend-adapter";
import type { CheckoutAdapter } from "../checkout";
import type { DemoOrder, DemoScenario } from "../../domain/checkout";

function simulateCreate(scenario: DemoScenario) {
  if (scenario === "failure") return { status: "failed" as const };
  if (scenario === "timeout") return { status: "unknown" as const };
  return { status: "created" as const, order: { id: `DEMO-${randomUUID()}`, source: "demo" as const, status: "模拟待支付" as const, payment: "模拟支付信息：不提供支付链接，不可实际支付。" as const } };
}
async function simulateQuery(order: DemoOrder): Promise<DemoOrder> { return { ...order, status: "模拟配餐中（未真实支付）" }; }

// Reuse only the in-memory transaction simulator, never the fictional menu/price adapter.
export function createReferenceSimulationAdapter(): CheckoutAdapter {
  return {
    kind: "reference-simulation",
    async recheck(snapshot, scenario) {
      if (snapshot.context.mode !== "live" || snapshot.quote.source !== "official" || scenario !== "normal") return { status: "blocked", reason: "模拟来源或场景不正确。" };
      return { status: "verified", snapshot: structuredClone(snapshot) };
    },
    async create(snapshot, scenario) {
      if (snapshot.context.mode !== "live" || snapshot.quote.source !== "official" || snapshot.quote.status !== "unknown" || scenario !== "normal") throw new Error("仅允许官方参考价的本地模拟");
      return simulateCreate(scenario);
    },
    query: simulateQuery,
  };
}

// No MCP dependency, credentials, payment URL or externally persisted state.
export function createDemoCheckoutAdapter(storeStillValid: (storeRef: string) => Promise<boolean>, now = Date.now): CheckoutAdapter {
  const meals = createDemoRecommendationAdapter(now);
  return {
    async recheck(snapshot, scenario) {
      const { context, request, candidate } = snapshot;
      if (context.mode !== "demo" || !(await storeStillValid(context.storeRef))) return { status: "blocked", reason: "样例门店已不可用，未创建订单。" };
      if (context.fulfillment === "delivery" && (context.addressRef !== "demo-address-1" || context.businessRef !== "demo-delivery")) return { status: "blocked", reason: "样例配送地址或履约条件不匹配。" };
      const catalog = await meals.load(context, request);
      const found = generateCandidates(context, request, catalog, now()).candidates.find((value) => value.id === candidate.id);
      if (!found) return { status: "blocked", reason: "商品、规格、数量或优惠已不可用，请重新推荐。" };
      const quote = await meals.quote(context, request, found);
      if (scenario === "price-change") {
        quote.totalFen! += 200;
        quote.fees!.productFen += 200;
        quote.reasons = ["受控样例调价 +2 元，要求重新确认"];
      }
      return { status: "verified", snapshot: { context, request, candidate: found, quote } };
    },
    async create(snapshot, scenario) {
      if (snapshot.context.mode !== "demo" || snapshot.quote.source !== "demo") throw new Error("演示模式不匹配");
      return simulateCreate(scenario);
    },
    query: simulateQuery,
  };
}
