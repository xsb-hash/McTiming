import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/client";
import schemas from "../docs/mcp/TOOL_SCHEMAS_2026-10-12.json";
import { candidateId, contextKey, quoteBinding, type DiningContext, type MealRequest } from "../src/domain/meal";
import type { CheckoutSnapshot, DemoScenario } from "../src/domain/checkout";
import { createCheckout, checkoutView, type CheckoutAdapter, type RecheckResult } from "../src/server/checkout";
import { createDemoCheckoutAdapter } from "../src/server/demo/checkout-adapter";
import { createDemoRecommendationAdapter } from "../src/server/demo/recommend-adapter";
import { createRecommendationSession } from "../src/server/recommend";
import { addressInputSchema, blockedMcdCheckoutAdapter, classifyUnverifiedWriteFailure, mapPickupOrderForReview, queryOrderInputSchema, saveRealAddressDisabled } from "../src/server/mcd/checkout-adapter";

const NOW = 1_800_000_000_000;
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function fixture(delivery = false) {
  const base = { mode: "demo" as const, storeRef: "demo-store-1", revision: 2, needTableware: false };
  const context: DiningContext = delivery ? { ...base, fulfillment: "delivery", addressRef: "demo-address-1", businessRef: "demo-delivery" } : { ...base, fulfillment: "pickup", takeWay: "take-in-store" };
  const request: MealRequest = { budgetFen: 3500, template: "main+drink", includeSnack: false, likedTags: ["beef", "sugar-free"], excludedTags: [] };
  const engine = createRecommendationSession(createDemoRecommendationAdapter(() => NOW), () => NOW);
  await engine.run(context, request);
  const { candidate, quote } = engine.current()!.budgetOptions[0];
  const snapshot: CheckoutSnapshot = { context, request, candidate, quote };
  let time = NOW;
  const store = vi.fn(async () => true);
  const original = createDemoCheckoutAdapter(store, () => time);
  const adapter = { recheck: vi.fn(original.recheck), create: vi.fn(original.create), query: vi.fn(original.query) };
  const sessionId = randomUUID();
  const checkout = createCheckout({ sessionId, mode: "demo", adapter, now: () => time });
  const draft = checkout.prepare(snapshot);
  const args = () => ({ draftId: checkout.read()!.id, version: checkout.read()!.version, confirmed: true as const, addressConfirmed: delivery });
  return { checkout, adapter, snapshot, draft, args, store, sessionId, advance: (ms: number) => { time += ms; } };
}
function rebind(snapshot: CheckoutSnapshot) {
  snapshot.candidate.id = candidateId(snapshot.candidate.items, snapshot.candidate.coupon);
  snapshot.candidate.contextKey = contextKey(snapshot.context);
  snapshot.quote.binding = quoteBinding(snapshot.context, snapshot.request, snapshot.candidate);
  return snapshot;
}

describe("server checkout state machine (controlled data only)", () => {
  it("requires explicit confirmation and rejects client prices or item substitutions", async () => {
    const f = await fixture();
    for (const bad of [{ ...f.args(), confirmed: false }, { ...f.args(), totalFen: 1 }, { ...f.args(), items: [] }, { draftId: f.draft.id, version: 1 }]) await expect(f.checkout.confirm(bad)).rejects.toThrow();
    expect(f.adapter.recheck).not.toHaveBeenCalled(); expect(f.adapter.create).not.toHaveBeenCalled();
    expect(f.checkout.read()!.snapshot.quote.totalFen).toBe(2600);
  });
  it("creates once, returns the same simulated ID on repeats and queries without creating", async () => {
    const f = await fixture(); const first = await f.checkout.confirm(f.args());
    expect(first.state).toBe("created"); expect(first.order!.id).toMatch(/^DEMO-/);
    expect((await f.checkout.confirm(f.args())).order).toEqual(first.order);
    expect(f.adapter.create).toHaveBeenCalledTimes(1);
    expect(() => f.checkout.prepare(f.snapshot)).toThrow("重复订单");
    const queried = await f.checkout.query(first.id, first.version);
    expect(queried.order!.status).toContain("未真实支付"); expect(f.adapter.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(checkoutView(queried))).not.toMatch(/https?:|sessionId|MCD_MCP_TOKEN|payH5Url/);
  });
  it("locks rechecking and creating on the server across concurrent submissions", async () => {
    const f = await fixture(); const review = gate<RecheckResult>(); const create = gate<Awaited<ReturnType<CheckoutAdapter["create"]>>>();
    f.adapter.recheck.mockReturnValue(review.promise); f.adapter.create.mockReturnValue(create.promise);
    const first = f.checkout.confirm(f.args());
    expect((await f.checkout.confirm(f.args())).state).toBe("rechecking"); expect(f.adapter.recheck).toHaveBeenCalledTimes(1);
    review.resolve({ status: "verified", snapshot: f.snapshot });
    await vi.waitFor(() => expect(f.checkout.read()!.state).toBe("creating"));
    const repeats = await Promise.all(Array.from({ length: 8 }, () => f.checkout.confirm(f.args())));
    expect(repeats.every((value) => value.state === "creating")).toBe(true); expect(f.adapter.create).toHaveBeenCalledTimes(1);
    expect(() => f.checkout.cancel(f.draft.id, 1)).toThrow();
    create.resolve({ status: "unknown" }); expect((await first).state).toBe("unknown");
  });
  it("requires a new explicit confirmation and version after price changes", async () => {
    const f = await fixture(); f.checkout.setScenario(f.draft.id, 1, "price-change"); const old = f.args();
    const changed = await f.checkout.confirm(old);
    expect(changed).toMatchObject({ state: "reconfirmation-required", version: 3, previousTotalFen: 2600, snapshot: { quote: { totalFen: 2800 } } });
    expect(f.adapter.create).not.toHaveBeenCalled();
    await expect(f.checkout.confirm(old)).rejects.toThrow("版本");
    expect((await f.checkout.confirm(f.args())).state).toBe("created");
    expect(f.adapter.create.mock.calls[0][0].quote.totalFen).toBe(2800);
  });
  it("requires reconfirmation even when fees change but the total stays equal", async () => {
    const f = await fixture(); const next = structuredClone(f.snapshot); next.quote.fees!.productFen -= 100; next.quote.fees!.packingFen = 100;
    f.adapter.recheck.mockResolvedValue({ status: "verified", snapshot: next });
    const result = await f.checkout.confirm(f.args());
    expect(result.state).toBe("reconfirmation-required"); expect(result.changes).toContain("费用明细变化"); expect(f.adapter.create).not.toHaveBeenCalled();
  });
  it.each(["store", "address", "items", "specification", "quantity", "fulfillment"])("invalidates changed %s bindings and requires a new recommendation", async (field) => {
    const f = await fixture(true); const changed = structuredClone(f.snapshot);
    if (field === "store") changed.context.storeRef = "demo-store-2";
    if (field === "address" && changed.context.fulfillment === "delivery") changed.context.addressRef = "different-address";
    if (field === "items") changed.candidate.items[0].productRef = "different-food";
    if (field === "specification") changed.candidate.items[0].modifications.push({ code: "test", key: "test", quantity: 1 });
    if (field === "quantity") changed.candidate.items[0].quantity++;
    if (field === "fulfillment") changed.context = { mode: "demo", storeRef: "demo-store-1", revision: 2, needTableware: false, fulfillment: "pickup", takeWay: "eat-in" };
    // Even an internally well-bound new quote cannot authorize different fulfillment/items.
    f.adapter.recheck.mockResolvedValue({ status: "verified", snapshot: rebind(changed) });
    expect((await f.checkout.confirm(f.args())).state).toBe("invalidated"); expect(f.adapter.create).not.toHaveBeenCalled();
  });
  it("rejects stale versions and a session/restart without the original draft", async () => {
    const f = await fixture(); const old = f.args(); f.checkout.setScenario(f.draft.id, 1, "normal");
    await expect(f.checkout.confirm(old)).rejects.toThrow("版本");
    const restarted = createCheckout({ sessionId: f.sessionId, mode: "demo", adapter: f.adapter });
    await expect(restarted.confirm(f.args())).rejects.toThrow("不存在"); expect(f.adapter.create).not.toHaveBeenCalled();
  });
  it("expires session drafts and quote deadlines before creation", async () => {
    const f = await fixture(); f.advance(30 * 60_000);
    await expect(f.checkout.confirm(f.args())).rejects.toThrow("失效");
    const g = await fixture(); const quote = structuredClone(g.snapshot); quote.quote.expiresAt = NOW + 100;
    g.checkout.invalidate(); g.checkout.prepare(quote); g.advance(100);
    await expect(g.checkout.confirm(g.args())).rejects.toThrow("失效"); expect(g.adapter.create).not.toHaveBeenCalled();
  });
  it("cancels before creation and discards late recheck results without corrupting a new draft", async () => {
    const f = await fixture(); const review = gate<RecheckResult>(); f.adapter.recheck.mockReturnValueOnce(review.promise);
    const old = f.checkout.confirm(f.args()); f.checkout.cancel(f.draft.id, 1);
    const newer = f.checkout.prepare(f.snapshot);
    review.resolve({ status: "verified", snapshot: f.snapshot }); await old;
    expect(f.checkout.read()!.id).toBe(newer.id); expect(f.checkout.read()!.state).toBe("awaiting-confirmation"); expect(f.adapter.create).not.toHaveBeenCalled();
  });
  it.each(["failure", "timeout"] as DemoScenario[])("keeps %s terminal and never automatically resends", async (scenario) => {
    const f = await fixture(); f.checkout.setScenario(f.draft.id, 1, scenario);
    const expected = scenario === "failure" ? "failed" : "unknown";
    expect((await f.checkout.confirm(f.args())).state).toBe(expected);
    for (let i = 0; i < 3; i++) expect((await f.checkout.confirm(f.args())).state).toBe(expected);
    await f.checkout.query(f.draft.id, f.checkout.read()!.version); expect(f.adapter.create).toHaveBeenCalledTimes(1);
    if (scenario === "timeout") { expect(() => f.checkout.prepare(f.snapshot)).toThrow("结果未知"); expect(() => f.checkout.cancel(f.draft.id, f.checkout.read()!.version)).toThrow(); }
  });
  it("treats a transport exception or malformed creation response as unknown, without logging raw errors", async () => {
    const f = await fixture(); f.adapter.create.mockRejectedValue(new Error("secret-test-canary"));
    expect((await f.checkout.confirm(f.args())).state).toBe("unknown");
    expect(JSON.stringify(f.checkout.read())).not.toContain("secret-test-canary");
    await f.checkout.confirm(f.args()); expect(f.adapter.create).toHaveBeenCalledTimes(1);
  });
  it("requires explicit fictional delivery address confirmation and includes complete demo fees", async () => {
    const f = await fixture(true);
    await expect(f.checkout.confirm({ ...f.args(), addressConfirmed: false })).rejects.toThrow("地址");
    expect(f.adapter.create).not.toHaveBeenCalled();
    const done = await f.checkout.confirm(f.args()); expect(done.snapshot.quote.totalFen).toBe(3200); expect(done.snapshot.quote.fees!.deliveryFen).toBe(600);
  });
  it("blocks unavailable stores and unavailable item configurations", async () => {
    const f = await fixture(); f.store.mockResolvedValue(false);
    expect((await f.checkout.confirm(f.args())).state).toBe("blocked"); expect(f.adapter.create).not.toHaveBeenCalled();
    const g = await fixture(); const altered = structuredClone(g.snapshot); altered.candidate.items[0].quantity = 2; rebind(altered);
    g.checkout.invalidate(); g.checkout.prepare(altered);
    expect((await g.checkout.confirm(g.args())).state).toBe("blocked"); expect(g.adapter.create).not.toHaveBeenCalled();
  });
  it.each(["expired", "inapplicable"])("rejects %s coupons before price recheck", async (kind) => {
    const f = await fixture(); const s = structuredClone(f.snapshot);
    s.candidate.coupon = { ref: "controlled", code: "controlled", source: "demo", contextKey: contextKey(s.context), productRefs: [s.candidate.items[0].productRef], owned: true, verified: true, applicable: kind !== "inapplicable", validFrom: NOW - 1000, validUntil: kind === "expired" ? NOW : NOW + 1000 };
    rebind(s); f.checkout.invalidate(); expect(() => f.checkout.prepare(s)).toThrow("可信"); expect(f.adapter.create).not.toHaveBeenCalled();
  });
  it("blocks recheck failure and incomplete prices without inventing zero fees", async () => {
    const f = await fixture(); f.adapter.recheck.mockRejectedValue(new Error("network"));
    expect((await f.checkout.confirm(f.args())).state).toBe("blocked"); expect(f.adapter.create).not.toHaveBeenCalled();
    const g = await fixture(); const next = structuredClone(g.snapshot); next.quote.fees = null;
    g.adapter.recheck.mockResolvedValue({ status: "verified", snapshot: next });
    expect((await g.checkout.confirm(g.args())).state).toBe("blocked"); expect(g.adapter.create).not.toHaveBeenCalled();
  });
  it("never exposes a real payment URL from a malformed demo response", async () => {
    const f = await fixture();
    f.adapter.create.mockResolvedValue({ status: "created", order: { id: `DEMO-${randomUUID()}`, source: "demo", status: "模拟待支付", payment: "https://pay.invalid" } } as never);
    const done = await f.checkout.confirm(f.args()); expect(done.state).toBe("unknown"); expect(done.order).toBeNull();
  });
});

describe("offline real MCP boundary — no network", () => {
  it("matches saved order/address/query input schemas without invented idempotency or amount keys", async () => {
    const f = await fixture(); const real = rebind({ ...structuredClone(f.snapshot), context: { ...f.snapshot.context, mode: "live" } });
    const order = mapPickupOrderForReview(real);
    const address = addressInputSchema.parse({ address: "虚构道路", addressDetail: "虚构房间", city: "虚构城市", contactName: "样例", phone: "00000000000" });
    const query = queryOrderInputSchema.parse({ orderId: "offline-fixture" });
    for (const [name, args] of [["create-order", order], ["delivery-create-address", address], ["query-order", query]] as const) {
      const schema = schemas.tools.find((tool) => tool.name === name)!;
      expect(new AjvJsonSchemaValidator().getValidator(schema.inputSchema as JsonSchemaType)(args).valid).toBe(true);
    }
    expect(order).not.toHaveProperty("idempotencyKey"); expect(order).not.toHaveProperty("expectedAmount"); expect(classifyUnverifiedWriteFailure()).toBe("unknown");
  });
  it("blocks live creation even with a controlled complete quote and an injected adapter", async () => {
    const f = await fixture(); const real = structuredClone(f.snapshot); real.context.mode = "live"; real.candidate.source = "official"; real.quote.source = "official"; real.quote.status = "verified"; rebind(real);
    const live = createCheckout({ sessionId: randomUUID(), mode: "live", adapter: f.adapter, now: () => NOW });
    const draft = live.prepare(real);
    expect((await live.confirm({ draftId: draft.id, version: 1, confirmed: true })).state).toBe("blocked");
    expect(f.adapter.recheck).not.toHaveBeenCalled(); expect(f.adapter.create).not.toHaveBeenCalled();
    live.invalidate(); real.quote.status = "unknown"; real.quote.fees = null; expect(() => live.prepare(real)).toThrow("可信");
    await expect(blockedMcdCheckoutAdapter.create(real, "normal")).rejects.toThrow("未授权"); expect(saveRealAddressDisabled).toThrow("禁止");
  });
});
