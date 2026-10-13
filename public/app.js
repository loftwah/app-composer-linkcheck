const $ = (selector) => document.querySelector(selector);
let report;
let controller;
try {
  if (localStorage.getItem("linkcheck-theme") === "light")
    document.documentElement.dataset.theme = "light";
} catch {}
function themeLabel() {
  $("#theme").textContent =
    document.documentElement.dataset.theme === "light"
      ? "Dark mode"
      : "Light mode";
}
themeLabel();
$("#theme").addEventListener("click", () => {
  const theme =
    document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("linkcheck-theme", theme);
  } catch {}
  themeLabel();
});
function preview() {
  if (!report) return;
  const platform = $("#platform").value;
  const x = platform === "x";
  const search = platform === "search";
  const tags = report.tags;
  const first = (key) => tags[key]?.[0] || "";
  const image = report.images.find(
    (i) => i.kind === (x ? "X / Twitter" : "Open Graph"),
  );
  $("#preview").dataset.shape = platform;
  $("#preview-title").textContent =
    (search ? report.title : x ? first("twitter:title") : first("og:title")) ||
    report.title;
  $("#preview-description").textContent =
    (x
      ? first("twitter:description")
      : search
        ? report.description
        : first("og:description")) || report.description;
  $("#preview-host").textContent = new URL(report.url).hostname;
  $("#preview-image").hidden = search || image?.status !== "verified";
  $("#preview-image").removeAttribute("src");
  if (!$("#preview-image").hidden) {
    $("#preview-image").src = image.url;
    $("#preview-image").alt =
      (x ? first("twitter:image:alt") : first("og:image:alt")) ||
      first("og:image:alt") ||
      "Declared share image";
  }
  $("#image-proof").textContent = search
    ? "Search appearance may be rewritten by the engine."
    : `${image?.message || "No image inspected."}${x && !first("twitter:image") ? " X image is inferred from Open Graph; confirm platform behavior." : ""}`;
  $("#image-dimensions").textContent =
    image?.status === "verified" && !search
      ? `${image.width} × ${image.height} · ${Math.round(image.bytes / 1024)} KB · ${image.type}`
      : "";
}
$("#platform").addEventListener("change", preview);
function identity() {
  const data = report.identity;
  const icon = data?.icons.find(
    (i) => i.status === "verified" && i.type !== "image/svg+xml",
  );
  $("#site-icon").hidden = !icon;
  $("#site-icon").removeAttribute("src");
  if (icon) $("#site-icon").src = icon.url;
  $("#site-title").textContent = report.title || "Untitled page";
  $("#site-host").textContent = new URL(report.url).hostname;
  $("#site-description").textContent =
    report.description || "No page description found.";
  $("#site-details").replaceChildren();
  for (const [label, value] of [
    ["Canonical", report.canonical || "Not declared"],
    ["Browser theme", report.tags["theme-color"]?.[0] || "Not declared"],
    [
      "Manifest",
      data?.manifest.status === "verified"
        ? data.manifest.name || "JSON verified"
        : data?.manifest.status || "Not inspected",
    ],
  ]) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    $("#site-details").append(dt, dd);
  }
  $("#icon-evidence").replaceChildren();
  for (const item of data?.icons || []) {
    const p = document.createElement("p");
    p.textContent = `${item.kind}: ${item.status === "verified" ? `${item.type} · ${item.bytes} bytes${item.width && item.height ? ` · ${item.width} × ${item.height}${item.type === "image/svg+xml" ? " viewBox" : " pixels"}` : ""}` : item.message}`;
    $("#icon-evidence").append(p);
  }
}
$("#inspect").addEventListener("submit", async (event) => {
  event.preventDefault();
  controller?.abort();
  controller = new AbortController();
  $("#submit").disabled = true;
  $("#submit").textContent = "Inspecting…";
  $("#status").textContent =
    "Reading the public page, site icons and share images…";
  $("#report").hidden = true;
  report = undefined;
  try {
    const response = await fetch("/api/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: $("#url").value.trim() }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Inspection failed. Retry.");
    report = data;
    $("#report-title").textContent = new URL(report.url).hostname;
    $("#checked").textContent =
      "Fetched " +
      new Date(report.checkedAt).toLocaleString() +
      ". No scripts executed.";
    $("#findings").replaceChildren();
    $("#passed-findings").replaceChildren();
    for (const finding of report.findings) {
      const li = document.createElement("li");
      const strong = document.createElement("strong");
      strong.textContent = `${finding.status === "pass" ? "Checked" : finding.status === "fix" ? "Fix" : "Review"} — ${finding.label}`;
      li.dataset.status = finding.status;
      li.append(strong);
      const p = document.createElement("p");
      p.textContent = finding.detail;
      li.append(p);
      $(finding.status === "pass" ? "#passed-findings" : "#findings").append(
        li,
      );
    }
    const fixes = report.findings.filter((f) => f.status === "fix").length;
    const passes = report.findings.filter((f) => f.status === "pass").length;
    const imageFailures = report.images.filter(
      (i) => i.status !== "verified",
    ).length;
    $("#summary-count").textContent =
      `${fixes} page ${fixes === 1 ? "fix" : "fixes"} · ${imageFailures} share-image ${imageFailures === 1 ? "problem" : "problems"} · ${passes} page checks passed`;
    $("#no-problems").hidden = fixes !== 0;
    $("#passed-label").textContent = `${passes} page checks passed`;
    $("#raw").textContent = JSON.stringify(
      {
        sourceSha: report.sourceSha,
        url: report.url,
        redirects: report.redirects,
        tags: report.tags,
        icons: report.icons,
        identity: report.identity,
        structured: report.structured,
        limits: report.limits,
      },
      null,
      2,
    );
    $("#report").hidden = false;
    $("#empty").hidden = true;
    $("#status").textContent =
      "Inspection complete. Export this report or review the findings below.";
    identity();
    preview();
  } catch (error) {
    $("#status").textContent =
      error.name === "AbortError"
        ? "Inspection cancelled. You can retry."
        : error.message;
    $("#empty").hidden = false;
  } finally {
    $("#submit").disabled = false;
    $("#submit").textContent = "Inspect page";
  }
});
$("#export").addEventListener("click", () => {
  if (!report) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "linkcheck-report.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
