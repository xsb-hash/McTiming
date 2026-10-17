import { describe, expect, it, vi } from "vitest";
import { budgetToFen, defaultForm, formSchema } from "../src/domain/workflow";
import { createDemoRecommendationAdapter } from "../src/server/demo/recommend-adapter";
import { createRecommendationSession, type RecommendationAdapter } from "../src/server/recommend";
import { createWorkflow } from "../src/server/workflow";
import { contextKey, quoteBinding } from "../src/domain/meal";

const store = { ref: "demo-store-1", name: "虚构门店", address: "虚构地址", available: true, hours: "样例", reservations: [] };
const form = { ...defaultForm, storeRef: store.ref };
function setup(adapter = createDemoRecommendationAdapter(), mode: "demo" | "live" = "demo") {
  const stores = vi.fn(async () => [store]);
  const workflow = createWorkflow({ mode, engine: createRecommendationSession(adapter), stores });
  const search = (revision = 1) => workflow.dispatch({ action: "stores", revision, fulfillment: "pickup", city: form.city, keyword: form.keyword, addressRef: form.addressRef });
  return { workflow, stores, search };
}
describe("web workflow and server review drafts", () => {
  it("converts exact decimal budgets and rejects malformed/conflicting input", () => {
    expect(budgetToFen("0.01")).toBe(1); expect(budgetToFen("25.10")).toBe(2510);
    for (const value of ["0", "-1", "1.001", "Infinity", "1e2", "10000", ""]) expect(() => budgetToFen(value)).toThrow();
    expect(formSchema.safeParse({ ...form, excludedTags: ["beef"] }).success).toBe(false);
  });
  it("projects opaque choices, reuses engine ranking and prepares memory-only review", async () => {
    const { workflow, search } = setup(); await search();
    const result = await workflow.dispatch({ action: "recommend", revision: 2, form });
    expect(result.result!.budgetOptions.map((option) => option.totalFen)).toEqual([2100, 2300]);
    expect(result.result!.overBudgetOption!.totalFen).toBe(2600);
    expect(JSON.stringify(result)).not.toContain("productRef");
    const option = result.result!.budgetOptions[0];
    const reviewed = await workflow.dispatch({ action: "review", revision: 2, optionId: option.id });
    expect(reviewed.draft).toMatchObject({ transactionEnabled: false, revision: 2, option: { totalFen: 2100, source: "demo" } });
    expect((await workflow.dispatch({ action: "bootstrap" })).draft!.id).toBe(reviewed.draft!.id);
    await expect(workflow.dispatch({ action: "review", revision: 2, optionId: option.id, totalFen: 1 })).rejects.toThrow("输入不合法");
    await expect(workflow.dispatch({ action: "create-order", revision: 2 })).rejects.toThrow();
  });
  it("changing conditions invalidates server quotes and drafts, including earlier requests", async () => {
    const { workflow, search } = setup(); await search();
    const result = await workflow.dispatch({ action: "recommend", revision: 2, form });
    const optionId = result.result!.budgetOptions[0].id;
    await workflow.dispatch({ action: "review", revision: 2, optionId });
    await workflow.dispatch({ action: "invalidate", revision: 4 });
    await expect(workflow.dispatch({ action: "invalidate", revision: 3 })).rejects.toThrow("版本已过期");
    await expect(workflow.dispatch({ action: "review", revision: 2, optionId })).rejects.toThrow("已失效");
    expect((await workflow.dispatch({ action: "bootstrap" })).draft).toBeNull();
  });
  it("cannot reuse another session's choice or an unqueried store", async () => {
    const a = setup(), b = setup(); await a.search(); await b.search();
    const result = await a.workflow.dispatch({ action: "recommend", revision: 2, form });
    await expect(b.workflow.dispatch({ action: "review", revision: 2, optionId: result.result!.budgetOptions[0].id })).rejects.toThrow();
    await expect(b.workflow.dispatch({ action: "recommend", revision: 2, form: { ...form, storeRef: "invented" } })).rejects.toThrow("选择");
  });
  it("demo delivery includes fictional delivery fees and cannot save an address", async () => {
    const { workflow } = setup();
    await workflow.dispatch({ action: "stores", revision: 1, fulfillment: "delivery", city: form.city, keyword: form.keyword, addressRef: "demo-address-1" });
    const result = await workflow.dispatch({ action: "recommend", revision: 2, form: { ...form, fulfillment: "delivery", budget: "35" } });
    const option = result.result!.budgetOptions[0];
    expect(option.totalFen).toBe(3200); expect(option.fees.deliveryFen).toBe(600);
    const reviewed = await workflow.dispatch({ action: "review", revision: 2, optionId: option.id });
    expect(reviewed.draft!.deliveryAddress).toContain("虚构地址");
    await expect(workflow.dispatch({ action: "delivery-create-address", revision: 2 })).rejects.toThrow();
  });
  it("keeps empty results on refresh and lets the user decline", async () => {
    const { workflow, search } = setup(); await search();
    await workflow.dispatch({ action: "recommend", revision: 2, form: { ...form, budget: "1" } });
    expect((await workflow.dispatch({ action: "bootstrap" })).result!.budgetOptions).toEqual([]);
    const declined = await workflow.dispatch({ action: "abstain", revision: 3 });
    expect(declined.result).toBeNull(); expect(declined.draft).toBeNull();
  });
  it("discards delayed old recommendations without replacing newer results", async () => {
    const adapter = createDemoRecommendationAdapter();
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    const original = adapter.load;
    adapter.load = async (context, request) => { if (request.budgetFen === 2500) await delayed; return original(context, request); };
    const { workflow, search } = setup(adapter); await search();
    const old = workflow.dispatch({ action: "recommend", revision: 2, form }).catch((error) => error);
    const latest = await workflow.dispatch({ action: "recommend", revision: 3, form: { ...form, budget: "35" } });
    release(); expect(await old).toBeInstanceOf(Error);
    expect((await workflow.dispatch({ action: "bootstrap" })).result).toEqual(latest.result);
  });
  it("blocks live delivery before any store calls", async () => {
    const adapter: RecommendationAdapter = { source: "official", load: vi.fn(), quote: vi.fn() };
    const { workflow, stores } = setup(adapter, "live");
    await expect(workflow.dispatch({ action: "stores", revision: 1, fulfillment: "delivery", city: "城", keyword: "区", addressRef: "unknown" })).rejects.toThrow("仍待验证");
    expect(stores).not.toHaveBeenCalled(); expect(adapter.load).not.toHaveBeenCalled();
  });
  it("never exposes an incomplete official quote as a reviewable amount", async () => {
    const adapter: RecommendationAdapter = {
      source: "official",
      async load(context) { const catalog = await createDemoRecommendationAdapter().load({ ...context, mode: "demo" }, { budgetFen: 3500, template: "main+drink", includeSnack: false, likedTags: [], excludedTags: [] }); return { ...catalog, source: "official", options: catalog.options.map((option) => ({ ...option, source: "official", contextKey: contextKey(context) })) }; },
      async quote(context, request, candidate) { return { source: "official", status: "unknown", binding: quoteBinding(context, request, candidate), totalFen: 3450, fees: null, quotedAt: Date.now(), expiresAt: null, reasons: ["完整费用尚未验证"] }; },
    };
    const { workflow, search } = setup(adapter, "live"); await search();
    const result = await workflow.dispatch({ action: "recommend", revision: 2, form: { ...form, budget: "35" } });
    expect(result.result!.budgetOptions).toEqual([]); expect(result.result!.overBudgetOption).toBeNull(); expect(result.result!.rejectedCount).toBeGreaterThan(0);
    await expect(workflow.dispatch({ action: "review", revision: 2, optionId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow();
  });
});
