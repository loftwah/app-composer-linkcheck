import test from "node:test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { inspect, target, boundedFetch } from "../src/inspection.ts";
import worker from "../src/worker.ts";

for (const host of ["bubbles.loftwah.com", "fm.loftwah.com"]) {
  test(`${host} public pages and share images can be inspected and displayed`, async () => {
    const origin = `https://${host}`;
    assert.equal(target(origin).href, origin + "/");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9f8AAAAASUVORK5CYII=",
      "base64",
    );
    const report = await Effect.runPromise(
      inspect(origin, async (url) =>
        String(url).endsWith("/share.png")
          ? new Response(png, { headers: { "content-type": "image/png" } })
          : new Response(
              `<html lang="en"><head><title>Fixture</title><meta property="og:image" content="${origin}/share.png"></head><body><h1>Fixture</h1></body></html>`,
              { headers: { "content-type": "text/html" } },
            ),
      ),
    );
    assert.equal(report.images[0].status, "verified");
    const response = await worker.fetch(
      new Request("https://share.loftwah.com/", {
        headers: { "X-Composer-Verification": "1" },
      }),
      {
        ASSETS: {
          fetch: async () =>
            new Response("<html></html>", {
              headers: { "content-type": "text/html" },
            }),
        },
      },
      { waitUntil() {} },
    );
    const policy = response.headers.get("Content-Security-Policy");
    assert.ok(
      policy
        .split(";")
        .find((part) => part.trim().startsWith("img-src "))
        .split(/\s+/)
        .includes("blob:"),
    );
  });

  test(`${host} does not admit lookalikes, private URLs or external redirects`, async () => {
    for (const url of [
      `https://${host}.evil.test/`,
      `https://${host}.localhost/`,
      `https://u:p@${host}/`,
      `https://${host}/api/private`,
      `https://${host}/?token=secret`,
    ])
      assert.throws(() => target(url));
    let calls = 0;
    await assert.rejects(
      boundedFetch(
        `https://${host}/`,
        1024,
        new AbortController().signal,
        async () => {
          calls++;
          return new Response(null, {
            status: 302,
            headers: { location: "https://unreviewed.test/" },
          });
        },
      ),
    );
    assert.equal(calls, 1);
  });
}

test("LoftwahFM-sized HTML fits while announced and streamed pages over 1 MiB fail", async () => {
  const origin = "https://fm.loftwah.com/";
  const report = await Effect.runPromise(
    inspect(
      origin,
      async () =>
        new Response(
          "<html><head><title>Large public library</title></head><body>" +
            " ".repeat(530 * 1024) +
            "</body></html>",
          { headers: { "content-type": "text/html" } },
        ),
    ),
  );
  assert.ok(report.htmlBytes > 512 * 1024);
  for (const headers of [
    { "content-type": "text/html" },
    { "content-type": "text/html", "content-length": String(1024 * 1024 + 1) },
  ]) {
    await assert.rejects(
      Effect.runPromise(
        inspect(
          origin,
          async () => new Response(" ".repeat(1024 * 1024 + 1), { headers }),
        ),
      ),
      (error) => error._tag === "TooLarge",
    );
  }
});
