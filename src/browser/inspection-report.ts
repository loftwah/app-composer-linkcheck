// MIT. UI data contracts shared by rendering, export and tab-history recovery.
export interface Finding {
  status: "pass" | "fix" | "review";
  label: string;
  detail: string;
  category?: string;
  priority?: string;
  why?: string;
  action?: string;
  source?: string;
}
export interface ReportImage {
  kind: string;
  status: string;
  message?: string;
  url?: string;
  width?: number;
  height?: number;
  bytes?: number;
  type?: string;
  [key: string]: unknown;
}
export interface PortableReport {
  contract: number;
  kind: string;
  url: string;
  sourceSha: string;
  checkedAt: string;
  title: string;
  findings: Finding[];
  images: ReportImage[];
  [key: string]: unknown;
}
export interface InspectionReport extends PortableReport {
  description: string;
  canonical?: string;
  tags: Record<string, string[]>;
  identity?: {
    icons: ReportImage[];
    manifest: { status: string; name?: string };
  };
  headings?: { level: number; text: string }[];
  textLengths?: { title?: number; description?: number };
  htmlBytes?: number;
  contentImages?: { total?: number };
  imageDeclarations?: { alt?: string; [key: string]: unknown }[];
  discovery?: { status?: string; [key: string]: unknown };
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const https = (value: unknown) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};
const optionalText = (value: Record<string, unknown>, keys: string[]) =>
  keys.every(
    (key) => value[key] === undefined || typeof value[key] === "string",
  );
const optionalNumber = (value: Record<string, unknown>, keys: string[]) =>
  keys.every(
    (key) =>
      value[key] === undefined ||
      (typeof value[key] === "number" &&
        Number.isFinite(value[key]) &&
        value[key] >= 0),
  );
function image(value: unknown): boolean {
  return (
    object(value) &&
    typeof value.kind === "string" &&
    typeof value.status === "string" &&
    optionalText(value, ["message", "type"]) &&
    optionalNumber(value, ["width", "height", "bytes"]) &&
    (value.url === undefined || https(value.url)) &&
    (value.status !== "verified" || https(value.url))
  );
}
// This checks renderer shapes, not the smaller history quota. Large valid reports
// remain usable/exportable even when they cannot be retained for Back navigation.
export function inspectionReport(value: unknown): InspectionReport {
  if (
    !object(value) ||
    value.contract !== 1 ||
    value.kind !== "page-inspection" ||
    !https(value.url) ||
    typeof value.sourceSha !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.sourceSha) ||
    typeof value.checkedAt !== "string" ||
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    !object(value.tags) ||
    !Object.values(value.tags).every(
      (values) =>
        Array.isArray(values) &&
        values.every((item) => typeof item === "string"),
    ) ||
    !Array.isArray(value.images) ||
    !value.images.every(image) ||
    !Array.isArray(value.findings) ||
    !value.findings.every(
      (f) =>
        object(f) &&
        typeof f.status === "string" &&
        ["pass", "fix", "review"].includes(f.status) &&
        typeof f.label === "string" &&
        typeof f.detail === "string" &&
        optionalText(f, ["category", "priority", "why", "action"]) &&
        (f.source === undefined || https(f.source)),
    )
  )
    throw Error(
      "The inspection response could not be read. Inspect the page again.",
    );
  if (value.canonical !== undefined && typeof value.canonical !== "string")
    throw Error("The inspection canonical evidence could not be read.");
  if (
    value.identity !== undefined &&
    (!object(value.identity) ||
      !Array.isArray(value.identity.icons) ||
      !value.identity.icons.every(image) ||
      !object(value.identity.manifest) ||
      typeof value.identity.manifest.status !== "string" ||
      !optionalText(value.identity.manifest, ["name"]))
  )
    throw Error("The inspection identity evidence could not be read.");
  if (
    value.headings !== undefined &&
    (!Array.isArray(value.headings) ||
      !value.headings.every(
        (h) =>
          object(h) &&
          typeof h.level === "number" &&
          typeof h.text === "string",
      ))
  )
    throw Error("The inspection outline could not be read.");
  for (const [key, fields] of [
    ["textLengths", ["title", "description"]],
    ["contentImages", ["total"]],
  ] as const) {
    if (
      value[key] !== undefined &&
      (!object(value[key]) || !optionalNumber(value[key], [...fields]))
    )
      throw Error("The inspection inventory could not be read.");
  }
  if (
    !optionalNumber(value, ["htmlBytes"]) ||
    (value.imageDeclarations !== undefined &&
      (!Array.isArray(value.imageDeclarations) ||
        !value.imageDeclarations.every(
          (i) => object(i) && optionalText(i, ["alt"]),
        ))) ||
    (value.discovery !== undefined &&
      (!object(value.discovery) || !optionalText(value.discovery, ["status"])))
  )
    throw Error("The inspection evidence could not be read.");
  return value as InspectionReport;
}
