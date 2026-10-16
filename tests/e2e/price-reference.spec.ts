import { expect, test } from "@playwright/test";
import { defaultForm } from "../../src/domain/workflow";

test("controlled live-page reference amount has no purchase control and disappears after changing conditions", async ({ page }) => {
  // Intercept every business API request: this is a UI fixture, not a real quote.
  const requests: string[] = [];
  const view = { revision: 2, stores: [], form: { ...defaultForm, likedTags: [] }, draft: null, result: {
    budgetOptions: [], overBudgetOption: null, referencePrices: [{ products: [{ name: "受控官方套餐名称", quantity: 1 }], items: [{ name: "受控回放套餐", quantity: 1 }], amountFen: 3450, quotedAt: 1791987977029, expiresAt: null }],
    message: "完整费用未核验", issues: [], claimableHints: [], rejectedCount: 1,
    coverage: { generated: 1, attempted: 1, succeeded: 0, rejectedOptions: 0, truncated: false, scope: "generated-candidates-only" },
  } };
  await page.route("**/api/workflow", async (route) => {
    const action = route.request().postDataJSON().action;
    requests.push(action);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(action === "bootstrap" ? view : { ...view, revision: 3, result: null }) });
  });
  await page.goto("http://127.0.0.1:3301/recommend");
  const section = page.getByRole("region", { name: "官方查询参考金额" });
  await expect(section).toContainText("当前查询金额，最终费用待核验");
  await expect(section).toContainText("¥34.50");
  await expect(section.getByRole("heading", { name: "受控官方套餐名称 × 1" })).toBeVisible();
  await expect(section).toContainText("包含：受控回放套餐 × 1");
  await expect(section).toContainText("查询时间（北京时间）");
  await expect(section.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /核对这份搭配|确认创建/ })).toHaveCount(0);
  await page.getByRole("button", { name: "修改条件", exact: true }).click();
  await page.getByLabel("单人餐预算（元）").fill("41");
  await expect(page.getByTestId("reference-price")).toHaveCount(0);
  expect(requests.every((name) => ["bootstrap", "invalidate"].includes(name))).toBe(true);
});
