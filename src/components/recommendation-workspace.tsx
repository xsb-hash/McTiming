"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PublicStatus } from "../domain/runtime";
import { budgetSchema, budgetToFen, defaultForm, demoAddress, foodTags, formSchema, money, tagLabel, type MealForm, type OptionView, type WorkflowAction, type WorkflowView } from "../domain/workflow";
import { FoodPhoto } from "./food-photo";
import { RecommendationResults } from "./recommendation-results";
import { CheckoutPanel } from "./checkout-panel";

async function send(action: WorkflowAction): Promise<WorkflowView> {
  const response = await fetch("/api/workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "请求失败，请重试。");
  return data;
}
const emptyView: WorkflowView = { revision: 0, stores: [], form: null, result: null, draft: null };
export function RecommendationWorkspace({ status }: { status: PublicStatus }) {
  const [form, setForm] = useState<MealForm>({ ...defaultForm, ...(status.mode === "live" ? { city: "唐山市", keyword: "路北区", likedTags: [] } : {}) });
  const [view, setView] = useState(emptyView);
  const [step, setStep] = useState(1);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const revision = useRef(0);
  const serial = useRef(0);
  const boot = useRef<Promise<WorkflowView> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const transactionLocked = busy && step === 4 || !!view.draft?.checkout && ["rechecking", "creating", "created", "unknown"].includes(view.draft.checkout.state);
  useEffect(() => {
    let active = true;
    boot.current ??= send({ action: "bootstrap" });
    boot.current.then((data) => { if (!active) return; revision.current = data.revision; setView(data); if (data.form) setForm(data.form); if (data.draft) setStep(4); else if (data.result) setStep(3); setReady(true); }).catch(() => { if (active) setError("无法初始化本地会话，请刷新页面重试。"); });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (ready) heading.current?.focus(); }, [step, ready]);
  function change(patch: Partial<MealForm>, resetStores = false) {
    if (transactionLocked) return;
    const next = ++revision.current; serial.current++;
    setForm((old) => ({ ...old, ...patch, ...(resetStores ? { storeRef: "" } : {}) }));
    setView((old) => ({ ...old, revision: next, result: null, draft: null, ...(resetStores ? { stores: [] } : {}) }));
    setBusy(false); setError(""); setNotice(view.result || view.draft || busy ? "条件已更新，旧报价及核对草稿已失效。" : "");
    void send({ action: "invalidate", revision: next }).catch(() => { /* Later revisions also invalidate the same draft. Review always rechecks server state. */ });
  }
  async function act(action: WorkflowAction, nextStep?: number) {
    const own = ++serial.current; setBusy(true); setError(""); setNotice("");
    try { const data = await send(action); if (own !== serial.current) return; setView(data); if (nextStep) setStep(nextStep); if (action.action === "stores" && data.stores.length === 0) setNotice("查询成功，但当前没有返回门店，请修改位置。"); if (action.action === "abstain") setNotice("已选择本次不购买，没有创建订单。"); }
    catch (failure) { if (own === serial.current) { setError(failure instanceof Error ? failure.message : "请求失败，请重试。"); if (!action.action.startsWith("checkout-") && action.action !== "abstain") setView((old) => ({ ...old, result: null, draft: null })); } }
    finally { if (own === serial.current) setBusy(false); }
  }
  function recommend() {
    const parsed = formSchema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    void act({ action: "recommend", revision: ++revision.current, form: parsed.data }, 3);
  }
  function toggle(group: "likedTags" | "excludedTags", tag: keyof typeof foodTags) {
    change({ [group]: form[group].includes(tag) ? form[group].filter((value) => value !== tag) : [...form[group], tag] });
  }
  const titles = ["选择门店", "预算与口味", "选择你的搭配", "核对这份搭配"];
  const result = view.result;
  const draft = view.draft;
  function optionCard(option: OptionView, index: number, over = false) {
    return <article className={`recommend-card ${over ? "over-card" : ""}`} key={option.id} data-testid={over ? "over-option" : "budget-option"}>
      <div className="card-top"><span className="pill">{over ? "超预算备选" : index === 0 ? "优先推荐" : `搭配 ${index + 1}`}</span></div>
      <div className="option-heading"><h3>{option.items.filter((item) => item.role === "main").map((item) => item.name).join(" + ")}搭配</h3><div className="option-price"><strong className="price">{money(option.totalFen)}</strong><small>{option.source === "demo" ? "演示价格 · 虚构数据" : "官方已验证报价"}</small>{over && <span className="over-amount">超出预算 {money(option.overBudgetFen)}</span>}</div></div>
      <div className="meal-preview"><FoodPhoto name={option.items.find((item) => item.role === "main")?.name ?? ""} source={option.source} /><div className="meal-description"><ul className="meal-items">{option.items.map((item, i) => <li key={i}><span>{item.name}</span><strong>× {item.quantity}</strong></li>)}</ul>
      <div className="preference-summary">{option.matched.length > 0 && <p>口味：{option.matched.map(tagLabel).join("、")}</p>}{option.missing.length > 0 && <p>更想要{option.missing.map(tagLabel).join("、")}？可以看看其他搭配。</p>}</div></div></div>
      <div className="option-action"><p className="quiet">{option.coupon === "已持有且通过核验的优惠已参与计价" ? "已有券 · 本单适用，已计入报价" : option.coupon === "未使用优惠券；未验证优惠不计入金额" ? "未使用优惠券" : option.coupon}</p><button className="button dark" disabled={busy || !ready} onClick={() => void act({ action: "review", revision: revision.current, optionId: option.id }, 4)}>核对这份搭配 <span aria-hidden="true">→</span></button></div>
      <details className="quote-details"><summary>报价来源</summary><p>来源：{option.source === "demo" ? "本地虚构样例" : "官方 MCP"} · 状态：{option.status === "demo" ? "样例有效" : "已验证"} · {new Date(option.quotedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间）。条件变化后需重新核算。</p></details>
    </article>;
  }
  return <main id="main" className="workspace shell">
    <div className="workspace-heading"><div><h1 ref={heading} tabIndex={-1}>{titles[step - 1]}</h1></div><Link href="/" className="text-link">返回首页 ↗</Link></div>
    <ol className="steps" aria-label="推荐流程">{["用餐与门店", "预算与口味", "推荐结果", "订单核对"].map((title, index) => <li key={title} aria-current={step === index + 1 ? "step" : undefined}><span>{index + 1}</span>{title}</li>)}</ol>
    {status.mode === "live" && <aside className="notice warning"><strong>真实餐品 · 模拟订单</strong><p>餐品和参考价来自官方查询；模拟下单不会付款或通知门店。{status.configuration === "missing-token" ? "本机未配置 MCP Token，请参照 docs/MCP_SETUP.md。" : ""}</p><details><summary>查看真实能力范围</summary><p>已验证自取菜单、套餐与无券计价样本；外送地址、完整费用、含券核算和排除品类证据仍不完整。</p></details></aside>}
    {error && <div role="alert" className="notice error">{error.length > 90 && step !== 4 ? <><p>本次查询未完成，请检查条件后重试。</p><details><summary>查看错误详情</summary><p>{error}</p></details></> : error}</div>}{notice && <p role="status" className="notice">{notice}</p>}{!ready && !error && <p role="status">正在准备本地会话…</p>}
    <div className="workspace-grid"><section className={`flow-panel ${step === 3 ? "results-panel" : ""}`} aria-busy={busy}>
      {step === 1 && <>
        <div className="section-heading"><h2>先选用餐方式</h2></div>
        <div className="segmented">{([['pickup', '到店自取'], ['delivery', '麦乐送外送']] as const).map(([value, label]) => <button key={value} disabled={!ready} aria-pressed={form.fulfillment === value} onClick={() => change({ fulfillment: value }, true)}><strong>{label}</strong>{value === "pickup" && <small>去熟悉的门店，带走好心情</small>}</button>)}</div>
        {form.fulfillment === "delivery" && status.mode === "live" ? <div className="notice warning">真实外送暂未开放：当前没有经过验证的地址、配送门店和完整费用链路。可切换到店自取进行只读查询。</div> : <>
          <div className="field-grid"><label>城市<input value={form.city} maxLength={50} disabled={!ready} onChange={(event) => change({ city: event.target.value }, true)} /></label><label>附近位置 / 商圈<input value={form.keyword} maxLength={100} disabled={!ready} onChange={(event) => change({ keyword: event.target.value }, true)} /></label></div>
          {form.fulfillment === "delivery" ? <label className="field">已有配送地址<select value={form.addressRef} onChange={(event) => change({ addressRef: event.target.value }, true)}><option value="demo-address-1">{demoAddress}</option></select><small>虚构地址，仅供演示。</small></label> : <label className="field">取餐方式<select value={form.takeWay} onChange={(event) => change({ takeWay: event.target.value as MealForm["takeWay"] })}><option value="take-in-store">到店外带</option><option value="eat-in">店内堂食</option></select></label>}
          <button className="button secondary" disabled={!ready || busy || !form.city.trim() || !form.keyword.trim()} onClick={() => { setForm({ ...form, city: form.city.trim(), keyword: form.keyword.trim(), storeRef: "" }); void act({ action: "stores", revision: ++revision.current, fulfillment: form.fulfillment, city: form.city.trim(), keyword: form.keyword.trim(), addressRef: form.addressRef }); }}>{busy ? "正在查询…" : status.mode === "demo" ? "查看样例门店" : "查询真实门店"}</button>
          {status.mode === "demo" && <p className="quiet">以下为固定样例门店，与输入位置无关。</p>}
          <div className="store-list" role="group" aria-label="选择一家门店">{view.stores.map((store) => <button className={`store-card ${form.storeRef === store.ref ? "selected" : ""}`} key={store.ref} disabled={!store.available} aria-pressed={form.storeRef === store.ref} onClick={() => change({ storeRef: store.ref })}><span><strong>{store.name}</strong><small>{store.address}</small><small>{store.hours} · {store.available ? "可选择" : "暂停营业"}</small>{store.reservations.map((text) => <small key={text}>{text}</small>)}</span><span className="selection-dot" /></button>)}</div>
          {view.stores.length > 0 && <button className="button primary" disabled={!form.storeRef || busy} onClick={() => { setError(""); setNotice(""); setStep(2); }}>设置预算与口味 →</button>}
        </>}
      </>}
      {step === 2 && <>
        <div className="section-heading"><h2>给今天这顿饭一个预算</h2></div>
        <label className="budget-field">单人餐预算（元）<div><span>¥</span><input inputMode="decimal" value={form.budget} aria-label="单人餐预算（元）" onChange={(event) => change({ budget: event.target.value })} /></div></label>
        <div className="budget-presets">{[20,25,30,35].map((value) => <button key={value} aria-pressed={form.budget === String(value)} className={`chip ${form.budget === String(value) ? "active" : ""}`} onClick={() => change({ budget: String(value) })}>{value} 元</button>)}</div>
        <div className="template-line"><div><strong>主食 + 饮品</strong></div><label className="check-line"><input type="checkbox" checked={form.includeSnack} onChange={(event) => change({ includeSnack: event.target.checked })} /> 加一份小食</label></div>
        <fieldset><legend>喜欢什么？<small>可多选，优先推荐</small></legend><div className="chips">{Object.entries(foodTags).map(([tag, label]) => <label className={`chip ${form.likedTags.includes(tag as keyof typeof foodTags) ? "active" : ""}`} key={tag}><input type="checkbox" aria-label={`喜欢${label}`} checked={form.likedTags.includes(tag as keyof typeof foodTags)} onChange={() => toggle("likedTags", tag as keyof typeof foodTags)} />{label}</label>)}</div></fieldset>
        <fieldset><legend>哪些一定不要？<small>必须避开，不会自动放宽</small></legend><div className="chips">{Object.entries(foodTags).map(([tag, label]) => <label className={`chip exclusion ${form.excludedTags.includes(tag as keyof typeof foodTags) ? "active" : ""}`} key={tag}><input type="checkbox" aria-label={`排除${label}`} checked={form.excludedTags.includes(tag as keyof typeof foodTags)} onChange={() => toggle("excludedTags", tag as keyof typeof foodTags)} />{label}</label>)}</div></fieldset>
        <p className="quiet">排除品类不等于过敏原保证；组成不明的餐品不会通过对应排除条件。</p>
        {status.mode === "live" && <p className="quiet">喜欢项按官方名称和标签匹配；目前缺少完整排除证据，选择必须排除的品类可能无法得到结果。参考价可帮助比较，最终支出仍需结算核验。</p>}
        <div className="actions"><button className="button primary" disabled={busy || !ready} onClick={recommend}>{busy ? "正在生成并核算搭配…" : "生成我的搭配 →"}</button><button className="text-link" onClick={() => setStep(1)}>返回选店</button></div>
      </>}
      {step === 3 && <>
        {result ? <RecommendationResults result={result} live={status.mode === "live"} card={optionCard} onEdit={() => setStep(2)} onRetry={recommend} onSimulate={(optionId) => void act({ action: "review-simulation", revision: revision.current, optionId }, 4)} busy={busy} /> : <div className="empty-state">报价已失效，请修改条件并重新推荐。</div>}
        <div className="actions"><button className="button secondary" onClick={() => setStep(2)}>修改条件</button><button className="text-link" disabled={busy || transactionLocked} onClick={() => void act({ action: "abstain", revision: ++revision.current }, 1)}>本次不购买</button></div>
      </>}
      {step === 4 && (draft ? <>
        <div className="section-heading"><h2>订单核对</h2><p>核对搭配后可体验模拟创建；不会创建真实订单或发起支付。</p></div>
        <div className="review-store"><h3>{draft.store.name}</h3><p>{draft.store.address}</p><p>{draft.form.fulfillment === "delivery" ? "麦乐送外送" : draft.form.takeWay === "eat-in" ? "到店自取 · 店内堂食" : "到店自取 · 外带"}</p><p>{draft.deliveryAddress ?? "取餐信息：到所选门店自取；本阶段无需提交手机号或取餐凭证。"}</p></div>
        {draft.option.status === "reference" && <h3>{draft.option.products.map(product => `${product.name} × ${product.quantity}`).join("、")}</h3>}
        <ul className="meal-items review-items">{draft.option.items.map((item, i) => <li key={i}><span>{item.name}</span><strong>× {item.quantity}</strong></li>)}</ul>
        {draft.option.status === "reference" ? <dl className="fee-list"><div><dt>预算</dt><dd>{money(budgetToFen(draft.form.budget))}</dd></div><div className="total"><dt>官方查询参考价</dt><dd>{money(draft.option.totalFen)}</dd></div><div><dt>最终应付金额及费用明细</dt><dd>未核验；本次模拟不结算</dd></div></dl> : <dl className="fee-list"><div><dt>预算</dt><dd>{money(budgetToFen(draft.form.budget))}</dd></div><div><dt>商品金额（优惠后）</dt><dd>{money(draft.option.fees.productFen)}</dd></div><div><dt>优惠金额（已含在商品金额中）</dt><dd>{money(draft.option.fees.discountFen)}</dd></div><div><dt>配送费</dt><dd>{money(draft.option.fees.deliveryFen)}</dd></div><div><dt>打包费 / 餐具费</dt><dd>{money(draft.option.fees.packingFen)} / {money(draft.option.fees.tablewareFen)}</dd></div><div className="total"><dt>{draft.option.source === "demo" ? "演示合计" : "官方核算合计"}</dt><dd>{money(draft.option.totalFen)}</dd></div></dl>}
        {draft.option.overBudgetFen > 0 && <p className="over-amount">{draft.option.status === "reference" ? "参考价超出预算 " : "此方案超出预算 "}{money(draft.option.overBudgetFen)}</p>}<p className="quiet">{draft.option.coupon}</p><div className="notice">{draft.option.source === "demo" ? "以上餐品、地址与费用均为虚构样例。" : draft.option.status === "reference" ? "餐品和参考价来自官方查询；费用未核验，不作为最终应付金额。" : "报价仅供本次核对。"}服务端已保存本次核对草稿，条件变化后失效；不构成真实订单。</div><button className="button disabled-order" disabled>真实下单未开放</button>{draft.checkout && <CheckoutPanel key={`${draft.checkout.id}-${draft.checkout.version}`} checkout={draft.checkout} delivery={draft.form.fulfillment === "delivery"} demo={status.mode === "demo"} busy={busy} onAction={(intent) => void act({ ...intent, revision: revision.current, draftId: draft.checkout!.id, version: draft.checkout!.version })} />}<div className="actions"><button className="button secondary" disabled={transactionLocked} onClick={() => setStep(3)}>返回推荐</button><button className="text-link" disabled={busy || transactionLocked} onClick={() => void act({ action: "abstain", revision: ++revision.current }, 1)}>本次不购买</button></div>
      </> : <div className="empty-state">核对草稿已失效。<button className="button secondary" onClick={() => setStep(2)}>重新设置条件</button></div>)}
    </section><aside className="summary-panel" aria-label="当前用餐条件"><h2>这一顿，你做主。</h2><dl><div><dt>门店</dt><dd>{view.stores.find((store) => store.ref === form.storeRef)?.name ?? "尚未选择"}</dd></div><div><dt>用餐</dt><dd>{form.fulfillment === "pickup" ? "到店自取" : "麦乐送外送"}</dd></div><div><dt>预算</dt><dd>{budgetSchema.safeParse(form.budget).success ? money(budgetToFen(form.budget)) : "待设置"}</dd></div><div><dt>模板</dt><dd>主食 + 饮品{form.includeSnack ? " + 小食" : ""}</dd></div></dl>{step > 1 && <button className="text-link" disabled={transactionLocked} onClick={() => setStep(1)}>更换门店 / 用餐方式 ↗</button>}</aside></div>
  </main>;
}
