import { randomUUID } from "node:crypto";
import { actionSchema, budgetToFen, demoAddress, type DraftView, type MealForm, type OptionView, type ReferenceOptionView, type ResultView, type StoreView, type WorkflowView } from "../domain/workflow";
import type { DiningContext, Recommendation } from "../domain/meal";
import type { createRecommendationSession } from "./recommend";
import { createCheckout, checkoutView, CheckoutError } from "./checkout";
import { createDemoCheckoutAdapter, createReferenceSimulationAdapter } from "./demo/checkout-adapter";

export class WorkflowError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
type Engine = ReturnType<typeof createRecommendationSession>;
type Search = { fulfillment: "pickup" | "delivery"; city: string; keyword: string; addressRef: string };
export type WorkflowDependencies = { mode: "demo" | "live"; engine: Engine; stores: (search: Search) => Promise<StoreView[]>; sessionId?: string };

// Per browser session, memory only. All transaction operations are local simulations.
export function createWorkflow({ mode, engine, stores: searchStores, sessionId = randomUUID() }: WorkflowDependencies) {
  let revision = 0;
  let stores: StoreView[] = [];
  let search: Search | undefined;
  let form: MealForm | null = null;
  let result: ResultView | null = null;
  let draft: DraftView | null = null;
  let selection: { context: DiningContext; request: import("../domain/meal").MealRequest } | null = null;
  const checkout = createCheckout({ sessionId, mode, adapter: mode === "demo" ? createDemoCheckoutAdapter(async (ref) => !!search && (await searchStores(search)).some((store) => store.ref === ref && store.available)) : createReferenceSimulationAdapter() });
  const options = new Map<string, string>();
  const simulations = new Map<string, string>();
  function clear() { checkout.invalidate(); engine.invalidate(); result = null; draft = null; options.clear(); simulations.clear(); selection = null; }
  function snapshot(): WorkflowView {
    if (result && engine.current()?.status === "expired") { result = null; options.clear(); }
    if (result) result.referencePrices = result.referencePrices.filter((price) => price.expiresAt === null || Date.now() < price.expiresAt);
    const transaction = checkout.read();
    if (draft && transaction) {
      draft.checkout = checkoutView(transaction, draft.option.status === "reference");
      const quote = transaction.snapshot.quote;
      if (draft.option.status !== "reference" && quote.totalFen !== null && quote.fees) draft.option = { ...draft.option, totalFen: quote.totalFen, fees: quote.fees, quotedAt: quote.quotedAt, overBudgetFen: Math.max(0, quote.totalFen - budgetToFen(draft.form.budget)) };
    }
    return structuredClone({ revision, stores, form, result, draft });
  }
  function project(option: Recommendation["budgetOptions"][number]): OptionView {
    const { candidate, quote } = option;
    if (quote.totalFen === null || !quote.fees || (mode === "live" ? quote.status !== "verified" || quote.source !== "official" : quote.status !== "demo" || quote.source !== "demo")) throw new WorkflowError("报价尚未完整验证，不能进入核对。", 409);
    const id = randomUUID();
    options.set(id, candidate.id);
    return { id, items: candidate.components.map(({ name, quantity, role }) => ({ name, quantity, role })), matched: candidate.matchedTags, missing: candidate.missingTags, totalFen: quote.totalFen, fees: quote.fees, overBudgetFen: option.overBudgetFen, source: mode === "demo" ? "demo" : "official", status: mode === "demo" ? "demo" : "verified", quotedAt: quote.quotedAt, explanation: option.explanation, coupon: candidate.coupon ? "已持有且通过核验的优惠已参与计价" : "未使用优惠券；未验证优惠不计入金额" };
  }
  return {
    invalidate: clear,
    async dispatch(input: unknown): Promise<WorkflowView> {
      const parsed = actionSchema.safeParse(input);
      if (!parsed.success) throw new WorkflowError("输入不合法：请检查预算、位置及互相冲突的偏好。");
      const action = parsed.data;
      if (action.action === "bootstrap") return snapshot();
      if (action.action === "checkout-confirm" || action.action === "checkout-status" || action.action === "checkout-cancel" || action.action === "checkout-scenario") {
        if (action.revision !== revision || !draft) throw new WorkflowError("会话或草稿已失效，请重新核对。", 409);
        try {
          if (action.action === "checkout-confirm") await checkout.confirm({ draftId: action.draftId, version: action.version, confirmed: action.confirmed, addressConfirmed: action.addressConfirmed });
          else if (action.action === "checkout-status") await checkout.query(action.draftId, action.version);
          else if (action.action === "checkout-cancel") checkout.cancel(action.draftId, action.version);
          else checkout.setScenario(action.draftId, action.version, action.scenario);
        } catch (error) { throw new WorkflowError(error instanceof CheckoutError ? error.message : "订单操作无法验证，请重新核对。", 409); }
        return snapshot();
      }
      if (action.action === "review-simulation") {
        snapshot();
        const id = simulations.get(action.optionId);
        const reference = result?.referencePrices.find(price => price.simulationId === action.optionId);
        const saved = id ? engine.referenceSnapshot(id) : undefined;
        if (mode !== "live" || action.revision !== revision || !form || !selection || !reference || !saved) throw new WorkflowError("参考价或会话已失效，请重新推荐。", 409);
        let transaction;
        try { transaction = checkout.prepare({ ...selection, ...saved }); }
        catch (error) { throw new WorkflowError(error instanceof CheckoutError ? error.message : "无法准备模拟草稿。", 409); }
        const option: ReferenceOptionView = { id: action.optionId, products: reference.products ?? reference.items, items: saved.candidate.components.map(({ name, quantity, role }) => ({ name, quantity, role })), matched: saved.candidate.matchedTags, missing: saved.candidate.missingTags, totalFen: saved.quote.totalFen!, fees: null, overBudgetFen: Math.max(0, saved.quote.totalFen! - selection.request.budgetFen), source: "official", status: "reference", quotedAt: saved.quote.quotedAt, explanation: "官方查询参考价，仅用于本次模拟订单。", coupon: "未使用优惠券" };
        draft = { id: transaction.id, revision, option, store: stores.find(store => store.ref === form!.storeRef)!, form, deliveryAddress: null, transactionEnabled: false, checkout: checkoutView(transaction, true) };
        return snapshot();
      }
      if (action.action === "review") {
        snapshot();
        if (action.revision !== revision || !result || !form || !options.has(action.optionId)) throw new WorkflowError("报价或核对草稿已失效，请重新推荐。", 409);
        const current = engine.current();
        const valid = [...(current?.budgetOptions ?? []), ...(current?.overBudgetOption ? [current.overBudgetOption] : [])].find((entry) => entry.candidate.id === options.get(action.optionId));
        if (!valid || current?.status !== "ready" || !selection) throw new WorkflowError("当前报价不可核对。", 409);
        const option = [...result.budgetOptions, ...(result.overBudgetOption ? [result.overBudgetOption] : [])].find((entry) => entry.id === action.optionId)!;
        let transaction;
        try { transaction = checkout.prepare({ ...selection, candidate: valid.candidate, quote: valid.quote }); }
        catch (error) { throw new WorkflowError(error instanceof CheckoutError ? error.message : "无法准备草稿。", 409); }
        draft = { id: transaction.id, revision, option, store: stores.find((entry) => entry.ref === form!.storeRef)!, form, deliveryAddress: form.fulfillment === "delivery" ? demoAddress : null, transactionEnabled: false, checkout: checkoutView(transaction) };
        return snapshot();
      }
      if (action.revision <= revision) throw new WorkflowError("条件版本已过期，请刷新或重新推荐。", 409);
      const previous = checkout.read();
      if (previous && ["creating", "created", "unknown"].includes(previous.state)) throw new WorkflowError("已发送的模拟创建不能视为未创建；请保留当前条件并查看订单状态。", 409);
      revision = action.revision;
      clear();
      if (action.action === "invalidate" || action.action === "abstain") { form = null; return snapshot(); }
      if (action.action === "stores") {
        stores = []; search = undefined; form = null;
        if (mode === "live" && action.fulfillment === "delivery") throw new WorkflowError("真实外送的地址、门店和完整费用仍待验证，当前不开放。");
        if (mode === "demo" && action.fulfillment === "delivery" && action.addressRef !== "demo-address-1") throw new WorkflowError("请选择已有的虚构演示地址。");
        const found = await searchStores(action);
        if (revision !== action.revision) throw new WorkflowError("门店请求已失效。", 409);
        stores = found; search = action;
        return snapshot();
      }
      form = action.form;
      if (!search || search.fulfillment !== form.fulfillment || search.city !== form.city || search.keyword !== form.keyword || (form.fulfillment === "delivery" && search.addressRef !== form.addressRef) || !stores.some((entry) => entry.ref === form!.storeRef && entry.available)) throw new WorkflowError("请先查询并选择当前条件下可用的门店。");
      const base = { mode, storeRef: form.storeRef, revision, needTableware: false };
      const context: DiningContext = form.fulfillment === "pickup" ? { ...base, fulfillment: "pickup", takeWay: form.takeWay } : { ...base, fulfillment: "delivery", addressRef: form.addressRef, businessRef: "demo-delivery" };
      selection = { context, request: { budgetFen: budgetToFen(form.budget), template: "main+drink", includeSnack: form.includeSnack, likedTags: form.likedTags, excludedTags: form.excludedTags } };
      const response = await engine.run(context, selection.request);
      if (revision !== action.revision || response.status === "superseded") throw new WorkflowError("旧推荐请求已丢弃，请使用最新条件。", 409);
      const recommendation = response.recommendation;
      const referencePrices = mode === "live" ? recommendation.referencePrices.map(({ candidateId, ...price }) => {
        if (!candidateId || !price.budgetRelation || !engine.referenceSnapshot(candidateId)) return price;
        const simulationId = randomUUID(); simulations.set(simulationId, candidateId);
        return { ...price, simulationId };
      }) : [];
      result = { budgetOptions: recommendation.budgetOptions.map(project), overBudgetOption: recommendation.overBudgetOption ? project(recommendation.overBudgetOption) : null, referencePrices, couponHints: recommendation.couponHints, unavailableItems: recommendation.unavailableItems, message: recommendation.message, issues: recommendation.issues, claimableHints: recommendation.claimableHints, coverage: recommendation.coverage, failedQuoteCount: recommendation.rejectedQuotes.filter(r => r.quote.status === "failed").length, rejectedCount: recommendation.rejectedQuotes.length };
      // Empty results are useful feedback and must remain visible.
      return structuredClone({ revision, stores, form, result, draft });
    },
  };
}
