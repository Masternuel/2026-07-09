const SECRET_KEY = /(authorization|cookie|password|secret|token|private.?key|credential|api.?key)|^(body|payload|requestBody|responseBody)$/i;
const MASK = "[REDACTED]";

export function stringifyRedacted(value, space) {
  return JSON.stringify(value, (key, item) => SECRET_KEY.test(key)
    ? MASK : typeof item === "string" ? redactText(item) : item, space);
}

export function redactText(value) {
  return String(value)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, MASK)
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, MASK)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/]+@/gi, `$1${MASK}@`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, MASK)
    .replace(/\b(?:AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, MASK)
    .replace(/((?:[\w.-]*(?:password|secret|token|api[_-]?key|credential)[\w.-]*|authorization|cookie|set-cookie|key)\s*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s&,}\r\n]+)/gi, `$1${MASK}`)
    .replace(/((?:set-cookie|cookie)\s*:\s*)[^\r\n]+/gi, `$1${MASK}`);
}

export function redactLogValue(value, key = "", seen = new WeakSet(), depth = 0) {
  if (SECRET_KEY.test(key)) return MASK;
  if (typeof value === "string") return redactText(value).slice(0, 16_384);
  if (!value || typeof value !== "object") return typeof value === "bigint" ? String(value) : value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= 12) return "[Truncated]";
  seen.add(value);
  const entries = value instanceof Error
    ? Object.entries({ ...value, name: value.name, message: value.message, stack: value.stack, cause: value.cause })
    : Object.entries(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactLogValue(item, "", seen, depth + 1));
  return Object.fromEntries(entries.slice(0, 100).map(([childKey, childValue]) => [
    redactText(childKey), redactLogValue(childValue, childKey, seen, depth + 1),
  ]));
}
