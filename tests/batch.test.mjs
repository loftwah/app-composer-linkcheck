import test from "node:test";
import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import {
  BATCH_CONCURRENCY,
  MAX_TARGETS,
  Inspector,
  ReviewedScope,
  admitTargets,
  batchHttp,
  parseBatchRequest,
  runBatch,
  toHttp,
} from "../src/batch.ts";
import { FetchFailed, hosts, inspect } from "../src/inspection.ts";
import worker from "../src/worker.ts";

const share = "https://share.loftwah.com/";
const composer = "https://composer.loftwah.com/learn";
const guestbook = "https://guestbook.loftwah.com/";

// A scripted provider: deterministic outcomes, real Effect concurrency and
// interruption. Nothing here opens a network connection.
function provider(handler, scope = hosts) {
  const state = {
    calls: 0,
    inFlight: 0,
    peak: 0,
    order: [],
    attempts: new Map(),
  };
  const inspector = Layer.succeed(Inspector, {
    inspect: (url) =>
      Effect.suspend(() => {
        state.calls += 1;
        state.inFlight += 1;
        state.peak = Math.max(state.peak, state.inFlight);
        state.order.push(url);
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

const report = (url, findings = ["pass", "fix", "review"]) => ({
  url,
  htmlBytes: 4096,
  findings: findings.map((status) => ({ status })),
  images: [{ status: "verified" }, { status: "failed" }],
});

const ok = (url) => Effect.succeed(report(url));

function run(body, options) {
  const scripted = options?.provider ?? provider(ok);
  return Effect.runPromise(
    Effect.result(
      runBatch(body, { backoff: "1 millis", ...options?.run }).pipe(
        Effect.provide(scripted.layer),
      ),
    ),
  ).then((result) => ({ result, state: scripted.state }));
}

const request = (...targets) => ({ contract: 1, targets });

test("malformed, oversized, empty and over-limit requests are refused before any read", async () => {
  const cases = [
    ["not json", "Send a JSON object"],
    [JSON.stringify({ contract: 2, targets: [share] }), "Use contract 1"],
    [JSON.stringify({ contract: 1, targets: [] }), "Add at least one target"],
    [
      JSON.stringify({
        contract: 1,
        targets: [share, composer, guestbook, share, guestbook],
      }),
      `at most ${MAX_TARGETS} targets`,
    ],
    [JSON.stringify({ contract: 1, targets: [42] }), "Use contract 1"],
    ["x".repeat(8 * 1024 + 1), "under 8 KiB"],
  ];
  for (const [body, expected] of cases) {
    const { result, state } = await run(body);
    assert.equal(result._tag, "Failure", body);
    assert.equal(result.failure._tag, "InvalidBatch", body);
    assert.match(result.failure.message, new RegExp(expected), body);
    assert.equal(state.calls, 0, body);
  }
});

test("the live HTTP composition refuses a malformed body without touching the network", async () => {
  const response = await Effect.runPromise(batchHttp('{"contract":1}'));
  assert.equal(response.status, 400);
  assert.equal(response.body.kind, "InvalidBatch");
});

test("a revoked host is 403 and stops the whole batch before the first fetch", async () => {
  const reviewed = hosts.filter((host) => host !== "guestbook.loftwah.com");
  const { result, state } = await run(request(share, guestbook), {
    provider: provider(ok, reviewed),
  });
  assert.equal(result._tag, "Failure");
  assert.equal(result.failure._tag, "TargetNotPermitted");
  assert.equal(result.failure.target, guestbook);
  assert.equal(state.calls, 0);
  const refused = await Effect.runPromise(
    toHttp(
      runBatch(request(share, guestbook)).pipe(
        Effect.provide(provider(ok, reviewed).layer),
      ),
    ),
  );
  assert.equal(refused.status, 403);
});

test("the scope may narrow the reviewed list but never widen it", async () => {
  const widened = [...hosts, "example.com"];
  const { result, state } = await run(request("https://example.com/page"), {
    provider: provider(ok, widened),
  });
  assert.equal(result._tag, "Failure");
  assert.equal(result.failure._tag, "TargetNotPermitted");
  assert.equal(state.calls, 0);
});

test("exact and normalised duplicates are refused, including a share revision of one page", async () => {
  for (const targets of [
    [share, share],
    [
      "https://composer.loftwah.com/showcase/",
      "https://composer.loftwah.com/showcase/?share=abcdef0123456789",
    ],
  ]) {
    const { result, state } = await run(request(...targets));
    assert.equal(result._tag, "Failure");
    assert.equal(result.failure._tag, "DuplicateTarget");
    assert.equal(result.failure.firstIndex, 0);
    assert.equal(result.failure.index, 1);
    assert.equal(state.calls, 0);
  }
});

test("a permitted batch preserves request order and holds its concurrency limit", async () => {
  const { result, state } = await run(request(share, composer, guestbook), {
    provider: provider((url) =>
      Effect.flatMap(Effect.sleep("15 millis"), () => ok(url)),
    ),
  });
  assert.equal(result._tag, "Success");
  const batch = result.success;
  assert.equal(batch.status, "complete");
  assert.equal(batch.totals.verified, 3);
  assert.equal(batch.totals.attempts, 3);
  assert.deepEqual(
    batch.targets.map((target) => target.target),
    [share, composer, guestbook],
  );
  assert.equal(batch.targets[0].findings.fix, 1);
  assert.equal(batch.targets[0].images.verified, 1);
  assert.equal(batch.limits.concurrency, BATCH_CONCURRENCY);
  assert.equal(batch.limits.persisted, false);
  assert.equal(state.peak, BATCH_CONCURRENCY);
  assert.equal(state.calls, 3);
});

test("one transient read failure is reconciled once; a permanent one is not retried", async () => {
  const { result: transient } = await run(request(share), {
    provider: provider((url, attempt) =>
      attempt === 1
        ? Effect.fail(
            new FetchFailed({
              message: "HTTP 503. Usually temporary.",
              retryable: true,
            }),
          )
        : ok(url),
    ),
  });
  assert.equal(transient._tag, "Success");
  assert.equal(transient.success.status, "complete");
  assert.equal(transient.success.targets[0].attempts, 2);
  assert.equal(transient.success.targets[0].reconciled, true);
  assert.match(
    transient.success.targets[0].recovery,
    /earlier attempt is not evidence/,
  );

  const permanentProvider = provider(() =>
    Effect.fail(
      new FetchFailed({
        message: "HTTP 404. Check the address.",
        retryable: false,
      }),
    ),
  );
  const { result: permanent } = await run(request(share), {
    provider: permanentProvider,
  });
  assert.equal(permanent._tag, "Success");
  assert.equal(permanent.success.status, "failed");
  assert.equal(permanent.success.targets[0].status, "failed");
  assert.equal(permanent.success.targets[0].attempts, 1);
  assert.equal(permanentProvider.state.calls, 1);
  assert.equal(permanent.success.targets[0].code, "FetchFailed");
});

test("an attempt that never answers becomes uncertain after the budget, and the batch reports partial evidence", async () => {
  const { result, state } = await run(request(share, guestbook), {
    provider: provider((url) => (url === guestbook ? Effect.never : ok(url))),
    run: { timeout: "20 millis" },
  });
  assert.equal(result._tag, "Success");
  const batch = result.success;
  assert.equal(batch.status, "partial");
  assert.equal(batch.totals.verified, 1);
  assert.equal(batch.totals.uncertain, 1);
  assert.equal(batch.targets[1].status, "uncertain");
  assert.equal(batch.targets[1].code, "AttemptTimeout");
  assert.equal(batch.targets[1].attempts, 2);
  assert.match(batch.targets[1].recovery, /Run the batch again/);
  assert.match(batch.recovery, /Re-run the batch/);
  assert.equal(state.attempts.get(guestbook), 2);
});

test("a provider defect is classified without echoing its text", async () => {
  const { result } = await run(request(share), {
    provider: provider(() => Effect.die(new Error("token=super-secret"))),
  });
  assert.equal(result._tag, "Success");
  const outcome = result.success.targets[0];
  assert.equal(outcome.status, "uncertain");
  assert.equal(outcome.code, "UnreadableResult");
  assert.doesNotMatch(JSON.stringify(result.success), /super-secret/);
  assert.doesNotMatch(outcome.message, /Error|token/);
});

test("interrupting the batch aborts the real fetch signal of in-flight reads", async () => {
  let aborted = 0;
  let started = 0;
  // The Effect timeout and interruption must reach the transport, not just
  // abandon a promise in memory.
  const fetcher = (_url, init) => {
    started += 1;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted += 1;
        reject(new Error("aborted"));
      });
    });
  };
  const scripted = provider((url) =>
    inspect(url, fetcher, { timeout: "30 seconds" }),
  );
  const outcome = await Effect.runPromise(
    Effect.result(
      Effect.timeout(
        runBatch(request(share, composer)).pipe(Effect.provide(scripted.layer)),
        "40 millis",
      ),
    ),
  );
  assert.equal(outcome._tag, "Failure");
  assert.ok(started >= 1, "a read started before the interrupt");
  assert.ok(
    aborted >= 1,
    "at least one in-flight fetch observed its abort signal",
  );
  assert.ok(
    aborted <= BATCH_CONCURRENCY,
    "no more reads than the concurrency limit started",
  );
});

test("parse and admit are separate, testable steps", async () => {
  const parsed = await Effect.runPromise(
    parseBatchRequest(JSON.stringify(request(share))),
  );
  assert.deepEqual(parsed, { contract: 1, targets: [share] });
  const admitted = await Effect.runPromise(
    admitTargets(parsed).pipe(
      Effect.provide(Layer.succeed(ReviewedScope, { hosts })),
    ),
  );
  assert.equal(admitted.length, 1);
  assert.equal(admitted[0].identity, "https://share.loftwah.com/");
});

test("the report is stable for identical inputs apart from its timestamps", async () => {
  const first = await run(request(share, composer));
  const second = await run(request(share, composer));
  const strip = (value) => ({ ...value, startedAt: "", checkedAt: "" });
  assert.deepEqual(strip(first.result.success), strip(second.result.success));
  assert.match(first.result.success.startedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("the Worker route admits methods, capacity and bodies before any inspection", async () => {
  const origin = "https://share.loftwah.com";
  const env = (success = true) => ({
    ASSETS: { fetch: async () => new Response("asset") },
    INSPECTION_LIMIT: { limit: async () => ({ success }) },
  });
  const send = (body, init = {}) =>
    worker.fetch(
      new Request(origin + "/api/inspect-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...init,
        body,
      }),
      env(),
    );
  const get = await worker.fetch(
    new Request(origin + "/api/inspect-batch"),
    env(),
  );
  assert.equal(get.status, 405);
  const wrongType = await send("{}", {
    headers: { "content-type": "text/plain" },
  });
  assert.equal(wrongType.status, 400);
  const empty = await send(JSON.stringify({ contract: 1, targets: [] }));
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).kind, "InvalidBatch");
  const tooLarge = await send("x".repeat(8 * 1024 + 1));
  assert.equal(tooLarge.status, 400);
  const crowded = await worker.fetch(
    new Request(origin + "/api/inspect-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request(share)),
    }),
    env(false),
  );
  assert.equal(crowded.status, 429);
});
