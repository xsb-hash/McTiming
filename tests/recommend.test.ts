import { describe, expect, it, vi } from "vitest";
import { catalogSchema, contextKey, diningContextSchema, mealRequestSchema, quoteBinding, quoteSchema, type Candidate, type Catalog, type Coupon, type DiningContext, type MealRequest, type MenuOption, type Quote } from "../src/domain/meal";
import { generateCandidates, RECOMMEND_LIMITS } from "../src/domain/recommend";
import { createRecommendationSession, type RecommendationAdapter } from "../src/server/recommend";
import { createDemoRecommendationAdapter } from "../src/server/demo/recommend-adapter";

const NOW = 1_800_000_000_000;
const context: DiningContext = { mode: "demo", fulfillment: "pickup", storeRef: "synthetic-store", revision: 0, needTableware: false, takeWay: "take-in-store" };
const request: MealRequest = { budgetFen: 2500, template: "main+drink", includeSnack: false, likedTags: [], excludedTags: [] };
const vocabulary = ["chicken", "beef", "spicy", "sweet"];
function option(ref: string, role: "main" | "drink" | "snack", price: number, tags: string[] = []): MenuOption {
  return { ref, name: `合成测试-${ref}`, source: "demo", contextKey: contextKey(context), availability: "available", composition: "complete", selectionHintFen: price,
    components: [{ productRef: ref, name: ref, quantity: 1, role, tags, exclusionChecks: Object.fromEntries(vocabulary.map((tag) => [tag, tags.includes(tag) ? "present" : "absent"])) }],
    items: [{ productRef: ref, quantity: 1, modifications: [], rounds: [] }],
  };
}
const basic = () => [option("main", "main", 2000, ["chicken"]), option("drink", "drink", 500, ["sweet"])];
function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return { ref: "synthetic-coupon", code: "synthetic-code", source: "demo", contextKey: contextKey(context), productRefs: ["main"], owned: true, applicable: true, verified: true, validFrom: NOW - 1000, validUntil: NOW + 1000, ...overrides };
}
function adapter(options = basic(), coupons: Coupon[] = []) {
  const catalog: Catalog = { source: "demo", options, coupons, claimableHints: ["合成可领取券，不能用于减价"], issues: [] };
  const quote = vi.fn(async (ctx: DiningContext, req: MealRequest, candidate: Candidate): Promise<Quote> => ({
    source: "demo", status: "demo", binding: quoteBinding(ctx, req, candidate), totalFen: candidate.selectionHintFen!,
    fees: { productFen: candidate.selectionHintFen!, deliveryFen: 0, discountFen: 0, packingFen: 0, tablewareFen: 0 }, quotedAt: NOW, expiresAt: null, reasons: ["controlled fixture"],
  }));
  return { source: "demo" as const, load: vi.fn(async () => structuredClone(catalog)), quote };
}
async function run(a: RecommendationAdapter, changes: Partial<MealRequest> = {}) {
  const result = await createRecommendationSession(a, () => NOW).run(context, { ...request, ...changes });
  if (result.status !== "complete") throw new Error("Unexpected superseded");
  return result.recommendation;
}

describe("single-meal recommendation with controlled fixtures", () => {
  it("includes a quote exactly on budget and never marks demo as purchasable", async () => {
    const result = await run(adapter());
    expect(result.budgetOptions[0].quote.totalFen).toBe(2500);
    expect(result.budgetOptions[0].overBudgetFen).toBe(0);
    expect(result.budgetOptions[0].purchasable).toBe(false);
  });
  it("without likes sorts by final quote, not menu hint", async () => {
    const a = adapter([...basic(), option("alternate", "main", 1000)]);
    const original = a.quote.getMockImplementation()!;
    a.quote.mockImplementation(async (...args) => {
      const quote = await original(...args);
      const totalFen = args[2].items.some((item) => item.productRef === "main") ? 800 : 1200;
      return { ...quote, totalFen, fees: { ...quote.fees!, productFen: totalFen } };
    });
    const result = await run(a);
    expect(result.budgetOptions.map((v) => v.quote.totalFen)).toEqual([800, 1200]);
    expect(result.budgetOptions[0].candidate.items.some((v) => v.productRef === "main")).toBe(true);
  });
  it("counts distinct fully satisfied likes once and prioritizes them over price", async () => {
    const a = adapter([...basic(), option("cheap", "main", 100)]);
    const result = await run(a, { likedTags: ["chicken", "sweet", "chicken"] });
    expect(result.budgetOptions[0].candidate.matchedTags).toEqual(["chicken", "sweet"]);
    expect(result.budgetOptions[0].candidate.missingTags).toEqual([]);
    expect(result.budgetOptions[0].quote.totalFen).toBe(2500);
  });
  it("explains partially satisfied likes", async () => {
    const result = await run(adapter(), { likedTags: ["chicken", "beef"] });
    expect(result.budgetOptions[0].candidate.missingTags).toEqual(["beef"]);
    expect(result.budgetOptions[0].explanation).toContain("未满足：beef");
  });
  it("hard exclusions beat preferences in both budget groups", async () => {
    const a = adapter([...basic(), option("spicy-main", "main", 9000, ["chicken", "spicy"])]);
    const result = await run(a, { likedTags: ["spicy"], excludedTags: ["spicy"] });
    expect(result.overBudgetOption).toBeNull();
    expect(a.quote.mock.calls.every(([, , candidate]) => !candidate.components.some((part) => part.tags.includes("spicy")))).toBe(true);
  });
  it("rejects excluded items hidden inside a bundle", async () => {
    const bundle = option("bundle", "main", 1800);
    bundle.components = [...option("hidden", "main", 1, ["spicy"]).components, ...basic()[1].components];
    const a = adapter([bundle]);
    const result = await run(a, { excludedTags: ["spicy"] });
    expect(result.status).toBe("empty");
    expect(a.quote).not.toHaveBeenCalled();
  });
  it.each(["unknown-role", "unknown-exclusion", "unknown-composition", "unavailable"])("does not price %s", async (state) => {
    const options = basic();
    if (state === "unknown-role") options[0].components[0].role = "unknown";
    if (state === "unknown-exclusion") delete options[0].components[0].exclusionChecks.spicy;
    if (state === "unknown-composition") options[0].composition = "unknown";
    if (state === "unavailable") options[0].availability = "unavailable";
    const a = adapter(options);
    const result = await run(a, { excludedTags: ["spicy"] });
    expect(result.budgetOptions).toEqual([]);
    expect(result.coverage.rejectedOptions).toBe(1);
    expect(a.quote).not.toHaveBeenCalled();
  });
  it("shows one over-budget option and a limited-scope message when none fit", async () => {
    const result = await run(adapter(), { budgetFen: 2400 });
    expect(result.budgetOptions).toEqual([]);
    expect(result.overBudgetOption?.overBudgetFen).toBe(100);
    expect(result.message).toContain("当前候选范围内");
  });
  it("requires strictly better preference for an over-budget alternative when a budget option exists", async () => {
    const a = adapter([...basic(), option("premium", "main", 4000, ["beef"])]);
    expect((await run(a)).overBudgetOption).toBeNull();
    expect((await run(a, { likedTags: ["beef"] })).overBudgetOption?.overBudgetFen).toBe(2000);
  });
  it("reports no legal combinations without calling price", async () => {
    const a = adapter([option("only-main", "main", 1000)]);
    expect((await run(a)).coverage.attempted).toBe(0);
    expect(a.quote).not.toHaveBeenCalled();
  });
  it("same preference sorts by price then stable ID, independent of menu order", async () => {
    const options = [...basic(), option("a", "main", 1000, ["chicken"]), option("b", "main", 1000, ["chicken"])];
    const first = await run(adapter(options));
    const second = await run(adapter([...options].reverse()));
    expect(first.budgetOptions.map((v) => v.candidate.id)).toEqual(second.budgetOptions.map((v) => v.candidate.id));
    expect(first.budgetOptions.map((v) => v.quote.totalFen)).toEqual([1500, 1500, 2500]);
  });
  it("filters expired, inapplicable, unowned, unverified and wrong-context coupons", async () => {
    const coupons = [coupon(), coupon({ ref: "expired", validUntil: NOW }), coupon({ ref: "inapplicable", applicable: false }), coupon({ ref: "claimable", owned: false }), coupon({ ref: "unverified", verified: false }), coupon({ ref: "other-store", contextKey: "other" })];
    const a = adapter(basic(), coupons);
    const result = await run(a);
    expect(a.quote.mock.calls.map(([, , c]) => c.coupon?.ref ?? "none").sort()).toEqual(["none", "synthetic-coupon"]);
    expect(result.claimableHints).toHaveLength(1);
    expect(result.budgetOptions.every((v) => v.quote.totalFen === 2500)).toBe(true);
  });
  it("reports all price failures without a zero-price fallback", async () => {
    const a = adapter();
    a.quote.mockRejectedValue(new Error("SENSITIVE_REMOTE_ERROR"));
    const result = await run(a);
    expect(result.status).toBe("empty");
    expect(result.rejectedQuotes[0].quote).toMatchObject({ status: "failed", totalFen: null });
    expect(JSON.stringify(result)).not.toContain("SENSITIVE_REMOTE_ERROR");
  });
  it("keeps valid recommendations when only some candidates fail pricing", async () => {
    const a = adapter([...basic(), option("broken", "main", 1000)]);
    const original = a.quote.getMockImplementation()!;
    a.quote.mockImplementation(async (...args) => {
      if (args[2].items.some((v) => v.productRef === "broken")) throw new Error("fixture failure");
      return original(...args);
    });
    const result = await run(a);
    expect(result.coverage).toMatchObject({ attempted: 2, succeeded: 1 });
    expect(result.rejectedQuotes).toHaveLength(1);
    expect(result.budgetOptions).toHaveLength(1);
  });
  it.each(["unknown", "wrong-binding", "wrong-source"])("does not rank an %s quote", async (reason) => {
    const a = adapter();
    const original = a.quote.getMockImplementation()!;
    a.quote.mockImplementation(async (...args) => {
      const quote = await original(...args);
      if (reason === "unknown") return { ...quote, status: "unknown" };
      if (reason === "wrong-binding") return { ...quote, binding: "previous-configuration" };
      return { ...quote, source: "official", status: "verified" };
    });
    const result = await run(a);
    expect(result.budgetOptions).toEqual([]);
    expect(result.overBudgetOption).toBeNull();
  });
  it("supports verified official quotes only as a controlled future-contract fixture", async () => {
    const a = adapter();
    const liveContext = { ...context, mode: "live" as const };
    const controlled: RecommendationAdapter = {
      source: "official",
      load: async () => ({ source: "official", options: basic().map((option) => ({ ...option, source: "official", contextKey: contextKey(liveContext) })), coupons: [], claimableHints: [], issues: ["synthetic verification fixture"] }),
      quote: async (...args) => ({ ...await a.quote(...args), source: "official", status: "verified" }),
    };
    const result = await createRecommendationSession(controlled, () => NOW).run(liveContext, request);
    if (result.status !== "complete") throw new Error();
    expect(result.recommendation.budgetOptions[0].purchasable).toBe(true);
    expect(result.recommendation.budgetOptions[0].quote.source).toBe("official");
  });
  it("requires a snack when selected and deduplicates full product configurations", async () => {
    const options = [...basic(), option("snack", "snack", 100)];
    const duplicate = structuredClone(options[0]); duplicate.ref = "other-label";
    const result = await run(adapter([...options, duplicate]), { includeSnack: true, budgetFen: 3000 });
    expect(result.coverage.generated).toBe(1);
    expect(result.budgetOptions[0].candidate.components.map((v) => v.role).sort()).toEqual(["drink", "main", "snack"]);
    const variant = structuredClone(options[0]);
    variant.items[0].modifications = [{ code: "fixture", key: "less", quantity: 1 }];
    expect((await run(adapter([...basic(), variant]))).coverage.generated).toBe(2);
  });
  it("caps quotes at 12 while retaining cheap and high-preference alternatives", async () => {
    const mains = Array.from({ length: 30 }, (_, index) => option(`main-${String(index).padStart(2, "0")}`, "main", 1000 + index * 100, index === 29 ? ["beef"] : []));
    const a = adapter([...mains, basic()[1]]);
    const result = await run(a, { likedTags: ["beef"] });
    expect(a.quote).toHaveBeenCalledTimes(RECOMMEND_LIMITS.quotes);
    expect(a.quote.mock.calls.some(([, , c]) => c.selectionHintFen === 1500)).toBe(true);
    expect(a.quote.mock.calls.some(([, , c]) => c.matchedTags.includes("beef"))).toBe(true);
    expect(result.coverage.truncated).toBe(true);
  });
  it("rejects malformed budgets, missing delivery refs and mixed data sources", async () => {
    expect(mealRequestSchema.safeParse({ ...request, budgetFen: 1.5 }).success).toBe(false);
    expect(diningContextSchema.safeParse({ ...context, fulfillment: "delivery" }).success).toBe(false);
    const a = adapter();
    await expect(createRecommendationSession(a).run({ ...context, mode: "live" }, request)).rejects.toThrow("来源不一致");
    expect(a.load).not.toHaveBeenCalled();
    expect(quoteSchema.safeParse({ source: "official", status: "verified", totalFen: 1, fees: null, binding: "x", quotedAt: NOW, expiresAt: null, reasons: [] }).success).toBe(false);
  });
  it("runs fictional delivery including explicitly fictional delivery fees", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Demo must not use network"));
    const delivery: DiningContext = { mode: "demo", fulfillment: "delivery", storeRef: "fictional", addressRef: "fictional-address", businessRef: "fictional-business", revision: 1, needTableware: false };
    const result = await createRecommendationSession(createDemoRecommendationAdapter(() => NOW), () => NOW).run(delivery, request);
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.recommendation.overBudgetOption?.quote.fees?.deliveryFen).toBe(600);
      expect(result.recommendation.overBudgetOption?.purchasable).toBe(false);
    }
    expect(network).not.toHaveBeenCalled();
  });
});

describe("quote binding and request ordering", () => {
  it("binds store, fulfillment, address, configuration, quantity, coupon and preferences", () => {
    const catalog = catalogSchema.parse({ source: "demo", options: basic(), coupons: [], issues: [], claimableHints: [] });
    const candidate = generateCandidates(context, request, catalog, NOW).candidates[0];
    const original = quoteBinding(context, request, candidate);
    expect(quoteBinding({ ...context, storeRef: "other" }, request, candidate)).not.toBe(original);
    expect(quoteBinding({ ...context, needTableware: true }, request, candidate)).not.toBe(original);
    expect(quoteBinding({ ...context, takeWay: "eat-in" }, request, candidate)).not.toBe(original);
    expect(quoteBinding(context, { ...request, likedTags: ["beef"] }, candidate)).not.toBe(original);
    for (const change of ["quantity", "modification", "coupon"]) {
      const next = structuredClone(candidate);
      if (change === "quantity") next.items[0].quantity++;
      if (change === "modification") next.items[0].modifications.push({ code: "fixture", key: "none", quantity: 0 });
      if (change === "coupon") next.coupon = coupon();
      expect(quoteBinding(context, request, next)).not.toBe(original);
    }
    const delivery: DiningContext = { mode: "demo", fulfillment: "delivery", storeRef: "x", businessRef: "b", addressRef: "a", revision: 0, needTableware: false };
    expect(quoteBinding(delivery, request, candidate)).not.toBe(quoteBinding({ ...delivery, addressRef: "b" }, request, candidate));
  });
  it("expires old results immediately on new input and on quote expiry", async () => {
    let time = NOW;
    const a = adapter();
    const original = a.quote.getMockImplementation()!;
    a.quote.mockImplementation(async (...args) => ({ ...await original(...args), expiresAt: NOW + 1 }));
    const session = createRecommendationSession(a, () => time);
    await session.run(context, request);
    time++;
    expect(session.current()?.status).toBe("expired");
    expect(session.current()?.budgetOptions[0].quote.status).toBe("expired");
    await expect(session.run(context, { ...request, budgetFen: -1 })).rejects.toThrow();
    expect(session.current()?.status).toBe("expired");
  });
  it("discards a previous request that finishes after the latest one", async () => {
    const a = adapter();
    const original = a.quote.getMockImplementation()!;
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    a.quote.mockImplementation(async (...args) => {
      if (args[1].budgetFen === 2500) await deferred;
      return original(...args);
    });
    const session = createRecommendationSession(a, () => NOW);
    const old = session.run(context, request);
    await vi.waitFor(() => expect(a.quote).toHaveBeenCalledTimes(1));
    const newer = await session.run(context, { ...request, budgetFen: 2400 });
    expect(newer.status).toBe("complete");
    const latest = session.current();
    release();
    expect(await old).toEqual({ status: "superseded" });
    expect(session.current()).toEqual(latest);
    expect(latest?.overBudgetOption?.overBudgetFen).toBe(100);
  });
  it("enforces at most two concurrent price calls across overlapping requests", async () => {
    const a = adapter([...basic(), option("a", "main", 100), option("b", "main", 200)]);
    const original = a.quote.getMockImplementation()!;
    let active = 0; let maximum = 0;
    const releases: (() => void)[] = [];
    a.quote.mockImplementation(async (...args) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => { releases.push(resolve); });
      active--;
      return original(...args);
    });
    const session = createRecommendationSession(a, () => NOW);
    const old = session.run(context, request);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    const latest = session.run(context, { ...request, budgetFen: 1000 });
    let complete = false;
    const both = Promise.all([old, latest]).then((value) => { complete = true; return value; });
    await vi.waitFor(() => { releases.splice(0).forEach((release) => release()); expect(complete).toBe(true); });
    expect(maximum).toBe(2);
    expect((await both)[0].status).toBe("superseded");
  });
});
