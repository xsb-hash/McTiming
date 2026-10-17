import { defaultForm } from "../../src/domain/workflow";
import { createMcdAdapter, type McdReadCall } from "../../src/server/mcd/adapter";
import { createRecommendationSession } from "../../src/server/recommend";
import { createWorkflow } from "../../src/server/workflow";

// Artificial protocol fixtures, never real store/price evidence. Unexpected tools fail closed.
export function liveReferenceFixture(now = Date.now) {
  const calls: string[] = [];
  const store = { ref: "controlled-live-store", name: "受控真实模式门店", address: "受控门店位置", available: true, hours: "受控时段", reservations: [] };
  const form = { ...defaultForm, storeRef: store.ref, likedTags: ["chicken", "sugar-free"] as typeof defaultForm.likedTags };
  const choice = (code: string, name: string) => ({ code, name, quantity: 1, isDefault: 1, maxQuantity: -1, supportModify: false });
  const responses: Record<string, unknown> = {
    "query-meals": { categories: [{ name: "精选单人餐", meals: [{ code: "controlled-bundle" }] }], meals: { "controlled-bundle": { name: "受控鸡肉双人气套餐", currentPrice: "13.9" } } },
    "query-meal-detail": { code: "controlled-bundle", name: "受控鸡肉双人气套餐", supportModify: false, rounds: [
      { id: 1, name: "选择主食", quantity: 1, minQuantity: 1, maxQuantity: 1, choices: [choice("controlled-chicken", "受控鸡肉堡")] },
      { id: 2, name: "选择套餐内饮料", quantity: 1, minQuantity: 1, maxQuantity: 1, choices: [choice("controlled-zero", "受控无糖可乐")] },
    ] },
    "query-my-coupons": { coupons: [], totalPages: 1 }, "query-store-coupons": [], "available-coupons": [],
    "calculate-price": { price: 1390, productPrice: 1390, discount: 0 },
  };
  const call: McdReadCall = async tool => {
    calls.push(tool);
    if (!(tool in responses)) throw new Error("Forbidden fixture tool");
    return { success: true, code: 200, data: structuredClone(responses[tool]) };
  };
  const engine = createRecommendationSession(createMcdAdapter(call, now), now);
  const workflow = createWorkflow({ mode: "live", engine, stores: async () => [store] });
  async function recommend() {
    await workflow.dispatch({ action: "stores", revision: 1, fulfillment: "pickup", city: form.city, keyword: form.keyword, addressRef: "" });
    return workflow.dispatch({ action: "recommend", revision: 2, form });
  }
  return { workflow, engine, calls, form, store, recommend };
}
