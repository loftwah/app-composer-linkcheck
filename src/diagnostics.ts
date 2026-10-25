import { Parser } from "htmlparser2";
import { boundedFetch } from "./inspection.ts";
import type { Finding, metadata } from "./inspection.ts";
const sources = {
  search:
    "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  sharing: "https://ogp.me/",
  accessibility: "https://www.w3.org/WAI/tutorials/images/",
  discovery:
    "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
  structured:
    "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
};
export function explain(finding: Finding): Finding {
  const label = finding.label.toLowerCase();
  const category = /robots|sitemap/.test(label)
    ? "Discovery"
    : /structured/.test(label)
      ? "Structured data"
      : /heading|image descriptions|language|zoom|viewport/.test(label)
        ? "Accessibility"
        : /og:|share|image|x card/.test(label)
          ? "Sharing"
          : /icon|manifest|theme/.test(label)
            ? "Site identity"
            : "Search";
  const why =
    category === "Discovery"
      ? "Discovery files describe crawling and URL discovery. They do not prove that a crawler visited or indexed this page."
      : category === "Structured data"
        ? "A valid JSON document can still describe the wrong thing or fail a search feature's requirements."
        : category === "Accessibility"
          ? "Semantic HTML helps people navigate and understand a page. Source checks cannot evaluate the complete rendered experience."
          : category === "Sharing"
            ? "Share crawlers read metadata and fetch image files independently. A working page in your browser is separate evidence."
            : category === "Site identity"
              ? "Browsers choose icons and presentation from declarations and supported file formats. Installation needs a separate check."
              : "Search engines combine several signals and can rewrite titles, snippets and canonicals. These checks describe the supplied HTML.";
  const action = /indexing/.test(label)
    ? "Confirm whether this page should appear in search. Keep intentional noindex on private or demonstration pages; inspect crawler access before changing it."
    : /canonical|search and share identity/.test(label)
      ? "Choose the intended public URL. Align the canonical, og:url, internal links and redirects when they refer to the same page."
      : /image file|image dimensions|image media/.test(label)
        ? "Fix the referenced public image or its declared properties, then re-inspect the actual bytes. Refresh platform caches using their official debugger."
        : /description/.test(label) && category !== "Accessibility"
          ? "Use a page-specific description grounded in the content. Do not add text solely to hit a character count."
          : category === "Accessibility"
            ? "Review the relevant HTML in its page context, then check keyboard, zoom and assistive-technology behavior. Decorative images can correctly use empty alt."
            : category === "Discovery"
              ? "Review the returned directives or entries against the intended public pages. Use Search Console and the relevant platform to verify actual crawler behavior."
              : category === "Structured data"
                ? "Choose a schema that describes the real page. Validate it with Google's Rich Results Test and Schema.org; do not invent facts to satisfy a test."
                : category === "Sharing"
                  ? "Review the observed tags, keep intended platform differences, then verify a public test link in the target client."
                  : category === "Site identity"
                    ? "Keep the declared asset public and correctly typed. Test the intended browser or installation flow separately."
                    : "Review the observed HTML against the page's purpose. Change only justified source or template values, then deploy and check again.";
  return {
    ...finding,
    category,
    priority:
      finding.status === "fix"
        ? "high"
        : finding.status === "review"
          ? "normal"
          : "low",
    why,
    action,
    source: /x card/.test(label)
      ? "https://docs.x.com/overview"
      : /indexing/.test(label)
        ? "https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag"
        : label === "page title"
          ? "https://developers.google.com/search/docs/appearance/title-link"
          : category === "Search" && /description/.test(label)
            ? "https://developers.google.com/search/docs/appearance/snippet"
            : /heading/.test(label)
              ? "https://www.w3.org/WAI/tutorials/page-structure/headings/"
              : label === "language"
                ? "https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html"
                : /zoom|viewport/.test(label)
                  ? "https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html"
                  : category === "Discovery"
                    ? sources.discovery
                    : category === "Structured data"
                      ? sources.structured
                      : category === "Accessibility"
                        ? sources.accessibility
                        : category === "Sharing"
                          ? sources.sharing
                          : category === "Search"
                            ? sources.search
                            : "https://html.spec.whatwg.org/multipage/links.html#rel-icon",
  };
}
export function imageFindings(
  meta: ReturnType<typeof metadata>,
  images: {
    kind: string;
    status: string;
    message: string;
    width?: number;
    height?: number;
    type?: string;
  }[],
): Finding[] {
  const findings: Finding[] = [];
  for (const image of images) {
    findings.push({
      status: image.status === "verified" ? "pass" : "fix",
      label: `${image.kind} image file`,
      detail: image.message,
    });
    if (image.kind !== "Open Graph" || image.status !== "verified") continue;
    const declared = meta.imageDeclarations[0];
    if (!declared) continue;
    for (const axis of ["width", "height"] as const) {
      if (declared[axis])
        findings.push({
          status: Number(declared[axis]) === image[axis] ? "pass" : "fix",
          label: `Share image dimensions (${axis})`,
          detail: `Declared ${declared[axis].slice(0, 80)}; fetched file ${image[axis]} pixels. Properties belong to the first image declaration.`,
        });
    }
    if (declared.type)
      findings.push({
        status: declared.type === image.type ? "pass" : "fix",
        label: "Share image media type",
        detail: `Declared ${declared.type.slice(0, 80)}; response and file bytes are ${image.type}.`,
      });
  }
  if (meta.imageDeclarations.length > 1)
    findings.push({
      status: "review",
      label: "Alternate share images",
      detail: `${meta.imageDeclarations.length} image declarations retained in source order (at most ten). Only the first Open Graph image and the X candidate were fetched. Dimensions for another declaration must not be attributed to the first.`,
    });
  return findings;
}
export function robotsDocument(text: string) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
  const directives = rows.flatMap((line) => {
    const match =
      /^(user-agent|allow|disallow|sitemap|crawl-delay)\s*:\s*(.*)$/i.exec(
        line,
      );
    return match
      ? [{ name: match[1].toLowerCase(), value: match[2].slice(0, 240) }]
      : [];
  });
  return {
    directives: directives.slice(0, 80),
    truncated: directives.length > 80,
    sitemap: directives.find((d) => d.name === "sitemap")?.value,
    interpreted: "document-only",
  };
}
export function sitemapDocument(
  text: string,
  pageUrl: string,
  canonical: string,
) {
  // Deliberately a bounded document inspection, not an XML/schema or crawler-policy validator.
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("Unsupported document declaration.");
  const stack: string[] = [];
  let root = "",
    prefix = "",
    active = false,
    location = "",
    count = 0;
  const urls: string[] = [];
  const parser = new Parser(
    {
      onopentag(name) {
        stack.push(name);
        if (stack.length === 1) {
          root = name.split(":").at(-1) || "";
          prefix = name.includes(":")
            ? name.slice(0, name.lastIndexOf(":") + 1)
            : "";
        }
        if (
          stack.length === 3 &&
          name === prefix + "loc" &&
          stack[1] === prefix + (root === "urlset" ? "url" : "sitemap")
        ) {
          active = true;
          location = "";
        }
      },
      ontext(value) {
        if (active) location += value.slice(0, 2048);
      },
      onclosetag(name) {
        if (active && stack.length === 3 && name === prefix + "loc") {
          count++;
          if (urls.length < 2000) urls.push(location.trim());
          active = false;
        }
        stack.pop();
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.end(text);
  if (!["urlset", "sitemapindex"].includes(root))
    throw new Error("No supported sitemap root.");
  const normalise = (value: string) => {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password
        ? u.href
        : null;
    } catch {
      return null;
    }
  };
  const parsed = urls.map(normalise);
  const wanted = normalise(canonical || pageUrl);
  return {
    root,
    entries: urls.length,
    truncated: count > 2000,
    duplicates: urls.length - new Set(urls).size,
    invalidUrls: parsed.filter((v) => v === null).length,
    pageListed: root === "urlset" ? parsed.includes(wanted) : null,
    sample: urls.slice(0, 5).map((s) => s.slice(0, 240)),
    validation: "document-only; child sitemaps and listed pages not fetched",
  };
}
export async function discoveryChecks(
  pageUrl: string,
  canonical: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
) {
  const findings: Finding[] = [];
  let robots: Record<string, unknown> = { status: "unavailable" };
  let sitemap: Record<string, unknown> = { status: "unavailable" };
  let sitemapUrl = new URL("/sitemap.xml", pageUrl).href;
  try {
    const response = await boundedFetch(
      new URL("/robots.txt", pageUrl).href,
      64 * 1024,
      signal,
      fetcher,
    );
    if (response.type !== "text/plain")
      throw new Error("robots.txt did not return text/plain.");
    const parsed = robotsDocument(new TextDecoder().decode(response.bytes));
    robots = {
      status: "read",
      url: response.url,
      bytes: response.bytes.length,
      ...parsed,
    };
    if (parsed.sitemap) sitemapUrl = parsed.sitemap;
    findings.push({
      status: "pass",
      label: "robots.txt document",
      detail: `Read ${response.bytes.length} bytes and retained ${parsed.directives.length} directives${parsed.truncated ? " (truncated)" : ""}. Rules are shown as evidence; no crawler-specific allow/deny verdict is simulated.`,
    });
  } catch {
    findings.push({
      status: "review",
      label: "robots.txt document",
      detail:
        "The optional public robots.txt could not be read within the host, media-type, byte or time limits. This does not prove that crawling is blocked or allowed.",
    });
  }
  try {
    const response = await boundedFetch(
      sitemapUrl,
      256 * 1024,
      signal,
      fetcher,
    );
    if (!["application/xml", "text/xml"].includes(response.type))
      throw new Error("Sitemap did not return XML.");
    const parsed = sitemapDocument(
      new TextDecoder().decode(response.bytes),
      pageUrl,
      canonical,
    );
    sitemap = {
      status: "read",
      url: response.url,
      bytes: response.bytes.length,
      ...parsed,
    };
    findings.push({
      status: parsed.invalidUrls || parsed.duplicates ? "review" : "pass",
      label: "Sitemap document",
      detail: `${parsed.root}: ${parsed.entries} entries${parsed.truncated ? " (truncated)" : ""}, ${parsed.duplicates} duplicates, ${parsed.invalidUrls} non-HTTPS or malformed URLs. ${parsed.pageListed === null ? "Child sitemaps were not opened." : parsed.pageListed ? "The inspected page/canonical is listed." : "The inspected page/canonical was not found in the inspected entries; inclusion is not mandatory."} XML/schema validity and search indexing remain unverified.`,
    });
  } catch {
    findings.push({
      status: "review",
      label: "Sitemap document",
      detail:
        "The optional sitemap could not be inspected within the public-destination/XML/byte limits. Every sitemap destination uses the same public-network checks. Missing or unreadable sitemaps do not by themselves prevent indexing.",
    });
  }
  return { status: "document-inspection", robots, sitemap, findings };
}
