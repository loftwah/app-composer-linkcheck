import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build, serialise } from "../scripts/effect-demo-fixtures.mjs";

const committed = readFileSync(
  new URL("../docs/effect/run-trace.json", import.meta.url),
  "utf8",
);
const parse = () => JSON.parse(committed);
const scenario = (fixture, id) =>
  fixture.scenarios.find((entry) => entry.id === id);

test("the committed trace is the current batch runner's real output", async () => {
  const fixture = await build();
  assert.equal(serialise(fixture), committed);
});

test("every recorded scenario labels itself as executed synthetic evidence", () => {
  const fixture = parse();
  assert.equal(fixture.kind, "effect-batch-trace");
  assert.equal(fixture.engine.effect, "4.0.4");
  assert.equal(fixture.engine.synthetic, true);
  assert.match(fixture.engine.label, /No network request/);
  assert.equal(fixture.scenarios.length, 5);
  assert.deepEqual(
    fixture.scenarios.map((entry) => entry.id),
    ["ready", "permission", "duplicate", "timeout", "recovery"],
  );
});

test("a refusal never reaches the inspector and stops at the blocking phase", () => {
  const fixture = parse();
  for (const id of ["permission", "duplicate"]) {
    const entry = scenario(fixture, id);
    assert.equal(entry.outcome.kind, "refused", id);
    assert.equal(entry.observed.inspectorCalls, 0, id);
    assert.equal(entry.phases.at(-1).state, "block", id);
    assert.equal(entry.phases.at(-1).blocked, true, id);
    assert.ok(entry.outcome.code, id);
  }
  assert.equal(
    scenario(fixture, "permission").outcome.code,
    "TargetNotPermitted",
  );
  assert.equal(scenario(fixture, "duplicate").outcome.code, "DuplicateTarget");
});

test("a completed report keeps per-page evidence, attempts and honest uncertainty", () => {
  const fixture = parse();
  const timeout = scenario(fixture, "timeout");
  assert.equal(timeout.outcome.report.status, "partial");
  const uncertain = timeout.outcome.report.targets.filter(
    (target) => target.status === "uncertain",
  );
  assert.equal(uncertain.length, 1);
  assert.equal(uncertain[0].code, "AttemptTimeout");
  assert.equal(uncertain[0].attempts, 2);
  const recovery = scenario(fixture, "recovery");
  const reconciled = recovery.outcome.report.targets.find(
    (target) => target.reconciled,
  );
  assert.ok(reconciled, "the retried read is marked as reconciled");
  assert.equal(reconciled.attempts, 2);
  for (const entry of fixture.scenarios) {
    if (entry.outcome.kind !== "report") continue;
    const report = entry.outcome.report;
    assert.equal(
      report.targets.length,
      report.totals.verified + report.totals.failed + report.totals.uncertain,
    );
    assert.equal(report.limits.persisted, false);
    for (const target of report.targets) {
      assert.ok(target.message.length > 0);
      assert.ok(target.recovery.length > 0);
      assert.ok(["verified", "failed", "uncertain"].includes(target.status));
    }
  }
});
