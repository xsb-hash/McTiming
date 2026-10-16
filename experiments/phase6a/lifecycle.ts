import assert from "node:assert/strict";
import { canonical, quoteBinding } from "../../src/domain/meal";
import { createRecommendationSession, type RecommendationAdapter } from "../../src/server/recommend";
import { FIXED_TIME, type ExperimentCase } from "./dataset";

export async function verifyLifecycle(test: ExperimentCase) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let loads = 0;
  const adapter: RecommendationAdapter = {
    source: "demo",
    async load() { if (++loads === 1) await gate; return structuredClone(test.catalog); },
    async quote(context, request, candidate) {
      const original = test.quoted.find((entry) => entry.candidate.id === candidate.id);
      assert(original, "Missing controlled snapshot");
      return { ...structuredClone(original.quote), binding: quoteBinding(context, request, candidate) };
    },
  };
  const engine = createRecommendationSession(adapter, () => FIXED_TIME);
  const old = engine.run(test.context, test.request);
  const latest = await engine.run(test.context, { ...test.request, budgetFen: 1000 });
  const before = canonical(engine.current()); release();
  assert.equal((await old).status, "superseded");
  assert.equal(canonical(engine.current()), before);
  assert.equal(latest.status, "complete");
  assert.equal(engine.current()!.budgetOptions.length, 0);
  engine.invalidate(); assert.equal(engine.current()!.status, "expired");
  return { caseId: test.id, source: "controlled", oldRequest: "superseded", latestDefaultCount: 0, invalidatedStatus: "expired", passed: true };
}
