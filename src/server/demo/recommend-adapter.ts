import { contextKey, quoteBinding, type MenuOption, type Quote } from "../../domain/meal";
import type { RecommendationAdapter } from "../recommend";

// Fictional products/prices only. This module has no MCP or credential imports.
export function createDemoRecommendationAdapter(now = Date.now): RecommendationAdapter {
  const products = [
    { ref: "demo-main-1", name: "样例鸡肉主食", role: "main", tags: ["chicken"], price: 1600 },
    { ref: "demo-main-2", name: "样例牛肉主食", role: "main", tags: ["beef"], price: 2100 },
    { ref: "demo-drink-1", name: "样例无糖饮品", role: "drink", tags: ["sugar-free"], price: 500 },
    { ref: "demo-drink-2", name: "样例果味饮品", role: "drink", tags: ["fruit"], price: 700 },
    { ref: "demo-snack-1", name: "样例土豆小食", role: "snack", tags: ["potato"], price: 600 },
  ] as const;
  const vocabulary = ["main", "drink", "snack", "chicken", "beef", "sugar-free", "fruit", "potato", "spicy"];
  return {
    source: "demo",
    async load(context) {
      if (context.mode !== "demo") throw new Error("演示 Adapter 不能用于真实模式。");
      const options: MenuOption[] = products.map((product) => ({
        ref: product.ref, name: product.name, source: "demo", contextKey: contextKey(context), availability: "available", composition: "complete", selectionHintFen: product.price,
        items: [{ productRef: product.ref, quantity: 1, modifications: [], rounds: [] }],
        components: [{ productRef: product.ref, name: product.name, quantity: 1, role: product.role, tags: [...product.tags], exclusionChecks: Object.fromEntries(vocabulary.map((tag) => [tag, tag === product.role || (product.tags as readonly string[]).includes(tag) ? "present" : "absent"])) }],
      }));
      return { source: "demo", options, coupons: [], claimableHints: ["虚构可领取券提示：不计入样例报价，不执行领取。"], issues: ["全部餐品与金额均为独立虚构数据，不产生真实订单。"] };
    },
    async quote(context, request, candidate): Promise<Quote> {
      if (context.mode !== "demo" || candidate.source !== "demo" || candidate.coupon) throw new Error("样例条件不匹配。");
      const productFen = candidate.items.reduce((sum, item) => {
        const product = products.find((entry) => entry.ref === item.productRef);
        if (!product || item.rounds.length || item.modifications.length) throw new Error("未知样例商品配置。");
        return sum + product.price * item.quantity;
      }, 0);
      const deliveryFen = context.fulfillment === "delivery" ? 600 : 0;
      return { source: "demo", status: "demo", binding: quoteBinding(context, request, candidate), totalFen: productFen + deliveryFen, fees: { productFen, deliveryFen, discountFen: 0, packingFen: 0, tablewareFen: 0 }, quotedAt: now(), expiresAt: null, reasons: ["虚构演示价格"] };
    },
  };
}
