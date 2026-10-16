import type { CallToolResult } from "@modelcontextprotocol/client";

export function structure(value: unknown, depth = 0): unknown {
  if (value === null) return "null";
  if (depth > 12) return "depth-limit";
  if (Array.isArray(value)) return { type: "array", length: value.length, items: value.slice(0, 2).map((item) => structure(item, depth + 1)) };
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, structure(item, depth + 1)]));
  return typeof value;
}

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

// Persist only explicit non-personal observations. Unknown values and free text
// are represented by types, never copied into evidence files or terminal output.
export function responseEvidence(tool: string, response: CallToolResult) {
  const envelope = object(response.structuredContent);
  const data = object(envelope.data);
  const observations: Record<string, unknown> = {};
  if (Array.isArray(envelope.data)) observations.resultCount = envelope.data.length;
  if (tool === "delivery-query-addresses" && Array.isArray(data.addresses)) observations.addressCount = data.addresses.length;
  if (tool === "query-my-coupons" && Array.isArray(data.coupons)) {
    observations.couponCount = data.coupons.length;
    observations.totalPages = typeof data.totalPages === "number" ? data.totalPages : "unknown";
  }
  if (tool === "query-meals") {
    observations.categoryCount = Array.isArray(data.categories) ? data.categories.length : "unknown";
    observations.mealCount = Object.keys(object(data.meals)).length;
  }
  if (tool === "query-meal-detail" && Array.isArray(data.rounds)) observations.roundCount = data.rounds.length;
  if (tool === "calculate-price") {
    for (const key of ["productOriginalPrice", "productPrice", "originalPrice", "discount", "price", "deliveryOriginalPrice", "deliveryPrice", "packingOriginalPrice", "packingPrice", "tablewarePrice"]) {
      observations[key] = Number.isSafeInteger(data[key]) ? data[key] : "missing-or-invalid";
    }
  }
  const success = typeof envelope.success === "boolean" ? envelope.success : undefined;
  const code = typeof envelope.code === "number" ? envelope.code : undefined;
  return {
    isError: response.isError === true,
    success, code,
    // Transport success alone does not establish business success or fee completeness.
    status: response.isError || success === false || (code !== undefined && code !== 200) ? "call-failed" : success === true && code === 200 ? "business-success" : "unverified-envelope",
    structure: structure(response.structuredContent),
    observations,
  };
}
