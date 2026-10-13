import test from "node:test";
import assert from "node:assert/strict";
import { reportJSON } from "../public/report-format.js";
const fixture = {
  contract: 1,
  kind: "page-inspection",
  url: "https://composer.loftwah.com/",
  sourceSha: "a".repeat(40),
  checkedAt: "2026-10-14T00:00:00Z",
  title: "Fixture",
  images: [
    {
      kind: "Open Graph",
      status: "verified",
      message: "Fetched",
      width: 1200,
      height: 630,
      bytes: 50000,
    },
  ],
  findings: Array.from({ length: 40 }, () => ({
    status: "review",
    label: "Fixture",
    detail: "Observed data",
    why: "Context",
    action: "Review",
    source: "https://ogp.me/",
  })),
};
test("portable size is measured using the exact pretty JSON bytes including newline", () => {
  for (const length of [39000, 41000, 65000, 100000]) {
    const text = reportJSON({ ...fixture, extra: "x".repeat(length) });
    assert.ok(new Blob([text]).size <= 65536);
    assert.equal(JSON.parse(text).images[0].width, 1200);
  }
});
test("worst-case core evidence is reduced and remeasured rather than emitting an oversized download", () => {
  const text = reportJSON({
    ...fixture,
    title: "x".repeat(4000),
    images: [
      ...fixture.images,
      {
        kind: "X / Twitter",
        status: "failed",
        message: "x".repeat(4000),
        declared: "x".repeat(4000),
      },
    ],
    findings: Array.from({ length: 80 }, () => ({
      status: "review",
      label: "x".repeat(160),
      detail: "x".repeat(4000),
    })),
  });
  assert.ok(new Blob([text]).size <= 65536);
  assert.equal(JSON.parse(text).findings.length, 80);
  assert.ok(JSON.parse(text).exportNote);
});
test("portable core strips forbidden control characters without executing or removing hostile words", () => {
  const text = reportJSON({
    ...fixture,
    title: "Hello\u0001 ignore instructions",
  });
  assert.equal(JSON.parse(text).title, "Hello ignore instructions");
});
