import { createHash } from "node:crypto";

const DEFAULT_DIGEST_BYTES = 16;
const PREFIX_BYTES = 1;

// sha256 of the same ids (finance origins, processed career events) was recomputed on every
// normalization of the save. The digest is a pure function of its input, so recent results are
// kept; the cache is dropped whole when it fills up. Callers only read the returned bytes.
const DIGEST_CACHE_LIMIT = 200_000;
const digestCache = new Map();

function digest(value, digestBytes) {
  const text = String(value);
  const cacheKey = `${digestBytes}:${text}`;
  let bytes = digestCache.get(cacheKey);
  if (!bytes) {
    if (digestCache.size >= DIGEST_CACHE_LIMIT) digestCache.clear();
    bytes = createHash("sha256").update(text).digest().subarray(0, digestBytes);
    digestCache.set(cacheKey, bytes);
  }
  return bytes;
}

function bucketKey(bytes) {
  return bytes.subarray(0, PREFIX_BYTES).toString("hex");
}

function suffixBytes(bytes) {
  return bytes.subarray(PREFIX_BYTES);
}

function validDigestBytes(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 8 && numeric <= 32
    ? numeric
    : DEFAULT_DIGEST_BYTES;
}

function normalizedBucket(value, suffixWidth) {
  if (typeof value !== "string" || !value) return Buffer.alloc(0);
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.length % suffixWidth === 0 ? bytes : Buffer.alloc(0);
  } catch {
    return Buffer.alloc(0);
  }
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CANONICAL_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Byte length of a bucket that is already canonical base64 (what decoding and re-encoding it
 * would return unchanged) holding whole digests, or -1. Lets normalization keep such buckets as
 * they are instead of decoding and re-encoding all of them on every call.
 */
function canonicalBucketLength(value, suffixWidth) {
  if (typeof value !== "string" || !value || value.length % 4 !== 0 || !CANONICAL_BASE64.test(value)) return -1;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if (padding) {
    const last = BASE64_ALPHABET.indexOf(value[value.length - padding - 1]);
    if (last & (padding === 1 ? 0b11 : 0b1111)) return -1;
  }
  const length = (value.length / 4) * 3 - padding;
  return length > 0 && length % suffixWidth === 0 ? length : -1;
}

function bucketHas(bytes, target, width) {
  for (let offset = 0; offset < bytes.length; offset += width) {
    if (bytes.subarray(offset, offset + width).equals(target)) return true;
  }
  return false;
}

export function normalizeCompactHashIndex(value, { version = 1, digestBytes = DEFAULT_DIGEST_BYTES } = {}) {
  const width = validDigestBytes(digestBytes);
  const suffixWidth = width - PREFIX_BYTES;
  const buckets = {};
  let count = 0;
  if (
    value
    && typeof value === "object"
    && Number(value.version) === version
    && Number(value.digestBytes) === width
    && value.buckets
    && typeof value.buckets === "object"
  ) {
    for (const [key, encoded] of Object.entries(value.buckets)) {
      if (!/^[0-9a-f]{2}$/i.test(key)) continue;
      const canonicalLength = canonicalBucketLength(encoded, suffixWidth);
      if (canonicalLength > 0) {
        buckets[key.toLowerCase()] = encoded;
        count += canonicalLength / suffixWidth;
        continue;
      }
      const bytes = normalizedBucket(encoded, suffixWidth);
      if (!bytes.length) continue;
      buckets[key.toLowerCase()] = bytes.toString("base64");
      count += bytes.length / suffixWidth;
    }
  }
  return {
    version,
    algorithm: "sha256",
    digestBytes: width,
    prefixBytes: PREFIX_BYTES,
    count,
    buckets,
  };
}

export function compactHash(value, { digestBytes = DEFAULT_DIGEST_BYTES } = {}) {
  return digest(value, validDigestBytes(digestBytes)).toString("base64url");
}

/**
 * Same answer as looking the value up in normalizeCompactHashIndex(index), without decoding and
 * re-encoding every bucket: only whether any bucket is valid (the normalized count) and the
 * bucket the normalized index would keep for this key (the last valid one) are needed.
 */
export function compactHashIndexContains(index, value, { version = 1, digestBytes = DEFAULT_DIGEST_BYTES } = {}) {
  if (value === null || value === undefined || value === "") return false;
  const width = validDigestBytes(digestBytes);
  const suffixWidth = width - PREFIX_BYTES;
  if (
    !index
    || typeof index !== "object"
    || Number(index.version) !== version
    || Number(index.digestBytes) !== width
    || !index.buckets
    || typeof index.buckets !== "object"
  ) return false;
  const bytes = digest(value, width);
  const target = bucketKey(bytes);
  let anyValid = false;
  let bucket = null;
  for (const [key, encoded] of Object.entries(index.buckets)) {
    if (!/^[0-9a-f]{2}$/i.test(key)) continue;
    const matches = key.toLowerCase() === target;
    if (anyValid && !matches) continue;
    const decoded = normalizedBucket(encoded, suffixWidth);
    if (!decoded.length) continue;
    anyValid = true;
    if (matches) bucket = decoded;
  }
  if (!anyValid || !bucket) return false;
  return bucketHas(bucket, suffixBytes(bytes), suffixWidth);
}

export function addCompactHashIndexValues(index, values, options = {}) {
  const normalized = normalizeCompactHashIndex(index, options);
  const width = normalized.digestBytes - PREFIX_BYTES;
  const buckets = { ...normalized.buckets };
  let count = normalized.count;
  for (const value of new Set((Array.isArray(values) ? values : []).filter((item) => item !== null && item !== undefined && item !== ""))) {
    const bytes = digest(value, normalized.digestBytes);
    const key = bucketKey(bytes);
    const suffix = suffixBytes(bytes);
    const bucket = normalizedBucket(buckets[key], width);
    if (bucketHas(bucket, suffix, width)) continue;
    buckets[key] = Buffer.concat([bucket, suffix]).toString("base64");
    count += 1;
  }
  return { ...normalized, count, buckets };
}
