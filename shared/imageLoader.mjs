import { MAX_IMAGE_BYTES } from "./imagePolicy.mjs";

export function createImageLoader({ fetchImage, createUrl, revokeUrl, now = Date.now, maxEntries = 128, maxBytes = 16 * 1024 * 1024 }) {
  const entries = new Map();
  const queue = [];
  let active = 0;
  let bytes = 0;
  function remove(entry) {
    if (entries.get(entry.key) !== entry) return;
    entries.delete(entry.key);
    const queued = queue.indexOf(entry);
    if (queued >= 0) queue.splice(queued, 1);
    entry.controller.abort();
    entry.resolve(null);
    if (entry.url) { revokeUrl(entry.url); bytes -= entry.size; }
  }
  function trim(required = 0) {
    for (const entry of entries.values()) {
      if (entry.refs === 0 && (entries.size >= maxEntries || bytes + required > maxBytes || entry.expiresAt <= now())) remove(entry);
    }
  }
  function pump() {
    while (active < 3 && queue.length) {
      const entry = queue.shift();
      if (entries.get(entry.key) !== entry) continue;
      active += 1;
      Promise.resolve().then(() => {
        if (entry.controller.signal.aborted) throw new Error("Cancelled");
        return fetchImage(entry.key, entry.controller.signal);
      }).then((blob) => {
        if (entry.controller.signal.aborted) return;
        if (!blob.size || blob.size > MAX_IMAGE_BYTES || !["image/png", "image/jpeg", "image/webp"].includes(blob.type)) throw new Error("Invalid image");
        trim(blob.size);
        if (bytes + blob.size > maxBytes) throw new Error("Image cache full");
        entry.url = createUrl(blob);
        entry.size = blob.size;
        bytes += blob.size;
        entry.expiresAt = now() + 300_000;
        entry.resolve(entry.url);
      }).catch(() => remove(entry)).finally(() => { active -= 1; pump(); });
    }
  }
  return {
    acquire(key) {
      trim();
      let entry = entries.get(key);
      if (!entry) {
        if (entries.size >= maxEntries) return { promise: Promise.resolve(null), release() {} };
        let resolve;
        const promise = new Promise((done) => { resolve = done; });
        entry = { key, promise, resolve, controller: new AbortController(), refs: 0, size: 0, url: null, expiresAt: Infinity };
        entries.set(key, entry);
        queue.push(entry);
      }
      entry.refs += 1;
      pump();
      let released = false;
      return {
        promise: entry.promise,
        release() {
          if (released) return;
          released = true;
          entry.refs -= 1;
          if (!entry.refs && !entry.url) remove(entry);
          trim();
        },
      };
    },
    clear() { for (const entry of entries.values()) remove(entry); queue.length = 0; },
  };
}
