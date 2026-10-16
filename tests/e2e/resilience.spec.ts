import { expect, test } from "@playwright/test";
const origin = "http://127.0.0.1:3300";
test("controlled browser API faults never become recommendations or orders", async ({ page }) => {
  await page.goto(`${origin}/recommend`);
  await page.getByRole("button", { name: "查看样例门店" }).click();
  await page.getByRole("button", { name: /样例中央广场店/ }).click();
  await page.getByRole("button", { name: "设置预算与口味" }).click();
  let fault = "401";
  await page.route("**/api/workflow", async (route) => {
    if (route.request().postDataJSON().action !== "recommend") { await route.continue(); return; }
    if (fault === "timeout") { await route.abort("timedout"); return; }
    if (fault === "empty") { await route.fulfill({ status: 200, contentType: "application/json", body: "" }); return; }
    await route.fulfill({ status: Number(fault), contentType: "application/json", body: JSON.stringify({ error: `受控接口故障 ${fault}，未产生报价` }) });
  });
  for (const scenario of ["401", "429", "timeout", "empty"]) {
    fault = scenario; await page.getByRole("button", { name: "生成我的搭配" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("budget-option")).toHaveCount(0); await expect(page.getByTestId("demo-order")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "确认创建模拟订单" })).toHaveCount(0);
  }
  await page.unroute("**/api/workflow"); await page.getByRole("button", { name: "生成我的搭配" }).click();
  await expect(page.getByTestId("budget-option").first()).toBeVisible();
  await page.getByRole("button", { name: "本次不购买" }).click(); await expect(page.getByRole("status")).toContainText("没有创建订单");
});

test("malformed inputs and oversized bodies are rejected before draft creation", async ({ request }) => {
  for (const data of ["{not-json", JSON.stringify({ action: "checkout-confirm", version: "1", draftId: "invalid" })]) {
    const response = await request.post(`${origin}/api/workflow`, { headers: { Origin: origin, "Content-Type": "application/json" }, data });
    expect(response.status()).toBe(400);
  }
  const large = await request.post(`${origin}/api/workflow`, { headers: { Origin: origin, "Content-Type": "application/json" }, data: JSON.stringify({ action: "bootstrap", padding: "x".repeat(9000) }) });
  expect(large.status()).toBe(413);
});
