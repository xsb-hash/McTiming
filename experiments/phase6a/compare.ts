import { canonical, compareId, normalizeItems, quoteSchema, type Recommendation } from "../../src/domain/meal";
import { hardConditions, quoteIsCurrent, rankRecommendations, couponUsable } from "../../src/domain/recommend";
import { FIXED_TIME, type ExperimentCase } from "./dataset";

export const METHODS = ["A", "B", "McTiming"] as const;
export type Method = typeof METHODS[number];
export type Selection = Pick<Recommendation, "budgetOptions" | "overBudgetOption">;
export function runMethod(test: ExperimentCase, method: Method): Selection {
  if (method === "McTiming") return rankRecommendations(test.context, test.request, test.catalog, test.generated, test.quoted, FIXED_TIME);
  const valid = test.quoted.filter(({ candidate, quote }) => (!candidate.coupon || method === "B") && hardConditions(candidate.components, test.request) && quoteSchema.safeParse(quote).success && quote.source === "demo" && quote.status === "demo" && candidate.source === "demo" && quote.totalFen !== null && quote.fees !== null && quoteIsCurrent(quote, test.context, test.request, candidate, FIXED_TIME));
  valid.sort((a, b) => a.quote.totalFen! - b.quote.totalFen! || compareId(a.candidate.id, b.candidate.id));
  return { budgetOptions: valid.filter((entry) => entry.quote.totalFen! <= test.request.budgetFen).slice(0, 3).map(({ candidate, quote }) => ({ candidate, quote, overBudgetFen: 0, purchasable: false, explanation: "受控报价按价格排序，不以口味为目标" })), overBudgetOption: null };
}

export function measure(test: ExperimentCase, method: Method, result = runMethod(test, method)) {
  const shown = [...result.budgetOptions, ...(result.overBudgetOption ? [result.overBudgetOption] : [])];
  const likes = [...new Set(test.request.likedTags)];
  const matched = (option: Selection["budgetOptions"][number]) => likes.filter((tag) => option.candidate.components.some((part) => part.tags.includes(tag)));
  const defaultMatches = result.budgetOptions.map((option) => matched(option).length);
  const union = new Set(result.budgetOptions.flatMap(matched));
  // Independent audit includes template counts, menu membership, coupon validity and exact snapshot equality.
  const hardViolations = shown.filter(({ candidate }) => {
    const counts = { main: 0, drink: 0, snack: 0, unknown: 0 };
    for (const part of candidate.components) counts[part.role] += part.quantity;
    const menu = candidate.items.map((item) => test.catalog.options.find((option) => option.items.some((configured) => canonical(normalizeItems([configured])) === canonical(normalizeItems([item])))));
    const parts = menu.flatMap((option) => option?.components ?? []);
    const excluded = candidate.components.some((part) => test.request.excludedTags.some((tag) => part.exclusionChecks[tag] !== "absent"));
    return counts.main !== 1 || counts.drink !== 1 || counts.unknown > 0 || counts.snack > 1 || (test.request.includeSnack && counts.snack !== 1) || excluded || menu.some((option) => !option || option.availability !== "available" || option.composition !== "complete") || canonical(parts.map(canonical).sort()) !== canonical(candidate.components.map(canonical).sort()) || !test.generated.candidates.some((allowed) => allowed.id === candidate.id) || !!candidate.coupon && !couponUsable(candidate.coupon, test.context, FIXED_TIME);
  }).length;
  const verified = shown.filter(({ candidate, quote }) => test.quoted.some((entry) => entry.candidate.id === candidate.id && canonical(entry.quote) === canonical(quote) && !!entry.evidence) && quoteSchema.safeParse(quote).success && quote.status === "demo" && quote.source === "demo" && quoteIsCurrent(quote, test.context, test.request, candidate, FIXED_TIME)).length;
  const first = result.budgetOptions[0];
  return {
    caseId: test.id, source: test.source, method, budgetFen: test.request.budgetFen, likedCount: likes.length,
    candidateCount: test.generated.candidates.length, eligibleQuoteCount: test.quoted.filter((entry) => method !== "A" || !entry.candidate.coupon).length,
    defaultCount: result.budgetOptions.length, overCount: result.overBudgetOption ? 1 : 0,
    top1Fen: first?.quote.totalFen ?? null, top1Match: likes.length ? (first ? matched(first).length / likes.length : 0) : null,
    averageMatch: likes.length ? (defaultMatches.length ? defaultMatches.reduce((a, b) => a + b, 0) / defaultMatches.length / likes.length : 0) : null,
    top3Coverage: likes.length ? union.size / likes.length : null,
    hardViolations, budgetViolations: result.budgetOptions.filter((entry) => entry.quote.totalFen === null || entry.quote.totalFen > test.request.budgetFen).length,
    ungroundedPrices: shown.length - verified, shownCount: shown.length, verifiableCount: verified,
    noResultReason: first ? null : test.generated.candidates.length === 0 ? "no-legal-candidates" : test.quoted.some((entry) => entry.quote.status === "demo" && quoteIsCurrent(entry.quote, test.context, test.request, entry.candidate, FIXED_TIME)) ? "all-trusted-options-over-budget" : "quotes-failed-unknown-or-expired",
    defaults: result.budgetOptions.map((entry) => ({ id: entry.candidate.id, amountFen: entry.quote.totalFen, matched: matched(entry), coupon: entry.candidate.coupon?.ref ?? null })),
    overBudget: result.overBudgetOption ? { id: result.overBudgetOption.candidate.id, amountFen: result.overBudgetOption.quote.totalFen, overBudgetFen: result.overBudgetOption.overBudgetFen } : null,
  };
}
export type Measurement = ReturnType<typeof measure>;
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function summarize(rows: Measurement[]) {
  const ids = [...new Set(rows.map((row) => row.caseId))];
  const pairedIds = ids.filter((id) => METHODS.every((method) => rows.some((row) => row.caseId === id && row.method === method && row.top1Fen !== null)));
  return METHODS.map((method) => {
    const group = rows.filter((row) => row.method === method);
    const sum = (key: "hardViolations" | "budgetViolations" | "ungroundedPrices" | "shownCount" | "verifiableCount") => group.reduce((n, row) => n + row[key], 0);
    return { method, cases: group.length, withPreferences: group.filter((row) => row.likedCount > 0).length, noPreferences: group.filter((row) => !row.likedCount).length,
      recommended: group.filter((row) => row.defaultCount > 0).length, empty: group.filter((row) => !row.defaultCount).length,
      coverage: group.filter((row) => row.defaultCount > 0).length / group.length,
      top1Match: average(group.flatMap((row) => row.top1Match === null ? [] : [row.top1Match])), averageMatch: average(group.flatMap((row) => row.averageMatch === null ? [] : [row.averageMatch])), top3Coverage: average(group.flatMap((row) => row.top3Coverage === null ? [] : [row.top3Coverage])),
      meanFenAvailable: average(group.flatMap((row) => row.top1Fen === null ? [] : [row.top1Fen])),
      pairedCount: pairedIds.length, meanFenPaired: average(group.filter((row) => pairedIds.includes(row.caseId)).map((row) => row.top1Fen!)),
      hardViolations: sum("hardViolations"), budgetViolations: sum("budgetViolations"), ungroundedPrices: sum("ungroundedPrices"), verifiableCount: sum("verifiableCount"), shownCount: sum("shownCount"), verifiableRatio: sum("shownCount") ? sum("verifiableCount") / sum("shownCount") : null,
    };
  });
}
