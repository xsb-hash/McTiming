// Verified against M-China/mcd-mcp-server README, 2026-10-12. Not inferred from name prefixes.
export const READ_ONLY_TOOLS = [
  "now-time-info",
  "query-nearby-stores",
  "delivery-query-addresses",
  "delivery-query-stores",
  "query-meals",
  "query-meal-detail",
  "query-my-coupons",
  "query-store-coupons",
  "available-coupons",
  "calculate-price",
  "query-order",
] as const;

export type ReadOnlyTool = typeof READ_ONLY_TOOLS[number];

export function isReadOnlyTool(name: unknown): name is ReadOnlyTool {
  return typeof name === "string" && (READ_ONLY_TOOLS as readonly string[]).includes(name);
}
