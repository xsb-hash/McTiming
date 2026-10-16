"use client";
import { useState } from "react";
import { checkoutStates, demoScenarios, type CheckoutView, type DemoScenario } from "../domain/checkout";
import { money } from "../domain/workflow";

export type CheckoutIntent = { action: "checkout-confirm"; confirmed: true; addressConfirmed: boolean } | { action: "checkout-status" | "checkout-cancel" } | { action: "checkout-scenario"; scenario: DemoScenario };
export function CheckoutPanel({ checkout, delivery, demo, busy, onAction }: { checkout: CheckoutView; delivery: boolean; demo: boolean; busy: boolean; onAction: (intent: CheckoutIntent) => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const canConfirm = demo && checkout.valid && ["awaiting-confirmation", "reconfirmation-required"].includes(checkout.state);
  return <section className="checkout-panel" aria-label="订单确认与模拟交易">
    <div className="card-top"><h3>{demo ? "模拟订单确认" : "订单确认"}</h3><strong data-testid="checkout-state">{checkoutStates[checkout.state]}</strong></div>
    <p className="quiet">报价版本 v{checkout.version} · {checkout.valid ? "草稿有效" : "草稿失效"} · {checkout.quoteStatus === "demo" ? "演示报价" : "官方报价待交易验证"}</p>
    <p className="quiet">计价时间 {new Date(checkout.quotedAt).toLocaleString("zh-CN", { hour12: false })}；提交前再次复核。</p>
    <details><summary>商品规格与套餐配置</summary><ul className="specifications">{checkout.specifications.map((text, index) => <li key={index}>{text}</li>)}</ul></details>
    {checkout.state === "reconfirmation-required" && checkout.previousTotalFen !== null && <div className="notice warning" data-testid="quote-change"><strong>报价已变化，需要重新确认</strong><p>原金额 {money(checkout.previousTotalFen)} → 新金额 {checkout.totalFen === null ? "未知" : money(checkout.totalFen)}</p><p>{checkout.changes.join("、")}</p></div>}
    <p className="notice" role="status">{checkout.message}</p>
    {demo && canConfirm && <>
      <label className="field">模拟交易场景<select disabled={busy} value={checkout.scenario} onChange={(event) => onAction({ action: "checkout-scenario", scenario: event.target.value as DemoScenario })}>{Object.entries(demoScenarios).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>受控样例，用于演示成功、调价、失败及未知结果。</small></label>
      {delivery && <label className="check-line"><input type="checkbox" checked={addressConfirmed} disabled={busy} onChange={(event) => setAddressConfirmed(event.target.checked)} />我确认上方虚构配送地址，仅用于本次模拟</label>}
      <label className="check-line"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />我已核对餐品、费用及取餐／配送信息，确认本次模拟创建</label>
      <button className="button primary" disabled={busy || !confirmed || (delivery && !addressConfirmed) || checkout.totalFen === null} onClick={() => { setConfirmed(false); onAction({ action: "checkout-confirm", confirmed: true, addressConfirmed }); }}>确认创建模拟订单 · {checkout.totalFen === null ? "金额待验证" : money(checkout.totalFen)}</button>
      <p className="quiet">按钮金额表示当前核对内容；点击后先复核，尚不代表已创建。</p>
    </>}
    {checkout.order && <div className="notice" data-testid="demo-order"><strong>模拟订单编号：{checkout.order.id}</strong><p>{checkout.order.status}</p><p>{checkout.order.payment}</p></div>}
    {(checkout.order || ["rechecking", "creating", "unknown"].includes(checkout.state)) && <button className="button secondary" disabled={busy} onClick={() => onAction({ action: "checkout-status" })}>刷新模拟状态</button>}
    {demo && canConfirm && <button className="text-link" disabled={busy} onClick={() => onAction({ action: "checkout-cancel" })}>取消本次模拟操作</button>}
    {checkout.state === "unknown" && <p className="notice warning">结果未知时不能重新创建，也不能当作取消成功。请保留当前会话查看结果；本样例没有可用于可靠恢复的订单编号。</p>}
  </section>;
}
