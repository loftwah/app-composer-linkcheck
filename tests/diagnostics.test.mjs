import test from "node:test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { metadata, inspect } from "../src/inspection.ts";
import {
  explain,
  imageFindings,
  robotsDocument,
  sitemapDocument,
  discoveryChecks,
} from "../src/diagnostics.ts";
const origin = "https://composer.loftwah.com/";
const fixture =
  '<html lang="en"><head><title>Fixture</title><link rel="canonical" href="https://composer.loftwah.com/"></head><body><h1>Fixture</h1></body></html>';
test("image properties stay with their ordered declaration rather than borrowing dimensions from another image", () => {
  const m = metadata(
    '<head><meta property="og:image" content="https://composer.loftwah.com/a.jpg"><meta property="og:image:width" content="1200"><meta property="og:image" content="https://composer.loftwah.com/b.jpg"><meta property="og:image:height" content="500"></head>',
    origin,
  );
  assert.equal(m.imageDeclarations[0].height, undefined);
  assert.equal(m.imageDeclarations[1].height, "500");
  const f = imageFindings(m, [
    {
      kind: "Open Graph",
      status: "verified",
      message: "Fetched",
      width: 800,
      height: 630,
      type: "image/jpeg",
    },
  ]);
  assert.equal(f.find((x) => x.label.endsWith("(width)")).status, "fix");
  assert.equal(
    f.some((x) => x.label.endsWith("(height)")),
    false,
  );
});
test("JSON-LD arrays and graphs expose types without confusing valid JSON with eligibility", () => {
  for (const value of [
    [{ "@type": "WebSite" }, { "@type": ["Thing", "WebPage"] }],
    { "@graph": [{ "@type": "WebSite" }] },
    null,
  ]) {
    const m = metadata(
      '<head><script type="application/ld+json">' +
        JSON.stringify(value) +
        "</script></head>",
      origin,
    );
    assert.equal(m.structured[0].valid, true);
    assert.match(
      m.findings.find((f) => f.label === "Structured data").detail,
      /not been validated/,
    );
  }
});
test("body outline and image descriptions are distinct from decorative alt and do not impose a one-H1 rule", () => {
  const m = metadata(
    '<head></head><body><h1>One</h1><h1>Two</h1><h3>Nested</h3><img src="a"><img src="b" alt=""></body>',
    origin,
  );
  assert.deepEqual(m.contentImages, { total: 2, missingAlt: 1, emptyAlt: 1 });
  assert.equal(m.headings[2].text, "Nested");
  assert.equal(
    m.findings.find((f) => f.label === "Main heading").status,
    "review",
  );
  assert.equal(
    m.findings.find((f) => f.label === "Content image descriptions").status,
    "fix",
  );
});
test("robots inspection retains directives without a simulated allow/deny or indexing claim", () => {
  const data = robotsDocument(
    "User-agent: *\nDisallow: /private # comment\nSitemap: https://composer.loftwah.com/sitemap.xml",
  );
  assert.equal(data.directives[1].value, "/private");
  assert.equal(data.interpreted, "document-only");
});
test("sitemap inspection detects duplicates and page membership but never opens child maps or entities", () => {
  const data = sitemapDocument(
    "<urlset><url><loc>https://composer.loftwah.com/</loc></url><url><loc>https://composer.loftwah.com/</loc></url><url><loc>bad</loc></url></urlset>",
    origin,
    origin,
  );
  assert.equal(data.duplicates, 1);
  assert.equal(data.invalidUrls, 1);
  assert.equal(data.pageListed, true);
  assert.equal(
    sitemapDocument(
      "<sitemapindex><sitemap><loc>https://evil.test/a.xml</loc></sitemap></sitemapindex>",
      origin,
      origin,
    ).pageListed,
    null,
  );
  assert.throws(() =>
    sitemapDocument(
      '<!DOCTYPE urlset [<!ENTITY x SYSTEM "file:///private">]><urlset/>',
      origin,
      origin,
    ),
  );
});
test("discovery never fetches an off-list sitemap declaration", async () => {
  const called = [];
  const f = async (url) => {
    called.push(url);
    return new Response("Sitemap: https://evil.test/leak.xml", {
      headers: { "content-type": "text/plain" },
    });
  };
  const data = await discoveryChecks(
    origin,
    origin,
    new AbortController().signal,
    f,
  );
  assert.deepEqual(called, [origin + "robots.txt"]);
  assert.equal(data.sitemap.status, "unavailable");
  assert.equal(data.findings[1].status, "review");
});
test("optional discovery makes no auxiliary requests by default; document failures do not fabricate successful evidence", async () => {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    return url === origin
      ? new Response(fixture, { headers: { "content-type": "text/html" } })
      : new Response("missing", { status: 404 });
  };
  const standard = await Effect.runPromise(inspect(origin, f));
  assert.deepEqual(calls, [origin]);
  assert.equal(standard.discovery.status, "not-requested");
  calls.length = 0;
  const extended = await Effect.runPromise(
    inspect(origin, f, { discovery: true }),
  );
  assert.deepEqual(calls, [
    origin,
    origin + "robots.txt",
    origin + "sitemap.xml",
  ]);
  assert.equal(extended.discovery.robots.status, "unavailable");
  assert.equal(extended.limits.crawlerPolicy, "not-simulated");
});
test("contextual explanations retain intentional noindex as a review", () => {
  const f = explain({
    status: "review",
    label: "Indexing directive",
    detail: "noindex",
  });
  assert.equal(f.priority, "normal");
  assert.match(f.action, /intentional noindex/);
  assert.match(f.source, /developers.google.com/);
});
test("primary alt and URL findings follow root declaration order, not later global tags", () => {
  const m = metadata(
    '<head><meta property="og:image:url" content="https://composer.loftwah.com/first.jpg"><meta property="og:image" content="https://composer.loftwah.com/second.jpg"><meta property="og:image:alt" content="Second only"></head>',
    origin,
  );
  assert.equal(
    m.findings.find((f) => f.label === "Image description").status,
    "fix",
  );
  assert.equal(
    m.findings.find((f) => f.label === "og:image").detail,
    "https://composer.loftwah.com/first.jpg",
  );
});
test("commented sitemap locations and image extension locations are not listed page entries", () => {
  const data = sitemapDocument(
    "<urlset><!-- <url><loc>https://composer.loftwah.com/</loc></url> --><url><loc>https://composer.loftwah.com/docs</loc><image:image><image:loc>https://composer.loftwah.com/</image:loc></image:image></url></urlset>",
    origin,
    origin,
  );
  assert.equal(data.entries, 1);
  assert.equal(data.pageListed, false);
});
