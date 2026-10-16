import { describe, expect, it } from "vitest";
import { couponDisplay, resultNotice } from "../src/components/recommendation-presentation";
import type { ResultView } from "../src/domain/workflow";

const empty = (): ResultView => ({ budgetOptions: [], overBudgetOption: null, referencePrices: [], message: "旧通用文案", issues: [], claimableHints: [], rejectedCount: 0, coverage: { generated: 0, attempted: 0, succeeded: 0, rejectedOptions: 0, truncated: false, scope: "generated-candidates-only" } });
describe("result messages preserve quote and budget semantics", () => {
  it("unknown fees do not become an insufficient-budget claim", () => {
    const result = empty();
    result.referencePrices = [{ items: [{ name: "受控餐品", quantity: 1 }], amountFen: 3450, quotedAt: 1000, expiresAt: null }];
    result.coverage.attempted = 1;
    expect(resultNotice(result)).toBeNull(); // Reference section explains this once.
  });
  it("failed quotes cannot be called over budget", () => {
    const result = empty(); result.coverage.attempted = 2; result.rejectedCount = 2;
    expect(resultNotice(result)?.title).toBe("候选已有，报价尚未通过核验");
  });
  it("only verified results allow the limited-range budget explanation", () => {
    const result = empty(); result.coverage.attempted = 2; result.coverage.succeeded = 2;
    expect(resultNotice(result)?.title).toBe("当前候选范围内，未找到合适的预算内组合。");
  });
  it("menu read failure remains a query failure", () => {
    const result = empty(); result.issues = ["菜单或优惠数据读取失败，未使用模拟数据替代。"];
    expect(resultNotice(result)?.title).toBe("本次查询未完成");
  });
  it("no candidates does not claim the whole store is unsuitable", () => {
    expect(resultNotice(empty())?.description).toContain("商品资料完整性");
    expect(resultNotice(empty())?.title).toContain("当前已检查餐品");
  });
});
describe("coupon copy never upgrades entitlement", () => {
  it.each(["可领取", "已持有", "本单适用", "适用性未验证"])("preserves %s distinctly", (status) => {
    expect(couponDisplay(`中薯条买一送一：${status}（未计入报价）`)).toEqual({ name: "中薯条买一送一", status });
  });
  it("preserves unknown restrictions instead of dropping them", () => {
    const hint = "中薯条买一送一：可领取（仅指定门店，每人限一次）";
    expect(couponDisplay(hint)).toEqual({ name: hint, status: null });
  });
});
