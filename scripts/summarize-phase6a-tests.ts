import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";

const unit = JSON.parse(readFileSync(".local/phase6a-vitest.json", "utf8"));
const browser = JSON.parse(readFileSync(".local/phase6a-playwright.json", "utf8"));
type Check = { runner: string; file: string; name: string; status: string };
const checks: Check[] = [];
for (const file of unit.testResults) for (const check of file.assertionResults) checks.push({ runner: "Vitest", file: basename(file.name), name: check.fullName, status: check.status });
type Suite = { file?: string; suites?: Suite[]; specs?: { title: string; tests: { status: string; results: { status: string }[] }[] }[] };
function walk(suites: Suite[]) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests) checks.push({ runner: "Playwright", file: basename(suite.file ?? "unknown"), name: spec.title, status: test.status === "expected" && test.results.every((run) => run.status === "passed") ? "passed" : test.status });
    walk(suite.suites ?? []);
  }
}
walk(browser.suites);
const groups = [...new Set(checks.map((check) => `${check.runner}:${check.file}`))].map((key) => {
  const entries = checks.filter((check) => `${check.runner}:${check.file}` === key);
  return { runner: entries[0].runner, file: entries[0].file, total: entries.length, passed: entries.filter((check) => check.status === "passed").length };
});
const report = { source: "actual local controlled test executions; no official business calls", generatedAt: new Date().toISOString(), vitest: { total: unit.numTotalTests, passed: unit.numPassedTests, failed: unit.numFailedTests, pending: unit.numPendingTests, files: unit.testResults.length }, playwright: browser.stats, groups, checks };
mkdirSync("docs/experiments/phase6a", { recursive: true });
writeFileSync("docs/experiments/phase6a/test-summary.json", JSON.stringify(report, null, 2) + "\n");
writeFileSync("docs/experiments/phase6a/test-groups.csv", "runner,file,total,passed\n" + groups.map((row) => [row.runner, row.file, row.total, row.passed].join(",")).join("\n") + "\n");
assert(checks.length === unit.numTotalTests + browser.stats.expected, "Missing or failed test records");
assert(checks.every((check) => check.status === "passed"), "A test failed, skipped or was flaky");
console.log(JSON.stringify({ vitest: report.vitest, playwright: report.playwright, groups }, null, 2));
