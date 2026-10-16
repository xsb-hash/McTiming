import { candidateId, catalogSchema, contextKey, quoteBinding, quoteSchema, type Candidate, type Catalog, type DiningContext, type MealRequest, type MenuOption, type Quote } from "../../src/domain/meal";
import { generateCandidates } from "../../src/domain/recommend";
import { createDemoRecommendationAdapter } from "../../src/server/demo/recommend-adapter";

export const FIXED_TIME = 1_800_000_000_000;
export type ExperimentCase = {
  id: string; source: "controlled" | "demo-adapter"; description: string; tags: string[];
  context: DiningContext; request: MealRequest; catalog: Catalog;
  generated: ReturnType<typeof generateCandidates>;
  quoted: { candidate: Candidate; quote: Quote; evidence: string }[];
};
const vocabulary = ["chicken", "beef", "sugar-free", "fruit", "potato", "spicy"];
function product(ref: string, role: "main" | "drink" | "snack", tags: string[], price: number, context: DiningContext): MenuOption {
  return { ref, name: `受控样例 ${ref}`, source: "demo", contextKey: contextKey(context), availability: "available", composition: "complete", selectionHintFen: price,
    items: [{ productRef: ref, quantity: 1, modifications: [], rounds: [] }],
    components: [{ productRef: ref, name: `受控样例 ${ref}`, role, quantity: 1, tags, exclusionChecks: Object.fromEntries(vocabulary.map((tag) => [tag, tags.includes(tag) ? "present" : "absent"])) }],
  };
}
// Independently declared complete configuration prices. No coupon face-value subtraction.
export const PRICE_TABLE: Record<string, { productFen: number; discountFen: number }> = {
  "chicken|sugar-free": { productFen: 2100, discountFen: 0 }, "chicken|fruit": { productFen: 2300, discountFen: 0 },
  "beef|sugar-free": { productFen: 2600, discountFen: 0 }, "beef|fruit": { productFen: 2800, discountFen: 0 },
  "chicken|snack|sugar-free": { productFen: 2700, discountFen: 0 }, "chicken|fruit|snack": { productFen: 2900, discountFen: 0 },
  "beef|snack|sugar-free": { productFen: 3200, discountFen: 0 }, "beef|fruit|snack": { productFen: 3400, discountFen: 0 },
  bundle: { productFen: 2000, discountFen: 0 },
  "beef|sugar-free@held": { productFen: 2200, discountFen: 400 }, "beef|fruit@held": { productFen: 2400, discountFen: 400 },
};
type Spec = { id: string; description: string; tags: string[]; budget?: number; likes?: string[]; excludes?: string[]; snack?: boolean; delivery?: boolean; bundle?: boolean; stockout?: boolean; unknown?: boolean; coupon?: "valid" | "expired" | "inapplicable" | "unverified-price"; fault?: "all" | "partial" | "incomplete" | "stale" };
const specs: Spec[] = [
  ...[1500, 2100, 2300, 2600, 3000, 3500].map((budget) => ({ id: `budget-${budget}`, description: `固定预算 ${budget} 分`, tags: ["budget-sweep", "no-coupon"], budget })),
  { id: "chicken-preference", description: "喜欢鸡肉，便宜方案也合口味", tags: ["chicken"], likes: ["chicken"] },
  { id: "no-preferences", description: "无喜欢项，匹配率不定义为100%", tags: ["no-likes"], likes: [] },
  { id: "multiple-preferences", description: "牛肉与果味饮品", tags: ["multiple-likes"], likes: ["beef", "fruit"] },
  { id: "exclude-chicken", description: "硬排除鸡肉", tags: ["exclusion"], excludes: ["chicken"] },
  { id: "bundle-exclusion", description: "低价套餐内含鸡肉，必须被排除", tags: ["bundle", "exclusion"], bundle: true, excludes: ["chicken"] },
  { id: "bundle-allowed", description: "完整组成的受控套餐", tags: ["bundle"], bundle: true },
  { id: "exact-budget", description: "预算恰好等于应付金额", tags: ["exact-budget"], budget: 2100, likes: [] },
  { id: "all-over-budget", description: "合法方案全部超预算", tags: ["over-budget"], budget: 1000 },
  { id: "no-valid", description: "排除全部主食，无合法方案", tags: ["no-solution"], excludes: ["chicken", "beef"] },
  { id: "held-coupon", description: "已有适用券，使用独立声明的含券固定报价", tags: ["coupon"], coupon: "valid", budget: 2500, likes: ["beef", "fruit"] },
  { id: "coupon-enables-budget", description: "含券固定报价使方案进入预算", tags: ["coupon", "coverage"], coupon: "valid", budget: 2200 },
  { id: "expired-coupon", description: "券已过期，不参与候选", tags: ["coupon-expired"], coupon: "expired" },
  { id: "inapplicable-coupon", description: "持有但不适用", tags: ["coupon-inapplicable"], coupon: "inapplicable" },
  { id: "unverified-coupon-price", description: "券条件可用但含券报价未核验，不展示其价格", tags: ["coupon-unverified"], coupon: "unverified-price" },
  { id: "stockout", description: "牛肉缺货，偏好不能抵消可售性", tags: ["stockout"], stockout: true },
  { id: "unknown-classification", description: "鸡肉的排除证据未知，保守拒绝", tags: ["unknown"], unknown: true, excludes: ["spicy"] },
  { id: "delivery-over-budget", description: "固定配送费600分导致预算不足", tags: ["delivery", "over-budget"], delivery: true, budget: 2500 },
  { id: "delivery-available", description: "外送完整样例费用", tags: ["delivery"], delivery: true, budget: 3500 },
  { id: "required-snack", description: "主食饮品加小食", tags: ["template", "snack"], snack: true, budget: 3500 },
  { id: "all-quotes-fail", description: "模拟官方计价全部失败；非真实故障", tags: ["price-failure"], fault: "all" },
  { id: "partial-quotes-fail", description: "模拟部分候选计价失败", tags: ["partial-failure"], fault: "partial" },
  { id: "incomplete-fees", description: "模拟费用缺失，不得默认补零", tags: ["incomplete"], fault: "incomplete" },
  { id: "stale-binding", description: "上下文变化，旧报价绑定失效", tags: ["condition-change"], fault: "stale" },
  { id: "out-of-order", description: "固定推荐输入；另执行旧请求晚到的生命周期检验", tags: ["request-race"] },
  { id: "equal-preference-price", description: "同偏好匹配按价格排序", tags: ["price-tie-break"], likes: ["beef"] },
];

export async function buildDataset(): Promise<ExperimentCase[]> {
  const cases: ExperimentCase[] = [];
  for (const spec of specs) {
    const context: DiningContext = spec.delivery ? { mode: "demo", fulfillment: "delivery", storeRef: "controlled-store", addressRef: "controlled-address", businessRef: "controlled-delivery", revision: 1, needTableware: false } : { mode: "demo", fulfillment: "pickup", storeRef: "controlled-store", revision: 1, needTableware: false, takeWay: "take-in-store" };
    const request: MealRequest = { budgetFen: spec.budget ?? 3000, template: "main+drink", includeSnack: spec.snack ?? false, likedTags: spec.likes ?? ["beef", "sugar-free"], excludedTags: spec.excludes ?? [] };
    const options = [product("chicken", "main", ["chicken"], 1600, context), product("beef", "main", ["beef"], 2100, context), product("sugar-free", "drink", ["sugar-free"], 500, context), product("fruit", "drink", ["fruit"], 700, context)];
    if (spec.snack) options.push(product("snack", "snack", ["potato"], 600, context));
    if (spec.stockout) options[1].availability = "unavailable";
    if (spec.unknown) options[0].components[0].exclusionChecks.spicy = "unknown";
    if (spec.bundle) options.push({ ...product("bundle", "main", [], 2000, context), components: [...options[0].components, ...options[3].components], items: [{ productRef: "bundle", quantity: 1, modifications: [], rounds: [{ roundRef: "main", choices: [{ productRef: "chicken", quantity: 1, modifications: [] }] }, { roundRef: "drink", choices: [{ productRef: "fruit", quantity: 1, modifications: [] }] }] }] });
    const catalog = catalogSchema.parse({ source: "demo", options, coupons: spec.coupon ? [{ ref: "held", code: "held-fixture", source: "demo", contextKey: contextKey(context), productRefs: ["beef"], owned: true, applicable: spec.coupon !== "inapplicable", verified: true, validFrom: FIXED_TIME - 10_000, validUntil: spec.coupon === "expired" ? FIXED_TIME : FIXED_TIME + 60_000 }] : [], claimableHints: [], issues: [] });
    const generated = generateCandidates(context, request, catalog, FIXED_TIME);
    const quoted = generated.candidates.map((candidate) => {
      const key = candidate.items.map((item) => item.productRef).sort().join("|") + (candidate.coupon ? "@held" : "");
      const declared = PRICE_TABLE[key]; if (!declared) throw new Error(`No declared fixture quote: ${key}`);
      const deliveryFen = spec.delivery ? 600 : 0;
      let quote: Quote = { source: "demo", status: "demo", binding: quoteBinding(context, request, candidate), totalFen: declared.productFen + deliveryFen, fees: { ...declared, deliveryFen, packingFen: 0, tablewareFen: 0 }, quotedAt: FIXED_TIME, expiresAt: FIXED_TIME + 60_000, reasons: ["人工固定报价，非麦当劳官方金额"] };
      if (spec.fault === "all" || (spec.fault === "partial" && candidate.components.some((part) => part.tags.includes("beef")))) quote = { ...quote, status: "failed", totalFen: null, fees: null, reasons: ["受控计价失败"] };
      if (spec.fault === "incomplete" || (spec.coupon === "unverified-price" && candidate.coupon)) quote = { ...quote, status: "unknown", fees: null, reasons: ["受控费用或含券金额未核验"] };
      if (spec.fault === "stale") quote.binding = quoteBinding({ ...context, revision: 0 }, request, candidate);
      return { candidate, quote: quoteSchema.parse(quote), evidence: `controlled-price-table/v1:${key}` };
    });
    cases.push({ id: spec.id, description: spec.description, tags: spec.tags, source: "controlled", context, request, catalog, generated, quoted });
  }
  const context: DiningContext = { mode: "demo", fulfillment: "pickup", storeRef: "demo-store-1", revision: 1, needTableware: false, takeWay: "take-in-store" };
  const request: MealRequest = { budgetFen: 2500, template: "main+drink", includeSnack: false, likedTags: ["beef", "sugar-free"], excludedTags: [] };
  const adapter = createDemoRecommendationAdapter(() => FIXED_TIME);
  const catalog = await adapter.load(context, request); const generated = generateCandidates(context, request, catalog, FIXED_TIME);
  const quoted = await Promise.all(generated.candidates.map(async (candidate) => ({ candidate, quote: await adapter.quote(context, request, candidate), evidence: "src/server/demo/recommend-adapter.ts@fixed-clock" })));
  cases.push({ id: "existing-demo", source: "demo-adapter", description: "原独立 Demo Adapter 固定时钟快照", tags: ["demo", "no-coupon"], context, request, catalog, generated, quoted });
  // Matched configurations are shared; A changes only coupon eligibility, never the menu range.
  for (const test of cases) {
    if (test.generated.truncated) throw new Error("Comparison dataset must not truncate candidates");
    for (const entry of test.quoted.filter((value) => value.candidate.coupon)) {
      if (!test.generated.candidates.some((value) => value.id === candidateId(entry.candidate.items, null))) throw new Error("Coupon configuration lacks a matching no-coupon configuration");
    }
  }
  return cases;
}
