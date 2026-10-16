import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, arch, platform, release } from "node:os";
import { performance } from "node:perf_hooks";
import { canonical } from "../src/domain/meal";
import { buildDataset } from "../experiments/phase6a/dataset";
import { METHODS, measure, runMethod, summarize } from "../experiments/phase6a/compare";
import { verifyLifecycle } from "../experiments/phase6a/lifecycle";

const out = "docs/experiments/phase6a";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Phase 6A experiment forbids network access"); };
const dataset = await buildDataset();
assert.equal(canonical(dataset), canonical(await buildDataset()), "Dataset must be deterministic");
const rows = dataset.flatMap((test) => METHODS.map((method) => measure(test, method)));
assert.equal(canonical(rows), canonical(dataset.flatMap((test) => METHODS.map((method) => measure(test, method)))), "Algorithm outputs must be deterministic");
const summaries = summarize(rows);
const lifecycle = await verifyLifecycle(dataset.find((test) => test.id === "out-of-order")!);
const evidencePath = "docs/mcp/VALIDATION_EVIDENCE_2026-10-12.json";
const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as { at: string; tool: string; observations?: unknown }[];
const recordedPrice = evidence.find((record) => record.tool === "calculate-price")!;
const historicalEvidence = { source: "official-redacted-snapshot", path: evidencePath, sha256: hash(readFileSync(evidencePath, "utf8")), recordedPrice, includedInAlgorithmComparison: false, reason: "历史无券价格缺少完整费用，不能补零或作为完整应付报价；历史结构化记录共8条，不归因给任一算法。", structuredReadRecords: evidence.length };

const timing: { repeat: number; caseId: string; method: string; durationMs: number }[] = [];
// Same process/input snapshots; rotate execution order, exclude generation, I/O and warmups.
for (let round = -5; round < 30; round++) {
  for (const test of dataset) {
    const offset = ((round % 3) + 3) % 3;
    for (let index = 0; index < 3; index++) {
      const method = METHODS[(index + offset) % 3];
      const start = performance.now(); runMethod(test, method); const durationMs = performance.now() - start;
      if (round >= 0) timing.push({ repeat: round, caseId: test.id, method, durationMs });
    }
  }
}
const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
const times = METHODS.map((method) => { const ms = timing.filter((row) => row.method === method).map((row) => row.durationMs); return { method, samples: ms.length, medianMs: quantile(ms, .5), p95Ms: quantile(ms, .95), meanMs: ms.reduce((a, b) => a + b, 0) / ms.length }; });
const differences = dataset.map((test) => {
  const values = rows.filter((row) => row.caseId === test.id);
  const a = values.find((row) => row.method === "A")!, b = values.find((row) => row.method === "B")!, m = values.find((row) => row.method === "McTiming")!;
  return { caseId: test.id, A: a.top1Fen, B: b.top1Fen, McTiming: m.top1Fen, mMinusA: m.top1Fen !== null && a.top1Fen !== null ? m.top1Fen - a.top1Fen : null, mMinusB: m.top1Fen !== null && b.top1Fen !== null ? m.top1Fen - b.top1Fen : null, matchGainA: m.top1Match !== null && a.top1Match !== null ? m.top1Match - a.top1Match : null, matchGainB: m.top1Match !== null && b.top1Match !== null ? m.top1Match - b.top1Match : null };
});
const safety = { hardViolations: rows.reduce((n, row) => n + row.hardViolations, 0), defaultBudgetViolations: rows.reduce((n, row) => n + row.budgetViolations, 0), ungroundedPrices: rows.reduce((n, row) => n + row.ungroundedPrices, 0), networkAttempts };
mkdirSync(out, { recursive: true });
const save = (name: string, value: unknown) => writeFileSync(`${out}/${name}.json`, JSON.stringify(value, null, 2) + "\n");
function csv(name: string, values: Record<string, unknown>[]) {
  const keys = Object.keys(values[0]); const cell = (v: unknown) => JSON.stringify(v === null ? "" : String(v));
  writeFileSync(`${out}/${name}.csv`, [keys.map(cell).join(","), ...values.map((row) => keys.map((key) => cell(row[key])).join(","))].join("\n") + "\n");
}
save("dataset", { mode: "controlled-offline", fixedClock: 1_800_000_000_000, cases: dataset, historicalEvidence });
save("results", { datasetHash: hash(canonical(dataset)), resultsHash: hash(canonical(rows)), rows, summaries, differences, lifecycle, safety });
save("timing", { environment: { node: process.version, platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length }, protocol: "5 warmups + 30 measured repetitions/case/method; rotated order; offline selection including each implementation's validation/projection; excludes candidate generation, network, file I/O and page rendering", times });
csv("metrics", rows.map(({ defaults: _defaults, overBudget: _over, ...rest }) => rest));
csv("summary", summaries); csv("differences", differences); csv("timings", timing);
assert(Object.values(safety).every((value) => value === 0), "Safety quality gate failed; inspect saved evidence");
console.log(JSON.stringify({ mode: "受控模拟实验，非真实麦当劳价格比较", cases: dataset.length, summaries, timing: times, safety, datasetHash: hash(canonical(dataset)), resultsHash: hash(canonical(rows)) }, null, 2));
