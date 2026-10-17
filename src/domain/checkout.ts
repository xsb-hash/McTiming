import { z } from "zod";
import { candidateSchema, diningContextSchema, mealRequestSchema, quoteSchema, canonical } from "./meal";

export const checkoutStates = {
  "awaiting-confirmation": "待确认", rechecking: "复核中", "reconfirmation-required": "需要重新确认", creating: "创建中",
  created: "已创建", failed: "明确失败", unknown: "结果未知", blocked: "已阻塞", invalidated: "已失效", cancelled: "已取消本次操作",
} as const;
export const demoScenarios = { normal: "正常创建", "price-change": "报价变化（增加 2 元）", failure: "明确创建失败", timeout: "创建超时／结果未知" } as const;
export const demoScenarioSchema = z.enum(["normal", "price-change", "failure", "timeout"]);
export type DemoScenario = z.infer<typeof demoScenarioSchema>;
export const checkoutSnapshotSchema = z.object({
  context: diningContextSchema, request: mealRequestSchema, candidate: candidateSchema, quote: quoteSchema,
}).strict();
export type CheckoutSnapshot = z.infer<typeof checkoutSnapshotSchema>;
export const demoOrderSchema = z.object({
  id: z.string().regex(/^DEMO-[a-f0-9-]+$/), source: z.literal("demo"),
  status: z.enum(["模拟待支付", "模拟配餐中（未真实支付）"]),
  payment: z.literal("模拟支付信息：不提供支付链接，不可实际支付。"),
}).strict();
export type DemoOrder = z.infer<typeof demoOrderSchema>;
export const checkoutDraftSchema = z.object({
  id: z.string().uuid(), sessionId: z.string().uuid(), version: z.number().int().positive(),
  snapshot: checkoutSnapshotSchema,
  state: z.enum(Object.keys(checkoutStates) as [keyof typeof checkoutStates, ...Array<keyof typeof checkoutStates>]),
  scenario: demoScenarioSchema, valid: z.boolean(), expiresAt: z.number().int(),
  previousTotalFen: z.number().int().nonnegative().nullable(), changes: z.array(z.string()), message: z.string(),
  order: demoOrderSchema.nullable(),
}).strict();
export type CheckoutDraft = z.infer<typeof checkoutDraftSchema>;
export type CheckoutView = Pick<CheckoutDraft, "id" | "version" | "state" | "scenario" | "valid" | "previousTotalFen" | "changes" | "message" | "order"> & {
  totalFen: number | null; quotedAt: number; quoteStatus: string; expiresAt: number; specifications: string[];
  referenceSimulation?: boolean;
};
export const confirmCheckoutSchema = z.object({ draftId: z.string().uuid(), version: z.number().int().positive(), confirmed: z.literal(true), addressConfirmed: z.boolean().default(false) }).strict();

// Times can refresh without changing the contents the user agreed to.
export function checkoutContents(value: CheckoutSnapshot) {
  return canonical({ context: value.context, request: value.request, items: value.candidate.items, components: value.candidate.components, coupon: value.candidate.coupon, fees: value.quote.fees, totalFen: value.quote.totalFen, source: value.quote.source, status: value.quote.status });
}
