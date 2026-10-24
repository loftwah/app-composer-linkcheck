// Records the real batch runner's outcomes for the App Composer /effect demo.
// Every number, message and typed code below comes from executing
// `src/batch.ts` with scripted inspectors. No network request is made, and no
// result here is a live inspection. Run `--check` to prove the committed trace
// still matches the current engine.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Effect, Layer } from "effect";
import {
  BATCH_CONCURRENCY,
  Inspector,
  MAX_TARGETS,
  ATTEMPTS_PER_TARGET,
  ReviewedScope,
  runBatch,
} from "../src/batch.ts";
import { FetchFailed, hosts } from "../src/inspection.ts";

const fixtureUrl = new URL("../docs/effect/run-trace.json", import.meta.url);
const output = fileURLToPath(fixtureUrl);
const share = "https://share.loftwah.com/";
const learn = "https://composer.loftwah.com/learn";
const guestbook = "https://guestbook.loftwah.com/";
const showcase = "https://composer.loftwah.com/showcase";

const labels = {
  [share]: "Link Check home",
  [learn]: "Composer: Learn",
  [guestbook]: "Guestbook home",
  [showcase]: "Composer: Showcase",
};

const findings = (pass, fix, review) => [
  ...Array.from({ length: pass }, () => ({ status: "pass" })),
  ...Array.from({ length: fix }, () => ({ status: "fix" })),
  ...Array.from({ length: review }, () => ({ status: "review" })),
];
const reportFor = (url) => {
  const shape =
    url === share
      ? [9, 1, 2]
      : url === learn
        ? [13, 0, 3]
        : url === showcase
          ? [11, 2, 1]
          : [7, 1, 0];
  return {
    url,
    htmlBytes: url === share ? 24_800 : url === learn ? 31_200 : 19_600,
    findings: findings(...shape),
    images: [
      { status: "verified" },
      { status: url === guestbook ? "failed" : "verified" },
      ...(url === learn ? [] : [{ status: "missing" }]),
    ],
  };
};

// Scripted inspector: counts calls and attempts, exposes real peak concurrency,
// and lets each scenario decide what an attempt returns.
function provider(handler, scope = hosts) {
  const state = { calls: 0, inFlight: 0, peak: 0, attempts: new Map() };
  const inspector = Layer.succeed(Inspector, {
    inspect: (url) =>
      Effect.suspend(() => {
        state.calls += 1;
        state.inFlight += 1;
        state.peak = Math.max(state.peak, state.inFlight);
        const attempt = (state.attempts.get(url) ?? 0) + 1;
        state.attempts.set(url, attempt);
        return Effect.ensuring(
          handler(url, attempt),
          Effect.sync(() => {
            state.inFlight -= 1;
          }),
        );
      }),
  });
  return {
    state,
    layer: Layer.merge(
      inspector,
      Layer.succeed(ReviewedScope, { hosts: scope }),
    ),
  };
}

const success = (url) => Effect.succeed(reportFor(url));

async function execute({ targets, handler = success, scope = hosts, timeout }) {
  const scripted = provider(handler, scope);
  const result = await Effect.runPromise(
    Effect.result(
      runBatch({ contract: 1, targets }, { timeout, backoff: "1 millis" }).pipe(
        Effect.provide(scripted.layer),
      ),
    ),
  );
  return { result, observed: scripted.state };
}

const attemptsOf = (observed, targets) =>
  Object.fromEntries(
    targets.map((url) => [url, observed.attempts.get(url) ?? 0]),
  );

function basePhases(targets) {
  return [
    {
      id: "validate",
      title: "Request validated",
      detail: `Contract 1 decoded with a Schema; ${targets.length} target${targets.length === 1 ? "" : "s"} accepted and the request stayed inside the ${MAX_TARGETS}-target limit.`,
      state: "pass",
      reads: 0,
    },
    {
      id: "authorise",
      title: "Reviewed hosts checked",
      detail: `Every hostname was compared with the reviewed public list before any read.`,
      state: "pass",
      reads: 0,
    },
    {
      id: "deduplicate",
      title: "Duplicate pages rejected",
      detail: `Each page identity was compared after normalising the URL, including share-revision queries.`,
      state: "pass",
      reads: 0,
    },
  ];
}

function inspectionPhase(observed) {
  return {
    id: "inspect",
    title: `${observed.peak} in flight, ${BATCH_CONCURRENCY} allowed`,
    detail: `The runner started ${observed.calls} read${observed.calls === 1 ? "" : "s"} and never exceeded the concurrency limit of ${BATCH_CONCURRENCY}. Each attempt had its own timeout; interrupt cancelled the transport.`,
    state: "pass",
    reads: observed.calls,
  };
}

function refuse(scenario, { result, observed }) {
  const error = result.failure;
  const phases = basePhases(scenario.request.targets);
  const index = { validate: 0, authorise: 1, deduplicate: 2, inspect: 3 }[
    scenario.blocksAt
  ];
  phases[index] = {
    ...phases[index],
    state: "block",
    detail: error.message,
    code: error._tag,
    blocked: true,
  };
  return {
    ...scenario,
    outcome: {
      kind: "refused",
      code: error._tag,
      message: error.message,
      target: error.target ?? null,
    },
    observed: {
      inspectorCalls: observed.calls,
      peakConcurrency: observed.peak,
      attempts: attemptsOf(observed, scenario.request.targets),
    },
    phases: phases.slice(0, index + 1),
  };
}

function completed(scenario, { result, observed }) {
  const report = result.success;
  const phases = [
    ...basePhases(scenario.request.targets),
    inspectionPhase(observed),
    {
      id: "classify",
      title:
        report.status === "complete"
          ? "Every page read"
          : "Partial evidence kept",
      detail: `${report.totals.verified} verified, ${report.totals.failed} failed, ${report.totals.uncertain} uncertain after ${report.totals.attempts} attempt${report.totals.attempts === 1 ? "" : "s"}. One failure never discards another page's result.`,
      state: report.status === "complete" ? "pass" : "review",
      reads: observed.calls,
    },
    {
      id: "recover",
      title: "Recovery stated",
      detail: report.recovery,
      state: report.status === "complete" ? "pass" : "review",
      reads: observed.calls,
    },
  ];
  const sanitised = {
    status: report.status,
    totals: report.totals,
    recovery: report.recovery,
    limits: report.limits,
    targets: report.targets.map((target) => ({
      target: target.target,
      label: labels[target.target] ?? target.target,
      status: target.status,
      attempts: target.attempts,
      code: target.code,
      message: target.message,
      recovery: target.recovery,
      reconciled: target.reconciled,
      findings: target.findings ?? null,
      images: target.images ?? null,
      bytes: target.bytes ?? null,
    })),
  };
  return {
    ...scenario,
    outcome: { kind: "report", report: sanitised },
    observed: {
      inspectorCalls: observed.calls,
      peakConcurrency: observed.peak,
      attempts: attemptsOf(observed, scenario.request.targets),
    },
    phases,
  };
}

export async function build() {
  const scenarios = [];

  scenarios.push(
    completed(
      {
        id: "ready",
        name: "Three pages, two at a time",
        question:
          "Can one run check a few published pages without hammering the origin?",
        expectation: "completed",
        request: { contract: 1, targets: [share, learn, guestbook] },
        scope: "reviewed",
        blocksAt: null,
        script: "every read succeeds",
      },
      await execute({
        targets: [share, learn, guestbook],
        handler: (url) =>
          Effect.flatMap(Effect.sleep("15 millis"), () => success(url)),
      }),
    ),
  );

  const revoked = hosts.filter((host) => host !== "guestbook.loftwah.com");
  scenarios.push(
    refuse(
      {
        id: "permission",
        name: "A host is revoked",
        question:
          "What happens when the reviewed list no longer includes a page?",
        expectation: "refused",
        request: { contract: 1, targets: [share, guestbook] },
        scope: "guestbook removed from the reviewed list",
        blocksAt: "authorise",
        script: "never called",
      },
      await execute({ targets: [share, guestbook], scope: revoked }),
    ),
  );

  scenarios.push(
    refuse(
      {
        id: "duplicate",
        name: "The same page twice",
        question: "Can a shared revision hide a duplicate target?",
        expectation: "refused",
        request: {
          contract: 1,
          targets: [showcase, showcase + "?share=abcdef0123456789"],
        },
        scope: "reviewed",
        blocksAt: "deduplicate",
        script: "never called",
      },
      await execute({
        targets: [showcase, showcase + "?share=abcdef0123456789"],
      }),
    ),
  );

  scenarios.push(
    completed(
      {
        id: "timeout",
        name: "One origin stops answering",
        question:
          "Does a stalled read hold up the other pages or produce a fake pass?",
        expectation: "completed",
        request: { contract: 1, targets: [share, guestbook, learn] },
        scope: "reviewed",
        blocksAt: null,
        script: "guestbook never answers; each attempt has a 30 ms budget",
      },
      await execute({
        targets: [share, guestbook, learn],
        timeout: "30 millis",
        handler: (url) => (url === guestbook ? Effect.never : success(url)),
      }),
    ),
  );

  scenarios.push(
    completed(
      {
        id: "recovery",
        name: "A temporary failure clears",
        question: "Is a retry allowed, and what does it change in the record?",
        expectation: "completed",
        request: { contract: 1, targets: [share, guestbook] },
        scope: "reviewed",
        blocksAt: null,
        script: "guestbook returns HTTP 503 once, then succeeds",
      },
      await execute({
        targets: [share, guestbook],
        handler: (url, attempt) =>
          url === guestbook && attempt === 1
            ? Effect.fail(
                new FetchFailed({
                  message:
                    "The target returned HTTP 503. That is usually temporary: wait a moment and inspect again.",
                  retryable: true,
                }),
              )
            : success(url),
      }),
    ),
  );

  return {
    contract: 1,
    kind: "effect-batch-trace",
    engine: {
      repository: "https://github.com/loftwah/app-composer-linkcheck",
      module: "src/batch.ts",
      runner: "runBatch",
      tests: "tests/batch.test.mjs",
      effect: "4.0.4",
      node: "22",
      generatedBy: "scripts/effect-demo-fixtures.mjs",
      label:
        "Recorded by executing the batch runner with scripted inspectors. No network request was made and no result is a live inspection.",
      synthetic: true,
    },
    limits: {
      targets: MAX_TARGETS,
      concurrency: BATCH_CONCURRENCY,
      attemptsPerTarget: ATTEMPTS_PER_TARGET,
      retry: "read-only transport failures only",
      persisted: false,
    },
    scenarios,
  };
}

export function serialise(fixture) {
  return JSON.stringify(fixture, null, 2) + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? "--write";
  const fixture = await build();
  const text = serialise(fixture);
  if (mode === "--write") {
    writeFileSync(output, text);
    console.log(
      `Wrote ${fixture.scenarios.length} recorded scenarios to ${output}.`,
    );
  } else if (mode === "--check") {
    const committed = readFileSync(output, "utf8");
    if (committed !== text)
      throw Error(
        "The committed trace does not match the batch runner. Run node scripts/effect-demo-fixtures.mjs --write.",
      );
    console.log(
      `Committed trace matches ${fixture.scenarios.length} executed scenarios.`,
    );
  } else {
    process.stdout.write(text);
  }
}
