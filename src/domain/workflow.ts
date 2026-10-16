import { z } from "zod";
import type { Quote, Recommendation } from "./meal";
import { fenSchema } from "./meal";
import { demoScenarioSchema, type CheckoutView } from "./checkout";

export const foodTags = { chicken: "鸡肉", beef: "牛肉", "sugar-free": "无糖饮品", fruit: "果味饮品", potato: "土豆小食", spicy: "辣味" } as const;
export const tagLabel = (tag: string) => foodTags[tag as keyof typeof foodTags] ?? tag;
export const money = (fen: number) => {
  const exact = BigInt(fenSchema.parse(fen));
  return `¥${exact / 100n}.${String(exact % 100n).padStart(2, "0")}`;
};
export const budgetSchema = z.string().regex(/^\d{1,4}(\.\d{1,2})?$/, "预算需为 0.01–9999.99 元，最多两位小数").refine((value) => Number(value) > 0, "预算必须大于 0 元");
export function budgetToFen(value: string) {
  const [yuan, fraction = ""] = budgetSchema.parse(value).split(".");
  return Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
}
const tags = z.array(z.enum(Object.keys(foodTags) as [keyof typeof foodTags, ...Array<keyof typeof foodTags>])).max(6);
export const formSchema = z.object({
  fulfillment: z.enum(["pickup", "delivery"]), city: z.string().trim().min(1).max(50), keyword: z.string().trim().min(1).max(100),
  storeRef: z.string().max(200), addressRef: z.string().max(200), takeWay: z.enum(["eat-in", "take-in-store"]),
  budget: budgetSchema, includeSnack: z.boolean(), likedTags: tags, excludedTags: tags,
}).strict().refine((value) => !value.likedTags.some((tag) => value.excludedTags.includes(tag)), "喜欢项与排除项不能同时选择同一品类");
export type MealForm = z.infer<typeof formSchema>;
export const defaultForm: MealForm = { fulfillment: "pickup", city: "样例城市", keyword: "中央广场", storeRef: "", addressRef: "demo-address-1", takeWay: "take-in-store", budget: "25", includeSnack: false, likedTags: ["beef", "sugar-free"], excludedTags: [] };
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("bootstrap") }).strict(),
  z.object({ action: z.literal("invalidate"), revision }).strict(),
  z.object({ action: z.literal("stores"), revision, fulfillment: z.enum(["pickup", "delivery"]), city: z.string().trim().min(1).max(50), keyword: z.string().trim().min(1).max(100), addressRef: z.string().max(200) }).strict(),
  z.object({ action: z.literal("recommend"), revision, form: formSchema }).strict(),
  z.object({ action: z.literal("review"), revision, optionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("abstain"), revision }).strict(),
  z.object({ action: z.literal("checkout-confirm"), revision, draftId: z.string().uuid(), version: revision, confirmed: z.literal(true), addressConfirmed: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal("checkout-status"), revision, draftId: z.string().uuid(), version: revision }).strict(),
  z.object({ action: z.literal("checkout-cancel"), revision, draftId: z.string().uuid(), version: revision }).strict(),
  z.object({ action: z.literal("checkout-scenario"), revision, draftId: z.string().uuid(), version: revision, scenario: demoScenarioSchema }).strict(),
]);
export type WorkflowAction = z.infer<typeof actionSchema>;
export type StoreView = { ref: string; name: string; address: string; available: boolean; hours: string; reservations: string[] };
export type OptionView = { id: string; items: { name: string; quantity: number; role: string }[]; matched: string[]; missing: string[]; totalFen: number; fees: NonNullable<Quote["fees"]>; overBudgetFen: number; source: "demo" | "official"; status: "demo" | "verified"; quotedAt: number; explanation: string; coupon: string };
export type ResultView = { budgetOptions: OptionView[]; overBudgetOption: OptionView | null; referencePrices: Recommendation["referencePrices"]; message: string; issues: string[]; claimableHints: string[]; coverage: Recommendation["coverage"]; rejectedCount: number };
export type DraftView = { id: string; revision: number; option: OptionView; store: StoreView; form: MealForm; deliveryAddress: string | null; transactionEnabled: false; checkout?: CheckoutView };
export type WorkflowView = { revision: number; stores: StoreView[]; form: MealForm | null; result: ResultView | null; draft: DraftView | null };
export const demoAddress = "样例城市 · 春日路 100 号演示楼（虚构地址）";
