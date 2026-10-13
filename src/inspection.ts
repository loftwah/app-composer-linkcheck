import { Data, Effect } from "effect";
import { Parser } from "htmlparser2";
import { imageSize } from "image-size";
import { explain, discoveryChecks, imageFindings } from "./diagnostics.ts";

// Forks change this reviewed source list, never accept host authority from a browser.
export const hosts = [
  "composer.loftwah.com",
  "guestbook.loftwah.com",
  "showcase.loftwah.com",
  "ready.loftwah.com",
  "ai.loftwah.com",
  "share.loftwah.com",
];
export class InvalidTarget extends Data.TaggedError("InvalidTarget")<{
  message: string;
}> {}
export class FetchFailed extends Data.TaggedError("FetchFailed")<{
  message: string;
}> {}
export class TooLarge extends Data.TaggedError("TooLarge")<{
  message: string;
}> {}
export class InvalidContent extends Data.TaggedError("InvalidContent")<{
  message: string;
}> {}
export type InspectionError =
  InvalidTarget | FetchFailed | TooLarge | InvalidContent;
export function target(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidTarget({ message: "Enter a complete HTTPS URL." });
  }
  if (
    input.length > 2048 ||
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !hosts.includes(url.hostname) ||
    /[\u0000-\u0020\\%]/.test(input) ||
    /\/(?:_emdash|api|admin|studio|owner|private)(?:\/|$)/i.test(url.pathname)
  )
    throw new InvalidTarget({
      message:
        "Use a public page on a supported hostname, without credentials, query strings or private paths.",
    });
  return url;
}
export async function boundedFetch(
  input: string,
  limit: number,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  let url = target(input);
  const redirects: string[] = [];
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetcher(url.href, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "AppComposer-LinkCheck/1.0",
        Accept: "text/html,image/png,image/jpeg,image/webp,image/gif",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const next = response.headers.get("location");
      if (!next || hop === 3)
        throw new FetchFailed({
          message:
            "The redirect chain did not reach a public response within three redirects.",
        });
      url = target(new URL(next, url).href);
      redirects.push(url.href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new FetchFailed({
        message: `The target returned HTTP ${response.status}.`,
      });
    }
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel();
      throw new TooLarge({
        message: "The response exceeds the inspection byte limit.",
      });
    }
    if (!response.body)
      throw new InvalidContent({
        message: "The target returned an empty response.",
      });
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          await reader.cancel();
          throw new TooLarge({
            message: "The streamed response exceeds the inspection byte limit.",
          });
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
    return {
      url: url.href,
      redirects,
      bytes,
      type: (response.headers.get("content-type") || "")
        .split(";")[0]
        .toLowerCase(),
      robots: response.headers.get("x-robots-tag") || "",
    };
  }
  throw new FetchFailed({ message: "Unable to fetch the target." });
}
export type Finding = {
  status: "pass" | "fix" | "review";
  label: string;
  detail: string;
  category?: string;
  priority?: "high" | "normal" | "low";
  why?: string;
  action?: string;
  source?: string;
};
type ImageReport = {
  kind: string;
  declared?: string;
  url?: string;
  status: string;
  message: string;
  width?: number;
  height?: number;
  bytes?: number;
  type?: string;
  redirects?: string[];
};
export function metadata(html: string, url: string, headerRobots = "") {
  const tags: Record<string, string[]> = {};
  const titles: string[] = [];
  const canonicals: string[] = [];
  const jsonld: string[] = [];
  const icons: {
    rel: string;
    href: string;
    sizes: string;
    type: string;
    media: string;
  }[] = [];
  const manifests: string[] = [];
  const headings: { level: number; text: string }[] = [];
  let activeHeading: { level: number; text: string } | undefined;
  const contentImages = { total: 0, missingAlt: 0, emptyAlt: 0 };
  const imageDeclarations: Record<string, string>[] = [];
  let activeImage: Record<string, string> | undefined;
  let head = false,
    title = false,
    ld = false,
    h1 = 0,
    lang = "",
    titleText = "",
    ldText = "";
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === "html") lang = attrs.lang || "";
        if (name === "head") head = true;
        if (name === "h1") h1++;
        if (!head && /^h[1-6]$/.test(name)) {
          activeHeading = { level: Number(name[1]), text: "" };
        }
        if (!head && name === "img") {
          contentImages.total++;
          if (attrs.alt === undefined) contentImages.missingAlt++;
          else if (!attrs.alt.trim()) contentImages.emptyAlt++;
        }
        if (!head) return;
        if (name === "title") {
          title = true;
          titleText = "";
        }
        if (name === "meta") {
          const key = (attrs.property || attrs.name || "").toLowerCase();
          if (key && attrs.content !== undefined)
            (tags[key] ??= []).push(attrs.content.slice(0, 4000));
          if (key === "og:image" || key === "og:image:url") {
            activeImage = { url: (attrs.content || "").slice(0, 2048) };
            if (imageDeclarations.length < 10)
              imageDeclarations.push(activeImage);
          } else if (key.startsWith("og:image:") && activeImage) {
            activeImage[key.slice(9)] = (attrs.content || "").slice(0, 4000);
          }
        }
        if (
          name === "link" &&
          (attrs.rel || "").toLowerCase().split(/\s+/).includes("canonical")
        )
          canonicals.push(attrs.href || "");
        if (name === "link") {
          const rel = (attrs.rel || "").toLowerCase().split(/\s+/);
          if (rel.includes("icon") || rel.includes("apple-touch-icon"))
            icons.push({
              rel: rel.includes("apple-touch-icon")
                ? "apple-touch-icon"
                : "icon",
              href: (attrs.href || "").slice(0, 2048),
              sizes: (attrs.sizes || "").slice(0, 80),
              type: (attrs.type || "").slice(0, 80),
              media: (attrs.media || "").slice(0, 160),
            });
          if (rel.includes("manifest"))
            manifests.push((attrs.href || "").slice(0, 2048));
        }
        if (name === "script" && attrs.type === "application/ld+json") {
          ld = true;
          ldText = "";
        }
      },
      ontext(text) {
        if (title) titleText += text;
        if (ld) ldText += text;
        if (activeHeading) activeHeading.text += text.slice(0, 160);
      },
      onclosetag(name) {
        if (name === "head") head = false;
        if (activeHeading && name === `h${activeHeading.level}`) {
          activeHeading.text = activeHeading.text.trim().slice(0, 160);
          if (headings.length < 60) headings.push(activeHeading);
          activeHeading = undefined;
        }
        if (name === "title" && title) {
          titles.push(titleText.trim().slice(0, 4000));
          title = false;
        }
        if (name === "script" && ld) {
          jsonld.push(ldText);
          ld = false;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  const first = (key: string) => tags[key]?.[0]?.trim() || "";
  const findings: Finding[] = [];
  const check = (label: string, ok: boolean, good: string, bad: string) =>
    findings.push({
      status: ok ? "pass" : "fix",
      label,
      detail: ok ? good : bad,
    });
  check(
    "Page title",
    titles.length === 1 && !!titles[0],
    titles[0] || "",
    "Publish one useful title in the server-rendered head.",
  );
  check(
    "Description",
    !!first("description"),
    first("description"),
    "Add a concise page-specific description. Search engines may choose another snippet.",
  );
  const canonicalDestination = (() => {
    try {
      const parsed = new URL(canonicals[0]);
      return parsed.protocol === "https:" &&
        !parsed.username &&
        !parsed.password
        ? parsed.href
        : null;
    } catch {
      return null;
    }
  })();
  check(
    "Canonical URL",
    canonicals.length === 1 && canonicalDestination !== null,
    canonicals[0] || "",
    "Publish one absolute HTTPS canonical.",
  );
  if (canonicalDestination && canonicalDestination !== new URL(url).href)
    findings.push({
      status: "review",
      label: "Canonical destination",
      detail:
        "The declared canonical differs from the inspected URL. Confirm that this duplication is intentional.",
    });
  for (const key of ["og:title", "og:type", "og:url", "og:image"]) {
    const value =
      key === "og:image" ? imageDeclarations[0]?.url || "" : first(key);
    check(key, !!value, value, `Add ${key} to the server-rendered head.`);
  }
  check(
    "Image description",
    !!imageDeclarations[0]?.alt?.trim(),
    imageDeclarations[0]?.alt?.trim() || "",
    "Describe the image using og:image:alt.",
  );
  check(
    "Language",
    !!lang,
    lang,
    "Declare the page language on the html element.",
  );
  check(
    "Mobile viewport",
    !!first("viewport"),
    first("viewport"),
    "Add a mobile viewport declaration.",
  );
  findings.push({
    status: h1 === 1 ? "pass" : "review",
    label: "Main heading",
    detail: `${h1} h1 elements found. Review the page outline; this count alone is not an accessibility or ranking verdict.`,
  });
  if (
    headings.some((item, i) => i > 0 && item.level > headings[i - 1].level + 1)
  )
    findings.push({
      status: "review",
      label: "Heading order",
      detail:
        "The HTML outline skips a heading level. Check whether sections are nested clearly.",
    });
  findings.push({
    status: contentImages.missingAlt ? "fix" : "pass",
    label: "Content image descriptions",
    detail: `${contentImages.total} HTML images; ${contentImages.missingAlt} without alt; ${contentImages.emptyAlt} with empty alt. Empty alt can be correct for decorative images. Text quality and rendered visibility are not evaluated.`,
  });
  const ogUrl = first("og:url");
  if (ogUrl) {
    try {
      const parsed = new URL(ogUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password)
        throw new Error();
      findings.push({
        status:
          canonicalDestination && parsed.href !== canonicalDestination
            ? "review"
            : "pass",
        label: "Search and share identity",
        detail:
          canonicalDestination && parsed.href !== canonicalDestination
            ? "og:url and the search canonical identify different URLs."
            : "og:url is absolute HTTPS and agrees with the canonical when one is declared.",
      });
    } catch {
      findings.push({
        status: "fix",
        label: "Search and share identity",
        detail: "og:url is not an absolute HTTPS URL without credentials.",
      });
    }
  }
  findings.push({
    status: first("og:description") ? "pass" : "review",
    label: "Share description",
    detail:
      first("og:description") ||
      "No og:description found. It is optional in the protocol; a page-specific description helps describe the shared page.",
  });
  findings.push({
    status: "review",
    label: "X card declaration",
    detail: first("twitter:card")
      ? `Declared ${first("twitter:card")}. Current X card eligibility rules are unavailable; verify the actual shared result.`
      : "No twitter:card found. Open Graph fallback and current card selection need an actual X check.",
  });
  if (
    first("viewport") &&
    /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[\s,]|$)/i.test(
      first("viewport"),
    )
  )
    findings.push({
      status: "review",
      label: "Zoom restriction",
      detail:
        "The viewport appears to restrict zoom. Review accessibility on a real device.",
    });
  const robots = [
    ...(tags["robots"] || []),
    ...(tags["googlebot"] || []).map((v) => "googlebot: " + v),
    ...(tags["bingbot"] || []).map((v) => "bingbot: " + v),
    headerRobots,
  ]
    .filter(Boolean)
    .join("; ");
  findings.push({
    status: /\b(noindex|none)\b/i.test(robots) ? "review" : "pass",
    label: "Indexing directive",
    detail:
      robots ||
      "No noindex directive in the response. This does not prove robots.txt access or search indexing.",
  });
  for (const [key, values] of Object.entries(tags))
    if (
      values.length > 1 &&
      key !== "og:image" &&
      !key.startsWith("og:image:") &&
      key !== "og:locale:alternate"
    )
      findings.push({
        status: "review",
        label: `Repeated ${key}`,
        detail:
          "More than one value was found. Check for conflicting template defaults.",
      });
  const structured = jsonld.map((text) => {
    try {
      const value = JSON.parse(text);
      const nodes = (
        Array.isArray(value)
          ? value
          : value && typeof value === "object" && Array.isArray(value["@graph"])
            ? value["@graph"]
            : [value]
      ).slice(0, 40);
      const types = nodes.flatMap((node) =>
        node && typeof node === "object"
          ? [node["@type"]]
              .flat()
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.slice(0, 120))
          : [],
      );
      return {
        valid: true,
        type: types.join(", ").slice(0, 400) || "JSON document",
        nodes: nodes.length,
        types,
      };
    } catch {
      return { valid: false, type: "Invalid JSON" };
    }
  });
  if (structured.some((s) => !s.valid))
    findings.push({
      status: "fix",
      label: "Structured data",
      detail: "An application/ld+json block is not valid JSON.",
    });
  else
    findings.push({
      status: structured.length ? "pass" : "review",
      label: "Structured data",
      detail: structured.length
        ? `${structured.length} JSON-LD blocks parse as JSON. Types: ${structured
            .map((s) => s.type)
            .join("; ")
            .slice(
              0,
              800,
            )}. Schema correctness and rich-result eligibility have not been validated.`
        : "No JSON-LD found. It is optional; choose a supported schema only when it describes the actual page.",
    });
  return {
    title: titles[0] || "",
    description: first("description"),
    canonical: canonicals[0] || "",
    tags,
    lang,
    h1,
    robots,
    structured,
    findings,
    icons,
    manifests,
    headings,
    contentImages,
    imageDeclarations,
    textLengths: {
      title: [...(titles[0] || "")].length,
      description: [...first("description")].length,
    },
  };
}
export async function identityAssets(
  meta: ReturnType<typeof metadata>,
  pageUrl: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const findings: Finding[] = [];
  const icons: ImageReport[] = [];
  // At most one ordinary favicon and one Apple touch icon. Every asset shares the public-host and byte guards.
  const candidates = [
    meta.icons.find((i) => i.rel === "icon"),
    meta.icons.find((i) => i.rel === "apple-touch-icon"),
  ].filter((i): i is NonNullable<typeof i> => !!i);
  if (!candidates.length)
    findings.push({
      status: "review",
      label: "Site icon",
      detail:
        "No favicon or Apple touch icon is declared. A conventional favicon.ico may still be used by browsers; it was not fetched.",
    });
  if (meta.icons.length > candidates.length)
    findings.push({
      status: "review",
      label: "Icon variants",
      detail:
        "Multiple icon declarations found. The first favicon and Apple touch icon were inspected; browser choice depends on sizes, media and type.",
    });
  for (const candidate of candidates) {
    const kind = candidate.rel === "icon" ? "Favicon" : "Apple touch icon";
    try {
      const url = target(new URL(candidate.href, pageUrl).href);
      if (!candidate.href)
        throw new InvalidContent({
          message: "The icon declaration has no URL.",
        });
      const asset = await boundedFetch(url.href, 256 * 1024, signal, fetcher);
      let width: number | undefined,
        height: number | undefined,
        message = "Public icon file and dimensions inspected.";
      if (asset.type === "image/svg+xml") {
        let root = false;
        let viewBox: string | undefined;
        let unsafe = false;
        const parser = new Parser(
          {
            onopentag(name, attrs) {
              if (!root) {
                if (name !== "svg") unsafe = true;
                root = true;
                viewBox = attrs.viewBox;
              }
              if (
                ["script", "foreignObject"].includes(name) ||
                Object.keys(attrs).some((k) => /^on/i.test(k))
              )
                unsafe = true;
            },
          },
          { xmlMode: true },
        );
        parser.end(new TextDecoder().decode(asset.bytes));
        if (!root || unsafe)
          throw new InvalidContent({
            message:
              "The SVG icon markup was not accepted. Use an SVG without scripts or embedded documents.",
          });
        const box = viewBox
          ?.trim()
          .split(/[\s,]+/)
          .map(Number);
        if (
          box?.length === 4 &&
          box.every(Number.isFinite) &&
          box[2] > 0 &&
          box[3] > 0
        ) {
          width = box[2];
          height = box[3];
        }
        message =
          "SVG response inspected as text. ViewBox is a coordinate size, not rendered pixels; SVG was not executed or previewed.";
      } else {
        const dimensions = imageSize(asset.bytes);
        const types: Record<string, string[]> = {
          png: ["image/png"],
          jpg: ["image/jpeg"],
          gif: ["image/gif"],
          webp: ["image/webp"],
          ico: ["image/x-icon", "image/vnd.microsoft.icon"],
        };
        if (!types[dimensions.type || ""]?.includes(asset.type))
          throw new InvalidContent({
            message: "Icon bytes do not match a supported image media type.",
          });
        width = dimensions.width;
        height = dimensions.height;
      }
      if ((width && width > 10000) || (height && height > 10000))
        throw new InvalidContent({ message: "Unsupported icon dimensions." });
      icons.push({
        kind,
        declared: candidate.href,
        url: asset.url,
        status: "verified",
        message,
        width,
        height,
        bytes: asset.bytes.length,
        type: asset.type,
        redirects: asset.redirects,
      });
      findings.push({
        status: "pass",
        label: kind,
        detail: `${asset.type}, ${asset.bytes.length} bytes${width && height ? `, ${width} × ${height}` : ""}. ${message}`,
      });
    } catch (error) {
      const message =
        error instanceof InvalidTarget ||
        error instanceof FetchFailed ||
        error instanceof TooLarge ||
        error instanceof InvalidContent
          ? error.message
          : "The icon could not be inspected.";
      icons.push({ kind, declared: candidate.href, status: "failed", message });
      findings.push({ status: "fix", label: kind, detail: message });
    }
  }
  const theme = meta.tags["theme-color"]?.[0];
  findings.push({
    status: "review",
    label: "Browser theme colour",
    detail: theme
      ? `Declared: ${theme}. Browser application depends on support and media conditions.`
      : "No theme-color declared. This is optional browser presentation metadata.",
  });
  let manifest: Record<string, unknown> = { status: "missing" };
  if (meta.manifests[0])
    try {
      const asset = await boundedFetch(
        new URL(meta.manifests[0], pageUrl).href,
        64 * 1024,
        signal,
        fetcher,
      );
      if (
        !["application/manifest+json", "application/json"].includes(asset.type)
      )
        throw new InvalidContent({
          message:
            "The manifest must return JSON with a manifest or JSON media type.",
        });
      const value = JSON.parse(new TextDecoder().decode(asset.bytes));
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new InvalidContent({
          message: "The manifest must be a JSON object.",
        });
      manifest = {
        status: "verified",
        url: asset.url,
        name: typeof value.name === "string" ? value.name.slice(0, 160) : "",
        display:
          typeof value.display === "string" ? value.display.slice(0, 80) : "",
        iconDeclarations: Array.isArray(value.icons) ? value.icons.length : 0,
      };
      findings.push({
        status: "pass",
        label: "Web app manifest",
        detail:
          "Public manifest JSON fetched and parsed. Installation, start URL and manifest icons are not verified.",
      });
    } catch {
      manifest = { status: "failed" };
      findings.push({
        status: "fix",
        label: "Web app manifest",
        detail:
          "The declared manifest could not be read as public JSON within the inspection limits.",
      });
    }
  else
    findings.push({
      status: "review",
      label: "Web app manifest",
      detail:
        "No web app manifest declared. A manifest is optional unless installation is part of this app.",
    });
  return { icons, manifest, findings };
}
export function inspect(
  input: string,
  fetcher: typeof fetch = fetch,
  options: { discovery?: boolean } = {},
) {
  return Effect.tryPromise({
    try: async (signal) => {
      const page = await boundedFetch(input, 512 * 1024, signal, fetcher);
      if (page.type !== "text/html")
        throw new InvalidContent({
          message: "The page must return text/html.",
        });
      const meta = metadata(
        new TextDecoder().decode(page.bytes),
        page.url,
        page.robots,
      );
      const images: ImageReport[] = [];
      const candidates = [
        {
          kind: "Open Graph",
          url: meta.imageDeclarations[0]?.url,
        },
        {
          kind: "X / Twitter",
          url:
            meta.tags["twitter:image"]?.[0] || meta.imageDeclarations[0]?.url,
        },
      ];
      for (const candidate of candidates) {
        if (!candidate.url) {
          images.push({
            ...candidate,
            status: "missing",
            message: "No image declared.",
          });
          continue;
        }
        // Image failure is a report finding, never a false successful inspection.
        try {
          if (!candidate.url.startsWith("https://"))
            throw new InvalidTarget({
              message: "Use an absolute HTTPS image URL.",
            });
          const previous = images.find(
            (i) => i.declared === candidate.url && i.status === "verified",
          );
          if (previous) {
            images.push({ ...previous, kind: candidate.kind });
            continue;
          }
          const image = await boundedFetch(
            candidate.url,
            5 * 1024 * 1024,
            signal,
            fetcher,
          );
          if (
            !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
              image.type,
            )
          )
            throw new InvalidContent({
              message:
                "Use a PNG, JPEG, GIF or WebP image. SVG/HTML images are not accepted by this checker.",
            });
          const dimensions = imageSize(image.bytes);
          if (
            !dimensions.width ||
            !dimensions.height ||
            dimensions.width > 10000 ||
            dimensions.height > 10000
          )
            throw new InvalidContent({
              message: "Unsupported or excessive image dimensions.",
            });
          const types: Record<string, string> = {
            png: "image/png",
            jpg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
          };
          if (types[dimensions.type || ""] !== image.type)
            throw new InvalidContent({
              message: "Image bytes do not match the declared media type.",
            });
          images.push({
            kind: candidate.kind,
            declared: candidate.url,
            url: image.url,
            status: "verified",
            width: dimensions.width,
            height: dimensions.height,
            bytes: image.bytes.length,
            type: image.type,
            redirects: image.redirects,
            message: "Public image response and file dimensions inspected.",
          });
        } catch (error) {
          images.push({
            kind: candidate.kind,
            declared: candidate.url,
            status: "failed",
            message:
              error instanceof InvalidTarget ||
              error instanceof FetchFailed ||
              error instanceof TooLarge ||
              error instanceof InvalidContent
                ? error.message
                : "The image could not be inspected.",
          });
        }
      }
      const identity = await identityAssets(meta, page.url, signal, fetcher);
      const discovery = options.discovery
        ? await discoveryChecks(page.url, meta.canonical, signal, fetcher)
        : { status: "not-requested", findings: [] as Finding[] };
      const allFindings = [
        ...meta.findings,
        ...identity.findings,
        ...imageFindings(meta, images),
        ...discovery.findings,
      ].map(explain);
      const findings =
        allFindings.length <= 80
          ? allFindings
          : [
              ...allFindings
                .sort(
                  (a, b) =>
                    ({ fix: 0, review: 1, pass: 2 })[a.status] -
                    { fix: 0, review: 1, pass: 2 }[b.status],
                )
                .slice(0, 79),
              explain({
                status: "review",
                label: "Inspection findings truncated",
                detail:
                  "The page produced more than eighty findings. Higher-priority findings were retained; this is not an exhaustive report.",
              }),
            ];
      return {
        contract: 1,
        kind: "page-inspection",
        checkedAt: new Date().toISOString(),
        guidanceReviewed: "2026-10-13",
        diagnosticsReviewed: "2026-10-14",
        url: page.url,
        redirects: page.redirects,
        htmlBytes: page.bytes.length,
        ...meta,
        findings,
        discovery,
        identity,
        images,
        limits: {
          searchIndex: "not-verified",
          platformUnfurl: "not-verified",
          robotsTxt: options.discovery ? "document-only" : "not-requested",
          sitemap: options.discovery ? "single-document-only" : "not-requested",
          crawlerPolicy: "not-simulated",
          renderedJavascript: "not-executed",
        },
      };
    },
    catch: (error): InspectionError =>
      error instanceof InvalidTarget ||
      error instanceof FetchFailed ||
      error instanceof TooLarge ||
      error instanceof InvalidContent
        ? error
        : new FetchFailed({
            message:
              "The public response could not be read. Retry or check the origin.",
          }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: "12 seconds",
      orElse: () =>
        Effect.fail(
          new FetchFailed({
            message:
              "Inspection timed out after 12 seconds. Retry when the origin responds.",
          }),
        ),
    }),
  );
}
