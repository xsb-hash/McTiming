import { expect, test } from "@playwright/test";
import { defaultForm, type ResultView, type WorkflowView } from "../../src/domain/workflow";

const result = (): ResultView => ({ budgetOptions: [], overBudgetOption: null, referencePrices: [], message: "旧的通用预算提示", issues: [], claimableHints: [], rejectedCount: 0, coverage: { generated: 2, attempted: 2, succeeded: 0, rejectedOptions: 0, truncated: false, scope: "generated-candidates-only" } });
const view = (data: ResultView): WorkflowView => ({ revision: 2, stores: [], form: defaultForm, draft: null, result: data });

test("coupon rows retain distinct states and rights, hide excess rows and technical details", async ({ page }) => {
  const data = result();
  data.claimableHints = ["中薯条买一送一：可领取（未计入报价）", "中薯条买一送一：已持有（未计入报价）", "中薯条买一送一：本单适用（未计入报价）", "中薯条买一送一：适用性未验证（未计入报价）", "中薯条买一送一：可领取（仅门店甲）"];
  data.issues = ["受控核验细节：商品组成资料不足"];
  await page.route("**/api/workflow", route => route.fulfill({ json: view(data) }));
  await page.goto("http://127.0.0.1:3300/recommend");
  const coupons = page.getByRole("region", { name: "优惠券", exact: true });
  await expect(coupons.locator("li:visible")).toHaveCount(3);
  await expect(coupons).not.toContainText("（未计入报价）");
  await coupons.getByText("查看更多（2 条）", { exact: true }).click();
  await expect(coupons.locator("li:visible")).toHaveCount(5);
  await expect(coupons.getByText("适用性未验证", { exact: true })).toBeVisible();
  await expect(coupons.getByText("中薯条买一送一：可领取（仅门店甲）", { exact: true })).toBeVisible();
  await expect(page.getByText(data.issues[0], { exact: true })).toBeHidden();
  await page.getByText("查看核验详情", { exact: true }).click();
  await expect(page.getByText(data.issues[0], { exact: true })).toBeVisible();
});

test("unverified prices and read errors have separate recovery messages, without purchase claims", async ({ page }) => {
  const data = result(); data.rejectedCount = 2;
  await page.route("**/api/workflow", route => route.fulfill({ json: view(data) }));
  await page.goto("http://127.0.0.1:3301/recommend");
  await expect(page.getByRole("status")).toContainText("候选已有，报价尚未通过核验");
  await expect(page.getByRole("button", { name: "重新查询", exact: true })).toBeVisible();
  await expect(page.getByText("当前候选范围内，未找到合适的预算内组合。", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "核对这份搭配" })).toHaveCount(0);
  await expect(page.locator(".food-photo")).toHaveCount(0);
  data.coverage.attempted = 0; data.issues = ["菜单或优惠数据读取失败，未使用模拟数据替代。"];
  await page.reload();
  await expect(page.getByRole("status")).toContainText("本次查询未完成");
  await expect(page.getByRole("button", { name: "重新查询", exact: true })).toBeVisible();
});

test("mobile demo photos load, first option shows its amount and summary remains above results", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:3300/recommend");
  await page.getByRole("button", { name: "查看样例门店" }).click();
  await page.getByRole("button", { name: /样例中央广场店/ }).click();
  await page.getByRole("button", { name: "设置预算与口味" }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "25 元", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "生成我的搭配" }).click();
  const first = page.getByTestId("budget-option").first();
  await expect(first).toContainText("¥21.00");
  await expect(first.getByRole("img")).toHaveAttribute("alt", /AI 示意图，非实物照片/);
  await first.getByRole("img").evaluate(async image => { await (image as HTMLImageElement).decode(); });
  expect(await first.getByRole("img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect((await page.getByRole("complementary", { name: "当前用餐条件" }).boundingBox())!.y).toBeLessThan((await first.boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByText("样例演示，不产生真实订单。", { exact: true })).toBeVisible();
});
