import { expect, test } from "@playwright/test";
import { liveReferenceFixture } from "../fixtures/live-reference";
import { WorkflowError } from "../../src/server/workflow";

for (const width of [1366, 390]) {
  test(`live adapter fixture → reference → review → local simulated order at ${width}px`, async ({ page }) => {
    const fixture = liveReferenceFixture();
    // Execute the real workflow/state machine with controlled MCP responses; no real network tools.
    await page.route("**/api/workflow", async route => {
      try {
        const result = await fixture.workflow.dispatch(route.request().postDataJSON());
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
      } catch (error) {
        await route.fulfill({ status: error instanceof WorkflowError ? error.status : 500, contentType: "application/json", body: JSON.stringify({ error: "受控请求被拒绝" }) });
      }
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:3301/recommend");
    await page.getByRole("button", { name: "查询真实门店", exact: true }).click();
    await page.getByRole("group", { name: "选择一家门店" }).getByRole("button").first().click();
    await page.getByRole("button", { name: "设置预算与口味" }).click();
    await page.getByRole("button", { name: "生成我的搭配" }).click();
    const reference = page.getByTestId("reference-price").first();
    await expect(reference).toContainText("受控鸡肉双人气套餐");
    await expect(reference).not.toContainText("满足");
    const before = fixture.calls.length;
    await reference.getByRole("button", { name: "模拟下单", exact: true }).click();
    await expect(page.locator('.steps [aria-current="step"]')).toContainText("订单核对");
    await expect(page.getByRole("heading", { name: "订单核对", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "受控鸡肉双人气套餐 × 1", exact: true })).toBeVisible();
    await expect(page.locator(".review-store")).toContainText(fixture.store.name);
    await expect(page.locator(".review-items")).toContainText("受控无糖可乐");
    await expect(page.locator(".fee-list")).toContainText("官方查询参考价");
    await expect(page.locator(".fee-list")).toContainText("¥13.90");
    await expect(page.locator(".fee-list")).toContainText("未核验；本次模拟不结算");
    await expect(page.locator(".fee-list")).not.toContainText("¥0.00");
    await expect(page.getByRole("button", { name: "确认模拟下单 · 参考价 ¥13.90", exact: true })).toBeDisabled();
    await page.getByLabel("我已核对餐品和门店，确认仅创建模拟订单，不付款", { exact: true }).check();
    await page.getByRole("button", { name: "确认模拟下单 · 参考价 ¥13.90", exact: true }).click();
    await expect(page.getByTestId("checkout-state")).toHaveText("已创建");
    await expect(page.getByTestId("demo-order")).toContainText("DEMO-");
    await expect(page.getByTestId("demo-order").getByRole("link")).toHaveCount(0);
    await page.getByRole("button", { name: "刷新模拟状态" }).click();
    await expect(page.getByTestId("demo-order")).toContainText("模拟配餐中（未真实支付）");
    await page.reload();
    await expect(page.locator('.steps [aria-current="step"]')).toContainText("订单核对");
    await expect(page.getByTestId("demo-order")).toContainText("模拟配餐中（未真实支付）");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(fixture.calls).toHaveLength(before);
  });
}
