import type { CallToolResult } from "@modelcontextprotocol/client";
import { responseEvidence } from "./mcp-evidence";

// Retain every structured field/array entry, but never account identifiers,
// free-text errors, URLs, addresses, voucher codes or unknown string values.
export function redactPhase5b(tool: string, value: unknown, input = false): unknown {
  const publicStrings = new Set(input
    ? ["storeCode", "city", "keyword", "productCode", "code", "key", "round", "page", "pageSize"]
    : tool === "query-meals" ? ["name", "code", "tags", "currentPrice", "originalPrice", "discountType"]
      : tool === "query-meal-detail" ? ["name", "code", "selectedKey", "unselectedKey", "diffPrice"]
        : tool === "query-nearby-stores" ? ["storeCode", "storeName", "businessStartTime", "businessEndTime"]
          : tool === "calculate-price" ? ["productCode", "productName", "code", "title", "subtitle", "amountType"]
            : tool === "query-my-coupons" || tool === "query-store-coupons" ? ["tradeStartDate", "tradeEndDate", "tradeDateTime", "productCode", "productName"]
              : tool === "now-time-info" ? ["date", "datetime", "formatted", "timezone", "offset", "utc", "dayOfWeek"] : []);
  const walk = (v: unknown, key: string): unknown => {
    if ((key !== "addresses" && /token|authorization|phone|contact|address|latitude|longitude|traceId|couponId|couponCode|promotionId|pay|orderId/i.test(key)) || (key === "id" && tool !== "query-meal-detail")) return "[REDACTED]";
    if (Array.isArray(v)) return v.map((entry) => walk(entry, key));
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, entry]) => [k, walk(entry, k)]));
    if (typeof v === "string") return publicStrings.has(key) ? v : "[REDACTED:string]";
    return v;
  };
  return walk(value, "");
}

export function phase5bRecord(tool: string, args: Record<string, unknown>, result: CallToolResult) {
  return { at: new Date().toISOString(), tool, arguments: redactPhase5b(tool, args, true),
    ...responseEvidence(tool, result), structuredContent: redactPhase5b(tool, result.structuredContent),
    contentPolicy: "All structured fields retained with redaction; text/image content omitted because it can repeat account data." };
}
