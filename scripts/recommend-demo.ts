import { createRecommendationSession } from "../src/server/recommend";
import { createDemoRecommendationAdapter } from "../src/server/demo/recommend-adapter";

const session = createRecommendationSession(createDemoRecommendationAdapter());
const result = await session.run(
  { mode: "demo", fulfillment: "pickup", storeRef: "fictional-store", revision: 1, needTableware: false, takeWay: "take-in-store" },
  { budgetFen: 2500, template: "main+drink", includeSnack: false, likedTags: ["beef", "sugar-free"], excludedTags: ["spicy"] },
);
if (result.status === "complete") {
  const { recommendation: r } = result;
  const display = (option: typeof r.budgetOptions[number]) => ({
    items: option.candidate.components.map((part) => part.name), totalFen: option.quote.totalFen,
    matched: option.candidate.matchedTags, missing: option.candidate.missingTags,
    overBudgetFen: option.overBudgetFen, purchasable: option.purchasable, source: option.quote.source,
  });
  console.log(JSON.stringify({ notice: "独立虚构演示；未连接官方 MCP，不产生真实订单。", budgetOptions: r.budgetOptions.map(display), overBudgetOption: r.overBudgetOption ? display(r.overBudgetOption) : null, coverage: r.coverage }, null, 2));
}
