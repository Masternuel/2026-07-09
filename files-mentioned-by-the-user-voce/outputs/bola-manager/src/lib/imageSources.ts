import { useEffect, useState } from 'react';
import { allowedExternalImage, MAX_IMAGE_BYTES } from '../../shared/imagePolicy.mjs';
import { createImageLoader } from '../../shared/imageLoader.mjs';

const previews = new Set<string>();
export function createImagePreview(file: File) {
  const url = URL.createObjectURL(file);
  previews.add(url);
  return url;
}
export function releaseImagePreview(url: string) {
  previews.delete(url);
  URL.revokeObjectURL(url);
}

const loader = createImageLoader({
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  async fetchImage(url, signal) {
    const base = (import.meta.env.VITE_SERVER_URL || window.location.origin).replace(/\/$/, '');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(abort, 15_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(`${base}/api/media/image?url=${encodeURIComponent(url)}`, {
        credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) throw new Error('Imagem indisponível');
      const type = response.headers.get('content-type')?.split(';', 1)[0] || '';
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)
        || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Imagem inválida');
      reader = response.body?.getReader();
      if (!reader) throw new Error('Imagem vazia');
      const chunks: ArrayBuffer[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) throw new Error('Imagem excede 5 MB');
        chunks.push(new Uint8Array(value).buffer);
      }
      return new Blob(chunks, { type });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      controller.abort();
      void reader?.cancel().catch(() => {});
    }
  },
});

function localSource(value?: string | null) {
  if (!value) return null;
  if (previews.has(value)) return value;
  return /^\/assets\/[a-zA-Z0-9_/-]+\.(?:png|jpe?g|webp)$/.test(value) && !value.includes('..') ? value : null;
}

export function useImageSource(source?: string | null) {
  const local = localSource(source);
  const external = allowedExternalImage(source);
  const [loaded, setLoaded] = useState<{ source: string; url: string | null } | null>(null);
  useEffect(() => {
    if (local || !external) return;
    const lease = loader.acquire(external);
    let current = true;
    void lease.promise.then((url) => { if (current) setLoaded({ source: external, url }); });
    return () => { current = false; lease.release(); };
  }, [local, external]);
  return local || (external && loaded?.source === external ? loaded.url : null);
}
