export const IMAGE_CSP = "img-src 'self' blob:; object-src 'none'; base-uri 'self'";
export const HTTP_CSP = `${IMAGE_CSP}; frame-ancestors 'none'`;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 4096;
export const MAX_IMAGE_PIXELS = 16_000_000;

/** Caller must require the native desktop bridge and a local/peer identity. Never request the stored origin. */
export function allowedDesktopImage(value, currentOrigin) {
  if (typeof value !== "string" || typeof currentOrigin !== "string" || value.length > 2048
    || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const app = new URL(currentOrigin);
    const url = new URL(value);
    if (app.protocol !== "http:" || app.hostname !== "127.0.0.1" || app.origin !== currentOrigin
      || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash
      || url.href !== value || !/^\/desktop-media\/[a-f0-9-]{36}$/.test(url.pathname)) return null;
    return `${app.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

export function allowedExternalImage(value) {
  if (typeof value !== "string" || value.length > 2048 || !value
    || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
    const path = decodeURIComponent(url.pathname);
    if (/\.(?:svgz?|gif)(?:$|[/?])/i.test(path) || /[\u0000-\u001f\u007f\\]/.test(path)) return null;
    const allowed = (url.hostname === "res.cloudinary.com" && /^\/[\w-]+\/image\/upload\/.+/.test(path))
      || (url.hostname === "firebasestorage.googleapis.com"
        && /^\/v0\/b\/[\w.-]+\/o\/.+/.test(path) && url.searchParams.get("alt") === "media")
      || (url.hostname === "lh3.googleusercontent.com" && path.length > 1);
    return allowed ? url.href : null;
  } catch {
    return null;
  }
}
