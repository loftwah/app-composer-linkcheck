import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.ts";
const env = {
  ASSETS: {
    fetch: async () =>
      new Response("<html><head></head><body>Fixture</body></html>", {
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "public,max-age=3600",
        },
      }),
  },
};
test("HTML CSP gives existing Cloudflare detections fresh nonces without arbitrary inline script permission", async () => {
  const a = await worker.fetch(new Request("https://share.loftwah.com/"), env),
    b = await worker.fetch(new Request("https://share.loftwah.com/"), env);
  const ac = a.headers.get("content-security-policy"),
    bc = b.headers.get("content-security-policy");
  assert.notEqual(ac.match(/nonce-([^']+)/)[1], bc.match(/nonce-([^']+)/)[1]);
  assert.doesNotMatch(ac, /unsafe-inline/);
  assert.match(ac, /https:\/\/static.cloudflareinsights.com\/beacon.min.js/);
  assert.match(ac, /connect-src 'self';/);
  assert.match(ac, /object-src 'none'/);
  assert.equal(a.headers.get("cache-control"), "private, no-store");
});

test("film byte ranges preserve the security wrapper and normal routes", async () => {
  const path = "/brand/icon-inspection-motion.mp4";
  const source = "0123456789";
  const seen = [];
  const fixture = {
    ASSETS: {
      fetch: async (request) => {
        seen.push(new URL(request.url).pathname);
        if (request.headers.get("if-none-match") === '"fixture"')
          return new Response(null, {
            status: 304,
            headers: { etag: '"fixture"' },
          });
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode(source));
              c.close();
            },
          }),
          {
            headers: {
              "content-type": "video/mp4",
              etag: '"fixture"',
              "cache-control": "public, max-age=60",
            },
          },
        );
      },
    },
  };
  const get = (p, headers = {}) =>
    worker.fetch(
      new Request(`https://share.loftwah.com${p}`, { headers }),
      fixture,
    );
  for (const [range, expected, contentRange] of [
    ["bytes=2-4", "234", "bytes 2-4/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
  ]) {
    const r = await get(path, { range });
    assert.equal(r.status, 206);
    assert.equal(await r.text(), expected);
    assert.equal(r.headers.get("content-range"), contentRange);
    assert.equal(r.headers.get("content-length"), String(expected.length));
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.match(r.headers.get("content-security-policy"), /object-src 'none'/);
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  }
  const invalid = await get(path, { range: "bytes=99-" });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), "bytes */10");
  assert.equal(invalid.headers.get("x-content-type-options"), "nosniff");
  const old = await get(path, { range: "bytes=0-2", "if-range": '"old"' });
  assert.equal(old.status, 200);
  assert.equal(await old.text(), source);
  const same = await get(path, { range: "bytes=0-2", "if-range": '"fixture"' });
  assert.equal(same.status, 206);
  assert.equal(await same.text(), "012");
  const unchanged = await get(path, {
    range: "bytes=0-2",
    "if-none-match": '"fixture"',
  });
  assert.equal(unchanged.status, 304);
  const full = await get(path);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), source);
  const other = await get("/brand/other.mp4", { range: "bytes=0-1" });
  assert.equal(other.status, 200);
  assert.equal(await other.text(), source);
  assert.ok(seen.includes("/brand/other.mp4"));
  const head = await worker.fetch(
    new Request(`https://share.loftwah.com${path}`, { method: "HEAD" }),
    fixture,
  );
  assert.equal(head.status, 405);
});

test("film range refuses a lengthless asset stream beyond its bound", async () => {
  const env = {
    ASSETS: {
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
              c.close();
            },
          }),
        ),
    },
  };
  const response = await worker.fetch(
    new Request("https://share.loftwah.com/brand/icon-inspection-motion.mp4", {
      headers: { range: "bytes=0-2" },
    }),
    env,
  );
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    response.headers.get("content-security-policy"),
    /object-src 'none'/,
  );
});
