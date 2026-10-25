// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
// MIT. Only same-origin validated raster responses become browser object URLs.
// Untrusted metadata URLs never become an img.src or a browser network request.
export class PreviewImages {
    controller = new AbortController();
    generation = 0;
    cache = new Map();
    blobs = new Set();
    selections = new WeakMap();
    clear() {
        this.generation++;
        this.controller.abort();
        this.controller = new AbortController();
        for (const url of this.blobs)
            URL.revokeObjectURL(url);
        this.blobs.clear();
        this.cache.clear();
    }
    async set(image, url, failed) {
        const generation = this.generation;
        const selection = (this.selections.get(image) ?? 0) + 1;
        this.selections.set(image, selection);
        image.hidden = true;
        image.removeAttribute("src");
        if (!url)
            return;
        try {
            if (!this.cache.has(url))
                this.cache.set(url, (async () => {
                    const response = await fetch("/api/preview", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ url }),
                        credentials: "omit",
                        signal: AbortSignal.any([
                            this.controller.signal,
                            AbortSignal.timeout(15000),
                        ]),
                    });
                    if (!response.ok ||
                        Number(response.headers.get("content-length")) > 5 * 1024 * 1024)
                        throw Error("Preview failed");
                    const blob = await response.blob();
                    if (!/^image\/(?:png|jpeg|gif|webp|vnd\.microsoft\.icon)$/.test(blob.type) ||
                        blob.size > 5 * 1024 * 1024 ||
                        generation !== this.generation)
                        throw Error("Preview unavailable");
                    const source = URL.createObjectURL(blob);
                    this.blobs.add(source);
                    return source;
                })());
            const source = await this.cache.get(url);
            if (generation !== this.generation ||
                selection !== this.selections.get(image))
                return;
            image.onerror = () => {
                if (generation === this.generation &&
                    selection === this.selections.get(image)) {
                    image.hidden = true;
                    failed?.();
                }
            };
            image.src = source;
            image.hidden = false;
        }
        catch {
            if (generation === this.generation &&
                selection === this.selections.get(image))
                failed?.();
        }
    }
}
