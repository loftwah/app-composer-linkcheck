import test from "node:test";
import assert from "node:assert/strict";
import { inspectionReport } from "../public/inspection-report.js";
import { validatedReport } from "../public/navigation-draft.js";
import { reportJSON } from "../public/report-format.js";
const fixture = () => ({
  contract: 1,
  kind: "page-inspection",
  url: "https://composer.loftwah.com/",
  sourceSha: "f".repeat(40),
  checkedAt: "2026-10-18T00:00:00Z",
  title: "Fictional <script>text only</script>",
  description: "Fictional report",
  canonical: "/observed-relative-canonical",
  tags: { "og:title": ["Inert observed text"] },
  findings: [
    {
      status: "fix",
      label: "Relative canonical",
      detail: "Observed text is evidence, never code.",
    },
  ],
  images: [],
});
test("renderer accepts raw canonical observations as text while history keeps its stricter URL boundary", () => {
  const report = fixture();
  assert.deepEqual(inspectionReport(report), report);
  assert.equal(validatedReport(report), null);
});
test("large valid reports remain renderable and portable even when tab history cannot retain them", () => {
  const report = {
    ...fixture(),
    canonical: "https://composer.loftwah.com/",
    extra: "x".repeat(300 * 1024),
  };
  assert.equal(inspectionReport(report).title, report.title);
  assert.equal(validatedReport(report), null);
  assert.ok(new Blob([reportJSON(report)]).size <= 65536);
});
test("renderer refuses malformed native control/image/source shapes before they reach DOM properties", () => {
  for (const patch of [
    { tags: { x: "not-an-array" } },
    {
      findings: [
        {
          status: { toString: () => "fix" },
          label: "Unsafe shape",
          detail: "Ignored",
        },
      ],
    },
    {
      findings: [
        {
          status: "review",
          label: "Unsafe link",
          detail: "Ignored",
          source: "javascript:alert(1)",
        },
      ],
    },
    {
      images: [
        {
          kind: "Open Graph",
          status: "verified",
          url: "https://user:secret@example.test/image.png",
        },
      ],
    },
    { images: [{ kind: "Open Graph", status: "verified" }] },
    { imageDeclarations: "not-an-array" },
    { textLengths: { title: "not-a-number" } },
  ])
    assert.throws(() => inspectionReport({ ...fixture(), ...patch }));
});
