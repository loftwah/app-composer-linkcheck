import test from "node:test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import {
  INSPECTION_TIMEOUT,
  FetchFailed,
  boundedFetch,
  inspect,
} from "../src/inspection.ts";

const pageUrl = "https://composer.loftwah.com/learn";
const html = (body = "<h1>Fixture</h1>") =>
  new Response(
    `<html lang="en"><head><title>Fixture</title></head><body>${body}</body></html>`,
    {
      headers: { "content-type": "text/html" },
    },
  );

test("the declared whole-inspection budget stays the documented default", () => {
  assert.equal(String(INSPECTION_TIMEOUT), "12 seconds");
});

test("the timeout is a typed failure and interrupts the real fetch signal", async () => {
  let aborted = false;
  let started = 0;
  const hanging = (_url, init) => {
    started += 1;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("socket closed"));
      });
    });
  };
  const began = Date.now();
  const result = await Effect.runPromise(
    Effect.result(inspect(pageUrl, hanging, { timeout: "40 millis" })),
  );
  const elapsed = Date.now() - began;
  assert.equal(started, 1);
  assert.equal(result._tag, "Failure");
  assert.ok(result.failure instanceof FetchFailed, "typed FetchFailed");
  assert.equal(result.failure.retryable, true);
  assert.match(
    result.failure.message,
    /timed out[\s\S]*Retry when the origin responds/i,
  );
  assert.doesNotMatch(result.failure.message, /socket closed/);
  assert.equal(aborted, true, "the transport observed the interruption");
  assert.ok(elapsed < 5000, `timeout returned promptly (${elapsed}ms)`);
});

test("only a read that may answer differently is marked retryable", async () => {
  const cases = [
    [404, false, /inspect a page that exists/i],
    [429, true, /temporary/i],
    [503, true, /temporary/i],
    [403, false, /inspect again/i],
  ];
  for (const [status, retryable, expected] of cases) {
    await assert.rejects(
      boundedFetch(
        pageUrl,
        1024,
        new AbortController().signal,
        async () => new Response(null, { status }),
      ),
      (error) => {
        assert.equal(error._tag, "FetchFailed", String(status));
        assert.equal(error.retryable, retryable, String(status));
        assert.match(error.message, expected, String(status));
        return true;
      },
    );
  }
  await assert.rejects(
    boundedFetch(
      pageUrl,
      3,
      new AbortController().signal,
      async () => new Response("oversize"),
    ),
    (error) => {
      assert.equal(error._tag, "TooLarge");
      assert.equal(
        "retryable" in error,
        false,
        "permanent failures carry no retry flag",
      );
      return true;
    },
  );
});

test("a complete read under an explicit budget still returns the report", async () => {
  const report = await Effect.runPromise(
    inspect(pageUrl, async () => html(), { timeout: "2 seconds" }),
  );
  assert.equal(report.url, pageUrl);
  assert.equal(report.limits.searchIndex, "not-verified");
  assert.equal(report.limits.renderedJavascript, "not-executed");
  assert.equal(report.contract, 1);
});

test("a fetcher that ignores the abort signal is still interrupted, not awaited", async () => {
  // The transport here never settles and never observes the signal. Effect must
  // still return control; the read is abandoned rather than trusted.
  const stubborn = () => new Promise(() => {});
  const began = Date.now();
  const result = await Effect.runPromise(
    Effect.result(inspect(pageUrl, stubborn, { timeout: "30 millis" })),
  );
  assert.equal(result._tag, "Failure");
  assert.equal(result.failure._tag, "FetchFailed");
  assert.ok(Date.now() - began < 5000);
});
