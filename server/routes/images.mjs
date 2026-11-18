import { Router } from "express";
import { createHash } from "node:crypto";
import { allowedExternalImage, MAX_IMAGE_BYTES } from "../../shared/imagePolicy.mjs";
import { prepareCatalogMedia, CatalogMediaError } from "../services/catalogMedia.mjs";

export function createImagesRouter({ fetchImpl = globalThis.fetch, timeoutMs = 10_000, now = Date.now } = {}) {
  const router = Router();
  const cache = new Map();
  let cacheBytes = 0;
  let active = 0;
  function evict(key) { cacheBytes -= cache.get(key).bytes.length; cache.delete(key); }
  router.get("/image", async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    const url = allowedExternalImage(request.query.url);
    if (!url) return response.status(400).json({ error: { code: "IMAGE_ORIGIN_BLOCKED", message: "Origem de imagem nao permitida; envie pelo Editor" } });
    const key = createHash("sha256").update(url).digest("hex");
    for (const [id, entry] of cache) if (entry.expiresAt <= now()) evict(id);
    const send = (entry) => response.type(entry.mimeType).send(entry.bytes);
    if (cache.has(key)) return send(cache.get(key));
    if (active >= 4) {
      response.setHeader("Retry-After", "2");
      return response.status(503).json({ error: { code: "IMAGE_BUSY", message: "Processamento ocupado; tente novamente" } });
    }
    active += 1;
    const controller = new AbortController();
    const disconnected = () => { if (!response.writableEnded) controller.abort(); };
    response.once("close", disconnected);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let upstream;
    let reader;
    try {
      upstream = await fetchImpl(url, {
        redirect: "error", signal: controller.signal, credentials: "omit",
        headers: { Accept: "image/png,image/jpeg,image/webp" },
      });
      if (!upstream.ok || upstream.redirected || (upstream.url && upstream.url !== url)) {
        throw new CatalogMediaError("Imagem externa indisponivel", "IMAGE_FETCH_FAILED", 502);
      }
      const mime = upstream.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) {
        throw new CatalogMediaError("Use PNG, JPEG ou WebP", "EDITOR_MEDIA_MIME_UNSUPPORTED", 415);
      }
      if (Number(upstream.headers.get("content-length")) > MAX_IMAGE_BYTES) {
        throw new CatalogMediaError("Imagem externa excede 5 MB", "EDITOR_MEDIA_TOO_LARGE", 413);
      }
      reader = upstream.body?.getReader();
      if (!reader) throw new CatalogMediaError("Imagem vazia", "IMAGE_FETCH_FAILED", 502);
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) throw new CatalogMediaError("Imagem externa excede 5 MB", "EDITOR_MEDIA_TOO_LARGE", 413);
        chunks.push(Buffer.from(value));
      }
      const prepared = await prepareCatalogMedia(mime, Buffer.concat(chunks, size), { thumbnail: true });
      if (controller.signal.aborted) throw new Error("aborted");
      if (cache.has(key)) evict(key);
      while (cache.size >= 128 || cacheBytes + prepared.bytes.length > 16 * 1024 * 1024) evict(cache.keys().next().value);
      const entry = { bytes: prepared.bytes, mimeType: prepared.mimeType, expiresAt: now() + 300_000 };
      cache.set(key, entry);
      cacheBytes += entry.bytes.length;
      return send(entry);
    } catch (error) {
      if (response.destroyed) return;
      const timeout = controller.signal.aborted;
      return response.status(timeout ? 504 : error instanceof CatalogMediaError ? error.status : 502).json({
        error: { code: timeout ? "IMAGE_TIMEOUT" : error instanceof CatalogMediaError ? error.code : "IMAGE_FETCH_FAILED",
          message: "Imagem bloqueada, invalida ou indisponivel; envie PNG, JPEG ou WebP pelo Editor" },
      });
    } finally {
      clearTimeout(timer);
      response.off("close", disconnected);
      controller.abort();
      void (reader ? reader.cancel() : upstream?.body?.cancel())?.catch(() => {});
      active -= 1;
    }
  });
  return router;
}
