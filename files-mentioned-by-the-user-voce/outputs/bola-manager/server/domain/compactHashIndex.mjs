import { createHash } from "node:crypto";

const DEFAULT_DIGEST_BYTES = 16;
const PREFIX_BYTES = 1;

function digest(value, digestBytes) {
  return createHash("sha256").update(String(value)).digest().subarray(0, digestBytes);
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

export function compactHashIndexContains(index, value, options = {}) {
  if (value === null || value === undefined || value === "") return false;
  const normalized = normalizeCompactHashIndex(index, options);
  if (!normalized.count) return false;
  const bytes = digest(value, normalized.digestBytes);
  const suffix = suffixBytes(bytes);
  const bucket = normalizedBucket(
    normalized.buckets[bucketKey(bytes)],
    normalized.digestBytes - PREFIX_BYTES,
  );
  return bucketHas(bucket, suffix, normalized.digestBytes - PREFIX_BYTES);
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
