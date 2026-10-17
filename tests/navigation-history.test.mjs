import test from "node:test";
import assert from "node:assert/strict";
import { validatedReport } from "../public/navigation-draft.js";
const fixture = () => ({
  contract: 1,
  kind: "page-inspection",
  url: "https://composer.loftwah.com/",
  sourceSha: "f".repeat(40),
  checkedAt: "2026-10-18T00:00:00Z",
  title: "Public <script>text only</script>",
  description: "A fictional report",
  tags: { "og:title": ["A fictional page"] },
  images: [],
  findings: [
    {
      status: "review",
      label: "Fictional observation",
      detail: "Retained data",
    },
  ],
});
test("bounded tab history keeps report data and rejects unsafe renderer shapes and URLs", () => {
  const valid = fixture();
  assert.deepEqual(validatedReport(valid), valid);
  for (const patch of [
    { contract: 2 },
    { kind: "other" },
    { sourceSha: "unknown" },
    { checkedAt: "not a date" },
    { url: "https://user:secret@composer.loftwah.com/" },
    { canonical: "javascript:alert(1)" },
    { findings: [{ status: ["fix"], label: "Bad", detail: "Shape" }] },
    {
      findings: [
        {
          status: "fix",
          label: "Bad",
          detail: "Source",
          source: "javascript:alert(1)",
        },
      ],
    },
    {
      images: [
        {
          kind: "Open Graph",
          status: "verified",
          url: "http://example.test/image.png",
        },
      ],
    },
    { identity: { icons: [], manifest: null } },
    { headings: [{ level: "1", text: "Invalid" }] },
    { tags: { x: Array.from({ length: 40 }, () => "x".repeat(8000)) } },
  ])
    assert.equal(validatedReport({ ...valid, ...patch }), null);
});

test("history quota and permission failures cannot claim a report was retained", async () => {
  const { rememberReport } = await import("../public/navigation-draft.js");
  const original = Object.getOwnPropertyDescriptor(globalThis, "history");
  try {
    for (const name of ["QuotaExceededError", "SecurityError"]) {
      Object.defineProperty(globalThis, "history", {
        configurable: true,
        value: {
          state: null,
          replaceState() {
            throw new DOMException("Unavailable", name);
          },
        },
      });
      assert.equal(rememberReport(fixture()), false);
    }
    let state = null;
    Object.defineProperty(globalThis, "history", {
      configurable: true,
      value: {
        get state() {
          return state;
        },
        replaceState(next) {
          state = structuredClone(next);
        },
      },
    });
    assert.equal(rememberReport(fixture()), true);
    assert.equal(state.composerLinkcheckDraft.report.title, fixture().title);
  } finally {
    if (original) Object.defineProperty(globalThis, "history", original);
    else delete globalThis.history;
  }
});
