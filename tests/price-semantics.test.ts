import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diningContextSchema, mealRequestSchema, quoteBinding, quoteSchema, type Quote } from "../src/domain/meal";
import { expireRecommendation, generateCandidates, rankRecommendations } from "../src/domain/recommend";
import { budgetToFen, defaultForm, money } from "../src/domain/workflow";
import { mapMenuOption } from "../src/server/mcd/adapter";
import { detailSchema, priceSchema } from "../src/server/mcd/contracts";
import { createRecommendationSession, type RecommendationAdapter } from "../src/server/recommend";
import { createWorkflow } from "../src/server/workflow";

// Offline replay of saved redacted real fields. No token, transport or fresh MCP calls.
const evidence = JSON.parse(readFileSync("docs/mcp/PHASE5B_VALIDATION_2026-10-14.json", "utf8"));
const detailRecord = evidence.records.find((r: { tool: string; arguments: { code?: string } }) => r.tool === "query-meal-detail" && r.arguments.code === "9900004064");
const priceRecord = evidence.records.find((r: { tool: string }) => r.tool === "calculate-price");
const context = diningContextSchema.parse({ mode: "live", fulfillment: "pickup", storeRef: priceRecord.arguments.storeCode, revision: 1, takeWay: "take-in-store", needTableware: false });
const request = mealRequestSchema.parse({ budgetFen: 4000, template: "main+drink", includeSnack: true, likedTags: [], excludedTags: [] });
const NOW = Date.parse(priceRecord.at) + 1000;
const option = mapMenuOption(context, detailSchema.parse(detailRecord.structuredContent.data), [], []);
const catalog = { source: "official" as const, options: [option], coupons: [], claimableHints: [], issues: [] };
const generated = generateCandidates(context, request, catalog, NOW);
const candidate = generated.candidates[0];
const data = priceSchema.parse(priceRecord.structuredContent.data);
const quote: Quote = { source: "official", status: "unknown", binding: quoteBinding(context, request, candidate), totalFen: data.price, fees: null, quotedAt: NOW, expiresAt: null, reasons: ["费用待核验"] };
const rank = (patch: Partial<Quote> = {}) => rankRecommendations(context, request, catalog, generated, [{ candidate, quote: { ...quote, ...patch } }], NOW);

describe("price semantics and non-purchasable reference amounts", () => {
  it("uses top-level price in fen, keeps missing fees unknown and does not grant purchase authority", () => {
    expect(data).toMatchObject({ price: 3450, productPrice: 3450, discount: 0, productList: [{ productCode: candidate.items[0].productRef, quantity: 1 }] });
    const result = rank();
    expect(result.budgetOptions).toEqual([]); expect(result.overBudgetOption).toBeNull();
    expect(result.coverage.succeeded).toBe(0);
    expect(result.referencePrices).toEqual([{ candidateId: candidate.id, products: [{ name: option.name, quantity: 1 }], items: candidate.components.map(({ name, quantity }) => ({ name, quantity })), amountFen: 3450, quotedAt: NOW, expiresAt: null }]);
    expect(result.referencePrices[0]).not.toHaveProperty("id");
    expect(result.referencePrices[0]).not.toHaveProperty("fees");
  });
  it.each<Partial<Quote>>([{ status: "failed" }, { status: "expired" }, { totalFen: null }, { source: "demo" }, { binding: "stale" }, { quotedAt: NOW + 1 }, { expiresAt: NOW }])("does not display failed, mismatched, unknown-source or expired observations: %j", (patch) => {
    expect(rank(patch).referencePrices).toEqual([]);
  });
  it("does not expose an excluded composition as a reference and removes observations on invalidation", () => {
    const excluded = { ...request, excludedTags: ["main"] };
    const result = rankRecommendations(context, excluded, catalog, generated, [{ candidate, quote: { ...quote, binding: quoteBinding(context, excluded, candidate) } }], NOW);
    expect(result.referencePrices).toEqual([]);
    expect(expireRecommendation(rank()).referencePrices).toEqual([]);
  });
  it("formats exact integer fen without floating-point cent rounding, and rejects fractional or unsafe fen", () => {
    expect(money(3450)).toBe("¥34.50"); expect(money(1)).toBe("¥0.01"); expect(money(0)).toBe("¥0.00");
    expect(money(Number.MAX_SAFE_INTEGER)).toBe("¥90071992547409.91");
    for (const bad of [34.5, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => money(bad)).toThrow();
    expect(budgetToFen("34.50")).toBe(3450); expect(budgetToFen("9999.99")).toBe(999999);
    expect(() => budgetToFen("34.505")).toThrow();
  });
  it("preserves complete fee equality validation and does not subtract discounts twice", () => {
    const complete = { ...quote, status: "verified", totalFen: 3450, fees: { productFen: 3000, discountFen: 500, packingFen: 100, tablewareFen: 50, deliveryFen: 300 } };
    expect(quoteSchema.parse(complete).totalFen).toBe(3450);
    expect(() => quoteSchema.parse({ ...complete, totalFen: 2950 })).toThrow();
    expect(() => quoteSchema.parse({ ...complete, fees: null })).toThrow();
  });
  it("returns display-only references through workflow, rejects review and clears them after conditions change", async () => {
    const adapter: RecommendationAdapter = {
      source: "official",
      async load(ctx) { return { ...catalog, options: [mapMenuOption(ctx, detailSchema.parse(detailRecord.structuredContent.data), [], [])] }; },
      async quote(ctx, req, selected) { return { ...quote, binding: quoteBinding(ctx, req, selected), quotedAt: Date.now() }; },
    };
    const workflow = createWorkflow({ mode: "live", engine: createRecommendationSession(adapter), stores: async () => [{ ref: context.storeRef, name: "受控回放门店", address: "", hours: "", reservations: [], available: true }] });
    const form = { ...defaultForm, storeRef: context.storeRef, likedTags: [], budget: "40", includeSnack: true };
    await workflow.dispatch({ action: "stores", revision: 1, fulfillment: form.fulfillment, city: form.city, keyword: form.keyword, addressRef: form.addressRef });
    const view = await workflow.dispatch({ action: "recommend", revision: 2, form });
    expect(view.result?.referencePrices[0].amountFen).toBe(3450);
    expect(view.result?.budgetOptions).toEqual([]); expect(view.draft).toBeNull();
    await expect(workflow.dispatch({ action: "review", revision: 2, optionId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow();
    await workflow.dispatch({ action: "invalidate", revision: 3 });
    expect((await workflow.dispatch({ action: "bootstrap" })).result).toBeNull();
  });
});
