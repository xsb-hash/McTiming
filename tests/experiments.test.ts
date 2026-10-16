import { beforeAll, describe, expect, it, vi } from "vitest";
import { canonical } from "../src/domain/meal";
import { buildDataset, type ExperimentCase } from "../experiments/phase6a/dataset";
import { METHODS, measure, runMethod, summarize } from "../experiments/phase6a/compare";
import { verifyLifecycle } from "../experiments/phase6a/lifecycle";

let dataset: ExperimentCase[];
beforeAll(async () => { dataset = await buildDataset(); });
describe("controlled comparison protocol and metrics", () => {
  it("uses a fixed clock, explicit sources and complete shared configuration range", async () => {
    expect(canonical(await buildDataset())).toBe(canonical(dataset));
    expect(dataset).toHaveLength(32);
    for (const test of dataset) { expect(test.generated.truncated).toBe(false); expect(["controlled", "demo-adapter"]).toContain(test.source); expect(test.quoted.every((entry) => !!entry.evidence)).toBe(true); }
  });
  it.each(Array.from({ length: 32 }, (_, i) => i))("audits all methods for fixed case %i without omitting empty results", (index) => {
    const test = dataset[index];
    for (const method of METHODS) {
      const result = runMethod(test, method); const metrics = measure(test, method, result);
      expect(metrics.hardViolations).toBe(0); expect(metrics.budgetViolations).toBe(0); expect(metrics.ungroundedPrices).toBe(0);
      expect(result.budgetOptions.length).toBeLessThanOrEqual(3);
      expect(canonical(result)).toBe(canonical(runMethod(test, method)));
      if (method === "A") expect(result.budgetOptions.every((option) => option.candidate.coupon === null)).toBe(true);
    }
  });
  it("calibrates the auditor with deliberately invalid prices, budgets and exclusions", () => {
    const test = structuredClone(dataset.find((entry) => entry.id === "budget-3000")!);
    const result = structuredClone(runMethod(test, "McTiming"));
    result.budgetOptions[0].quote.totalFen = 99999;
    test.request.excludedTags = ["beef"];
    const bad = measure(test, "McTiming", result);
    expect(bad.budgetViolations).toBeGreaterThan(0); expect(bad.hardViolations).toBeGreaterThan(0); expect(bad.ungroundedPrices).toBeGreaterThan(0);
  });
  it("detects unavailable menu data independently of the generator", () => {
    const test = structuredClone(dataset.find((entry) => entry.id === "budget-3000")!);
    const result = runMethod(test, "McTiming"); test.catalog.options.forEach((option) => { option.availability = "unavailable"; });
    expect(measure(test, "McTiming", result).hardViolations).toBeGreaterThan(0);
  });
  it("keeps zero-output cases in denominators and no-likes cases as null", () => {
    const rows = dataset.flatMap((test) => METHODS.map((method) => measure(test, method)));
    const summary = summarize(rows);
    for (const method of summary) { expect(method.cases).toBe(32); expect(method.withPreferences).toBe(30); expect(method.noPreferences).toBe(2); expect(method.empty).toBeGreaterThan(0); }
    expect(rows.filter((row) => !row.likedCount).every((row) => row.top1Match === null && row.averageMatch === null && row.top3Coverage === null)).toBe(true);
    expect(rows.filter((row) => row.likedCount && !row.defaultCount).every((row) => row.top1Match === 0 && !!row.noResultReason)).toBe(true);
  });
  it("uses the held-coupon configuration quote, rejects unverified coupon prices", () => {
    const valid = dataset.find((test) => test.id === "held-coupon")!;
    const selected = runMethod(valid, "McTiming").budgetOptions[0];
    expect(selected.candidate.coupon?.ref).toBe("held"); expect(selected.quote.totalFen).toBe(2400);
    const unknown = dataset.find((test) => test.id === "unverified-coupon-price")!;
    for (const method of METHODS) expect(runMethod(unknown, method).budgetOptions.every((option) => !option.candidate.coupon)).toBe(true);
  });
  it("verifies out-of-order and invalidation lifecycle without networking", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    expect((await verifyLifecycle(dataset.find((test) => test.id === "out-of-order")!)).passed).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
