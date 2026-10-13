import test from "node:test";
import assert from "node:assert/strict";
import { metadata } from "../src/inspection.ts";
const html = `<!doctype html><html lang="en"><head><title>A &amp; B</title><meta name="description" content="A useful page"><link rel="canonical" href="https://composer.loftwah.com/"><meta property="og:title" content="One"><meta property="og:type" content="website"><meta property="og:url" content="https://composer.loftwah.com/"><meta property="og:image" content="https://composer.loftwah.com/first.png"><meta property="og:image:alt" content="One image"><meta property="og:image" content="https://composer.loftwah.com/second.png"><meta name="viewport" content="width=device-width"><script type="application/ld+json">{"@type":"WebSite"}</script></head><body><h1>Hello</h1><meta property="og:title" content="Ignore body injection"></body></html>`;
test("head metadata decodes entities, preserves image order and ignores body tags", () => {
  const data = metadata(html, "https://composer.loftwah.com/");
  assert.equal(data.title, "A & B");
  assert.deepEqual(data.tags["og:title"], ["One"]);
  assert.equal(
    data.tags["og:image"][0],
    "https://composer.loftwah.com/first.png",
  );
  assert.equal(
    data.findings.some((f) => f.label === "Repeated og:image"),
    false,
  );
  assert.equal(data.structured[0].valid, true);
});
test("missing, conflicting and noindex data produces specific findings without indexing claims", () => {
  const data = metadata(
    '<html><head><title>One</title><title>Two</title><meta name="description" content="First"><meta name="description" content="Second"><script type="application/ld+json">bad</script></head><body><h1>One</h1><h1>Two</h1></body></html>',
    "https://composer.loftwah.com/",
    "noindex",
  );
  assert.equal(
    data.findings.find((f) => f.label === "Page title").status,
    "fix",
  );
  assert.equal(
    data.findings.find((f) => f.label === "Repeated description").status,
    "review",
  );
  assert.equal(
    data.findings.find((f) => f.label === "Indexing directive").status,
    "review",
  );
  assert.equal(
    data.findings.find((f) => f.label === "Structured data").status,
    "fix",
  );
});
test("more restrictive repeated and Googlebot directives never produce an indexing pass", () => {
  for (const head of [
    '<meta name="robots" content="index"><meta name="robots" content="noindex">',
    '<meta name="robots" content="index"><meta name="googlebot" content="noindex">',
  ]) {
    const data = metadata(
      "<html><head>" + head + "</head></html>",
      "https://composer.loftwah.com/",
    );
    assert.equal(
      data.findings.find((f) => f.label === "Indexing directive").status,
      "review",
    );
  }
});
test("the official og:image:url alias is accepted consistently", () => {
  const data = metadata(
    '<html><head><meta property="og:image:url" content="https://composer.loftwah.com/image.png"></head></html>',
    "https://composer.loftwah.com/",
  );
  assert.equal(
    data.findings.find((f) => f.label === "og:image").status,
    "pass",
  );
});

test("equivalent origin canonicals avoid false duplicate warnings while distinct paths and malformed URLs remain findings", () => {
  const input = (canonical) =>
    html.replace('href="https://composer.loftwah.com/"', `href="${canonical}"`);
  const equivalent = metadata(
    input("https://COMPOSER.loftwah.com:443"),
    "https://composer.loftwah.com/",
  );
  assert.equal(
    equivalent.findings.some((f) => f.label === "Canonical destination"),
    false,
  );
  const distinct = metadata(
    input("https://composer.loftwah.com/apps"),
    "https://composer.loftwah.com/",
  );
  assert.equal(
    distinct.findings.some((f) => f.label === "Canonical destination"),
    true,
  );
  const malformed = metadata(
    input("https://"),
    "https://composer.loftwah.com/",
  );
  assert.equal(
    malformed.findings.find((f) => f.label === "Canonical URL").status,
    "fix",
  );
});
