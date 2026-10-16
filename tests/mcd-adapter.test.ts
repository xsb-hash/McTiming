import { describe, expect, it, vi } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/client";
import schemas from "../docs/mcp/TOOL_SCHEMAS_2026-10-12.json";
import { contextKey, type DiningContext, type MealRequest } from "../src/domain/meal";
import { generateCandidates } from "../src/domain/recommend";
import { createRecommendationSession } from "../src/server/recommend";
import { createMcdAdapter, priceArguments, type McdReadCall } from "../src/server/mcd/adapter";
import { detailSchema } from "../src/server/mcd/contracts";

const context: DiningContext = { mode: "live", fulfillment: "pickup", storeRef: "0000000", revision: 1, needTableware: false, takeWay: "take-in-store" };
const request: MealRequest = { budgetFen: 4000, template: "main+drink", includeSnack: false, likedTags: [], excludedTags: [] };
const NOW = 1_800_000_000_000;
// Synthetic values shaped after the real stage 2 contract, not a new real call.
const detail = {
  code: "fixture-bundle", name: "合成套餐", supportModify: false,
  rounds: [
    { id: 1, name: "主食任意选", quantity: 1, minQuantity: 1, maxQuantity: 1, choices: [{ code: "fixture-main", name: "合成主食", quantity: 1, isDefault: 1, maxQuantity: -1, supportModify: true, modification: { items: [{ minValues: 0, maxValues: 2, values: [
      { code: "fixture-sauce", selectedKey: "0-1", unselectedKey: "0-0", selectedQuantity: 1, minQuantity: 0, maxQuantity: 1 },
      { code: "fixture-onion", selectedKey: "0-1", unselectedKey: "0-0", selectedQuantity: 0, minQuantity: 0, maxQuantity: 1 },
    ] }] } }] },
    { id: 2, name: "选择套餐内饮料", quantity: 1, minQuantity: 1, maxQuantity: 1, choices: [{ code: "fixture-drink", name: "合成饮品", quantity: 1, isDefault: 1, maxQuantity: -1, supportModify: false }] },
  ],
};
function fixture(price: unknown = { price: 3450, productPrice: 3450, discount: 0 }, customDetail: unknown = detail) {
  const call = vi.fn<McdReadCall>(async (name) => {
    const payloads: Record<string, unknown> = {
      "query-meals": { categories: [{ name: "精选单人餐", meals: [{ code: "fixture-bundle" }] }], meals: { "fixture-bundle": { name: "合成套餐", currentPrice: "34.5", canWithOrder: false } } },
      "query-meal-detail": customDetail,
      "query-my-coupons": { coupons: [], totalPages: 1 },
      "query-store-coupons": [],
      "available-coupons": [{ couponName: "合成可领取券", couponStatus: "CAN_GET", label: "可领取" }],
      "calculate-price": price,
    };
    if (!Object.hasOwn(payloads, name)) throw new Error("Unexpected call");
    return { success: true, code: 200, data: payloads[name] };
  });
  return { call, adapter: createMcdAdapter(call, () => NOW) };
}

describe("MCP adapter: controlled protocol fixtures only", () => {
  it("maps verified role labels and default round/modification selections to the actual input Schema", async () => {
    const { adapter, call } = fixture();
    const catalog = await adapter.load(context, request);
    expect(catalog.options[0].source).toBe("official");
    expect(catalog.options[0].selectionHintFen).toBeNull();
    const candidate = generateCandidates(context, request, catalog, NOW).candidates[0];
    const args = priceArguments(context, candidate);
    const schema = schemas.tools.find((tool) => tool.name === "calculate-price")!;
    expect(new AjvJsonSchemaValidator().getValidator(schema.inputSchema as JsonSchemaType)(args).valid).toBe(true);
    expect(args).not.toHaveProperty("beCode");
    expect(args.items[0].roundList?.find((round) => round.round === "1")).toMatchObject({ round: "1", comboItemList: [{ code: "fixture-main", quantity: 1, modification: { values: expect.arrayContaining([{ code: "fixture-sauce", key: "0-1", quantity: 1 }, { code: "fixture-onion", key: "0-0", quantity: 0 }]) } }] });
    const quote = await adapter.quote(context, request, candidate);
    expect(quote).toMatchObject({ status: "unknown", totalFen: 3450, fees: null });
    expect(call.mock.calls.map(([name]) => name)).toContain("calculate-price");
    expect(call.mock.calls.every(([name]) => !/create|bind|pay|redeem/.test(name))).toBe(true);
  });
  it("does not claim official purchasability even when all declared fee fields are returned", async () => {
    const { adapter } = fixture({ price: 3450, productPrice: 3450, discount: 0, deliveryPrice: 0, packingPrice: 0, tablewarePrice: 0 });
    const result = await createRecommendationSession(adapter, () => NOW).run(context, request);
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.recommendation.budgetOptions).toEqual([]);
      expect(result.recommendation.rejectedQuotes[0].quote.status).toBe("unknown");
    }
  });
  it.each([undefined, null, "3450", 34.5, -1, Number.MAX_SAFE_INTEGER + 1])("rejects invalid or missing official fen: %s", async (value) => {
    const { adapter } = fixture({ price: value, productPrice: 3450, discount: 0 });
    const result = await createRecommendationSession(adapter, () => NOW).run(context, request);
    if (result.status !== "complete") throw new Error();
    expect(result.recommendation.rejectedQuotes[0].quote).toMatchObject({ status: "failed", totalFen: null });
  });
  it("never invents ingredient exclusions from menu names or customization lists", async () => {
    const { adapter, call } = fixture();
    const result = await createRecommendationSession(adapter, () => NOW).run(context, { ...request, excludedTags: ["spicy"] });
    if (result.status !== "complete") throw new Error();
    expect(result.recommendation.coverage.attempted).toBe(0);
    expect(call.mock.calls.some(([name]) => name === "calculate-price")).toBe(false);
  });
  it("blocks unverified delivery without any calls and refuses demo mode", async () => {
    const { adapter, call } = fixture();
    const delivery: DiningContext = { mode: "live", fulfillment: "delivery", addressRef: "fixture-address", businessRef: "fixture-business", storeRef: "0000000", revision: 1, needTableware: false };
    const catalog = await adapter.load(delivery, request);
    expect(catalog.options).toEqual([]);
    expect(catalog.issues[0]).toContain("外送链路尚未验证");
    await expect(adapter.load({ ...context, mode: "demo" }, request)).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it("does not map missing rounds to a complete single item", async () => {
    const { rounds: _, ...withoutRounds } = detail;
    const { adapter } = fixture(undefined, withoutRounds);
    const catalog = await adapter.load(context, request);
    expect(catalog.options[0].composition).toBe("unknown");
    expect(generateCandidates(context, request, catalog, NOW).candidates).toEqual([]);
  });
  it("fails safely on a remote business error without propagating raw text", async () => {
    const call = vi.fn<McdReadCall>(async () => ({ success: false, code: 999, message: "PRIVATE_CANARY" }));
    const result = await createRecommendationSession(createMcdAdapter(call), () => NOW).run(context, request);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("refuses a forged or cross-store product configuration before pricing", async () => {
    const { adapter, call } = fixture();
    const catalog = await adapter.load(context, request);
    const candidate = generateCandidates(context, request, catalog, NOW).candidates[0];
    candidate.items[0].quantity = 2;
    await expect(adapter.quote(context, request, candidate)).rejects.toThrow();
    candidate.contextKey = contextKey({ ...context, storeRef: "other" });
    await expect(adapter.quote(context, request, candidate)).rejects.toThrow();
    expect(call.mock.calls.some(([name]) => name === "calculate-price")).toBe(false);
  });
  it("rejects unsupported detail fields and invalid default quantities", async () => {
    expect(detailSchema.safeParse({ ...detail, supportModify: "true" }).success).toBe(false);
    const invalid = structuredClone(detail); invalid.rounds[0].quantity = 2;
    const { adapter } = fixture(undefined, invalid);
    expect((await adapter.load(context, request)).options).toEqual([]);
  });
});
