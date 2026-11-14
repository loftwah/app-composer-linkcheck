import {health,publish,pageEvent,type PublisherEnv} from "./publisher.mjs";
import { Effect } from "effect";
import { inspect, hosts, rasterPreview } from "./inspection.ts";
import { MAX_BODY_BYTES, batchHttp } from "./batch.ts";
import { sha } from "./build.ts";
type Env = PublisherEnv & { ASSETS: Fetcher; INSPECTION_LIMIT: RateLimit };
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
// Workers static assets return a full 200 for Range requests. Keep this
// bounded workaround specific to the published film, with no remote fetch.
async function filmResponse(req: Request, assets: Fetcher): Promise<Response> {
  const range = req.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (req.method !== "GET" || !match || (!match[1] && !match[2]))
    return assets.fetch(req);
  const headers = new Headers(req.headers);
  headers.delete("range");
  headers.delete("if-range");
  const full = await assets.fetch(new Request(req, { headers }));
  if (full.status !== 200) return full;
  const length = full.headers.get("content-length");
  const declared = length === null ? null : Number(length);
  const limit = 2 * 1024 * 1024;
  // A declared oversized or invalid asset stays on its ordinary full path.
  if (
    declared !== null &&
    (!Number.isSafeInteger(declared) || declared <= 0 || declared > limit)
  )
    return full;
  const ifRange = req.headers.get("if-range");
  if (ifRange) {
    const etag = full.headers.get("etag");
    const modified = full.headers.get("last-modified");
    const date = Date.parse(ifRange),
      last = modified ? Date.parse(modified) : NaN;
    if (
      !(etag && !etag.startsWith("W/") && ifRange === etag) &&
      !(Number.isFinite(date) && Number.isFinite(last) && last === date)
    )
      return full;
  }
  const startNumber = match[1] ? Number(match[1]) : null;
  const endNumber = match[2] ? Number(match[2]) : null;
  if (
    (startNumber !== null && !Number.isSafeInteger(startNumber)) ||
    (endNumber !== null && !Number.isSafeInteger(endNumber))
  )
    return full;
  if (!full.body) return new Response("Asset unavailable.", { status: 502 });
  const reader = full.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit || (declared !== null && total > declared)) {
      await reader.cancel();
      return new Response("Asset length changed.", { status: 502 });
    }
    chunks.push(value);
  }
  if (total === 0 || (declared !== null && total !== declared))
    return new Response("Asset length changed.", { status: 502 });
  const size = total;
  const start =
    startNumber === null ? Math.max(0, size - (endNumber ?? 0)) : startNumber;
  const end =
    startNumber === null ? size - 1 : Math.min(endNumber ?? size - 1, size - 1);
  const responseHeaders = new Headers(full.headers);
  responseHeaders.set("accept-ranges", "bytes");
  if (
    start >= size ||
    start > end ||
    (startNumber === null && endNumber === 0)
  ) {
    responseHeaders.set("content-range", `bytes */${size}`);
    responseHeaders.delete("content-length");
    return new Response(null, { status: 416, headers: responseHeaders });
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  responseHeaders.set("content-range", `bytes ${start}-${end}/${size}`);
  responseHeaders.set("content-length", String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: responseHeaders,
  });
}

// One bounded reader for both inspection routes. A declared length above the
// limit, a missing body, a read error and a streamed overrun all return null.
async function readBoundedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
const app = {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    const url = new URL(request.url);
    if (
      request.method !== "GET" &&
      !(
        ["/api/inspect", "/api/inspect-batch", "/api/preview"].includes(url.pathname) &&
        request.method === "POST"
      )
    )
      return json({ error: "Method not supported." }, 405);
    if (url.pathname === "/build.json")
      return json({ sha, app: "linkcheck", contract: 1 });
    if (url.pathname === "/manifest.json")
      return json({
        id: "linkcheck",
        contract: 1,
        runtime: "cloudflare-worker",
        dataVersion: 1,
        routes: ["/linkcheck"],
        capabilities: ["page-inspection:read"],
        configuration: { targets: { type: "public-https-with-public-dns" } },
        source: "https://github.com/loftwah/app-composer-linkcheck",
        batchHosts: hosts,
      });
    if (url.pathname === "/api/preview") {
      if (request.method !== "POST") return json({error:"Send a JSON image-preview request using POST."},405);
      const allowed = await env.INSPECTION_LIMIT.limit({key:"public-preview"});
      if (!allowed.success) return json({error:"Preview capacity reached. Wait one minute and retry."},429);
      if (!request.headers.get("content-type")?.startsWith("application/json")) return json({error:"Use a JSON request body."},400);
      let value: string;
      try {
        const bytes = await readBoundedBody(request,4096);
        if (!bytes) throw Error("body");
        const body = JSON.parse(new TextDecoder().decode(bytes));
        if (typeof body?.url !== "string") throw Error("url");
        value = body.url;
      } catch {return json({error:"Send a JSON URL request under 4 KiB."},400);}
      return Effect.runPromise(rasterPreview(value).pipe(Effect.match({
        onSuccess: image => new Response(image.bytes,{headers:{
          "Content-Type":image.type,"Content-Length":String(image.bytes.length),
          "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
          "Content-Security-Policy":"default-src 'none'; sandbox",
        }}),
        onFailure: error => json({error:error.message,kind:error._tag},error._tag === "InvalidTarget" ? 400 : 422),
      })));
    }
    if (url.pathname === "/api/inspect-batch") {
      if (request.method !== "POST")
        return json(
          { error: "Send a JSON batch request using POST." },
          405,
        );
      const allowed = await env.INSPECTION_LIMIT.limit({
        key: "public-batch",
      });
      if (!allowed.success)
        return json(
          { error: "Inspection capacity reached. Wait one minute and retry." },
          429,
        );
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return json({ error: "Use a JSON request body." }, 400);
      const bytes = await readBoundedBody(request, MAX_BODY_BYTES);
      if (!bytes)
        return json(
          { error: "Send a JSON batch request under 8 KiB." },
          400,
        );
      try {
        const result = await Effect.runPromise(batchHttp(bytes));
        return json({ sourceSha: sha, ...result.body }, result.status);
      } catch {
        // A defect is a server fault, not a finding about any inspected page.
        return json(
          { error: "The batch could not be completed.", kind: "BatchFailed" },
          500,
        );
      }
    }
    if (url.pathname === "/api/inspect") {
      if (request.method !== "POST")
        return json(
          { error: "Send a JSON inspection request using POST." },
          405,
        );
      const allowed = await env.INSPECTION_LIMIT.limit({
        key: "public-inspection",
      });
      if (!allowed.success)
        return json(
          { error: "Inspection capacity reached. Wait one minute and retry." },
          429,
        );
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return json({ error: "Use a JSON request body." }, 400);
      let value: string;
      let discovery = false;
      try {
        const bytes = await readBoundedBody(request, 4096);
        if (!bytes) throw new Error("size");
        const body = JSON.parse(new TextDecoder().decode(bytes));
        if (typeof body?.url !== "string") throw new Error("url");
        value = body.url;
        discovery = body.discovery === true;
      } catch {
        return json({ error: "Send a JSON URL request under 4 KiB." }, 400);
      }
      return Effect.runPromise(
        inspect(value, undefined, { discovery }).pipe(
          Effect.match({
            onSuccess: (report) => {publish(env,context,request,'inspection_completed');return json({ sourceSha: sha, ...report });},
            onFailure: (error) =>
              json(
                { error: error.message, kind: error._tag },
                error._tag === "InvalidTarget" ? 400 : 422,
              ),
          }),
        ),
      );
    }
    const asset = url.pathname === "/brand/icon-inspection-motion.mp4"
      ? await filmResponse(request, env.ASSETS)
      : await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    const nonce = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
    );
    if (headers.get("content-type")?.startsWith("text/html"))
      headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://static.cloudflareinsights.com/beacon.min.js; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    );
    return new Response(asset.body, { status: asset.status, headers });
  },
};

export default {async fetch(request:Request,env:Env,context:ExecutionContext){
 const probe=health(request,'/healthz','linkcheck',sha);if(probe)return probe;
 const response=await app.fetch(request,env,context);if(pageEvent(request,response)==='app_open')publish(env,context,request,'app_open');return response;
}};
