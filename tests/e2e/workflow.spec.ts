import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const demo = "http://127.0.0.1:3300";
const screenshots = "docs/screenshots/stage-4";
async function capture(page: Page, name: string) { if (process.env.MCTIMING_CAPTURE_SCREENSHOTS !== "1") return; await mkdir(screenshots, { recursive: true }); await page.screenshot({ path: `${screenshots}/${name}.png`, fullPage: true }); }
async function openStore(page: Page, delivery = false) {
  await page.goto(`${demo}/recommend`);
  await expect(page.getByRole("button", { name: "查看样例门店" })).toBeEnabled();
  if (delivery) await page.getByRole("button", { name: "麦乐送外送" }).click();
  await page.getByRole("button", { name: "查看样例门店" }).click();
  await page.getByRole("button", { name: /样例中央广场店/ }).click();
}
async function preferences(page: Page, delivery = false) {
  await openStore(page, delivery);
  await page.getByRole("button", { name: "设置预算与口味" }).click();
}
async function generate(page: Page) {
  await page.getByRole("button", { name: "生成我的搭配" }).click();
  await expect(page.getByRole("heading", { name: "预算内的搭配" })).toBeVisible();
}
test("home, pickup, independent over-budget option, review and decline; desktop screenshots", async ({ page }) => {
  const external: string[] = [];
  await page.route("**/*", async (route) => { if (new URL(route.request().url()).hostname !== "127.0.0.1") { external.push(route.request().url()); await route.abort(); } else await route.continue(); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto(demo))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "你的单人餐预算搭配助手" })).toBeVisible();
  await expect(page.getByText("样例演示，不产生真实订单。", { exact: true })).toBeVisible();
  await capture(page, "01-home-desktop");
  await page.getByRole("link", { name: "开始推荐" }).click();
  await page.getByRole("button", { name: "查看样例门店" }).click();
  await page.getByRole("button", { name: /样例中央广场店/ }).click();
  await capture(page, "02-store-desktop");
  await page.getByRole("button", { name: "设置预算与口味" }).click();
  await capture(page, "03-preferences-desktop");
  await generate(page);
  await expect(page.getByTestId("budget-option")).toHaveCount(2);
  await expect(page.getByTestId("budget-option").first()).toContainText("¥21.00");
  await expect(page.getByTestId("budget-option").first()).toContainText("更想要牛肉？可以看看其他搭配。");
  await expect(page.getByTestId("over-option")).toHaveCount(1);
  await expect(page.getByTestId("over-option")).toContainText("超出预算 ¥1.00");
  await capture(page, "04-results-desktop");
  await page.getByTestId("budget-option").first().getByRole("button", { name: "核对这份搭配" }).click();
  await expect(page.getByRole("heading", { name: "订单核对", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "真实下单未开放" })).toBeDisabled();
  await capture(page, "05-review-desktop");
  await page.reload();
  await expect(page.getByRole("heading", { name: "订单核对", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "本次不购买" }).click();
  await expect(page.getByRole("status")).toContainText("没有创建订单");
  expect(external).toEqual([]);
});
test("delivery demo, full fictional fees and mobile screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(demo); await capture(page, "06-home-mobile");
  await preferences(page, true);
  await page.getByLabel("单人餐预算（元）").fill("35");
  await generate(page);
  await expect(page.getByTestId("budget-option").first()).toContainText("¥32.00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "07-delivery-mobile");
  await page.getByTestId("budget-option").first().getByRole("button", { name: "核对这份搭配" }).click();
  await expect(page.locator(".review-store")).toContainText("虚构地址");
  await expect(page.locator(".fee-list")).toContainText("¥6.00");
  await expect(page.getByRole("button", { name: "真实下单未开放" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "08-review-mobile");
});
test("budget validation and preference conflicts", async ({ page }) => {
  await preferences(page);
  for (const value of ["0", "-1", "25.001", "abc"]) {
    await page.getByLabel("单人餐预算（元）").fill(value);
    await page.getByRole("button", { name: "生成我的搭配" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("预算");
    await expect(page.getByTestId("budget-option")).toHaveCount(0);
  }
  await page.getByLabel("单人餐预算（元）").fill("25");
  await page.getByLabel("排除牛肉", { exact: true }).check();
  await page.getByRole("button", { name: "生成我的搭配" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("不能同时选择");
});
test("likes outrank cheaper food and exclusion applies to all displayed options", async ({ page }) => {
  await preferences(page); await page.getByLabel("单人餐预算（元）").fill("35"); await generate(page);
  await expect(page.getByTestId("budget-option").first()).toContainText("样例牛肉主食");
  await expect(page.getByTestId("budget-option").first()).toContainText("口味：牛肉、无糖饮品");
  await page.getByRole("button", { name: "修改条件" }).click();
  await page.getByLabel("喜欢牛肉", { exact: true }).uncheck();
  await page.getByLabel("排除牛肉", { exact: true }).check(); await generate(page);
  const cards = page.getByTestId("budget-option");
  expect(await cards.count()).toBeGreaterThan(0);
  for (const card of await cards.all()) { await expect(card.locator(".meal-items")).not.toContainText("牛肉"); }
  await expect(page.getByTestId("over-option")).toHaveCount(0);
});
test("no budget fit gives limited-search message and a separate alternative", async ({ page }) => {
  await preferences(page); await page.getByLabel("单人餐预算（元）").fill("1"); await generate(page);
  await expect(page.getByTestId("budget-option")).toHaveCount(0);
  await expect(page.getByText("当前候选范围内，未找到合适的预算内组合。", { exact: true })).toBeVisible();
  await expect(page.getByTestId("over-option")).toHaveCount(1);
});
test("store change revokes old quotes and server draft", async ({ page }) => {
  await preferences(page); await generate(page);
  await page.getByTestId("budget-option").first().getByRole("button", { name: "核对这份搭配" }).click();
  await page.getByRole("button", { name: "更换门店 / 用餐方式" }).click();
  const changed = page.waitForResponse((response) => response.url().endsWith("/api/workflow") && response.request().postDataJSON().action === "invalidate");
  await page.getByRole("button", { name: /样例河畔公园店/ }).click(); await changed;
  await expect(page.getByRole("status")).toContainText("已失效");
  await expect(page.getByTestId("budget-option")).toHaveCount(0);
  await page.getByRole("button", { name: "设置预算与口味" }).click(); await generate(page);
  await page.getByTestId("budget-option").first().getByRole("button", { name: "核对这份搭配" }).click();
  await expect(page.locator(".review-store")).toContainText("样例河畔公园店");
});
test("late browser response cannot restore a previous condition version", async ({ page }) => {
  await preferences(page);
  let release!: () => void; let received!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { received = resolve; });
  await page.route("**/api/workflow", async (route) => {
    if (route.request().postDataJSON().action === "recommend") { const response = await route.fetch(); received(); await gate; await route.fulfill({ response }); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "生成我的搭配" }).click(); await reached;
  await page.getByLabel("单人餐预算（元）").fill("1");
  const oldResponse = page.waitForResponse((response) => response.url().endsWith("/api/workflow") && response.request().postDataJSON().action === "recommend");
  release(); await oldResponse;
  await expect(page.getByRole("status")).toContainText("已失效");
  await expect(page.getByRole("heading", { name: "给今天这顿饭一个预算" })).toBeVisible();
  await expect(page.getByTestId("budget-option")).toHaveCount(0);
  await generate(page);
  await expect(page.getByTestId("budget-option")).toHaveCount(0);
  await expect(page.getByText("当前候选范围内，未找到合适的预算内组合。", { exact: true })).toBeVisible();
});
test("live missing credentials fails explicitly, delivery and real ordering stay blocked", async ({ page }) => {
  await page.goto("http://127.0.0.1:3302/recommend");
  await page.getByRole("button", { name: "查询真实门店" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("未配置 MCP Token");
  await expect(page.locator(".store-card")).toHaveCount(0);
  await expect(page.getByTestId("budget-option")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "核对这份搭配" })).toHaveCount(0);
  await page.getByRole("button", { name: "麦乐送外送" }).click();
  await expect(page.getByText(/真实外送暂未开放/)).toBeVisible();
});
test("canary never reaches live HTML or browser JS; no automatic MCP call", async ({ page, request }) => {
  const actions: string[] = [];
  page.on("request", value => { if (value.url().endsWith("/api/workflow")) actions.push(value.postDataJSON().action); });
  const response = await page.goto("http://127.0.0.1:3301/recommend");
  expect(await response!.text()).not.toContain("mctiming-test-secret-canary");
  await expect(page.getByText("真实餐品 · 模拟订单", { exact: true })).toBeVisible();
  const scripts = await page.locator("script[src]").evaluateAll((elements) => elements.map((el) => (el as HTMLScriptElement).src));
  for (const src of scripts) { const js = await (await request.get(src)).text(); expect(js).not.toContain("mctiming-test-secret-canary"); expect(js).not.toContain("MCD_MCP_TOKEN"); }
  expect(actions.every(action => action === "bootstrap")).toBe(true);
});
test("API rejects cross-site access and unsupported transaction actions", async ({ request }) => {
  const forbidden = await request.post(`${demo}/api/workflow`, { data: { action: "bootstrap" }, headers: { Origin: "https://evil.invalid" } });
  expect(forbidden.status()).toBe(403);
  for (const action of ["create-order", "delivery-create-address", "pay", "claim-coupon"]) {
    const response = await request.post(`${demo}/api/workflow`, { data: { action }, headers: { Origin: demo } });
    expect(response.status()).toBe(400);
  }
});
