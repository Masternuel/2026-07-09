export const IMAGE_CSP = "img-src 'self' blob:; object-src 'none'; base-uri 'self'";
export const HTTP_CSP = `${IMAGE_CSP}; frame-ancestors 'none'`;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 4096;
export const MAX_IMAGE_PIXELS = 16_000_000;

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
