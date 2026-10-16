import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { WorkflowView } from "../../src/domain/workflow";

const origin = "http://127.0.0.1:3300";
async function review(page: Page, delivery = false) {
  await page.goto(`${origin}/recommend`);
  if (delivery) await page.getByRole("button", { name: "麦乐送外送" }).click();
  await page.getByRole("button", { name: "查看样例门店" }).click();
  await page.getByRole("button", { name: /样例中央广场店/ }).click();
  await page.getByRole("button", { name: "设置预算与口味" }).click();
  if (delivery) await page.getByLabel("单人餐预算（元）").fill("35");
  await page.getByRole("button", { name: "生成我的搭配" }).click();
  await page.getByTestId("budget-option").first().getByRole("button", { name: "核对这份搭配" }).click();
  await expect(page.getByTestId("checkout-state")).toHaveText("待确认");
}
async function confirm(page: Page) { await page.getByLabel("我已核对餐品", { exact: false }).check(); await page.getByRole("button", { name: "确认创建模拟订单" }).click(); }
async function state(page: Page): Promise<WorkflowView> {
  return (await page.request.post(`${origin}/api/workflow`, { headers: { Origin: origin }, data: { action: "bootstrap" } })).json();
}
function confirmation(view: WorkflowView) { return { action: "checkout-confirm", revision: view.revision, draftId: view.draft!.checkout!.id, version: view.draft!.checkout!.version, confirmed: true }; }
async function capture(page: Page, name: string) { if (process.env.MCTIMING_CAPTURE_SCREENSHOTS !== "1") return; await mkdir("docs/screenshots/phase5a", { recursive: true }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `docs/screenshots/phase5a/${name}.png`, fullPage: true }); }

test("explicit demo confirmation, duplicate API submissions, status refresh and no payment links", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => { if (!request.url().startsWith(origin)) external.push(request.url()); });
  await review(page);
  await expect(page.getByText("样例演示，不产生真实订单。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认创建模拟订单 · ¥21.00" })).toBeDisabled();
  const initial = await state(page);
  await capture(page, "01-confirmation"); await confirm(page);
  await expect(page.getByTestId("checkout-state")).toHaveText("已创建");
  const created = await state(page);
  const responses = await Promise.all(Array.from({ length: 5 }, () => page.request.post(`${origin}/api/workflow`, { headers: { Origin: origin }, data: confirmation(initial) })));
  for (const response of responses) { expect(response.status()).toBe(200); expect((await response.json()).draft.checkout.order.id).toBe(created.draft!.checkout!.order!.id); }
  await page.getByRole("button", { name: "刷新模拟状态" }).click();
  await expect(page.getByTestId("demo-order")).toContainText("模拟配餐中（未真实支付）");
  await expect(page.getByTestId("demo-order").getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "真实下单未开放" })).toBeDisabled();
  await page.reload(); await expect(page.getByTestId("checkout-state")).toHaveText("已创建");
  await capture(page, "02-created"); expect(external).toEqual([]);
});

test("changed quotation requires a new version and a second explicit confirmation", async ({ page }) => {
  await review(page); await page.getByLabel("模拟交易场景").selectOption("price-change");
  await expect(page.getByLabel("模拟交易场景")).toHaveValue("price-change");
  const previous = await state(page); await confirm(page);
  await expect(page.getByTestId("checkout-state")).toHaveText("需要重新确认");
  await expect(page.getByTestId("quote-change")).toContainText("原金额 ¥21.00 → 新金额 ¥23.00");
  await expect(page.getByTestId("demo-order")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认创建模拟订单 · ¥23.00" })).toBeDisabled();
  const stale = await page.request.post(`${origin}/api/workflow`, { headers: { Origin: origin }, data: confirmation(previous) }); expect(stale.status()).toBe(409);
  await capture(page, "03-price-change"); await confirm(page);
  await expect(page.getByTestId("checkout-state")).toHaveText("已创建");
  expect((await state(page)).draft!.option.totalFen).toBe(2300);
  await expect(page.getByTestId("quote-change")).toHaveCount(0);
});

test("failure and unknown are distinct; unknown cannot be retried or erased by new conditions", async ({ page }) => {
  await review(page); await page.getByLabel("模拟交易场景").selectOption("failure"); await confirm(page);
  await expect(page.getByTestId("checkout-state")).toHaveText("明确失败"); await expect(page.getByTestId("demo-order")).toHaveCount(0);
  await page.getByRole("button", { name: "返回推荐", exact: true }).click();
  await page.getByTestId("budget-option").first().getByRole("button", { name: "核对这份搭配" }).click();
  await page.getByLabel("模拟交易场景").selectOption("timeout"); await confirm(page);
  await expect(page.getByTestId("checkout-state")).toHaveText("结果未知");
  await expect(page.getByRole("button", { name: "确认创建模拟订单" })).toHaveCount(0);
  const unknown = await state(page);
  const repeated = await page.request.post(`${origin}/api/workflow`, { headers: { Origin: origin }, data: confirmation(unknown) });
  expect((await repeated.json()).draft.checkout.state).toBe("unknown");
  const invalidation = await page.request.post(`${origin}/api/workflow`, { headers: { Origin: origin }, data: { action: "invalidate", revision: unknown.revision + 1 } }); expect(invalidation.status()).toBe(409);
  await page.reload(); await expect(page.getByTestId("checkout-state")).toHaveText("结果未知"); await capture(page, "04-unknown");
});

test("mobile delivery explicitly confirms fictional address and complete sample fees", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await review(page, true);
  await expect(page.locator(".fee-list")).toContainText("¥6.00");
  await page.getByLabel("我已核对餐品", { exact: false }).check();
  await expect(page.getByRole("button", { name: "确认创建模拟订单 · ¥32.00" })).toBeDisabled();
  await page.getByLabel("我确认上方虚构配送地址", { exact: false }).check();
  await page.getByRole("button", { name: "确认创建模拟订单" }).click();
  await expect(page.getByTestId("checkout-state")).toHaveText("已创建");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, "05-delivery-mobile");
});

test("canceling an unsubmitted operation invalidates its server draft", async ({ page }) => {
  await review(page); const old = await state(page);
  await page.getByRole("button", { name: "取消本次模拟操作" }).click();
  await expect(page.getByTestId("checkout-state")).toHaveText("已取消本次操作");
  const res = await page.request.post(`${origin}/api/workflow`, { headers: { Origin: origin }, data: confirmation(old) });
  expect(res.status()).toBe(409); await expect(page.getByTestId("demo-order")).toHaveCount(0);
});

test("API rejects client amounts, absent consent, foreign origins, foreign sessions and missing live quotes", async ({ page, playwright }) => {
  await review(page); const view = await state(page); const data = confirmation(view);
  for (const forged of [{ ...data, totalFen: 1 }, { ...data, confirmed: false }, { ...data, items: [] }, { ...data, enableRealWrites: true }]) {
    expect((await page.request.post(`${origin}/api/workflow`, { headers: { Origin: origin }, data: forged })).status()).toBe(400);
  }
  for (const headers of [{ Origin: "https://evil.invalid" }, {}] as Record<string, string>[]) expect((await page.request.post(`${origin}/api/workflow`, { headers, data })).status()).toBe(403);
  const stranger = await playwright.request.newContext();
  try {
    expect((await stranger.post(`${origin}/api/workflow`, { headers: { Origin: origin }, data })).status()).toBe(409);
    for (const port of [3301, 3302]) {
      const live = `http://127.0.0.1:${port}`;
      expect((await stranger.post(`${live}/api/workflow`, { headers: { Origin: live }, data })).status()).toBe(409);
    }
  } finally { await stranger.dispose(); }
  const unchanged = await state(page); expect(unchanged.draft!.checkout!.state).toBe("awaiting-confirmation"); expect(unchanged.draft!.option.totalFen).toBe(2100);
  expect(JSON.stringify(unchanged)).not.toMatch(/sessionId|MCD_MCP_TOKEN|mctiming-test-secret-canary|payH5Url/);
  await page.context().clearCookies();
  expect((await page.request.post(`${origin}/api/workflow`, { headers: { Origin: origin }, data })).status()).toBe(409);
});

test("store changes invalidate checkout IDs on the server, not only in the browser", async ({ page }) => {
  await review(page); const old = await state(page);
  await page.getByRole("button", { name: "更换门店 / 用餐方式" }).click();
  const changed = page.waitForResponse((response) => response.url().endsWith("/api/workflow") && response.request().postDataJSON().action === "invalidate");
  await page.getByRole("button", { name: /样例河畔公园店/ }).click(); await changed;
  expect((await page.request.post(`${origin}/api/workflow`, { headers: { Origin: origin }, data: confirmation(old) })).status()).toBe(409);
  expect((await state(page)).draft).toBeNull();
});
