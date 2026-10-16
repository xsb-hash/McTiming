import { describe, expect, it } from "vitest";
import { responseEvidence } from "../scripts/mcp-evidence";

describe("stage 2 evidence projection (synthetic data, no real network)", () => {
  it("retains an empty-address success without copying personal or free-text values", () => {
    const result = responseEvidence("delivery-query-addresses", {
      content: [{ type: "text", text: "PRIVATE_RESPONSE_CANARY" }],
      structuredContent: { success: true, code: 200, message: "PRIVATE_MESSAGE_CANARY", traceId: "PRIVATE_TRACE_CANARY", data: { addresses: [], extra: "PRIVATE_EXTRA_CANARY" } },
    });
    expect(result.status).toBe("business-success");
    expect(result.observations.addressCount).toBe(0);
    expect(JSON.stringify(result)).not.toContain("CANARY");
  });
  it("does not infer missing fees as zero and only retains safe integers", () => {
    const result = responseEvidence("calculate-price", {
      content: [], structuredContent: { success: true, code: 200, data: { price: 3450, productPrice: 3450, discount: 0, tablewarePrice: 0.1, deliveryPrice: "0" } },
    });
    expect(result.observations.price).toBe(3450);
    expect(result.observations.discount).toBe(0);
    expect(result.observations.packingPrice).toBe("missing-or-invalid");
    expect(result.observations.deliveryPrice).toBe("missing-or-invalid");
    expect(result.observations.tablewarePrice).toBe("missing-or-invalid");
  });
  it("distinguishes business failure from absent structured data", () => {
    expect(responseEvidence("query-meals", { content: [], structuredContent: { success: false, code: 500 } }).status).toBe("call-failed");
    expect(responseEvidence("query-meals", { content: [{ type: "text", text: "success" }] }).status).toBe("unverified-envelope");
  });
});
