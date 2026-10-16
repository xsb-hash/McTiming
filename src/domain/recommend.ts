import { candidateId, candidateSchema, compareId, contextKey, normalizeItems, quoteBinding, recommendationSchema, requestKey, type Candidate, type Catalog, type Coupon, type DiningContext, type MealRequest, type MenuOption, type Quote, type Recommendation } from "./meal";

export const RECOMMEND_LIMITS = Object.freeze({ quotes: 12, concurrency: 2, generated: 2000, explored: 20000, budgetResults: 3, detailQueries: 24 });
const sourceFor = (context: DiningContext) => context.mode === "demo" ? "demo" : "official";
export const couponUsable = (coupon: Coupon, context: DiningContext, now: number) => coupon.source === sourceFor(context) && coupon.contextKey === contextKey(context) && coupon.owned && coupon.applicable && coupon.verified && coupon.validFrom <= now && now < coupon.validUntil;
const preference = (components: MenuOption["components"], request: MealRequest) => request.likedTags.filter((tag) => components.some((part) => part.tags.includes(tag)));
export function hardConditions(components: MenuOption["components"], request: MealRequest): boolean {
  return components.every((part) => part.role !== "unknown" && request.excludedTags.every((tag) => part.exclusionChecks[tag] === "absent"));
}
function counts(options: MenuOption[]) {
  const result = { main: 0, drink: 0, snack: 0, unknown: 0 };
  for (const option of options) for (const part of option.components) result[part.role] += part.quantity;
  return result;
}
function* combinations(options: MenuOption[], request: MealRequest, exploration: { count: number; limited: boolean }, selected: MenuOption[] = [], start = 0): Generator<MenuOption[]> {
  if (++exploration.count > RECOMMEND_LIMITS.explored) { exploration.limited = true; return; }
  const n = counts(selected);
  if (n.main > 1 || n.drink > 1 || n.snack > 1 || n.unknown) return;
  if (n.main === 1 && n.drink === 1 && (!request.includeSnack || n.snack === 1)) yield selected;
  if (selected.length === 3) return;
  for (let i = start; i < options.length && !exploration.limited; i++) yield* combinations(options, request, exploration, [...selected, options[i]], i + 1);
}

export function generateCandidates(context: DiningContext, request: MealRequest, catalog: Catalog, now: number) {
  const eligible = catalog.options.filter((option) => option.source === sourceFor(context) && option.contextKey === contextKey(context) && option.availability === "available" && option.composition === "complete" && hardConditions(option.components, request));
  const cheap = [...eligible].sort((a, b) => (a.selectionHintFen ?? Infinity) - (b.selectionHintFen ?? Infinity) || compareId(candidateId(a.items, null), candidateId(b.items, null)));
  const preferred = [...eligible].sort((a, b) => preference(b.components, request).length - preference(a.components, request).length || compareId(candidateId(a.items, null), candidateId(b.items, null)));
  const explorations = [{ count: 0, limited: false }, { count: 0, limited: false }];
  const streams = [combinations(cheap, request, explorations[0]), combinations(preferred, request, explorations[1])];
  const pool = new Map<string, Candidate>();
  let steps = 0;
  let done = false;
  while (steps < RECOMMEND_LIMITS.generated && !done) {
    done = true;
    for (const stream of streams) {
      const next = stream.next();
      if (next.done) continue;
      done = false;
      steps++;
      const options = next.value;
      const items = normalizeItems(options.flatMap((option) => option.items));
      const components = options.flatMap((option) => option.components);
      const matchedTags = preference(components, request);
      // Only one verified coupon on a matching item; no inferred stacking.
      const coupons: (Coupon | null)[] = [null, ...catalog.coupons.filter((coupon) => couponUsable(coupon, context, now) && items.some((item) => coupon.productRefs.includes(item.productRef)))];
      for (const coupon of coupons) {
        if (pool.size >= RECOMMEND_LIMITS.generated) break;
        const id = candidateId(items, coupon);
        const estimate = options.every((o) => o.selectionHintFen !== null) ? options.reduce((sum, o) => sum + o.selectionHintFen!, 0) : null;
        pool.set(id, candidateSchema.parse({ id, contextKey: contextKey(context), source: sourceFor(context), items, components, coupon, matchedTags, missingTags: request.likedTags.filter((tag) => !matchedTags.includes(tag)), selectionHintFen: estimate !== null && Number.isSafeInteger(estimate) ? estimate : null }));
      }
    }
  }
  const candidates = [...pool.values()];
  // Interleave inexpensive hints and preference leaders before the quote cap.
  const byHint = [...candidates].sort((a, b) => (a.selectionHintFen ?? Infinity) - (b.selectionHintFen ?? Infinity) || compareId(a.id, b.id));
  const byPreference = [...candidates].sort((a, b) => b.matchedTags.length - a.matchedTags.length || compareId(a.id, b.id));
  const chosen = new Map<string, Candidate>();
  for (let i = 0; i < candidates.length && chosen.size < RECOMMEND_LIMITS.quotes; i++) {
    for (const list of [byHint, byPreference]) {
      if (chosen.size < RECOMMEND_LIMITS.quotes) chosen.set(list[i].id, list[i]);
    }
  }
  return { candidates: [...chosen.values()], generated: candidates.length, truncated: !done || explorations.some((e) => e.limited) || candidates.length > chosen.size, rejectedOptions: catalog.options.length - eligible.length };
}

export function quoteIsCurrent(quote: Quote, context: DiningContext, request: MealRequest, candidate: Candidate, now: number) {
  return quote.binding === quoteBinding(context, request, candidate) && quote.quotedAt <= now && (quote.expiresAt === null || now < quote.expiresAt) && (!candidate.coupon || couponUsable(candidate.coupon, context, now));
}

export function rankRecommendations(context: DiningContext, request: MealRequest, catalog: Catalog, generated: ReturnType<typeof generateCandidates>, quoted: { candidate: Candidate; quote: Quote }[], now: number): Recommendation {
  const rejectedQuotes: Recommendation["rejectedQuotes"] = [];
  const references: { id: string; matched: number; price: Recommendation["referencePrices"][number] }[] = [];
  const valid = quoted.flatMap(({ candidate, quote }) => {
    if (!quoteIsCurrent(quote, context, request, candidate, now)) quote = { ...quote, status: "expired", reasons: [...quote.reasons, "报价条件或有效期已变化"] };
    const usable = hardConditions(candidate.components, request) && candidate.source === sourceFor(context) && quote.source === sourceFor(context) && quote.status === (context.mode === "demo" ? "demo" : "verified") && quote.totalFen !== null && quote.fees !== null;
    if (!usable) {
      rejectedQuotes.push({ candidateId: candidate.id, quote });
      if (context.mode === "live" && context.fulfillment === "pickup" && candidate.source === "official" && quote.source === "official" && quote.status === "unknown" && quote.totalFen !== null && hardConditions(candidate.components, request)) {
        const products = candidate.items.map((item) => {
          const option = catalog.options.find((entry) => candidateId(entry.items, null) === candidateId([item], null));
          return option ? { name: option.name, quantity: item.quantity } : null;
        });
        references.push({ id: candidate.id, matched: candidate.matchedTags.length, price: { ...(products.every((product) => product !== null) ? { products } : {}), items: candidate.components.map(({ name, quantity }) => ({ name, quantity })), amountFen: quote.totalFen, quotedAt: quote.quotedAt, expiresAt: quote.expiresAt } });
      }
      return [];
    }
    return [{ candidate, quote, overBudgetFen: Math.max(0, quote.totalFen! - request.budgetFen), purchasable: context.mode === "live", explanation: `已匹配：${candidate.matchedTags.join("、") || "无喜欢项"}；未满足：${candidate.missingTags.join("、") || "无"}。${context.mode === "demo" ? "虚构演示报价，不可真实购买。" : "官方报价；下单前仍需复核并确认。"}` }];
  }).sort((a, b) => b.candidate.matchedTags.length - a.candidate.matchedTags.length || a.quote.totalFen! - b.quote.totalFen! || compareId(a.candidate.id, b.candidate.id));
  const budgetOptions = valid.filter((option) => option.overBudgetFen === 0).slice(0, RECOMMEND_LIMITS.budgetResults);
  const overBudgetOption = valid.find((option) => option.overBudgetFen > 0 && (!budgetOptions.length || option.candidate.matchedTags.length > budgetOptions[0].candidate.matchedTags.length)) ?? null;
  // Compare all returned reference amounts before truncating; they remain non-purchasable.
  const referencePrices = references.sort((a, b) => b.matched - a.matched || a.price.amountFen - b.price.amountFen || compareId(a.id, b.id)).slice(0, RECOMMEND_LIMITS.budgetResults).map((entry) => entry.price);
  return recommendationSchema.parse({ source: sourceFor(context), status: valid.length ? "ready" : "empty", requestKey: requestKey(context, request), budgetOptions, overBudgetOption, rejectedQuotes, referencePrices, claimableHints: catalog.claimableHints, issues: catalog.issues,
    message: budgetOptions.length ? `仅在本次候选范围内按口味和${context.mode === "demo" ? "演示" : "官方"}金额排序；不代表全店最低价或全局最优。` : "当前候选范围内未找到预算内合适组合，可修改条件或本次不买。",
    coverage: { generated: generated.generated, attempted: quoted.length, succeeded: valid.length, rejectedOptions: generated.rejectedOptions, truncated: generated.truncated, scope: "generated-candidates-only" },
  });
}

export function expireRecommendation(result: Recommendation): Recommendation {
  const expire = (option: Recommendation["budgetOptions"][number]) => ({ ...option, purchasable: false, quote: { ...option.quote, status: "expired" as const } });
  return { ...result, status: "expired", referencePrices: [], budgetOptions: result.budgetOptions.map(expire), overBudgetOption: result.overBudgetOption ? expire(result.overBudgetOption) : null, message: "条件已变化或报价已过期，请重新获取推荐。" };
}
