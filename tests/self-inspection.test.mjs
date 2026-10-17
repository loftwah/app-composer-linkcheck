import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const config = JSON.parse(
  readFileSync(new URL("wrangler.jsonc", root), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, ""),
);
const inspection = readFileSync(new URL("src/inspection.ts", root), "utf8");
const hosts = [...inspection.matchAll(/"([a-z0-9.-]+\.[a-z]{2,})"/g)].map(
  ([, host]) => host,
);
const deployed = config.routes.map((route) => route.pattern);

// Cloudflare returns 522 for a custom-domain Worker that fetches its own
// hostname unless `global_fetch_strictly_public` is enabled, so a deployment
// that advertises its own host as an inspectable page must keep that flag.
// https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-522/
test("a deployment that inspects its own host keeps the public-fetch flag", () => {
  for (const host of deployed) {
    if (!hosts.includes(host)) continue;
    assert.ok(
      config.compatibility_flags.includes("global_fetch_strictly_public"),
      host +
        " is in the reviewed host list, so global_fetch_strictly_public must stay enabled or every self-inspection fails with HTTP 522",
    );
  }
});

test("the reviewed host list stays an explicit allow-list", () => {
  assert.ok(hosts.length >= 5, "the reviewed hosts are listed explicitly");
  for (const host of hosts) assert.match(host, /^[a-z0-9.-]+\.[a-z]{2,}$/);
  assert.doesNotMatch(inspection, /hosts\s*=\s*\[[^\]]*\*\*/);
});
