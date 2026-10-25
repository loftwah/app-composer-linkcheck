import test from "node:test";
import assert from "node:assert/strict";
import { PreviewImages } from "../public/preview-images.js";
const image = () => ({
  hidden: false,
  src: "",
  removeAttribute() {
    this.src = "";
  },
});
test("browser previews use same-origin POST bytes, cache within a report and revoke object URLs", async () => {
  const original = globalThis.fetch;
  const revoke = URL.revokeObjectURL;
  const calls = [],
    revoked = [];
  const images = new PreviewImages();
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(new Blob(["raster"], { type: "image/png" }));
    };
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
      revoke(url);
    };
    const element = image();
    await images.set(element, "https://public.example.net/image.png");
    assert.equal(element.hidden, false);
    assert.match(element.src, /^blob:/);
    const blob = element.src;
    await images.set(element, "https://public.example.net/image.png");
    assert.equal(element.src, blob);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/preview");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.credentials, "omit");
    images.clear();
    assert.deepEqual(revoked, [blob]);
  } finally {
    images.clear();
    globalThis.fetch = original;
    URL.revokeObjectURL = revoke;
  }
});
test("a late preview from a cleared report cannot overwrite the next report or expose its old source", async () => {
  const original = globalThis.fetch;
  const images = new PreviewImages();
  let finish, requestSignal;
  try {
    globalThis.fetch = (_url, init) => {
      requestSignal = init.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const element = image();
    const pending = images.set(element, "https://old.example.net/old.png");
    images.clear();
    assert.equal(requestSignal.aborted, true);
    await images.set(element);
    finish(new Response(new Blob(["raster"], { type: "image/png" })));
    await pending;
    assert.equal(element.src, "");
    assert.equal(element.hidden, true);
  } finally {
    images.clear();
    globalThis.fetch = original;
  }
});
