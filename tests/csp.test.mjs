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
