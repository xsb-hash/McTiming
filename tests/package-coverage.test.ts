import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diningContextSchema, mealRequestSchema, quoteBinding, type Quote } from "../src/domain/meal";
import { generateCandidates, rankRecommendations } from "../src/domain/recommend";
import { mapMenuOption, priceArguments } from "../src/server/mcd/adapter";
import { detailSchema } from "../src/server/mcd/contracts";

// Existing redacted official menu/detail replay; no network and no new official price claim.
const evidence = JSON.parse(readFileSync("docs/mcp/PHASE5B_VALIDATION_2026-10-14.json", "utf8"));
const record = evidence.records.find((r: { tool: string; arguments: { code?: string } }) => r.tool === "query-meal-detail" && r.arguments.code === "9900015602");
const detail = detailSchema.parse(record.structuredContent.data);
const context = diningContextSchema.parse({ mode: "live", fulfillment: "pickup", storeRef: "1980297", revision: 1, takeWay: "take-in-store", needTableware: false });
const request = mealRequestSchema.parse({ budgetFen: 3500, template: "main+drink", includeSnack: true, likedTags: [], excludedTags: [] });
const NOW = 1800000000000;
const catalogFor = (input = detail) => ({ source: "official" as const, options: [mapMenuOption(context, input, [], [])], coupons: [], claimableHints: [], issues: [] });

describe("official package coverage", () => {
  it("recognizes actual main/snack round labels and prices the package as one product", () => {
    const catalog = catalogFor();
    expect(catalog.options[0].components.map(part => part.role)).toEqual(["main", "snack", "drink"]);
    const generated = generateCandidates(context, request, catalog, NOW);
    expect(generated.candidates).toHaveLength(1);
    const args = priceArguments(context, generated.candidates[0]);
    expect(args.items).toHaveLength(1);
    expect(args.items[0].productCode).toBe("9900015602");
    expect(args.items[0].roundList).toHaveLength(3);
  });
  it("does not infer an unknown round's role from its appetizing product name", () => {
    const unknown = structuredClone(detail); unknown.rounds![0].name = "未验证轮次名称";
    expect(generateCandidates(context, request, catalogFor(unknown), NOW).candidates).toEqual([]);
  });
  it("keeps exclusions and default-quantity validation after recognizing a package", () => {
    expect(generateCandidates(context, { ...request, excludedTags: ["spicy"] }, catalogFor(), NOW).candidates).toEqual([]);
    const invalid = structuredClone(detail); invalid.rounds![0].quantity += 1;
    expect(() => catalogFor(invalid)).toThrow();
  });
  it("preserves the official package name rather than presenting only its components", () => {
    const catalog = catalogFor();
    const generated = generateCandidates(context, request, catalog, NOW);
    expect(generated.candidates).toHaveLength(1);
    const candidate = generated.candidates[0];
    // Artificial quote, not a measured price for this real product.
    const quote: Quote = { source: "official", status: "unknown", referenceBasis: "mcd-pickup-price-fen-no-coupon", binding: quoteBinding(context, request, candidate), totalFen: 3000, fees: null, quotedAt: NOW, expiresAt: null, reasons: ["受控测试"] };
    const result = rankRecommendations(context, request, catalog, generated, [{ candidate, quote }], NOW);
    expect(result.referencePrices[0]).toMatchObject({ products: [{ name: detail.name, quantity: 1 }] });
    expect(result.budgetOptions).toEqual([]);
    expect(result.referencePrices[0]).not.toHaveProperty("id");
  });
  it("compares all reference amounts before taking three, with stable ties and no budget promise", () => {
    // Synthetic catalog and prices: these are not current McDonald's offers.
    const options = [0, 1, 2, 3, 4].map(index => mapMenuOption(context, { ...detail, code: `fixture-package-${index}`, name: `受控套餐 ${index}` }, [], []));
    const catalog = { ...catalogFor(), options };
    const generated = generateCandidates(context, request, catalog, NOW);
    const amounts = [3450, 2990, 2890, 2690, 2690];
    const quoted = generated.candidates.map(candidate => ({ candidate, quote: { source: "official", status: "unknown", referenceBasis: "mcd-pickup-price-fen-no-coupon", binding: quoteBinding(context, request, candidate), totalFen: amounts[Number(candidate.items[0].productRef.slice(-1))], fees: null, quotedAt: NOW, expiresAt: null, reasons: ["受控测试"] } as Quote }));
    const run = (entries = quoted) => rankRecommendations(context, request, catalog, generated, entries, NOW);
    expect(run().referencePrices.map(price => price.amountFen)).toEqual([2690, 2690, 2890]);
    expect(run().referencePrices.map(price => price.products?.[0].name)).toEqual(["受控套餐 3", "受控套餐 4", "受控套餐 2"]);
    expect(run([...quoted].reverse()).referencePrices).toEqual(run().referencePrices);
    expect(run().budgetOptions).toEqual([]);
    expect(run().overBudgetOption).toBeNull();
  });
  it("keeps preference priority for reference display instead of silently switching to price-only", () => {
    const options = [0, 1].map(index => mapMenuOption(context, { ...detail, code: `fixture-preference-${index}`, name: `受控偏好套餐 ${index}` }, [], []));
    options[0].components[0].tags = ["controlled-preference"];
    const preferredRequest = { ...request, likedTags: ["controlled-preference"] };
    const catalog = { ...catalogFor(), options };
    const generated = generateCandidates(context, preferredRequest, catalog, NOW);
    const quoted = generated.candidates.map(candidate => ({ candidate, quote: { source: "official", status: "unknown", referenceBasis: "mcd-pickup-price-fen-no-coupon", binding: quoteBinding(context, preferredRequest, candidate), totalFen: candidate.matchedTags.length ? 3450 : 2690, fees: null, quotedAt: NOW, expiresAt: null, reasons: ["受控测试"] } as Quote }));
    const result = rankRecommendations(context, preferredRequest, catalog, generated, quoted, NOW);
    expect(result.referencePrices.map(price => price.amountFen)).toEqual([3450, 2690]);
    expect(result.budgetOptions).toEqual([]);
  });
});
