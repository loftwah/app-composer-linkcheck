import { InvalidTarget, target } from "./target.ts";

// DNS preflight is defense in depth. The final connection MUST use Workers'
// global fetch with global_fetch_strictly_public: a DNS check alone cannot stop
// rebinding between this lookup and the transport's own lookup. No service,
// origin, socket or caller-provided credential is used to fetch a destination.
export function publicAddress(address: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
    const parts = address.split(".").map(Number);
    if (parts.some((n) => n > 255)) return false;
    const [a, b, c] = parts;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 ||
          (b === 0 && (c === 0 || c === 2)) ||
          (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (!/^[a-f0-9:.]+$/i.test(address) || !address.includes(":")) return false;
  try {
    const normalized = new URL(`https://[${address}]/`).hostname.slice(1, -1);
    const [left, right] = normalized.split("::");
    const start = left ? left.split(":") : [];
    const end = right ? right.split(":") : [];
    const words =
      right === undefined
        ? start
        : [...start, ...Array(8 - start.length - end.length).fill("0"), ...end];
    const [a, b] = words.map((word) => parseInt(word, 16));
    return (
      words.length === 8 &&
      a >= 0x2000 &&
      a <= 0x3fff &&
      !(a === 0x2001 && (b < 0x200 || b === 0xdb8)) &&
      a !== 0x2002 &&
      !(a === 0x3fff && b < 0x1000)
    );
  } catch {
    return false;
  }
}

const DNS_LIMIT = 16 * 1024;
export function publicFetcher(transport: typeof fetch = fetch): typeof fetch {
  const verified = new Map<string, Promise<void>>();
  async function verify(host: string, signal?: AbortSignal | null) {
    if (!verified.has(host)) {
      if (verified.size >= 8)
        throw new InvalidTarget({
          message:
            "This page references too many different hosts for one bounded inspection.",
        });
      verified.set(
        host,
        (async () => {
          const families = await Promise.all(
            ["A", "AAAA"].map(async (type) => {
              const response = await transport(
                `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
                {
                  headers: { Accept: "application/dns-json" },
                  redirect: "error",
                  signal,
                },
              );
              if (
                !response.ok ||
                Number(response.headers.get("content-length")) > DNS_LIMIT
              )
                throw Error("DNS response");
              const reader = response.body?.getReader();
              if (!reader) throw Error("DNS body");
              const chunks: Uint8Array[] = [];
              let size = 0;
              try {
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  size += value.length;
                  if (size > DNS_LIMIT) {
                    await reader.cancel();
                    throw Error("DNS limit");
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
              const data = JSON.parse(new TextDecoder().decode(bytes)) as {
                Status?: number;
                Answer?: { type: number; data: string }[];
              };
              if (
                data.Status !== 0 ||
                (data.Answer !== undefined && !Array.isArray(data.Answer))
              )
                throw Error("DNS unavailable");
              return (data.Answer ?? [])
                .filter((row) => row.type === 1 || row.type === 28)
                .map((row) => row.data);
            }),
          );
          const addresses = families.flat();
          if (
            !addresses.length ||
            addresses.length > 64 ||
            !addresses.every(publicAddress)
          )
            throw new InvalidTarget({
              message:
                "This hostname does not resolve exclusively to public Internet addresses.",
            });
        })().catch((error) => {
          if (error instanceof InvalidTarget || signal?.aborted) throw error;
          throw new InvalidTarget({
            message:
              "Public DNS could not be verified for this hostname. Check the address and try again.",
          });
        }),
      );
    }
    await verified.get(host);
  }
  return (async (input, init) => {
    const url = target(
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url,
    );
    await verify(url.hostname, init?.signal);
    const requested = new Headers(init?.headers);
    return transport(url.href, {
      method: "GET",
      redirect: "manual",
      signal: init?.signal,
      headers: {
        Accept:
          requested.get("Accept") ||
          "text/html,image/png,image/jpeg,image/webp,image/gif",
        "User-Agent": "AppComposer-LinkCheck/1.0",
      },
    });
  }) as typeof fetch;
}
