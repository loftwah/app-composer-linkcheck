// Generated from src/browser/navigation-draft.ts. MIT.
const property = "composerLinkcheckDraft";
const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 8192) => typeof value === "string" && value.length <= max;
function publicURL(value) {
    if (!text(value, 2048))
        return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
    }
    catch {
        return false;
    }
}
function jsonData(value, depth = 0) {
    if (depth > 10)
        return false;
    if (value === null || typeof value === "boolean")
        return true;
    if (typeof value === "number")
        return Number.isFinite(value);
    if (typeof value === "string")
        return value.length <= 65536;
    if (Array.isArray(value))
        return (value.length <= 1000 && value.every((item) => jsonData(item, depth + 1)));
    return (record(value) &&
        Object.keys(value).length <= 256 &&
        Object.entries(value).every(([key, item]) => key !== "__proto__" &&
            key !== "constructor" &&
            key !== "prototype" &&
            jsonData(item, depth + 1)));
}
// Validate every shape/URL the existing renderer reads as a control or image.
// Other bounded evidence remains inert JSON displayed with textContent.
export function validatedReport(value) {
    try {
        if (new TextEncoder().encode(JSON.stringify(value)).length > 256 * 1024 ||
            !record(value) ||
            !jsonData(value))
            return null;
        if (value.contract !== 1 ||
            value.kind !== "page-inspection" ||
            !publicURL(value.url) ||
            !text(value.checkedAt, 64) ||
            !Number.isFinite(Date.parse(value.checkedAt)) ||
            !text(value.sourceSha, 40) ||
            !/^[a-f0-9]{40}$/.test(value.sourceSha) ||
            !text(value.title) ||
            !text(value.description) ||
            !record(value.tags) ||
            !Array.isArray(value.findings) ||
            value.findings.length > 80 ||
            !Array.isArray(value.images) ||
            value.images.length > 80)
            return null;
        if (value.canonical && !publicURL(value.canonical))
            return null;
        if (!Object.values(value.tags).every((values) => Array.isArray(values) && values.every((item) => text(item))))
            return null;
        if (!value.findings.every((finding) => record(finding) &&
            typeof finding.status === "string" &&
            ["pass", "fix", "review"].includes(finding.status) &&
            text(finding.label) &&
            text(finding.detail) &&
            ["category", "priority", "why", "action"].every((key) => finding[key] === undefined || text(finding[key])) &&
            (finding.source === undefined || publicURL(finding.source))))
            return null;
        const image = (item) => record(item) &&
            text(item.kind, 200) &&
            text(item.status, 80) &&
            (item.message === undefined || text(item.message)) &&
            (item.url === undefined || publicURL(item.url)) &&
            ["width", "height", "bytes"].every((key) => item[key] === undefined ||
                (typeof item[key] === "number" &&
                    Number.isFinite(item[key]) &&
                    item[key] >= 0)) &&
            (item.type === undefined || text(item.type, 200));
        if (!value.images.every(image))
            return null;
        if (value.identity !== undefined &&
            (!record(value.identity) ||
                !Array.isArray(value.identity.icons) ||
                !value.identity.icons.every(image) ||
                !record(value.identity.manifest) ||
                !text(value.identity.manifest.status, 80) ||
                (value.identity.manifest.name !== undefined &&
                    !text(value.identity.manifest.name))))
            return null;
        if (value.headings !== undefined &&
            (!Array.isArray(value.headings) ||
                !value.headings.every((heading) => record(heading) &&
                    typeof heading.level === "number" &&
                    text(heading.text))))
            return null;
        return JSON.parse(JSON.stringify(value));
    }
    catch {
        return null;
    }
}
function entry() {
    try {
        const state = history.state;
        return record(state) && record(state[property]) ? state[property] : null;
    }
    catch {
        return null;
    }
}
function update(patch) {
    try {
        const state = history.state;
        history.replaceState({
            ...(record(state) ? state : {}),
            [property]: { ...(entry() ?? {}), version: 1, ...patch },
        }, "");
    }
    catch {
        /* History capacity/permission failure cannot interrupt inspection. */
    }
}
export function rememberReport(report) {
    const safe = validatedReport(report);
    update({ report: safe, pending: false });
    return safe !== null;
}
export function rememberPending(pending) {
    update({ report: null, pending });
}
export function restoredInspection() {
    const saved = entry();
    return {
        report: saved?.version === 1 ? validatedReport(saved.report) : null,
        pending: saved?.version === 1 && saved.pending === true,
    };
}
(() => {
    if (typeof document === "undefined")
        return;
    const url = document.querySelector("#url");
    const discovery = document.querySelector("#discovery");
    if (!url || !discovery)
        return;
    const saved = entry();
    if (saved?.version === 1 &&
        publicURL(saved.url) &&
        typeof saved.discovery === "boolean") {
        url.value = saved.url;
        discovery.checked = saved.discovery;
    }
    function remember() {
        if (url && discovery && publicURL(url.value))
            update({ url: url.value, discovery: discovery.checked });
    }
    url.addEventListener("input", remember);
    discovery.addEventListener("change", remember);
    window.addEventListener("pagehide", remember);
})();
