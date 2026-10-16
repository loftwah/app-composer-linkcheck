import test from "node:test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { boundedFetch, target, inspect } from "../src/inspection.ts";
const signal = () => new AbortController().signal;
test("credentials, private/encoded paths, IPs, arbitrary hosts and query secrets are rejected before fetch", async () => {
  for (const value of [
    "http://composer.loftwah.com/",
    "https://127.0.0.1/",
    "https://composer.loftwah.com.evil.test/",
    "https://u:p@composer.loftwah.com/",
    "https://composer.loftwah.com/_emdash/admin",
    "https://composer.loftwah.com/guestbook/api/private",
    "https://composer.loftwah.com/%61pi/secret",
    "https://composer.loftwah.com/?key=secret",
    "https://composer.loftwah.com:444/",
  ])
    assert.throws(() => target(value));
  let calls = 0;
  await assert.rejects(
    boundedFetch("https://evil.test/", 30, signal(), async () => {
      calls++;
      return new Response("x");
    }),
  );
  assert.equal(calls, 0);
});
test("every redirect is validated without credentials or following a disallowed destination", async () => {
  let calls = 0;
  await assert.rejects(
    boundedFetch(
      "https://composer.loftwah.com/",
      30,
      signal(),
      async (url, init) => {
        calls++;
        assert.equal(init.redirect, "manual");
        assert.equal(init.headers.Authorization, undefined);
        return new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/private" },
        });
      },
    ),
  );
  assert.equal(calls, 1);
});
test("announced and streamed oversized bodies stop inspection", async () => {
  for (const headers of [{}, { "content-length": "100" }])
    await assert.rejects(
      boundedFetch(
        "https://composer.loftwah.com/",
        3,
        signal(),
        async () => new Response("oversize", { headers }),
      ),
      (error) => error._tag === "TooLarge",
    );
});
test("actual bytes determine dimensions; different X and OG assets remain separate and image failure remains explicit", async () => {
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9f8AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const urls = [];
  const fetcher = async (url) => {
    urls.push(String(url));
    if (String(url).endsWith("og.png"))
      return new Response(png, { headers: { "content-type": "image/png" } });
    if (String(url).endsWith("x.png"))
      return new Response("<html>wrong</html>", {
        headers: { "content-type": "text/html" },
      });
    return new Response(
      '<html lang="en"><head><title>Fixture</title><meta property="og:image" content="https://composer.loftwah.com/og.png"><meta name="twitter:image" content="https://composer.loftwah.com/x.png"></head><body><h1>Fixture</h1></body></html>',
      { headers: { "content-type": "text/html" } },
    );
  };
  const report = await Effect.runPromise(
    inspect("https://composer.loftwah.com/", fetcher),
  );
  assert.equal(report.images[0].width, 1);
  assert.equal(report.images[0].status, "verified");
  assert.equal(report.images[1].status, "failed");
  assert.equal(urls.length, 3);
  assert.equal(report.limits.platformUnfurl, "not-verified");
});
test("effect returns typed network failure without provider bodies", async () => {
  const result = await Effect.runPromise(
    inspect("https://composer.loftwah.com/", async () => {
      throw new Error("secret provider details");
    }).pipe(
      Effect.match({
        onSuccess: () => null,
        onFailure: (e) => ({ kind: e._tag, message: e.message }),
      }),
    ),
  );
  assert.equal(result.kind, "FetchFailed");
  assert.doesNotMatch(result.message, /secret/);
});

 test("only the bounded public share revision query is accepted",async()=>{
  const accepted="https://composer.loftwah.com/showcase/?share=abcdef0123456789";assert.equal(target(accepted).href,accepted);
  for(const query of ["?share=secret","?share=abcdef0123456789&token=secret","?share=abcdef0123456789&share=abcdef0123456789","?share=abcdef0123456789abcdef","?share=%61bcdef0123456789"])assert.throws(()=>target("https://composer.loftwah.com/"+query));
  assert.throws(()=>target("https://composer.loftwah.com/api/private?share=abcdef0123456789"));
 });
