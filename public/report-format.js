// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
const CAP = 64 * 1024;
const clean = (value) => String(value ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "");
const serialize = (value) => JSON.stringify(value, null, 2) + "\n";
const fits = (value) => new Blob([value]).size <= CAP;
export function reportJSON(report) {
    const safe = {
        ...report,
        title: clean(report.title),
        findings: report.findings.map((f) => ({
            ...f,
            label: clean(f.label),
            detail: clean(f.detail),
        })),
        images: report.images.map((i) => ({ ...i, message: clean(i.message) })),
    };
    const full = serialize(safe);
    if (fits(full))
        return full;
    const core = {
        contract: safe.contract,
        kind: safe.kind,
        url: safe.url,
        sourceSha: safe.sourceSha,
        checkedAt: safe.checkedAt,
        title: safe.title,
        images: safe.images,
        findings: safe.findings.map(({ status, label, detail }) => ({
            status,
            label,
            detail: detail.slice(0, 400),
        })),
        exportNote: "Extended evidence omitted to fit Composer’s 64 KiB import limit. Review it in Link Check.",
    };
    let result = serialize(core);
    if (fits(result))
        return result;
    core.title = core.title.slice(0, 400);
    core.images = core.images.map(({ kind, status, message, width, height, bytes, type }) => ({
        kind,
        status,
        message: message.slice(0, 400),
        width,
        height,
        bytes,
        type,
    }));
    core.findings = core.findings.map((f) => ({
        ...f,
        label: f.label.slice(0, 120),
        detail: f.detail.slice(0, 160),
    }));
    result = serialize(core);
    if (!fits(result))
        throw new Error("This report cannot fit the portable limit. Save the readable report instead.");
    return result;
}
