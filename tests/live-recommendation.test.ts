import { describe, expect, it, vi } from "vitest";
import { candidateId, quoteBinding, type DiningContext, type MealRequest, type Quote } from "../src/domain/meal";
import { generateCandidates, rankRecommendations, RECOMMEND_LIMITS } from "../src/domain/recommend";
import { createMcdAdapter, mapMenuOption, priceArguments, type McdReadCall } from "../src/server/mcd/adapter";
import { detailSchema } from "../src/server/mcd/contracts";
import { menuVariants, nameTags, selectDetailCodes } from "../src/server/mcd/menu-selection";
import { createRecommendationSession } from "../src/server/recommend";
import { ProbeError } from "../src/server/mcd/probe";

// Controlled fixtures, shaped after the observed official Schema; never a real price claim.
const context: DiningContext = { mode: "live", fulfillment: "pickup", storeRef: "controlled-store", revision: 1, takeWay: "take-in-store", needTableware: false };
const request: MealRequest = { budgetFen: 2500, template: "main+drink", includeSnack: false, likedTags: ["chicken", "sugar-free"], excludedTags: [] };
const now = 1800000000000;
const basis = "mcd-pickup-price-fen-no-coupon";
const choice = (code: string, name: string, selected = true) => ({ code, name, quantity: selected ? 1 : 0, isDefault: selected ? 1 : 0, maxQuantity: -1, supportModify: false, diffPrice: "+ ¥0" });
const detail = detailSchema.parse({ code: "bundle", name: "受控套餐", supportModify: false, rounds: [
  { id: 1, name: "选择主食", quantity: 1, minQuantity: 1, maxQuantity: 1, choices: [choice("beef", "牛肉堡"), choice("chicken", "鸡腿堡", false)] },
  { id: 2, name: "选择套餐内饮料", quantity: 1, minQuantity: 1, maxQuantity: 1, choices: [choice("cola", "可乐中杯"), choice("zero", "无糖可乐中杯", false)] },
] });
function catalog() { return { source: "official" as const, options: menuVariants(detail, request, d => mapMenuOption(context, d, [], []), 2000), coupons: [], claimableHints: [], issues: [] }; }
function fixture(failure?: "coupon" | "detail" | "price" | "auth" | "rate") {
  const call = vi.fn<McdReadCall>(async (tool, args) => {
    if (failure === "auth" || failure === "rate") throw new ProbeError(failure === "auth" ? "AUTH" : "RATE_LIMIT");
    if (failure === "coupon" && /coupons/.test(tool)) throw new Error("PRIVATE_COUPON");
    if (failure === "price" && tool === "calculate-price") throw new Error("PRIVATE_PRICE");
    if (tool === "query-meal-detail" && args.code === "bad") throw new Error("PRIVATE_DETAIL");
    const data: Record<string, unknown> = {
      "query-meals": { categories: [{ name: "精选单人餐", meals: [{ code: "bundle" }, ...(failure === "detail" ? [{ code: "bad" }] : [])] }], meals: { bundle: { name: "受控套餐", currentPrice: "20" }, ...(failure === "detail" ? { bad: { name: "受控失败套餐", currentPrice: "15" } } : {}) } },
      "query-meal-detail": detail, "query-my-coupons": { coupons: [{ id: "PRIVATE_ASSET", code: "PRIVATE_CODE", title: "已有测试券", enable: 0, datetimeText: "受控有效期" }], totalPages: 1 },
      "query-store-coupons": [], "available-coupons": [], "calculate-price": { price: 2000, productPrice: 2000, discount: 0 },
    };
    return { success: true, code: 200, data: data[tool] };
  });
  return { call, adapter: createMcdAdapter(call, () => now) };
}
describe("live non-transactional recommendations", () => {
  it("generates actual alternative round selections with matched and missing preferences", () => {
    const loaded = catalog();
    expect(new Set(loaded.options.map(o => candidateId(o.items, null))).size).toBe(loaded.options.length);
    const best = generateCandidates(context, request, loaded, now).candidates.find(c => c.matchedTags.length === 2)!;
    expect(best.items[0].rounds.map(r => r.choices[0].productRef)).toEqual(["chicken", "zero"]);
    expect(priceArguments(context, best).items[0].productCode).toBe("bundle");
    expect(best.missingTags).toEqual([]);
  });
  it("uses literal name matching only for preferences, never claims ingredient absence", () => {
    expect(nameTags("鸡腿堡")).toContain("chicken");
    expect(nameTags("牛奶")).not.toContain("beef");
    expect(generateCandidates(context, { ...request, excludedTags: ["spicy"] }, catalog(), now).candidates).toEqual([]);
  });
  it("recognizes unknown round roles by matching the child ID to actual menu categories", () => {
    const changed = structuredClone(detail); changed.rounds![0].name = "蓝区"; changed.rounds![1].name = "粉区";
    const mapped = mapMenuOption(context, changed, [], [], { beef: "main", cola: "drink" });
    expect(mapped.components.map(c => c.role)).toEqual(["main", "drink"]);
    expect(mapMenuOption(context, changed, [], []).components.every(c => c.role === "unknown")).toBe(true);
  });
  it("resolves same-store role evidence after all selected details, independent of detail order", async () => {
    const { call } = fixture();
    const mixed = structuredClone(detail); mixed.code = "mixed"; mixed.rounds![0].name = "蓝区"; mixed.rounds![1].name = "粉区";
    const adapter = createMcdAdapter(async (tool, args) => {
      if (tool === "query-meals") return { success: true, code: 200, data: { categories: [{ name: "精选单人餐", meals: [{ code: "mixed" }, { code: "bundle" }] }], meals: { mixed: { name: "受控混合选区", currentPrice: "10" }, bundle: { name: "受控分类依据", currentPrice: "20" } } } };
      if (tool === "query-meal-detail" && args.code === "mixed") return { success: true, code: 200, data: mixed };
      return call(tool, args);
    });
    const loaded = await adapter.load(context, request);
    expect(loaded.options.filter(o => o.ref === "mixed").length).toBeGreaterThan(0);
    expect(loaded.options.filter(o => o.ref === "mixed").every(o => o.components.every(c => c.role !== "unknown"))).toBe(true);
  });
  it("quotes a singles combination as a complete request, separate from a package", () => {
    const options = [mapMenuOption(context, { code: "main", name: "鸡肉堡", supportModify: false, rounds: [] }, ["鸡肉汉堡\n/卷"], []), mapMenuOption(context, { code: "drink", name: "无糖可乐", supportModify: false, rounds: [] }, ["饮品"], [])];
    const generated = generateCandidates(context, request, { ...catalog(), options }, now);
    expect(generated.candidates).toHaveLength(1);
    expect(priceArguments(context, generated.candidates[0]).items).toHaveLength(2);
    expect(priceArguments(context, generated.candidates[0]).items.every(i => !i.roundList)).toBe(true);
  });
  it("does not turn condiments in the mixed other category into a snack", () => {
    const sauce = mapMenuOption(context, { code: "sauce", name: "受控蘸酱", supportModify: false, rounds: [] }, ["小食甜品\n/其他", "炸鸡"], []);
    expect(sauce.components[0].role).toBe("unknown");
    const fries = mapMenuOption(context, { code: "fries", name: "受控中薯条", supportModify: false, rounds: [] }, ["小食甜品\n/其他"], [], { fries: "snack" });
    expect(fries.components[0].role).toBe("snack");
  });
  it("samples lower hints, preferences and categories beyond the first menu entries", () => {
    const codes = Array.from({ length: 60 }, (_, i) => `p${i}`);
    const menu = { categories: [{ name: "精选单人餐", meals: codes.map(code => ({ code })) }], meals: Object.fromEntries(codes.map((code, i) => [code, { name: i === 58 ? "鸡肉套餐" : "受控套餐", currentPrice: i === 59 ? "10" : "40" }])) };
    const selected = selectDetailCodes(menu, request);
    expect(selected.length).toBeLessThanOrEqual(RECOMMEND_LIMITS.detailQueries);
    expect(selected).toEqual(expect.arrayContaining(["p58", "p59"]));
  });
  it("groups comparable reference quotes without granting strict budget or purchase authority", () => {
    const loaded = catalog(); const generated = generateCandidates(context, request, loaded, now);
    const quoted = generated.candidates.map((candidate, i) => ({ candidate, quote: { source: "official", status: "unknown", referenceBasis: basis, binding: quoteBinding(context, request, candidate), totalFen: candidate.matchedTags.length === 2 ? 2700 : i % 2 ? 2500 : 2300, fees: null, quotedAt: now, expiresAt: null, reasons: [] } as Quote }));
    const result = rankRecommendations(context, request, loaded, generated, quoted, now);
    expect(result.status).toBe("ready"); expect(result.budgetOptions).toEqual([]); expect(result.overBudgetOption).toBeNull();
    expect(result.referencePrices.filter(p => p.budgetRelation === "reference-within").every(p => p.amountFen <= 2500)).toBe(true);
    expect(result.referencePrices.filter(p => p.budgetRelation === "reference-over")).toHaveLength(1);
    expect(result.referencePrices.find(p => p.budgetRelation === "reference-over")).toMatchObject({ budgetDifferenceFen: 200, matchedTags: ["chicken", "sugar-free"] });
    expect(result.referencePrices.every(p => !("id" in p))).toBe(true);
  });
  it("does not price-sort or calculate budget differences for unestablished bases", () => {
    const loaded = catalog(); const generated = generateCandidates(context, request, loaded, now);
    const quoted = generated.candidates.map((candidate, i) => ({ candidate, quote: { source: "official", status: "unknown", referenceBasis: `unknown-${i}`, binding: quoteBinding(context, request, candidate), totalFen: i + 1, fees: null, quotedAt: now, expiresAt: null, reasons: [] } as Quote }));
    const run = (entries = quoted) => rankRecommendations(context, request, loaded, generated, entries, now);
    expect(run().referencePrices.every(p => p.budgetRelation === undefined && p.budgetDifferenceFen === undefined)).toBe(true);
    expect(run().referencePrices).toEqual(run([...quoted].reverse()).referencePrices);
  });
  it.each(["coupon", "detail"] as const)("%s failure does not discard other legal official candidates", async failure => {
    const { adapter, call } = fixture(failure);
    const run = await createRecommendationSession(adapter, () => now).run(context, request);
    if (run.status !== "complete") throw new Error();
    expect(run.recommendation.referencePrices.length).toBeGreaterThan(0);
    expect(run.recommendation.budgetOptions).toEqual([]);
    expect(JSON.stringify(run)).not.toMatch(/PRIVATE_/);
    if (failure === "detail") expect(run.recommendation.unavailableItems?.[0].name).toBe("受控失败套餐");
    expect(call.mock.calls.every(([name]) => !/create|bind|pay|redeem/.test(name))).toBe(true);
  });
  it("exposes owned coupon conditions without asset identifiers or unverified discounts", async () => {
    const { adapter } = fixture(); const loaded = await adapter.load(context, request);
    expect(loaded.coupons).toEqual([]);
    expect(loaded.couponHints?.[0]).toMatchObject({ name: "已有测试券", status: "已持有", conditions: expect.arrayContaining(["官方标记当前不可用"]) });
    expect(JSON.stringify(loaded)).not.toMatch(/PRIVATE_ASSET|PRIVATE_CODE/);
  });
  it("rejects a quote whose returned product identity differs from the submitted configuration", async () => {
    const { call } = fixture();
    const adapter = createMcdAdapter(async (tool, args) => tool === "calculate-price" ? { success: true, code: 200, data: { price: 2000, productPrice: 2000, discount: 0, productList: [{ productCode: "unrelated", quantity: 1 }] } } : call(tool, args));
    const run = await createRecommendationSession(adapter).run(context, request);
    if (run.status !== "complete") throw new Error();
    expect(run.recommendation.referencePrices).toEqual([]);
    expect(run.recommendation.rejectedQuotes.every(r => r.quote.status === "failed")).toBe(true);
  });
  it("keeps successful current prices when one candidate quote fails", async () => {
    const { call } = fixture(); let quoted = 0;
    const adapter = createMcdAdapter(async (tool, args) => {
      if (tool === "calculate-price" && quoted++ === 0) throw new ProbeError("NETWORK");
      return call(tool, args);
    });
    const run = await createRecommendationSession(adapter).run(context, request);
    if (run.status !== "complete") throw new Error();
    expect(run.recommendation.referencePrices.length).toBeGreaterThan(0);
    expect(run.recommendation.rejectedQuotes.filter(r => r.quote.status === "failed")).toHaveLength(1);
  });
  it.each(["price", "auth", "rate"] as const)("%s failure remains an explicit failure without a demo fallback", async failure => {
    const { adapter } = fixture(failure); const run = await createRecommendationSession(adapter, () => now).run(context, request);
    if (run.status !== "complete") throw new Error();
    expect(run.recommendation.source).toBe("official"); expect(run.recommendation.referencePrices).toEqual([]);
    expect(run.recommendation.budgetOptions).toEqual([]);
    if (failure !== "price") expect(run.recommendation.issues.join()).toMatch(failure === "auth" ? /鉴权失败/ : /限流/);
  });
});
