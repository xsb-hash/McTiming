import { describe, expect, it, vi } from "vitest";
import { phase5bRecord, redactPhase5b } from "../scripts/phase5b-evidence";
import { PHASE5B_READS, verifyPickup, type Phase5bRead } from "../scripts/phase5b-pickup";

const bundle = {
  code: "sample-bundle", name: "受控三件套", supportModify: false,
  rounds: ["主食任意选", "选择套餐内小食", "选择套餐内饮料"].map((name, index) => ({ id: index + 1, name, quantity: 1, minQuantity: 1, maxQuantity: 1, choices: [{ code: `part-${index}`, name: `受控组成${index}`, quantity: 1, isDefault: 1, maxQuantity: -1, supportModify: false }] })),
};
function fixture({ feeComplete = false, coupon = false, total = 3450, open = true, couponDetailFails = false } = {}) {
  const call = vi.fn(async (tool: Phase5bRead, args: Record<string, unknown>) => {
    let data: unknown;
    switch (tool) {
      case "query-nearby-stores": data = [{ storeCode: "sample-store", storeName: "受控店", businessStatus: open }]; break;
      case "query-meals": data = { categories: [{ name: "精选单人餐", meals: [{ code: bundle.code }] }], meals: { [bundle.code]: { name: bundle.name, canWithOrder: false } } }; break;
      case "query-my-coupons": data = { coupons: coupon ? [{ id: "private-asset", code: "private-voucher" }] : [], totalPages: 1, totalCount: coupon ? 1 : 0 }; break;
      case "query-store-coupons": data = coupon ? [{ couponId: "private-asset", couponCode: "private-voucher", products: [{ productCode: "sample-coffee" }] }] : []; break;
      case "query-meal-detail":
        if (args.code === "sample-coffee" && couponDetailFails) throw new Error("PRIVATE_REMOTE_ERROR");
        data = args.code === bundle.code ? bundle : { code: "sample-coffee", name: "受控咖啡", supportModify: false, rounds: [] }; break;
      case "calculate-price": {
        const item = (args.items as { productCode: string; couponId?: string }[])[0];
        const price = item.productCode === bundle.code ? total : item.couponId ? 1800 : 2400;
        data = { price, productPrice: price, discount: item.couponId ? 600 : 0, ...(feeComplete ? { deliveryPrice: 0, packingPrice: 0, tablewarePrice: 0 } : {}) }; break;
      }
      default: throw new Error("Unexpected tool");
    }
    return { success: true, code: 200, data };
  });
  return call;
}

describe("phase 5B verifier: controlled fixtures, no real calls", () => {
  it("reuses generated defaults and preserves incomplete official prices without authorizing recommendations", async () => {
    const call = fixture();
    const result = await verifyPickup(call, "受控城市", "受控位置", 4000);
    expect(result).toMatchObject({ status: "OFFICIAL_QUOTES_WITH_RECOMMENDATION_GATE", observations: [{ noCoupon: { totalFen: 3450, missingFees: ["deliveryPrice", "packingPrice", "tablewarePrice"] } }], recommendation: { status: "empty", budgetOptions: [] } });
    const quoteArgs = call.mock.calls.find(([name]) => name === "calculate-price")![1];
    expect(quoteArgs).toMatchObject({ storeCode: "sample-store", items: [{ productCode: bundle.code, quantity: 1, roundList: [{ round: "1", comboItemList: [{ code: "part-0", quantity: 1 }] }, { round: "2" }, { round: "3" }] }] });
  });
  it("does not release a recommendation merely because numeric fee fields exist", async () => {
    const result = await verifyPickup(fixture({ feeComplete: true }), "城", "位置", 4000);
    expect(result.recommendation?.budgetOptions).toEqual([]);
    expect(result.recommendation?.rejectedQuotes[0].quote.status).toBe("unknown");
  });
  it("requires live detail and separately quotes a coupon-only product with and without the owned matching voucher", async () => {
    const call = fixture({ coupon: true });
    const result = await verifyPickup(call, "城", "位置", 4000);
    expect(result.couponDiagnostic).toMatchObject({ productCode: "sample-coffee", inRegularMenu: false, withoutCoupon: { totalFen: 2400 }, withCoupon: { totalFen: 1800 } });
    expect(result.observations?.[0].couponQuote).toEqual({ status: "NO_MATCHING_OWNED_COUPON_FOR_CANDIDATE" });
    expect(call.mock.calls.filter(([name]) => name === "calculate-price")).toHaveLength(3);
    expect(JSON.stringify(result)).not.toMatch(/private-asset|private-voucher/);
  });
  it("does not invent configuration when a coupon product detail is unavailable", async () => {
    const call = fixture({ coupon: true, couponDetailFails: true });
    const result = await verifyPickup(call, "城", "位置", 4000);
    expect(result.couponDiagnostic).toMatchObject({ status: "DETAIL_OR_DEFAULT_CONFIGURATION_UNVERIFIED" });
    expect(call.mock.calls.filter(([name]) => name === "calculate-price")).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_REMOTE_ERROR");
  });
  it("does not guess a store when all returned stores are closed", async () => {
    const call = fixture({ open: false });
    expect(await verifyPickup(call, "城", "位置", 4000)).toEqual({ status: "NO_OPEN_STORE", storeCount: 1 });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("rejects a missing or invalid total instead of substituting zero", async () => {
    await expect(verifyPickup(fixture({ total: Number.NaN }), "城", "位置", 4000)).rejects.toThrow();
  });
  it("has no transaction, order-query, address-save or claim tool in its static allowlist", () => {
    expect(PHASE5B_READS).toEqual(["now-time-info", "query-nearby-stores", "delivery-query-addresses", "query-meals", "query-meal-detail", "query-my-coupons", "query-store-coupons", "available-coupons", "calculate-price"]);
  });
  it("redacts credentials, private identifiers, personal values, free text and URLs recursively", () => {
    const value = { success: true, code: 200, traceId: "secret-trace", message: "private-error", data: { coupons: [{ id: "private-asset", code: "private-voucher", title: "private-title", unknownText: "private-data", phone: 13800000000, token: "private-token", image: "https://example.invalid/private", tradeStartDate: "2026-01-01" }] } };
    const output = JSON.stringify(redactPhase5b("query-my-coupons", value));
    expect(output).not.toMatch(/private-|secret-trace|13800000000|example.invalid/);
    expect(output).toContain("2026-01-01");
    expect(output).toContain('"code":200');
  });
  it("keeps public round IDs and menu codes needed for replay while masking coupon parameters", () => {
    expect(redactPhase5b("query-meal-detail", { rounds: [{ id: 2, choices: [{ code: "public-product" }] }] })).toEqual({ rounds: [{ id: 2, choices: [{ code: "public-product" }] }] });
    expect(redactPhase5b("calculate-price", { items: [{ productCode: "public-product", couponId: "private", couponCode: "private" }] }, true)).toEqual({ items: [{ productCode: "public-product", couponId: "[REDACTED]", couponCode: "[REDACTED]" }] });
  });
  it("records business failure and missing fees without persisting text content", () => {
    const record = phase5bRecord("calculate-price", {}, { content: [{ type: "text", text: "private-data" }], structuredContent: { success: false, code: 400, message: "private-error", data: {} } });
    expect(record.status).toBe("call-failed");
    expect(record.observations.price).toBe("missing-or-invalid");
    expect(JSON.stringify(record)).not.toMatch(/private-data|private-error/);
  });
  it("keeps address list cardinality while removing all address and contact values", () => {
    expect(redactPhase5b("delivery-query-addresses", { data: { addresses: [{ addressId: "private-id", fullAddress: "private-address", contactName: "private-name", phone: "private-phone" }] } })).toEqual({ data: { addresses: [{ addressId: "[REDACTED]", fullAddress: "[REDACTED]", contactName: "[REDACTED]", phone: "[REDACTED]" }] } });
  });
  it("blocks the observed empty required customization group without guessing a key or quoting the coupon", async () => {
    const base = fixture({ coupon: true });
    const call = vi.fn(async (tool: Phase5bRead, args: Record<string, unknown>) => {
      if (tool === "query-meal-detail" && args.code === "sample-coffee") return { success: true, code: 200, data: { code: "sample-coffee", name: "受控缺项咖啡", supportModify: true, modification: { items: [{ minValues: 1, maxValues: 1, values: [] }] }, rounds: [] } };
      return base(tool, args);
    });
    const result = await verifyPickup(call, "城", "位置", 4000);
    expect(result.couponDiagnostic).toMatchObject({ status: "DETAIL_OR_DEFAULT_CONFIGURATION_UNVERIFIED" });
    expect(call.mock.calls.filter(([tool]) => tool === "calculate-price")).toHaveLength(1);
  });
});
