import { z } from "zod";
import type { CheckoutAdapter } from "../checkout";
import type { CheckoutSnapshot } from "../../domain/checkout";
import { priceArguments } from "./adapter";

export const REAL_TRANSACTION_BLOCK = "真实交易未授权；费用完整性、报价金额绑定、幂等和超时恢复尚未验证。";

// Offline mapping only, based on the saved 2026-10-12 actual tool Schema.
// No SDK/transport is accepted or imported here, so neither Token nor HTTP input can enable writes.
export function mapPickupOrderForReview(snapshot: CheckoutSnapshot) {
  if (snapshot.context.mode !== "live" || snapshot.context.fulfillment !== "pickup" || snapshot.candidate.coupon) throw new Error("仅有自取无券字段映射依据；其他路径未验证。");
  return { ...priceArguments(snapshot.context, snapshot.candidate), takeWayCode: snapshot.context.takeWay };
}
export const addressInputSchema = z.object({ address: z.string().min(1), addressDetail: z.string().min(1), city: z.string().min(1), contactName: z.string().min(1), phone: z.string().regex(/^\d{11}$/), gender: z.string().optional() }).strict();
export const queryOrderInputSchema = z.object({ orderId: z.string().min(1) }).strict();
export const declaredCreateResultSchema = z.object({ data: z.object({ orderId: z.string(), payId: z.string().optional(), payH5Url: z.string().optional(), orderDetail: z.unknown().optional() }) });
export const declaredAddressResultSchema = z.object({ data: z.object({ addressId: z.string(), contactName: z.string().optional(), fullAddress: z.string().optional(), phone: z.string().optional() }) });
// Amount/status strings are retained as unknown semantics, never inferred as fen or success.
export const declaredOrderResultSchema = z.object({ data: z.object({ orderId: z.string(), orderStatus: z.string().optional(), status: z.string().optional(), totalAmount: z.string().optional(), realTotalAmount: z.string().optional() }) });
export function classifyUnverifiedWriteFailure(): "unknown" { return "unknown"; }
export const blockedMcdCheckoutAdapter: CheckoutAdapter = {
  async recheck() { return { status: "blocked", reason: REAL_TRANSACTION_BLOCK }; },
  async create() { throw new Error(REAL_TRANSACTION_BLOCK); },
  async query() { throw new Error("真实订单查询尚未联调，本阶段没有可验证的真实订单标识。"); },
};
export function saveRealAddressDisabled(): never { throw new Error("阶段 5A 禁止保存真实地址。"); }
