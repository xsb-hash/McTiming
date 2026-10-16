import { randomUUID } from "node:crypto";
import { canonical, candidateId, contextKey } from "../domain/meal";
import { couponUsable, hardConditions, quoteIsCurrent } from "../domain/recommend";
import { checkoutContents, checkoutDraftSchema, checkoutSnapshotSchema, confirmCheckoutSchema, demoOrderSchema, type CheckoutDraft, type CheckoutSnapshot, type CheckoutView, type DemoOrder, type DemoScenario } from "../domain/checkout";

export type RecheckResult = { status: "blocked"; reason: string } | { status: "verified"; snapshot: CheckoutSnapshot };
export interface CheckoutAdapter {
  recheck(snapshot: CheckoutSnapshot, scenario: DemoScenario): Promise<RecheckResult>;
  create(snapshot: CheckoutSnapshot, scenario: DemoScenario): Promise<{ status: "created"; order: DemoOrder } | { status: "failed" } | { status: "unknown" }>;
  query(order: DemoOrder): Promise<DemoOrder>;
}
export class CheckoutError extends Error {}

export function createCheckout({ sessionId, mode, adapter, now = Date.now }: { sessionId: string; mode: "demo" | "live"; adapter: CheckoutAdapter; now?: () => number }) {
  let draft: CheckoutDraft | null = null;
  let generation = 0;
  const transitions: Record<CheckoutDraft["state"], CheckoutDraft["state"][]> = {
    "awaiting-confirmation": ["rechecking", "blocked", "invalidated", "cancelled"],
    "reconfirmation-required": ["rechecking", "blocked", "invalidated", "cancelled"],
    rechecking: ["reconfirmation-required", "creating", "blocked", "invalidated", "cancelled"],
    creating: ["created", "failed", "unknown"], created: [], failed: ["invalidated", "cancelled"], unknown: [], blocked: ["invalidated", "cancelled"], invalidated: [], cancelled: [],
  };
  function transition(next: CheckoutDraft["state"], message: string) {
    if (!draft || !transitions[draft.state].includes(next)) throw new CheckoutError("不允许的订单状态转换。");
    draft.state = next; draft.message = message;
  }
  function invalidate(cancel = false) {
    generation++;
    if (!draft) return;
    draft.valid = false;
    if (transitions[draft.state].includes(cancel ? "cancelled" : "invalidated")) transition(cancel ? "cancelled" : "invalidated", cancel ? "已取消本次操作，未发起模拟创建。" : "条件或会话已变化，草稿失效。");
    // In-flight/unknown outcomes remain visible; invalidation is not cancellation.
  }
  function read() {
    if (draft?.valid && now() >= draft.expiresAt) invalidate();
    if (draft?.valid && ["awaiting-confirmation", "reconfirmation-required"].includes(draft.state) && !quoteIsCurrent(draft.snapshot.quote, draft.snapshot.context, draft.snapshot.request, draft.snapshot.candidate, now())) invalidate();
    return draft ? structuredClone(draft) : null;
  }
  function trusted(snapshot: CheckoutSnapshot) {
    const { context, request, candidate, quote } = snapshot;
    return context.mode === mode && candidate.contextKey === contextKey(context) && candidate.id === candidateId(candidate.items, candidate.coupon) && quote.source === (mode === "demo" ? "demo" : "official") && candidate.source === quote.source && quote.status === (mode === "demo" ? "demo" : "verified") && quote.totalFen !== null && quote.fees !== null && quoteIsCurrent(quote, context, request, candidate, now()) && hardConditions(candidate.components, request) && (!candidate.coupon || couponUsable(candidate.coupon, context, now()));
  }
  function identify(id: string, version: number) {
    read();
    if (!draft || draft.id !== id || draft.version !== version || draft.sessionId !== sessionId) throw new CheckoutError("草稿不存在或版本已过期，请重新核对。");
    return draft;
  }
  return {
    read, invalidate,
    prepare(input: CheckoutSnapshot) {
      read();
      if (draft && ["rechecking", "creating", "created", "unknown"].includes(draft.state)) throw new CheckoutError("上一笔模拟创建正在处理、已创建或结果未知，不能准备重复订单。");
      const snapshot = checkoutSnapshotSchema.parse(input);
      if (!trusted(snapshot)) throw new CheckoutError("缺少可信完整报价，不能准备订单。");
      if (draft?.valid && checkoutContents(draft.snapshot) === checkoutContents(snapshot) && !["failed", "blocked", "cancelled", "invalidated"].includes(draft.state)) return read()!;
      generation++;
      draft = checkoutDraftSchema.parse({ id: randomUUID(), sessionId, version: 1, snapshot, state: "awaiting-confirmation", scenario: "normal", valid: true, expiresAt: now() + 30 * 60_000, previousTotalFen: null, changes: [], message: "请核对金额与履约信息，明确确认后才执行模拟创建。", order: null });
      return read()!;
    },
    setScenario(id: string, version: number, scenario: DemoScenario) {
      const current = identify(id, version);
      if (mode !== "demo" || !current.valid || !["awaiting-confirmation", "reconfirmation-required"].includes(current.state)) throw new CheckoutError("当前不能修改模拟场景。");
      current.scenario = scenario; current.version++; current.message = "模拟场景已更新，请核对当前版本。";
      return read()!;
    },
    async confirm(input: unknown) {
      const args = confirmCheckoutSchema.parse(input);
      const current = identify(args.draftId, args.version);
      if (["rechecking", "creating", "created", "unknown", "failed", "blocked"].includes(current.state)) return read()!;
      if (!current.valid) throw new CheckoutError("草稿已失效，不能提交。");
      if (current.snapshot.context.fulfillment === "delivery" && !args.addressConfirmed) throw new CheckoutError("请先明确确认本次虚构配送地址。");
      if (mode !== "demo") { transition("blocked", "真实创建未授权，完整费用和金额约束尚未验证。Token 不会开放交易。"); return read()!; }
      if (!trusted(current.snapshot)) { transition("blocked", "报价已过期、优惠失效或费用不完整，请重新推荐。"); return read()!; }
      transition("rechecking", "正在复核门店、履约、餐品配置、优惠和完整费用。");
      const own = generation;
      let checked: RecheckResult;
      try { checked = await adapter.recheck(structuredClone(current.snapshot), current.scenario); }
      catch { checked = { status: "blocked", reason: "复核失败，尚未执行创建，请重新推荐。" }; }
      if (own !== generation) return read()!;
      if (!current.valid || now() >= current.expiresAt) { invalidate(); return read()!; }
      if (checked.status === "blocked") { transition("blocked", checked.reason); return read()!; }
      const parsed = checkoutSnapshotSchema.safeParse(checked.snapshot);
      if (!parsed.success || !trusted(parsed.data)) { transition("blocked", "复核报价或配置无法验证，未创建订单。"); return read()!; }
      const next = parsed.data;
      if (canonical(next.context) !== canonical(current.snapshot.context) || canonical(next.request) !== canonical(current.snapshot.request) || canonical(next.candidate.items) !== canonical(current.snapshot.candidate.items) || canonical(next.candidate.components) !== canonical(current.snapshot.candidate.components) || canonical(next.candidate.coupon) !== canonical(current.snapshot.candidate.coupon)) {
        invalidate(); current.message = "门店、履约、商品配置、组成或优惠条件变化，请重新推荐并准备草稿。"; return read()!;
      }
      if (checkoutContents(next) !== checkoutContents(current.snapshot)) {
        const old = current.snapshot;
        current.previousTotalFen = old.quote.totalFen;
        current.changes = [old.quote.totalFen !== next.quote.totalFen ? "总金额变化" : "", canonical(old.quote.fees) !== canonical(next.quote.fees) ? "费用明细变化" : ""].filter(Boolean);
        current.snapshot = next; current.version++;
        transition("reconfirmation-required", "核对内容发生变化，尚未创建；请查看新旧金额并重新确认。");
        return read()!;
      }
      current.snapshot = next;
      transition("creating", "已明确确认，正在创建模拟订单。请勿重复操作。");
      try {
        const response = await adapter.create(structuredClone(next), current.scenario);
        if (response.status === "created") {
          current.order = demoOrderSchema.parse(response.order);
          transition("created", "模拟订单已创建，不是真实麦当劳订单。");
        } else if (response.status === "failed") transition("failed", "模拟服务明确返回未创建订单。需重新推荐／准备草稿后才能再次尝试。");
        else transition("unknown", "模拟创建结果未知，可能已经创建；不会自动重发。没有可查询订单编号时不能证明失败。");
      } catch { transition("unknown", "模拟创建超时或断连，结果未知；禁止自动重发，不能当作明确失败。"); }
      return read()!;
    },
    async query(id: string, version: number) {
      const current = identify(id, version);
      if (mode !== "demo" || !current.order) return read()!;
      try {
        const order = demoOrderSchema.parse(await adapter.query(structuredClone(current.order)));
        if (order.id !== current.order.id) throw new Error("Order mismatch");
        current.order = order; current.message = "已刷新模拟订单状态，未执行真实支付。";
      } catch { current.message = "模拟状态查询失败，保留已知创建结果；没有再次创建。"; }
      return read()!;
    },
    cancel(id: string, version: number) {
      const current = identify(id, version);
      if (["creating", "created", "unknown"].includes(current.state)) throw new CheckoutError("已发送的创建不能当作取消成功；请查看当前模拟结果。");
      invalidate(true); return read()!;
    },
  };
}

export function checkoutView(draft: CheckoutDraft): CheckoutView {
  const name = (ref: string) => draft.snapshot.candidate.components.find((part) => part.productRef === ref)?.name ?? "套餐商品（名称未提供）";
  return { id: draft.id, version: draft.version, state: draft.state, scenario: draft.scenario, valid: draft.valid, previousTotalFen: draft.previousTotalFen, changes: draft.changes, message: draft.message, order: draft.order, totalFen: draft.snapshot.quote.totalFen, quotedAt: draft.snapshot.quote.quotedAt, quoteStatus: draft.snapshot.quote.status, expiresAt: draft.expiresAt,
    specifications: draft.snapshot.candidate.items.flatMap((item) => [
      `${name(item.productRef)} × ${item.quantity}${item.modifications.length ? `；特制配置：${item.modifications.map((mod) => `${mod.code}/${mod.key} × ${mod.quantity}`).join("、")}` : "；默认规格"}`,
      ...item.rounds.map((round) => `套餐选项：${round.choices.map((choice) => `${name(choice.productRef)} × ${choice.quantity}${choice.modifications.length ? `（配置 ${choice.modifications.map((mod) => `${mod.code}/${mod.key} × ${mod.quantity}`).join("、")}）` : ""}`).join("、")}`),
    ]),
  };
}
