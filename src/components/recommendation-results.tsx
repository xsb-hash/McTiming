import type { ReactNode } from "react";
import { money, type ResultView, type OptionView } from "../domain/workflow";
import { couponDisplay, resultNotice } from "./recommendation-presentation";

export function RecommendationResults({ result, live, card, onEdit, onRetry, busy }: {
  result: ResultView; live: boolean; card: (option: OptionView, index: number, over?: boolean) => ReactNode;
  onEdit: () => void; onRetry: () => void; busy: boolean;
}) {
  const notice = resultNotice(result);
  const retry = result.coverage.attempted > 0 && result.coverage.succeeded === 0 || result.issues.includes("菜单或优惠数据读取失败，未使用模拟数据替代。");
  const hints = result.claimableHints.map(couponDisplay);
  const row = (hint: ReturnType<typeof couponDisplay>, index: number) => <li key={index}><span>{hint.name}</span>{hint.status && <span className="coupon-status">{hint.status}</span>}</li>;
  return <>
    <div className="section-heading"><h2>{result.budgetOptions.length > 0 || result.coverage.succeeded > 0 ? "预算内的搭配" : "本次查询结果"}</h2><p>优先匹配口味，同分时选价格更低的搭配。</p></div>
    {notice && <div className="empty-state" role="status"><strong>{notice.title}</strong><p>{notice.description}</p>{result.budgetOptions.length === 0 && <div className="actions"><button className="button secondary" disabled={busy} onClick={retry ? onRetry : onEdit}>{retry ? "重新查询" : "调整预算与条件"}</button></div>}</div>}
    <div className="result-list">{result.budgetOptions.map((option, index) => card(option, index))}</div>
    {live && result.referencePrices.length > 0 && <section className="reference-section" aria-label="官方查询参考金额">
      <h2>当前查询金额，最终费用待核验</h2><p>已查到金额，但包装费、餐具费等是否包含仍待确认。仅供参考，不能据此判断符合预算或进入订单核对。</p>
      {result.referencePrices.map((price, index) => <article key={index} data-testid="reference-price"><div><h3>{(price.products ?? price.items).map((item) => `${item.name} × ${item.quantity}`).join("、")}</h3>{price.products && <p>包含：{price.items.map((item) => `${item.name} × ${item.quantity}`).join("、")}</p>}<p className="quiet">查询时间（北京时间）：{new Date(price.quotedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p></div><div><strong className="price">{money(price.amountFen)}</strong><span className="quiet">参考金额 · 费用待核验</span></div></article>)}
    </section>}
    {result.overBudgetOption && <section aria-label="超预算备选" className="over-section"><h2>超预算备选</h2>{card(result.overBudgetOption, 0, true)}</section>}
    <section className="coupon-note" aria-label="优惠券"><h3>优惠券</h3>{hints.length > 0 ? <><ul className="coupon-list">{hints.slice(0, 3).map(row)}</ul>{hints.length > 3 && <details><summary>查看更多（{hints.length - 3} 条）</summary><ul className="coupon-list">{hints.slice(3).map(row)}</ul></details>}</> : <p>本轮没有返回可领取券提示，不代表账户无券。</p>}<p className="quiet">可领取不等于本单适用；仅已持有且经核验适用的券参与计价。未验证优惠不扣减。</p></section>
    <details className="verification-details"><summary>查看核验详情</summary><ul>{result.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>{result.rejectedCount > 0 && <p>{result.rejectedCount} 份报价未通过核验，已排除。</p>}<p>已生成 {result.coverage.generated} 个候选，计价 {result.coverage.attempted} 个，通过核验 {result.coverage.succeeded} 个；{result.coverage.rejectedOptions} 个菜单选项未通过筛选。{result.coverage.truncated ? "候选数量已达本轮上限。" : ""}</p><p>仅比较当前候选，不代表全店最低价或全局最优。</p></details>
  </>;
}
