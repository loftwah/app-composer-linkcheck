import test from "node:test";
import assert from "node:assert/strict";
import { metadata, identityAssets } from "../src/inspection.ts";
const signal = () => new AbortController().signal;
test("head icon declarations resolve safely and bounded SVG text is not executed", async () => {
  const meta = metadata(
    '<html><head><link rel="shortcut icon" href="/icon.svg"><meta name="theme-color" content="#17181b"></head><body><link rel="icon" href="https://evil.test/x"></body></html>',
    "https://composer.loftwah.com/",
  );
  assert.equal(meta.icons.length, 1);
  let calls = 0;
  const result = await identityAssets(
    meta,
    "https://composer.loftwah.com/",
    signal(),
    async (url) => {
      calls++;
      assert.equal(url, "https://composer.loftwah.com/icon.svg");
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M0 0"/></svg>',
        { headers: { "content-type": "image/svg+xml" } },
      );
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.icons[0].width, 32);
  assert.equal(result.icons[0].status, "verified");
  assert.match(result.icons[0].message, /not executed/);
});
test("disallowed icon hosts do not fetch; active SVG and failed manifests stay failed", async () => {
  let calls = 0;
  const meta = metadata(
    '<head><link rel="icon" href="https://evil.test/x"><link rel="manifest" href="/site.webmanifest"></head>',
    "https://composer.loftwah.com/",
  );
  const result = await identityAssets(
    meta,
    "https://composer.loftwah.com/",
    signal(),
    async () => {
      calls++;
      return new Response("bad", {
        headers: { "content-type": "application/json" },
      });
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.icons[0].status, "failed");
  assert.equal(result.manifest.status, "failed");
  const svg = await identityAssets(
    metadata(
      '<head><link rel="icon" href="/icon.svg"></head>',
      "https://composer.loftwah.com/",
    ),
    "https://composer.loftwah.com/",
    signal(),
    async () =>
      new Response("<svg><script>doBad()</script></svg>", {
        headers: { "content-type": "image/svg+xml" },
      }),
  );
  assert.equal(svg.icons[0].status, "failed");
});
test("manifest JSON is reported without assuming installation or fetching declared nested icons", async () => {
  let calls = 0;
  const meta = metadata(
    '<head><link rel="manifest" href="/site.webmanifest"></head>',
    "https://composer.loftwah.com/",
  );
  const result = await identityAssets(
    meta,
    "https://composer.loftwah.com/",
    signal(),
    async () => {
      calls++;
      return new Response(
        JSON.stringify({
          name: "Fixture",
          display: "standalone",
          icons: [{ src: "https://evil.test/icon" }],
        }),
        { headers: { "content-type": "application/manifest+json" } },
      );
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.manifest.status, "verified");
  assert.match(
    result.findings.find((f) => f.label === "Web app manifest").detail,
    /not verified/,
  );
});
