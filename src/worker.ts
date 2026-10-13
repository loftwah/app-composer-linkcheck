import { Effect } from "effect";
import { inspect, hosts } from "./inspection.ts";
import { sha } from "./build.ts";
type Env = { ASSETS: Fetcher; INSPECTION_LIMIT: RateLimit };
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (
      request.method !== "GET" &&
      !(url.pathname === "/api/inspect" && request.method === "POST")
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
        configuration: { hosts: { type: "reviewed-source-list" } },
        source: "https://github.com/loftwah/app-composer-linkcheck",
        hosts,
      });
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
        if (Number(request.headers.get("content-length")) > 4096)
          throw new Error("size");
        const reader = request.body?.getReader();
        if (!reader) throw new Error("empty");
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 4096) {
              await reader.cancel();
              throw new Error("size");
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        const body = JSON.parse(new TextDecoder().decode(bytes));
        if (typeof body?.url !== "string") throw new Error("url");
        value = body.url;
        discovery = body.discovery === true;
      } catch {
        return json({ error: "Send a JSON URL request under 4 KiB." }, 400);
      }
      return Effect.runPromise(
        inspect(value, fetch, { discovery }).pipe(
          Effect.match({
            onSuccess: (report) => json({ sourceSha: sha, ...report }),
            onFailure: (error) =>
              json(
                { error: error.message, kind: error._tag },
                error._tag === "InvalidTarget" ? 400 : 422,
              ),
          }),
        ),
      );
    }
    const asset = await env.ASSETS.fetch(request);
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
      `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://static.cloudflareinsights.com/beacon.min.js; style-src 'self'; img-src 'self' https://composer.loftwah.com https://guestbook.loftwah.com https://showcase.loftwah.com https://ready.loftwah.com https://ai.loftwah.com https://share.loftwah.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    );
    return new Response(asset.body, { status: asset.status, headers });
  },
};
