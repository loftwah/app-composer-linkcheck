import test from "node:test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { publicUrl } from "../public/public-url.js";
import { publicAddress, publicFetcher } from "../src/public-network.ts";
import { inspect, boundedFetch, rasterPreview } from "../src/inspection.ts";
import worker from "../src/worker.ts";

const signal = () => new AbortController().signal;
const dns = (addresses = ["93.184.215.14"]) =>
  Response.json({
    Status: 0,
    Answer: addresses.map((data) => ({
      type: data.includes(":") ? 28 : 1,
      data,
    })),
  });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9f8AAAAASUVORK5CYII=",
  "base64",
);

test("public sites, CDN image queries, encoded public paths and fragments work without a domain list", () => {
  for (const url of [
    "https://example.com/",
    "https://www.wikipedia.org/",
    "https://cdn.example.net/art%20work.png?w=1200&format=webp",
    "https://example.com/search?q=music",
  ])
    assert.equal(publicUrl(url).href, url);
  assert.equal(
    publicUrl("https://example.com./page#heading").href,
    "https://example.com/page",
  );
  for (const url of [
    "https://127.1/",
    "https://2130706433/",
    "https://0x7f000001/",
    "https://[::1]/",
    "https://localhost/",
    "https://metadata.google.internal/",
    "https://site.local/",
    "https://u:p@example.com/",
    "https://example.com:8443/",
    "file:///tmp/private",
    "https://example.com/%61dmin/",
    "https://example.com/%2561dmin/",
    "https://example.com/a?access_token=private",
    "https://example.com/a?X-Amz-Signature=private",
  ])
    assert.throws(() => publicUrl(url), url);
});

test("all non-public IPv4 and IPv6 families are denied, including mapped and transition addresses", () => {
  for (const address of [
    "0.0.0.0",
    "10.2.3.4",
    "100.64.1.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.1",
    "192.0.0.9",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "2001::1",
    "2002:7f00:1::",
    "3fff::1",
    "not-an-ip",
  ])
    assert.equal(publicAddress(address), false, address);
  for (const address of [
    "1.1.1.1",
    "93.184.215.14",
    "208.80.154.224",
    "2606:4700:4700::1111",
    "2620:0:861:ed1a::1",
  ])
    assert.equal(publicAddress(address), true, address);
});

test("DNS checks both families, rejects mixed/private answers and never dispatches the destination", async () => {
  for (const addresses of [
    ["127.0.0.1"],
    ["93.184.215.14", "10.0.0.1"],
    ["fc00::1"],
    [],
  ]) {
    let destinations = 0;
    const transport = async (url) => {
      if (String(url).startsWith("https://cloudflare-dns.com/"))
        return dns(addresses);
      destinations++;
      return new Response("private");
    };
    await assert.rejects(
      publicFetcher(transport)("https://example.com/", { signal: signal() }),
      (e) => e._tag === "InvalidTarget",
    );
    assert.equal(destinations, 0);
  }
});

test("DNS failure, malformed and oversized DNS responses fail closed", async () => {
  for (const response of [
    () => new Response("bad"),
    () => Response.json({ Status: 2 }),
    () => new Response(" ".repeat(16385)),
    () => Response.json({ Status: 0, Answer: {} }),
  ]) {
    let destinations = 0;
    await assert.rejects(
      publicFetcher(async (url) => {
        if (String(url).startsWith("https://cloudflare-dns.com/"))
          return response();
        destinations++;
        return new Response("bad");
      })("https://example.com/"),
    );
    assert.equal(destinations, 0);
  }
});

test("public fetch caches DNS within a run and never forwards caller credentials, methods or headers", async () => {
  const calls = [];
  const fetcher = publicFetcher(async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).startsWith("https://cloudflare-dns.com/")
      ? dns()
      : new Response("public");
  });
  for (let i = 0; i < 2; i++)
    await fetcher("https://example.com/", {
      method: "POST",
      headers: {
        Authorization: "private",
        Cookie: "private",
        "X-Owner-Token": "private",
        Accept: "text/html",
      },
      signal: signal(),
    });
  assert.equal(calls.filter((c) => c.url.includes("/dns-query?")).length, 2);
  for (const { init } of calls.filter(
    (c) => c.url === "https://example.com/",
  )) {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Authorization"), null);
    assert.equal(headers.get("Cookie"), null);
    assert.equal(headers.get("X-Owner-Token"), null);
  }
});

test("every redirect is preflighted and a private DNS destination is stopped before connection", async () => {
  let destinationCalls = 0;
  const fetcher = publicFetcher(async (url) => {
    url = String(url);
    if (url.startsWith("https://cloudflare-dns.com/"))
      return dns(
        new URL(url).searchParams.get("name") === "example.com"
          ? ["93.184.215.14"]
          : ["127.0.0.1"],
      );
    destinationCalls++;
    return new Response(null, {
      status: 302,
      headers: { location: "https://rebind.example.net/" },
    });
  });
  await assert.rejects(
    boundedFetch("https://example.com/", 1024, signal(), fetcher),
    (e) => e._tag === "InvalidTarget",
  );
  assert.equal(destinationCalls, 1);
});

test("DNS cancellation follows the inspection AbortSignal", async () => {
  let cancelled = 0;
  const fetcher = publicFetcher(
    (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener(
          "abort",
          () => {
            cancelled++;
            reject(Error("cancelled"));
          },
          { once: true },
        ),
      ),
  );
  await assert.rejects(
    Effect.runPromise(
      inspect("https://example.com/", fetcher, { timeout: "30 millis" }),
    ),
  );
  assert.equal(cancelled, 2);
});

test("third-party pages and CDN images run through the same public transport and produce actual image evidence", async () => {
  const calls = [];
  const fetcher = publicFetcher(async (url) => {
    url = String(url);
    calls.push(url);
    if (url.startsWith("https://cloudflare-dns.com/")) return dns();
    if (url.includes("cdn.example.net"))
      return new Response(png, { headers: { "content-type": "image/png" } });
    return new Response(
      '<html><head><title>Outside portfolio</title><meta property="og:image" content="https://cdn.example.net/share.png?w=1200"></head><body><h1>Page</h1></body></html>',
      { headers: { "content-type": "text/html" } },
    );
  });
  const report = await Effect.runPromise(
    inspect("https://example.com/", fetcher),
  );
  assert.equal(report.title, "Outside portfolio");
  assert.equal(report.images[0].status, "verified");
  assert.equal(
    calls.filter((url) => url.startsWith("https://cloudflare-dns.com/")).length,
    4,
  );
});

test("preview returns only bounded decoded raster bytes and rejects SVG, HTML and MIME confusion", async () => {
  const r = await Effect.runPromise(
    rasterPreview(
      "https://cdn.example.net/a.png",
      async () =>
        new Response(png, { headers: { "content-type": "image/png" } }),
    ),
  );
  assert.equal(r.type, "image/png");
  assert.deepEqual(Buffer.from(r.bytes), png);
  for (const [body, type] of [
    ['<svg onload="bad()"></svg>', "image/svg+xml"],
    ["<html>bad</html>", "text/html"],
    [png, "text/html"],
  ])
    await assert.rejects(
      Effect.runPromise(
        rasterPreview(
          "https://cdn.example.net/a",
          async () => new Response(body, { headers: { "content-type": type } }),
        ),
      ),
    );
  const response = await worker.fetch(
    new Request("https://share.loftwah.com/api/preview"),
    {},
    {},
  );
  assert.equal(response.status, 405);
  const throttled = await worker.fetch(
    new Request("https://share.loftwah.com/api/preview", { method: "POST" }),
    { INSPECTION_LIMIT: { limit: async () => ({ success: false }) } },
    {},
  );
  assert.equal(throttled.status, 429);
});
