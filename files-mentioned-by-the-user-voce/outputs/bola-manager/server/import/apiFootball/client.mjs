// Minimal API-Football (api-sports.io v3) client for the offline catalog updater.
// The key is only sent as a request header and never logged; successful responses are
// cached on disk so a run interrupted by the daily quota resumes without spending it again.
import { createHash } from "node:crypto";
import dns from "node:dns";
import https from "node:https";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";

export class ApiFootballError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "ApiFootballError";
    this.code = code;
    this.details = details;
  }
}

function cacheKey(path, params) {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]).sort(([a], [b]) => a.localeCompare(b)));
  return `${path}?${query}`;
}

export function createMemoryCache() {
  const entries = new Map();
  return { async get(key) { return entries.get(key) ?? null; }, async set(key, value) { entries.set(key, value); }, entries };
}

export function createFileCache(directory) {
  const file = (key) => join(directory, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  return {
    async get(key) {
      try {
        const cached = JSON.parse(await readFile(file(key), "utf8"));
        return cached.key === key ? cached.body : null;
      } catch { return null; }
    },
    async set(key, body) {
      await mkdir(directory, { recursive: true });
      const target = file(key);
      await writeFile(`${target}.tmp`, JSON.stringify({ key, savedAt: new Date().toISOString(), body }));
      await rename(`${target}.tmp`, target);
    },
  };
}

// Some Brazilian ISP resolvers return NXDOMAIN for api-sports.io. Resolve with the system
// first and only fall back to public resolvers (Cloudflare, Google) for this host; the
// system DNS settings are never changed.
const PUBLIC_RESOLVERS = ["1.1.1.1", "8.8.8.8"];

export function createFallbackLookup({ systemLookup = dns.lookup, resolver = new dns.Resolver() } = {}) {
  resolver.setServers?.(PUBLIC_RESOLVERS);
  return (hostname, options, callback) => {
    systemLookup(hostname, options, (error, address, family) => {
      if (!error) return callback(null, address, family);
      if (!["ENOTFOUND", "EAI_AGAIN", "ESERVFAIL"].includes(error.code)) return callback(error);
      resolver.resolve4(hostname, (fallbackError, addresses) => {
        if (fallbackError || !addresses?.length) return callback(error);
        if (options?.all) return callback(null, addresses.map((value) => ({ address: value, family: 4 })));
        callback(null, addresses[0], 4);
      });
    });
  };
}

// fetch-compatible subset (GET + JSON) over node:https using the fallback lookup.
export function createHttpsFetch({ lookup = createFallbackLookup(), timeoutMs = 30_000 } = {}) {
  return (url, { headers = {} } = {}) => new Promise((resolvePromise, reject) => {
    const request = https.get(url, { headers, lookup, timeout: timeoutMs }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolvePromise({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          headers: { get: (name) => response.headers[String(name).toLowerCase()] ?? null },
          json: async () => JSON.parse(text),
        });
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
  });
}

// API-Football reports most failures as HTTP 200 with a non-empty `errors` object/array.
function responseErrors(body) {
  const errors = body?.errors;
  if (!errors) return [];
  if (Array.isArray(errors)) return errors.map(String);
  return Object.entries(errors).map(([field, message]) => `${field}: ${message}`);
}

function classify(errors) {
  const text = errors.join(" | ").toLowerCase();
  if (/token|key|subscription|account/.test(text) && !/request limit/.test(text)) return "API_FOOTBALL_AUTH";
  if (/requests?:|request limit|reached the request/.test(text)) return "API_FOOTBALL_QUOTA";
  if (/ratelimit|too many requests|per minute/.test(text)) return "API_FOOTBALL_RATE_LIMIT";
  if (/plan|season|free/.test(text)) return "API_FOOTBALL_PLAN";
  return "API_FOOTBALL_FAILED";
}

export function createApiFootballClient({
  key, fetchImpl = createHttpsFetch(), cache = createMemoryCache(), minIntervalMs = 6_500,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now(), maxRequests = Infinity,
} = {}) {
  if (typeof key !== "string" || !key.trim()) throw new ApiFootballError("Chave da API-Football ausente", "API_FOOTBALL_KEY_MISSING");
  let lastRequestAt = -Infinity;
  const stats = { requests: 0, cacheHits: 0, remaining: null };

  async function request(path, params, retried = false) {
    if (stats.requests >= maxRequests) throw new ApiFootballError("Limite de consultas desta execucao atingido", "API_FOOTBALL_QUOTA");
    const wait = lastRequestAt + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
    stats.requests += 1;
    const url = new URL(path, API_FOOTBALL_BASE_URL);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    let response;
    try {
      response = await fetchImpl(url, { headers: { "x-apisports-key": key.trim(), accept: "application/json" } });
    } catch (error) {
      throw new ApiFootballError("Sem conexao com a API-Football", "API_FOOTBALL_NETWORK", { cause: error?.message });
    }
    const remaining = Number(response.headers?.get?.("x-ratelimit-requests-remaining"));
    if (Number.isFinite(remaining)) stats.remaining = remaining;
    if (response.status === 429 && !retried) { await sleep(61_000); return request(path, params, true); }
    if (response.status === 401 || response.status === 403) throw new ApiFootballError("Chave da API-Football recusada", "API_FOOTBALL_AUTH");
    if (!response.ok) throw new ApiFootballError(`API-Football respondeu HTTP ${response.status}`, "API_FOOTBALL_FAILED");
    const body = await response.json();
    const errors = responseErrors(body);
    if (errors.length) {
      const code = classify(errors);
      if (code === "API_FOOTBALL_RATE_LIMIT" && !retried) { await sleep(61_000); return request(path, params, true); }
      throw new ApiFootballError(`API-Football: ${errors.join(" | ")}`, code, { errors });
    }
    return body;
  }

  return {
    stats,
    // cacheOnly: answer from the cache or return null, without spending a request.
    async get(path, params = {}, { cacheOnly = false } = {}) {
      const keyText = cacheKey(path, params);
      const cached = await cache.get(keyText);
      if (cached) { stats.cacheHits += 1; return cached.response ?? []; }
      if (cacheOnly) return null;
      const body = await request(path, params);
      await cache.set(keyText, body);
      return body.response ?? [];
    },
  };
}
