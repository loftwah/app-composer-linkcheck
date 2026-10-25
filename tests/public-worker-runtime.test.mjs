import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const toolRequire = createRequire(require.resolve("wrangler/package.json"));
const esbuild = toolRequire("esbuild");
const { Miniflare, convertV4MiniflareOptions } = toolRequire("miniflare");

test("real workerd accepts the public DNS fetch options and refuses resolver redirects before destination access", async () => {
  const root = mkdtempSync(join(tmpdir(), "linkcheck-workerd-"));
  let runtime;
  const originalTemp = process.env.TMPDIR;
  try {
    const bundle = await esbuild.build({
      stdin: {
        contents: `import {publicFetcher} from './src/public-network.ts';
export default {async fetch(){try { const r=await publicFetcher()('https://example.com/');return Response.json({status:r.status}); } catch(error) {return Response.json({kind:error._tag},{status:400});}}};`,
        resolveDir: process.cwd(),
        sourcefile: "runtime-fixture.ts",
      },
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
    });
    let redirect = false,
      dnsCalls = 0,
      destinationCalls = 0;
    process.env.TMPDIR = root;
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2026-10-13",
        compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
        host: "127.0.0.1",
        port: 0,
        outboundService: async (request) => {
          const url = new URL(request.url);
          if (url.hostname === "cloudflare-dns.com") {
            dnsCalls++;
            if (redirect)
              return new Response(null, {
                status: 302,
                headers: { location: "https://127.0.0.1/private" },
              });
            return Response.json({
              Status: 0,
              Answer: [{ type: 1, data: "93.184.215.14" }],
            });
          }
          assert.equal(url.hostname, "example.com");
          destinationCalls++;
          return new Response("Public page");
        },
      }),
    );
    if (originalTemp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTemp;
    let response = await runtime.dispatchFetch("http://fixture.invalid/");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 200 });
    assert.equal(dnsCalls, 2);
    assert.equal(destinationCalls, 1);
    redirect = true;
    response = await runtime.dispatchFetch("http://fixture.invalid/");
    assert.equal(response.status, 400);
    assert.equal((await response.json()).kind, "InvalidTarget");
    assert.equal(destinationCalls, 1);
  } finally {
    if (originalTemp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTemp;
    await runtime?.dispose();
    esbuild.stop();
    rmSync(root, { recursive: true, force: true });
    assert.equal(existsSync(root), false);
  }
});
