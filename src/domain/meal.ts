import { z } from "zod";

export const fenSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ref = z.string().min(1).max(200);
const sourceSchema = z.enum(["official", "demo", "unknown"]);
const contextBase = { mode: z.enum(["live", "demo"]), storeRef: ref, revision: z.number().int().nonnegative(), needTableware: z.boolean() };
export const diningContextSchema = z.discriminatedUnion("fulfillment", [
  z.object({ ...contextBase, fulfillment: z.literal("pickup"), takeWay: z.enum(["eat-in", "take-in-store"]) }).strict(),
  z.object({ ...contextBase, fulfillment: z.literal("delivery"), addressRef: ref, businessRef: ref }).strict(),
]);
export const mealRequestSchema = z.object({
  budgetFen: fenSchema.refine((v) => v > 0),
  template: z.literal("main+drink"), includeSnack: z.boolean(),
  likedTags: z.array(ref).max(30).transform((v) => [...new Set(v)].sort()),
  excludedTags: z.array(ref).max(30).transform((v) => [...new Set(v)].sort()),
}).strict();
const modificationSchema = z.object({ code: ref, key: ref, quantity: z.number().int().nonnegative() }).strict();
const choiceSchema = z.object({ productRef: ref, quantity: z.number().int().positive(), modifications: z.array(modificationSchema) }).strict();
export const itemSchema = choiceSchema.extend({ rounds: z.array(z.object({ roundRef: ref, choices: z.array(choiceSchema).min(1) }).strict()) });
export const componentSchema = z.object({
  productRef: ref, name: ref, quantity: z.number().int().positive(),
  role: z.enum(["main", "drink", "snack", "unknown"]),
  tags: z.array(ref),
  exclusionChecks: z.record(z.string(), z.enum(["present", "absent", "unknown"])),
}).strict();
export const menuOptionSchema = z.object({
  ref, name: ref, source: sourceSchema, contextKey: z.string(),
  availability: z.enum(["available", "unavailable", "unknown"]),
  composition: z.enum(["complete", "unknown"]),
  components: z.array(componentSchema).min(1), items: z.array(itemSchema).min(1),
  // A candidate-selection hint only; never a quote, discount, or budget decision.
  selectionHintFen: fenSchema.nullable(),
}).strict();
export const couponSchema = z.object({
  ref, code: ref, source: sourceSchema, contextKey: z.string(), productRefs: z.array(ref).min(1),
  owned: z.boolean(), applicable: z.boolean(), verified: z.boolean(),
  validFrom: z.number().int(), validUntil: z.number().int(),
}).strict().refine((v) => v.validUntil > v.validFrom);
export const couponHintSchema = z.object({ name: ref, status: z.enum(["已持有", "可领取", "适用性未验证", "本单适用"]), conditions: z.array(z.string()) }).strict();
const unavailableItemSchema = z.object({ name: ref, reason: z.string() }).strict();
export const catalogSchema = z.object({
  source: sourceSchema, options: z.array(menuOptionSchema).max(500), coupons: z.array(couponSchema).max(200),
  claimableHints: z.array(z.string()), issues: z.array(z.string()),
  couponHints: z.array(couponHintSchema).optional(), unavailableItems: z.array(unavailableItemSchema).optional(),
}).strict();
export const candidateSchema = z.object({
  id: z.string(), contextKey: z.string(), source: sourceSchema,
  items: z.array(itemSchema).min(1), components: z.array(componentSchema).min(1),
  coupon: couponSchema.nullable(), matchedTags: z.array(ref), missingTags: z.array(ref),
  selectionHintFen: fenSchema.nullable(),
}).strict();
export const feesSchema = z.object({ productFen: fenSchema, discountFen: fenSchema, deliveryFen: fenSchema, packingFen: fenSchema, tablewareFen: fenSchema }).strict();
export const quoteSchema = z.object({
  source: sourceSchema, status: z.enum(["verified", "demo", "unknown", "failed", "expired"]),
  binding: z.string(), totalFen: fenSchema.nullable(), fees: feesSchema.nullable(),
  quotedAt: z.number().int(), expiresAt: z.number().int().nullable(), reasons: z.array(z.string()),
  // Internal evidence label, not an official field. Only the adapter can supply it.
  referenceBasis: ref.optional(),
}).strict().superRefine((v, ctx) => {
  if (["verified", "demo"].includes(v.status) && (v.totalFen === null || v.fees === null || (v.status === "verified" ? v.source !== "official" : v.source !== "demo"))) {
    ctx.addIssue({ code: "custom", message: "可信报价必须有对应来源、完整金额和费用。" });
  }
  if (["verified", "demo"].includes(v.status) && v.fees && v.totalFen !== v.fees.productFen + v.fees.deliveryFen + v.fees.packingFen + v.fees.tablewareFen) {
    ctx.addIssue({ code: "custom", message: "内部报价的优惠后商品金额与结算费用之和必须等于总额。" });
  }
});
export const rankedOptionSchema = z.object({ candidate: candidateSchema, quote: quoteSchema, overBudgetFen: fenSchema, purchasable: z.boolean(), explanation: z.string() }).strict();
// Internal candidate identity is stripped from the browser view; no purchase authority.
export const referencePriceSchema = z.object({ products: z.array(z.object({ name: ref, quantity: z.number().int().positive() })).min(1).optional(), items: z.array(z.object({ name: ref, quantity: z.number().int().positive() })), amountFen: fenSchema, quotedAt: z.number().int(), expiresAt: z.number().int().nullable(),
  candidateId: z.string().optional(),
  basis: ref.optional(), matchedTags: z.array(ref).optional(), missingTags: z.array(ref).optional(),
  budgetRelation: z.enum(["reference-within", "reference-over"]).optional(), budgetDifferenceFen: fenSchema.optional(), explanation: z.string().optional(),
}).strict();
export const recommendationSchema = z.object({
  source: sourceSchema, status: z.enum(["ready", "empty", "expired"]), requestKey: z.string(),
  budgetOptions: z.array(rankedOptionSchema).max(3), overBudgetOption: rankedOptionSchema.nullable(),
  rejectedQuotes: z.array(z.object({ candidateId: z.string(), quote: quoteSchema })),
  referencePrices: z.array(referencePriceSchema).max(12).default([]),
  couponHints: z.array(couponHintSchema).optional(), unavailableItems: z.array(unavailableItemSchema).optional(),
  claimableHints: z.array(z.string()), issues: z.array(z.string()), message: z.string(),
  coverage: z.object({ generated: z.number().int().nonnegative(), attempted: z.number().int().nonnegative(), succeeded: z.number().int().nonnegative(), rejectedOptions: z.number().int().nonnegative(), truncated: z.boolean(), scope: z.literal("generated-candidates-only") }),
}).strict();

export type DiningContext = z.infer<typeof diningContextSchema>;
export type MealRequest = z.infer<typeof mealRequestSchema>;
export type MenuOption = z.infer<typeof menuOptionSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type Coupon = z.infer<typeof couponSchema>;
export type Item = z.infer<typeof itemSchema>;

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => compareId(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const contextKey = (context: DiningContext) => canonical(diningContextSchema.parse(context));
export const requestKey = (context: DiningContext, request: MealRequest) => canonical({ context: diningContextSchema.parse(context), request: mealRequestSchema.parse(request) });
export function normalizeItems(items: Item[]): Item[] {
  const sort = <T>(values: T[]) => values.sort((a, b) => compareId(canonical(a), canonical(b)));
  const normalized = items.map((item) => ({ ...item, modifications: sort([...item.modifications]), rounds: item.rounds.map((round) => ({ ...round, choices: sort(round.choices.map((choice) => ({ ...choice, modifications: sort([...choice.modifications]) }))) })).sort((a, b) => compareId(a.roundRef, b.roundRef)) }));
  return sort(normalized);
}
export const candidateId = (items: Item[], coupon: Coupon | null) => canonical({ items: normalizeItems(items), coupon });
export const quoteBinding = (context: DiningContext, request: MealRequest, candidate: Candidate) => canonical({ request: requestKey(context, request), configuration: candidateId(candidate.items, candidate.coupon) });
