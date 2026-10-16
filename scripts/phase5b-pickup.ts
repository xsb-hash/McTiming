import { z } from "zod";
import { candidateId, candidateSchema, contextKey, diningContextSchema, mealRequestSchema, quoteBinding, type Quote } from "../src/domain/meal";
import { generateCandidates, rankRecommendations } from "../src/domain/recommend";
import { mapMenuOption, priceArguments } from "../src/server/mcd/adapter";
import { detailSchema, envelopeSchema, menuSchema, priceSchema } from "../src/server/mcd/contracts";

export const PHASE5B_READS = ["now-time-info", "query-nearby-stores", "delivery-query-addresses", "query-meals", "query-meal-detail", "query-my-coupons", "query-store-coupons", "available-coupons", "calculate-price"] as const;
export type Phase5bRead = typeof PHASE5B_READS[number];
type Call = (tool: Phase5bRead, args: Record<string, unknown>) => Promise<unknown>;

// A bounded read-only verification sample, not a second production recommender.
// No defaults for missing prices/fees and no membership purchase or coupon claim.
export async function verifyPickup(call: Call, city: string, keyword: string, budgetFen: number) {
  const read = async (tool: Phase5bRead, args: Record<string, unknown>) => envelopeSchema.parse(await call(tool, args)).data;
  const stores = z.array(z.object({ storeCode: z.string(), storeName: z.string(), businessStatus: z.boolean() })).parse(await read("query-nearby-stores", { beType: 1, searchType: 2, city, keyword }));
  const store = stores.find((entry) => entry.businessStatus);
  if (!store) return { status: "NO_OPEN_STORE" as const, storeCount: stores.length };
  const context = diningContextSchema.parse({ mode: "live", fulfillment: "pickup", storeRef: store.storeCode, takeWay: "take-in-store", needTableware: false, revision: 1 });
  const request = mealRequestSchema.parse({ budgetFen, template: "main+drink", includeSnack: true, likedTags: [], excludedTags: [] });
  const base = { storeCode: store.storeCode, orderType: 1, beType: 1 };
  const menu = menuSchema.parse(await read("query-meals", base));
  const ownedSchema = z.object({ coupons: z.array(z.object({ id: z.string(), code: z.string() })), totalPages: z.number().int(), totalCount: z.number().int() });
  const first = ownedSchema.parse(await read("query-my-coupons", { page: "1", pageSize: "200" }));
  const owned = [...first.coupons];
  for (let page = 2; page <= Math.min(first.totalPages, 5); page++) owned.push(...ownedSchema.parse(await read("query-my-coupons", { page: String(page), pageSize: "200" })).coupons);
  const storeCoupons = z.array(z.object({ couponId: z.string(), couponCode: z.string(), products: z.array(z.object({ productCode: z.string() })).optional() })).parse(await read("query-store-coupons", base));
  // A separate coupon diagnostic may reference a coupon-only product absent
  // from the regular menu. Require its live detail; never add it to meal recommendations.
  const ownedStore = storeCoupons.filter((coupon) => owned.some((asset) => asset.id === coupon.couponId && asset.code === coupon.couponCode));
  let couponDiagnostic: unknown = { status: "NO_OWNED_STORE_COUPON_WITH_PRODUCT" };
  const coupon = ownedStore.find((entry) => entry.products?.length);
  const couponProduct = coupon?.products?.[0];
  if (coupon && couponProduct) {
    try {
      const detail = detailSchema.parse(await read("query-meal-detail", { ...base, code: couponProduct.productCode }));
      if (detail.code !== couponProduct.productCode) throw new Error();
      const option = mapMenuOption(context, detail, [], []);
      const diagnosticCandidate = candidateSchema.parse({ id: candidateId(option.items, null), contextKey: contextKey(context), source: "official", items: option.items, components: option.components, coupon: null, matchedTags: [], missingTags: [], selectionHintFen: null });
      const args = priceArguments(context, diagnosticCandidate);
      const quotes: Record<string, unknown> = {};
      for (const useCoupon of [false, true]) {
        try {
          const data = priceSchema.parse(await read("calculate-price", { ...args, items: args.items.map((item) => useCoupon ? { ...item, couponId: coupon.couponId, couponCode: coupon.couponCode } : item) }));
          quotes[useCoupon ? "withCoupon" : "withoutCoupon"] = { status: "OFFICIAL_PRICE_RETURNED", totalFen: data.price, productFen: data.productPrice, discountFen: data.discount, missingFees: ["deliveryPrice", "packingPrice", "tablewarePrice"].filter((key) => data[key as keyof typeof data] === undefined) };
        } catch { quotes[useCoupon ? "withCoupon" : "withoutCoupon"] = { status: "QUOTE_FAILED" }; }
      }
      couponDiagnostic = { status: "DETAIL_VERIFIED_QUOTES_ATTEMPTED", productCode: detail.code, productName: detail.name, inRegularMenu: Boolean(menu.meals[detail.code]), ...quotes };
    } catch { couponDiagnostic = { status: "DETAIL_OR_DEFAULT_CONFIGURATION_UNVERIFIED", productCode: couponProduct.productCode, inRegularMenu: Boolean(menu.meals[couponProduct.productCode]) }; }
  }
  const candidates = [...new Set(menu.categories.filter((category) => category.name.includes("单人餐")).flatMap((category) => category.meals.map((entry) => entry.code)))].filter((code) => menu.meals[code] && !menu.meals[code].canWithOrder && !menu.meals[code].discountType).slice(0, 3);
  const options = [];
  const skipped: { productCode: string; reason: string }[] = [];
  for (const code of candidates) {
    try {
      const detail = detailSchema.parse(await read("query-meal-detail", { ...base, code }));
      if (detail.code !== code) throw new Error();
      const categories = menu.categories.filter((category) => category.meals.some((entry) => entry.code === code));
      options.push(mapMenuOption(context, detail, categories.map((entry) => entry.name), []));
    } catch { skipped.push({ productCode: code, reason: "DETAIL_OR_MAPPING_UNVERIFIED" }); }
  }
  const catalog = { source: "official" as const, options, coupons: [], claimableHints: [], issues: ["只读样本；真实费用完整性尚未验证，不放行购买。"] };
  const generated = generateCandidates(context, request, catalog, Date.now());
  const quoted: { candidate: typeof generated.candidates[number]; quote: Quote }[] = [];
  const observations = [];
  for (const candidate of generated.candidates) {
    const args = priceArguments(context, candidate);
    const data = priceSchema.parse(await read("calculate-price", args));
    const missingFees = ["deliveryPrice", "packingPrice", "tablewarePrice"].filter((key) => data[key as keyof typeof data] === undefined);
    const quote: Quote = { source: "official", status: "unknown", binding: quoteBinding(context, request, candidate), totalFen: data.price, fees: null, quotedAt: Date.now(), expiresAt: null, reasons: [missingFees.length ? "官方费用字段缺失，不能视作零元。" : "费用字段存在，完整结算语义尚未核实。"] };
    quoted.push({ candidate, quote });
    const ownedMatching = storeCoupons.filter((coupon) => owned.some((asset) => asset.id === coupon.couponId && asset.code === coupon.couponCode) && coupon.products?.some((product) => candidate.items.some((item) => item.productRef === product.productCode)));
    let couponQuote: unknown = { status: "NO_MATCHING_OWNED_COUPON_FOR_CANDIDATE" };
    if (ownedMatching.length) {
      const coupon = ownedMatching[0];
      const couponArgs = { ...args, items: args.items.map((item) => coupon.products?.some((p) => p.productCode === item.productCode) ? { ...item, couponId: coupon.couponId, couponCode: coupon.couponCode } : item) };
      try {
        const discounted = priceSchema.parse(await read("calculate-price", couponArgs));
        couponQuote = { status: "OFFICIAL_PRICE_RETURNED", totalFen: discounted.price, productFen: discounted.productPrice, discountFen: discounted.discount, completeFees: discounted.deliveryPrice !== undefined && discounted.packingPrice !== undefined && discounted.tablewarePrice !== undefined };
      } catch { couponQuote = { status: "COUPON_QUOTE_FAILED" }; }
    }
    observations.push({ items: candidate.items, components: candidate.components, noCoupon: { totalFen: data.price, productFen: data.productPrice, discountFen: data.discount, missingFees }, couponQuote });
  }
  return { status: observations.length ? "OFFICIAL_QUOTES_WITH_RECOMMENDATION_GATE" as const : "NO_VERIFIED_CANDIDATE" as const,
    store, request, storeCount: stores.length, menuCount: Object.keys(menu.meals).length, ownedCount: owned.length, ownedPaginationComplete: first.totalPages <= 5, storeCouponCount: storeCoupons.length,
    ownedStoreCouponMatches: storeCoupons.filter((coupon) => owned.some((asset) => asset.id === coupon.couponId && asset.code === coupon.couponCode)).length,
    couponDiagnostic, selectedDetailCount: candidates.length, skipped, observations,
    recommendation: rankRecommendations(context, request, catalog, generated, quoted, Date.now()) };
}
