import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveReferenceFixture } from "./fixtures/live-reference";
import { createCheckout } from "../src/server/checkout";
import { createReferenceSimulationAdapter } from "../src/server/demo/checkout-adapter";
import { blockedMcdCheckoutAdapter } from "../src/server/mcd/checkout-adapter";
import type { WorkflowView } from "../src/domain/workflow";
import { quoteBinding, type DiningContext, type MealRequest } from "../src/domain/meal";

const confirm = (view: WorkflowView) => ({ action: "checkout-confirm", revision: view.revision, draftId: view.draft!.checkout!.id, version: view.draft!.checkout!.version, confirmed: true });
async function prepared() {
  const fixture = liveReferenceFixture();
  const recommended = await fixture.recommend();
  const reference = recommended.result!.referencePrices[0];
  const action = { action: "review-simulation", revision: 2, optionId: reference.simulationId! };
  const reviewed = await fixture.workflow.dispatch(action);
  return { ...fixture, reference, action, reviewed };
}
afterEach(() => vi.useRealTimers());

describe("live reference orders remain local simulations", () => {
  it("preserves official products/reference price and null fees through review, confirmation and query", async () => {
    const f = await prepared(); const before = f.calls.length;
    expect(f.reviewed.draft).toMatchObject({ store: { name: f.store.name }, transactionEnabled: false, option: { status: "reference", source: "official", totalFen: 1390, fees: null, products: [{ name: "受控鸡肉双人气套餐", quantity: 1 }] }, checkout: { referenceSimulation: true, quoteStatus: "unknown", order: null } });
    expect(f.reviewed.draft!.option.items.map(i => i.name)).toEqual(["受控鸡肉堡", "受控无糖可乐"]);
    const created = await f.workflow.dispatch(confirm(f.reviewed));
    expect(created.draft!.checkout!.order).toMatchObject({ source: "demo", status: "模拟待支付" });
    expect(created.draft!.checkout!.order!.id).toMatch(/^DEMO-/);
    const queried = await f.workflow.dispatch({ action: "checkout-status", revision: 2, draftId: created.draft!.checkout!.id, version: created.draft!.checkout!.version });
    expect(queried.draft!.checkout!.order!.status).toBe("模拟配餐中（未真实支付）");
    expect(f.calls).toHaveLength(before);
    expect(JSON.stringify(queried)).not.toMatch(/https?:\/\/|productRef|candidateId|couponCode/);
  });
  it("rejects client prices, unconfirmed submission, wrong versions and the regular real review route", async () => {
    const f = await prepared();
    await expect(f.workflow.dispatch({ ...f.action, totalFen: 1 })).rejects.toThrow();
    await expect(f.workflow.dispatch({ ...confirm(f.reviewed), confirmed: false })).rejects.toThrow();
    await expect(f.workflow.dispatch({ ...confirm(f.reviewed), version: 999 })).rejects.toThrow();
    await expect(f.workflow.dispatch({ ...f.action, action: "review" })).rejects.toThrow();
    await expect(f.workflow.dispatch({ action: "create-order" })).rejects.toThrow();
    expect((await f.workflow.dispatch({ action: "bootstrap" })).draft!.checkout!.order).toBeNull();
  });
  it("concurrent and repeated confirmation creates only one simulated ID", async () => {
    const f = await prepared(); const before = f.calls.length;
    await Promise.all(Array.from({ length: 8 }, () => f.workflow.dispatch(confirm(f.reviewed))));
    const created = await f.workflow.dispatch({ action: "bootstrap" });
    const repeated = await f.workflow.dispatch(confirm(f.reviewed));
    expect(created.draft!.checkout!.state).toBe("created");
    expect(repeated.draft!.checkout!.order!.id).toBe(created.draft!.checkout!.order!.id);
    expect(f.calls).toHaveLength(before);
  });
  it("condition changes revoke the simulation ID and draft", async () => {
    const f = await prepared();
    await f.workflow.dispatch({ action: "invalidate", revision: 3 });
    await expect(f.workflow.dispatch(f.action)).rejects.toThrow("失效");
    await expect(f.workflow.dispatch(confirm(f.reviewed))).rejects.toThrow("失效");
    expect((await f.workflow.dispatch({ action: "bootstrap" })).draft).toBeNull();
  });
  it("other sessions and restarted sessions cannot reuse choices or drafts", async () => {
    const f = await prepared(), other = liveReferenceFixture(); await other.recommend();
    await expect(other.workflow.dispatch(f.action)).rejects.toThrow();
    await expect(other.workflow.dispatch(confirm(f.reviewed))).rejects.toThrow();
  });
  it("expires the local simulation after five minutes without converting reference to a final quote", async () => {
    vi.useFakeTimers(); const f = await prepared();
    vi.advanceTimersByTime(5 * 60_000);
    await expect(f.workflow.dispatch(confirm(f.reviewed))).rejects.toThrow("失效");
    await expect(f.workflow.dispatch(f.action)).rejects.toThrow();
    expect((await f.workflow.dispatch({ action: "bootstrap" })).draft!.checkout!.valid).toBe(false);
  });
  it("can cancel before creating and cannot select fictional price change in live mode", async () => {
    const f = await prepared(); const c = f.reviewed.draft!.checkout!;
    await expect(f.workflow.dispatch({ action: "checkout-scenario", revision: 2, draftId: c.id, version: c.version, scenario: "price-change" })).rejects.toThrow();
    const cancelled = await f.workflow.dispatch({ action: "checkout-cancel", revision: 2, draftId: c.id, version: c.version });
    expect(cancelled.draft!.checkout!.state).toBe("cancelled");
    expect(cancelled.draft!.checkout!.order).toBeNull();
  });
  it("keeps transaction adapter blocked and validates simulation snapshot binding", async () => {
    const f = liveReferenceFixture(); await f.recommend();
    const reference = f.engine.current()!.referencePrices[0];
    const saved = f.engine.referenceSnapshot(reference.candidateId!)!;
    const context: DiningContext = { mode: "live", fulfillment: "pickup", storeRef: f.store.ref, revision: 2, needTableware: false, takeWay: f.form.takeWay };
    const request: MealRequest = { budgetFen: 2500, template: "main+drink", includeSnack: false, likedTags: ["chicken", "sugar-free"], excludedTags: [] };
    const snapshot = { context, request, ...saved };
    expect(saved.quote.binding).toBe(quoteBinding(context, request, saved.candidate));
    expect(() => createCheckout({ sessionId: randomUUID(), mode: "live", adapter: blockedMcdCheckoutAdapter }).prepare(snapshot)).toThrow();
    const adapter = createReferenceSimulationAdapter();
    const create = vi.spyOn(adapter, "create");
    const checkout = createCheckout({ sessionId: randomUUID(), mode: "live", adapter });
    expect(() => checkout.prepare({ ...snapshot, context: { ...context, takeWay: "eat-in" } })).toThrow();
    expect(() => checkout.prepare({ ...snapshot, quote: { ...saved.quote, referenceBasis: "unverified-unit" } })).toThrow();
    const draft = checkout.prepare(snapshot);
    adapter.create = create.mockRejectedValue(new Error("simulated disconnection"));
    const args = { draftId: draft.id, version: draft.version, confirmed: true };
    expect((await checkout.confirm(args)).state).toBe("unknown");
    expect((await checkout.confirm(args)).state).toBe("unknown");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
