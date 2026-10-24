import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const html = readFileSync(new URL("public/index.html", root), "utf8");

// Link Check keeps its own App Composer destination, so the local shell names the
// Composer instance it links to rather than inferring it.
test("public/index.html provides the shared illustrated Apps menu shell", () => {
  assert.match(html, /data-open-apps/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /class="dialog-heading"/);
  assert.match(html, /id="app-navigation-title">Apps and shortcuts/);
  assert.match(html, /data-close-apps autofocus/);
  assert.match(html, /type="search"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /data-composer-home="https:\/\/composer\.loftwah\.com\/"/);
  assert.match(html, /src="\/brand\/launcher.js" defer/);
});

const destinations = [...html.matchAll(/<li data-destination>([\s\S]*?)<\/li>/g)].map(
  ([, body]) => ({
    body,
    href: body.match(/<a href="([^"]+)"/)?.[1] ?? "",
    label: (
      body.match(/<span>([^<]*)</)?.[1] ??
      body.match(/<a href="[^"]*"(?:\s[^>]*)?>\s*([^<]*)/)?.[1] ??
      ""
    ).trim(),
    image: body.match(/<img\s+src="([^"]+)"/)?.[1] ?? "",
    alt: body.match(/\salt="([^"]*)"/)?.[1],
    description: body.match(/<small>([^<]*)<\/small>/)?.[1] ?? "",
  }),
);

test("the authored LDraw destination sits after Carry / forward and before the Composer tasks", () => {
  const ldraw = destinations.filter((row) => row.label === "LDraw");
  assert.equal(ldraw.length, 1, "exactly one authored LDraw row");
  assert.equal(ldraw[0].href, "https://ldraw.loftwah.com/");
  assert.equal(
    ldraw[0].image,
    "/brand/apps/ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96.webp",
  );
  assert.equal(ldraw[0].alt, "", "the tile is decorative beside the label");
  assert.equal(ldraw[0].description, "Editable diagrams");
  assert.match(ldraw[0].body, /width="40"\s+height="40"/);
  const index = destinations.indexOf(ldraw[0]);
  assert.equal(destinations[index - 1].label, "Carry / forward");
  assert.deepEqual(
    destinations.slice(index + 1).map((row) => row.label),
    ["Get Ready", "Init"],
  );
});

test("every other app keeps its own name, crop and authored destination", () => {
  for (const [label, crop, href] of [
    ["Here / there", "herethere-small-20261018", "https://guestbook.loftwah.com"],
    ["Linkarooie", "linkarooie-small-20261018", "https://showcase.loftwah.com"],
    ["Link Check", "linkcheck-small-20261018", "https://share.loftwah.com"],
    ["Hello World", "hello-small-20261018", "https://ready.loftwah.com"],
    ["Carry / forward", "carryforward-small-20261018", "https://ai.loftwah.com"],
  ]) {
    const row = destinations.find((item) => item.label === label);
    assert.ok(row, label + " stays in the menu");
    assert.equal(row.href, href);
    assert.equal(row.image, "/brand/apps/" + crop + ".webp");
    assert.equal(row.alt, "");
  }
  assert.equal(
    destinations.find((row) => row.label === "Link Check").body.includes(
      'aria-current="page"',
    ),
    true,
    "the current app is marked once in authored markup",
  );
});

test("the local Apps menu controller is the reviewed Composer distribution with LDraw", () => {
  const launcher = readFileSync(new URL("public/brand/launcher.js", root));
  assert.equal(
    createHash("sha256").update(launcher).digest("hex"),
    "c952399adeb5fc8bfa8f7916222d2c57c1e792b2164807cb9b80592bd520c3cb",
    "public/brand/launcher.js must be the reviewed Composer distribution",
  );
  const code = launcher.toString("utf8");
  assert.match(
    code,
    /\{ name: "LDraw", href: "https:\/\/ldraw\.loftwah\.com\/", image: "apps\/ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96\.webp", standaloneOnly: true, explainer: "\/ldraw", description: "Editable diagrams, PNG and SVG", keywords: "draw drawing diagram excalidraw scene png svg local offline" \}/,
  );
  // The same local controller keeps the documented keyboard and search paths.
  for (const pattern of [
    /event\.key === "Escape"/,
    /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/,
    /event\.key === "Home"/,
    /event\.key === "End"/,
    /event\.key\.toLowerCase\(\) === "k"/,
    /event\.isComposing/,
    /keyCode === 229/,
    /normalize\("NFD"\)/,
    /\\p\{Diacritic\}/,
  ])
    assert.match(code, pattern);
});

test("the local LDraw tile is the reviewed 96px WebP and no drawn logo was added", () => {
  const tile = readFileSync(
    new URL(
      "public/brand/apps/ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96.webp",
      root,
    ),
  );
  assert.equal(tile.subarray(0, 4).toString("latin1"), "RIFF");
  assert.equal(tile.subarray(8, 12).toString("latin1"), "WEBP");
  assert.equal(
    createHash("sha256").update(tile).digest("hex"),
    "eeabb3049de7c9f830a9ded2e40a5014fbcd0fdb7c51373115ba45da2b15748f",
    "the committed tile must be the reviewed Composer export",
  );
  for (const path of ["/brand/ldraw", "/brand/apps/ldraw-icon", "ldraw-logo"])
    assert.equal(html.includes(path), false, "no invented LDraw mark " + path);
});
