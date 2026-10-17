import { expect, test } from "@playwright/test";
import { defaultForm } from "../../src/domain/workflow";

for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
  test(`controlled live reference groups, coupon conditions and invalidation at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const reference = (name: string, amountFen: number, over = false) => ({ products: [{ name, quantity: 1 }], items: [{ name: "受控鸡肉堡", quantity: 1 }, { name: "受控无糖饮品", quantity: 1 }], amountFen, quotedAt: Date.now(), expiresAt: null, basis: "mcd-pickup-price-fen-no-coupon", matchedTags: ["chicken"], missingTags: ["sugar-free"], budgetRelation: over ? "reference-over" : "reference-within", budgetDifferenceFen: Math.abs(amountFen - 2500), explanation: "受控界面样例，用于验证展示，不是真实报价。" });
    const actions: string[] = [];
    const view = { revision: 2, stores: [], form: { ...defaultForm, budget: "25", likedTags: ["chicken", "sugar-free"] }, draft: null, result: {
      budgetOptions: [], overBudgetOption: null, referencePrices: [reference("受控预算参考套餐", 2290), reference("受控超预算套餐", 2700, true)],
      message: "受控参考结果", issues: ["完整费用未知"], claimableHints: [], rejectedCount: 2,
      couponHints: [{ name: "受控已有券", status: "已持有", conditions: ["本单适用性未验证，未计入报价"] }],
      coverage: { generated: 2, attempted: 2, succeeded: 0, rejectedOptions: 0, truncated: false, scope: "generated-candidates-only" },
    } };
    await page.route("**/api/workflow", async route => {
      const action = route.request().postDataJSON().action; actions.push(action);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(action === "bootstrap" ? view : { ...view, revision: 3, result: null }) });
    });
    await page.goto("http://127.0.0.1:3301/recommend");
    const within = page.getByRole("region", { name: "参考价在预算内", exact: true });
    await expect(within).toContainText("¥22.90");
    await expect(within).toContainText("参考价距预算 ¥2.10");
    await expect(within).toContainText("更想要无糖饮品？可以看看其他搭配。");
    await expect(within).toContainText("不能保证实际支付不超预算");
    await expect(page.getByRole("region", { name: "超出预算的参考备选", exact: true })).toContainText("参考价超预算 ¥2.00");
    await expect(page.getByTestId("budget-option")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /核对这份搭配|确认创建/ })).toHaveCount(0);
    await expect(page.getByText("模拟下单可核对餐品和体验订单流程，不会付款或通知门店。实际购买请前往麦当劳官方渠道。", { exact: true })).toHaveCount(1);
    await expect(page.getByTestId("reference-price").locator("summary")).toHaveCount(0);
    await expect(within).not.toContainText("calculate-price");
    await page.getByText("已有券与门店提示（1 条）").click();
    await expect(page.getByRole("region", { name: "优惠券", exact: true })).toContainText("本单适用性未验证");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "更换门店 / 用餐方式 ↗" }).click();
    await page.getByRole("button", { name: /麦乐送外送/ }).click();
    await expect(page.getByTestId("reference-price")).toHaveCount(0);
    expect(actions.every(action => ["bootstrap", "invalidate"].includes(action))).toBe(true);
  });
}
