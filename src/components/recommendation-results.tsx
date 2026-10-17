import type { ReactNode } from "react";
import { money, tagLabel, type ResultView, type OptionView } from "../domain/workflow";
import { couponDisplay, resultNotice } from "./recommendation-presentation";

export function RecommendationResults({ result, live, card, onEdit, onRetry, onSimulate, busy }: {
  result: ResultView; live: boolean; card: (option: OptionView, index: number, over?: boolean) => ReactNode;
  onEdit: () => void; onRetry: () => void; onSimulate: (id: string) => void; busy: boolean;
}) {
  const notice = resultNotice(result);
  const retry = result.coverage.attempted > 0 && result.coverage.succeeded === 0 || result.issues.includes("菜单或优惠数据读取失败，未使用模拟数据替代。");
  const hints = result.claimableHints.map(couponDisplay);
  const referenceGroups = [
    { relation: "reference-within", title: "参考价在预算内", note: "最终费用以实际结算为准，不能保证实际支付不超预算。" },
    { relation: "reference-over", title: "超出预算的参考备选", note: "独立展示供取舍，最终费用以实际结算为准。" },
    { relation: undefined, title: "当前查询金额，最终费用待核验", note: "计价口径未确认，不参与预算比较或金额排序。" },
  ] as const;
  const row = (hint: ReturnType<typeof couponDisplay>, index: number) => <li key={index}><span>{hint.name}</span>{hint.status && <span className="coupon-status">{hint.status}</span>}</li>;
  return <>
    <div className="section-heading"><h2>{result.budgetOptions.length > 0 || result.coverage.succeeded > 0 ? "预算内的搭配" : "本次查询结果"}</h2><p>优先匹配口味，同分时选价格更低的搭配。</p></div>
    {notice && <div className="empty-state" role="status"><strong>{notice.title}</strong><p>{notice.description}</p>{result.budgetOptions.length === 0 && <div className="actions"><button className="button secondary" disabled={busy} onClick={retry ? onRetry : onEdit}>{retry ? "重新查询" : "调整预算与条件"}</button></div>}</div>}
    <div className="result-list">{result.budgetOptions.map((option, index) => card(option, index))}</div>
    {!!result.failedQuoteCount && result.referencePrices.length > 0 && <p role="status">部分组合询价失败，以下仅展示本轮已取得的参考结果。</p>}
    {live && result.referencePrices.length > 0 && <section className="reference-section" aria-label="官方查询参考金额">
      {referenceGroups.map(group => {
        const prices = result.referencePrices.filter(price => price.budgetRelation === group.relation);
        return prices.length > 0 && <section key={group.title} aria-label={group.title}>
          <h2>{group.title}</h2><p>{group.note}</p>
          {prices.map((price, index) => <article key={index} data-testid="reference-price"><div><h3>{(price.products ?? price.items).map(item => `${item.name} × ${item.quantity}`).join("、")}</h3>{price.products && <p>包含：{price.items.map(item => `${item.name} × ${item.quantity}`).join("、")}</p>}
            <div className="preference-summary">{!!price.matchedTags?.length && <p>口味：{price.matchedTags.map(tagLabel).join("、")}</p>}{!!price.missingTags?.length && <p>更想要{price.missingTags.map(tagLabel).join("、")}？可以看看其他搭配。</p>}</div>
            <p className="quiet">查询时间（北京时间）：{new Date(price.quotedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p>
          </div><div><span className="quiet">官方查询参考价</span><strong className="price">{money(price.amountFen)}</strong>{price.budgetDifferenceFen !== undefined && <span className={price.budgetRelation === "reference-over" ? "over-amount" : "quiet"}>{price.budgetRelation === "reference-over" ? "参考价超预算 " : "参考价距预算 "}{money(price.budgetDifferenceFen)}</span>}<span className="quiet">非最终应付金额</span>{price.simulationId && <button className="button dark" disabled={busy} onClick={() => onSimulate(price.simulationId!)}>模拟下单</button>}</div></article>)}
        </section>;
      })}
      {!result.referencePrices.some(price => price.budgetRelation === "reference-within") && result.referencePrices.some(price => price.budgetRelation === "reference-over") && <p>本轮未找到参考价在预算内的组合，可调整预算或条件。</p>}
      <p>模拟下单可核对餐品和体验订单流程，不会付款或通知门店。实际购买请前往麦当劳官方渠道。</p>
    </section>}
    {result.overBudgetOption && <section aria-label="超预算备选" className="over-section"><h2>超预算备选</h2>{card(result.overBudgetOption, 0, true)}</section>}
    <section className="coupon-note" aria-label="优惠券"><h3>优惠券</h3>{!!result.couponHints?.length && <details><summary>已有券与门店提示（{result.couponHints.length} 条）</summary><ul className="coupon-list">{result.couponHints.map((coupon, i) => <li key={i}><div><span>{coupon.name}</span>{coupon.conditions.map((condition, j) => <p className="quiet" key={j}>{condition}</p>)}</div><span className="coupon-status">{coupon.status}</span></li>)}</ul></details>}{hints.length > 0 ? <><ul className="coupon-list">{hints.slice(0, 3).map(row)}</ul>{hints.length > 3 && <details><summary>查看更多（{hints.length - 3} 条）</summary><ul className="coupon-list">{hints.slice(3).map(row)}</ul></details>}</> : <p>本轮没有返回可领取券提示，不代表账户无券。</p>}<p className="quiet">可领取不等于本单适用；仅已持有且经核验适用的券参与计价。未验证优惠不扣减。</p></section>
    <details className="verification-details"><summary>查看核验详情</summary><ul>{result.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>{result.rejectedCount > 0 && <p>{result.rejectedCount} 份报价未取得最终费用核验，其中有效查询金额可单独展示为参考价。</p>}<p>已生成 {result.coverage.generated} 个候选，计价 {result.coverage.attempted} 个，最终费用通过核验 {result.coverage.succeeded} 个；{result.coverage.rejectedOptions} 个菜单选项未通过筛选。{result.coverage.truncated ? "候选数量已达本轮上限。" : ""}</p>{!!result.unavailableItems?.length && <><h3>未参与推荐的菜单商品</h3><ul>{result.unavailableItems.map((item, index) => <li key={index}>{item.name}：{item.reason}</li>)}</ul></>}<p>仅比较当前候选，不代表全店最低价或全局最优。</p></details>
  </>;
}
