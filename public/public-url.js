// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
// MIT. URL syntax policy shared by the hosted inspector and report consumers.
// This is not a DNS or network check; fetching also requires public egress.
export function publicUrl(input) {
    if (typeof input !== "string" ||
        input.length > 2048 ||
        /[\u0000-\u0020\\]/.test(input))
        throw Error("Enter a complete public HTTPS URL without spaces or credentials.");
    let url;
    try {
        url = new URL(input);
    }
    catch {
        throw Error("Enter a complete HTTPS URL.");
    }
    url.hash = "";
    url.hostname = url.hostname.replace(/\.$/, "");
    const host = url.hostname;
    if (url.protocol !== "https:" ||
        url.port ||
        url.username ||
        url.password ||
        !host.includes(".") ||
        host.length > 253 ||
        /^[\d.]+$/.test(host) ||
        host.includes(":") ||
        host
            .split(".")
            .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
        /(?:^|\.)(?:localhost|local|internal|invalid|test|example|onion|home|lan|corp|intranet|arpa)$/.test(host))
        throw Error("Use a public HTTPS hostname. Local addresses, IP addresses, credentials and custom ports are not supported.");
    let path = url.pathname;
    try {
        for (let depth = 0; depth < 3 && /%[a-f0-9]{2}/i.test(path); depth++)
            path = decodeURIComponent(path);
    }
    catch {
        throw Error("The URL contains an invalid encoded path.");
    }
    if (/%[a-f0-9]{2}/i.test(path) ||
        /[\u0000-\u001f\\]/.test(path) ||
        /\/(?:_emdash|api|admin|studio|owner|private)(?:\/|$)/i.test(path))
        throw Error("Choose a public page rather than a private, administrative or API path.");
    for (const key of url.searchParams.keys())
        if (/(?:^|[_-])(?:token|secret|password|passphrase|auth|authorization|session|signature|credential|apikey|api-key|key|code|sig)(?:$|[_-])/i.test(key))
            throw Error("Remove credentials, access tokens and signed/private query parameters before inspecting a page.");
    return url;
}
