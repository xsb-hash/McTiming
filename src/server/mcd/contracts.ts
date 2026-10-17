import { z } from "zod";
import { fenSchema } from "../../domain/meal";

// Only fields declared/observed in docs/mcp/TOOL_SCHEMAS_2026-10-12.json.
// Extra remote fields are stripped, never reinterpreted as domain guarantees.
const ref = z.string().min(1);
export const envelopeSchema = z.object({ success: z.literal(true), code: z.literal(200), data: z.unknown() });
export const menuSchema = z.object({
  categories: z.array(z.object({ name: ref, meals: z.array(z.object({ code: ref, tags: z.array(z.string()).optional() })) })),
  meals: z.record(z.string(), z.object({ name: ref, currentPrice: z.string().optional(), canWithOrder: z.boolean().optional(), discountType: z.string().optional() })),
});
const modificationSchema = z.object({ items: z.array(z.object({ minValues: z.number().int(), maxValues: z.number().int(), values: z.array(z.object({ code: ref, selectedKey: ref, unselectedKey: z.string().optional(), selectedQuantity: z.number().int().nonnegative(), minQuantity: z.number().int(), maxQuantity: z.number().int() })) })) });
export const detailSchema = z.object({
  code: ref, name: ref, supportModify: z.boolean(), modification: modificationSchema.optional(),
  rounds: z.array(z.object({ id: z.number().int(), name: ref, quantity: z.number().int(), minQuantity: z.number().int(), maxQuantity: z.number().int(), choices: z.array(z.object({ code: ref, name: ref, quantity: z.number().int().nonnegative(), isDefault: z.number().int(), maxQuantity: z.number().int(), diffPrice: z.string().optional(), supportModify: z.boolean(), modification: modificationSchema.optional() })) })).optional(),
});
export const priceSchema = z.object({
  price: fenSchema, productPrice: fenSchema, discount: fenSchema,
  deliveryPrice: fenSchema.optional(), packingPrice: fenSchema.optional(), tablewarePrice: fenSchema.optional(),
  productList: z.array(z.object({ productCode: ref, quantity: z.number().int().positive() })).optional(),
});
export const ownedCouponsSchema = z.object({ coupons: z.array(z.object({ id: ref, code: ref, title: z.string().optional(), subtitle: z.string().optional(), datetimeText: z.string().optional(), enable: z.number().int().optional(), tradeStartDate: z.string().optional(), tradeEndDate: z.string().optional(), tags: z.array(z.object({ label: z.string() })).optional() })), totalPages: z.number().int().nonnegative() });
export const storeCouponsSchema = z.array(z.object({ couponId: ref, couponCode: ref, title: z.string().optional(), tradeDateTime: z.string().optional(), products: z.array(z.object({ productCode: ref, productName: z.string().optional() })).optional() }));
export const claimableSchema = z.array(z.object({ couponName: ref, couponStatus: ref, label: ref }));
export type McdDetail = z.infer<typeof detailSchema>;
