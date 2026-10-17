import { catalogSchema, diningContextSchema, mealRequestSchema, quoteBinding, quoteSchema, type Candidate, type Catalog, type DiningContext, type MealRequest, type Quote, type Recommendation } from "../domain/meal";
import { expireRecommendation, generateCandidates, couponUsable, quoteIsCurrent, rankRecommendations, RECOMMEND_LIMITS } from "../domain/recommend";
import { ProbeError } from "./mcd/probe";

export interface RecommendationAdapter {
  readonly source: "official" | "demo";
  load(context: DiningContext, request: MealRequest): Promise<Catalog>;
  quote(context: DiningContext, request: MealRequest, candidate: Candidate): Promise<Quote>;
}

// One instance per local interaction/session, never a global shared user's state.
export function createRecommendationSession(adapter: RecommendationAdapter, now = Date.now) {
  let generation = 0;
  let current: Recommendation | undefined;
  let selection: { context: DiningContext; request: MealRequest } | undefined;
  const referenceSnapshots = new Map<string, { candidate: Candidate; quote: Quote }>();
  let active = 0;
  const waiters: (() => void)[] = [];
  async function withQuoteSlot<T>(work: () => Promise<T>): Promise<T> {
    if (active >= RECOMMEND_LIMITS.concurrency) await new Promise<void>((resolve) => { waiters.push(resolve); });
    else active++;
    try { return await work(); }
    finally { const next = waiters.shift(); if (next) next(); else active--; }
  }
  function invalidate() {
    generation++;
    referenceSnapshots.clear();
    if (current) current = expireRecommendation(current);
  }
  return {
    invalidate,
    referenceSnapshot(id: string) {
      const saved = referenceSnapshots.get(id);
      if (!saved || !selection || current?.status !== "ready" || !current.referencePrices.some(price => price.candidateId === id && price.budgetRelation) || !quoteIsCurrent(saved.quote, selection.context, selection.request, saved.candidate, now())) return undefined;
      return structuredClone(saved);
    },
    current(): Recommendation | undefined {
      if (current && selection) {
        const shown = [...current.budgetOptions, ...(current.overBudgetOption ? [current.overBudgetOption] : [])];
        if (shown.some((option) => !quoteIsCurrent(option.quote, selection!.context, selection!.request, option.candidate, now()))) current = expireRecommendation(current);
      }
      return current ? structuredClone(current) : undefined;
    },
    async run(contextInput: unknown, requestInput: unknown): Promise<{ status: "superseded" } | { status: "complete"; recommendation: Recommendation }> {
      // Even invalid new input revokes the preceding result immediately.
      invalidate();
      const ownGeneration = generation;
      const context = diningContextSchema.parse(contextInput);
      const request = mealRequestSchema.parse(requestInput);
      selection = { context, request };
      const source = context.mode === "demo" ? "demo" : "official";
      if (adapter.source !== source) throw new Error("运行模式与数据来源不一致，已拒绝调用。");
      let catalog: Catalog;
      try {
        catalog = catalogSchema.parse(await adapter.load(context, request));
        if (catalog.source !== source) throw new Error("Source mismatch");
      } catch (error) {
        catalog = { source, options: [], coupons: [], claimableHints: [], issues: ["菜单或优惠数据读取失败，未使用模拟数据替代。", ...(error instanceof ProbeError ? [error.message] : [])] };
      }
      if (generation !== ownGeneration) return { status: "superseded" };
      const generated = generateCandidates(context, request, catalog, now());
      const quoted = await Promise.all(generated.candidates.map((candidate) => withQuoteSlot(async () => {
        if (generation !== ownGeneration) return null;
        let quote: Quote;
        try {
          if (candidate.coupon && !couponUsable(candidate.coupon, context, now())) throw new Error("Coupon expired");
          quote = quoteSchema.parse(await adapter.quote(context, request, candidate));
        } catch (error) {
          quote = { source, status: "failed", binding: quoteBinding(context, request, candidate), totalFen: null, fees: null, quotedAt: now(), expiresAt: null, reasons: [error instanceof ProbeError ? error.message : "计价失败或优惠已失效，不能确认购买金额。"] };
        }
        return { candidate, quote };
      })));
      if (generation !== ownGeneration) return { status: "superseded" };
      current = rankRecommendations(context, request, catalog, generated, quoted.filter((value) => value !== null), now());
      for (const value of quoted) if (value && current.referencePrices.some(price => price.candidateId === value.candidate.id && price.budgetRelation)) referenceSnapshots.set(value.candidate.id, value);
      current.issues = [...new Set([...current.issues, ...current.rejectedQuotes.filter(r => r.quote.status === "failed").flatMap(r => r.quote.reasons)])];
      return { status: "complete", recommendation: structuredClone(current) };
    },
  };
}
