import type { ResultView } from "../domain/workflow";

// Presentation only: never makes a quote eligible or changes candidate ordering.
export function resultNotice(result: ResultView) {
  if (result.budgetOptions.length > 0) return result.rejectedCount > 0
    ? { title: "部分报价未通过核验", description: "以下仅展示通过核验的方案，未通过的方案不能进入核对。" }
    : null;
  if (result.referencePrices.length > 0) return null; // The reference section carries the single explanation.
  if (result.issues.includes("菜单或优惠数据读取失败，未使用模拟数据替代。"))
    return { title: "本次查询未完成", description: "菜单或优惠数据读取失败，请重试。没有使用样例替代真实数据。" };
  if (result.coverage.succeeded > 0)
    return { title: "当前候选范围内，未找到合适的预算内组合。", description: "可调整预算或餐品模板，排除条件不会自动放宽。" };
  if (result.coverage.attempted > 0)
    return { title: "候选已有，报价尚未通过核验", description: "暂时无法判断哪些组合符合预算。可重新查询，未核验的金额不能进入核对。" };
  return { title: "当前已检查餐品中，没有可推荐组合", description: "可能受模板、排除条件或商品资料完整性影响。可修改条件或更换门店。" };
}

export function couponDisplay(hint: string) {
  // Only shorten the documented display format. Do not infer applicability or merge rights by name.
  const match = hint.match(/^(.*)：(可领取|已持有|本单适用|适用性未验证)（未计入报价）$/);
  return match ? { name: match[1], status: match[2] } : { name: hint, status: null };
}
