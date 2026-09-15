import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseTrustedProxies } from "../server/infrastructure/networkPolicy.mjs";
import { cloudinaryConfigFromEnv } from "../server/services/cloudinaryMedia.mjs";

export const GROUPS = Object.freeze({
  redis: ["redisTest"],
  firebase: ["firebase", "storage"],
  media: ["cloudinary"],
  ai: ["redis", "gemini"],
  all: ["backend", "frontend", "proxy", "redis", "redisTest", "firebase", "storage", "cloudinary", "gemini"],
});
export const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const present = (value) => typeof value === "string" && Boolean(value.trim());
const projectId = (value) => /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value ?? "");
const integer = (value) => /^\d+$/.test(value ?? "") && Number.isSafeInteger(Number(value)) && Number(value) > 0;

function origin(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
  return url.origin;
}

function redisEndpoint(raw) {
  const url = new URL(raw);
  if (!["redis:", "rediss:"].includes(url.protocol) || !url.hostname || url.search || url.hash || !/^\/\d*$/.test(url.pathname || "/")) throw new Error();
  // Same host/port is the same service even with another credential, DB or scheme.
  return `${url.hostname.toLowerCase()}:${url.port || "6379"}`;
}

export function serviceTargets(env) {
  const targets = {};
  const attempt = (service, task) => { try { targets[service] = task(); } catch { /* Missing/invalid configuration is reported below. */ } };
  attempt("backend", () => origin(env.STAGING_BACKEND_URL));
  attempt("frontend", () => origin(env.STAGING_FRONTEND_ORIGIN));
  attempt("proxy", () => ({ backend: origin(env.STAGING_BACKEND_URL), trust: parseTrustedProxies(env.TRUST_PROXY) }));
  attempt("redis", () => redisEndpoint(env.REDIS_URL));
  attempt("redisTest", () => redisEndpoint(env.TEST_REDIS_URL));
  if (projectId(env.FIREBASE_PROJECT_ID)) targets.firebase = env.FIREBASE_PROJECT_ID;
  if (/^[a-z0-9][a-z0-9.-]{2,221}[a-z0-9]$/.test(env.FIREBASE_STORAGE_BUCKET ?? "")) targets.storage = env.FIREBASE_STORAGE_BUCKET;
  const cloud = cloudinaryConfigFromEnv(env);
  if (cloud.complete && /^[a-z0-9_-]+$/i.test(cloud.cloudName)) targets.cloudinary = cloud.cloudName.toLowerCase();
  if (projectId(env.STAGING_GEMINI_PROJECT_ID)) targets.gemini = env.STAGING_GEMINI_PROJECT_ID;
  return targets;
}

function credentialFingerprint(env, service) {
  if (service === "cloudinary") {
    const cloud = cloudinaryConfigFromEnv(env);
    return fingerprint([cloud.apiKey, cloud.apiSecret]);
  }
  if (service === "gemini") return fingerprint(env.GEMINI_API_KEY || "");
  if (service === "firebase") return fingerprint([env.FIREBASE_SERVICE_ACCOUNT_JSON, env.STAGING_FIREBASE_ADMIN_JSON]);
  return null;
}

export function isolationTemplate(env) {
  const targets = serviceTargets(env);
  return {
    version: 1, environment: "", productionInventoryReviewed: false,
    // Fill production target hashes offline using fingerprint/serviceTargets; never copy credentials.
    production: Object.fromEntries(GROUPS.all.map((service) => [service, []])),
    services: Object.fromEntries(GROUPS.all.map((service) => [service, {
      environment: "", isolated: false, evidence: "",
      targetHash: targets[service] === undefined ? "" : fingerprint(targets[service]),
      credentialHash: credentialFingerprint(env, service),
    }])),
  };
}

export function evaluatePreflight(env, isolation, { group = "all", destructive = false } = {}) {
  if (!Object.hasOwn(GROUPS, group)) throw new Error("INVALID_GROUP");
  const rows = [];
  const targets = serviceTargets(env);
  const add = (name, status, secret = false, configured = false, reason) => rows.push({ name, status, ...(secret ? { configured } : {}), ...(reason ? { reason } : {}) });
  const check = (name, validate = present, { secret = false, optional = false } = {}) => {
    if (!present(env[name])) return add(name, optional ? "NOT CONFIGURED" : "MISSING", secret, false);
    let valid = false;
    try { valid = Boolean(validate(env[name])); } catch { /* Never emit input or SDK/parser errors. */ }
    add(name, valid ? "PASS" : "INVALID", secret, true);
  };
  check("STAGING_ENVIRONMENT", (value) => value === "staging");
  check("BOLA_ENV_FILES", (value) => value === "false");
  check("NODE_ENV", (value) => destructive ? ["test", "staging"].includes(value) : ["test", "staging", "production"].includes(value));
  if (destructive) check("STAGING_ALLOW_WRITES", (value) => value === "true");
  for (const name of ["RAILWAY_ENVIRONMENT_NAME", "APP_ENV", "ENVIRONMENT"]) {
    if (/^(prod|production)$/i.test(env[name]?.trim() ?? "")) add(name, "INVALID", false, false, "PRODUCTION_BLOCKED");
  }
  for (const name of ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST", "GOOGLE_API_USE_MTLS_ENDPOINT"]) {
    if (present(env[name])) add(name, "INVALID");
  }
  const account = (raw) => {
    const value = JSON.parse(raw);
    return value.type === "service_account" && value.project_id === env.FIREBASE_PROJECT_ID
      && value.client_email?.endsWith(`@${value.project_id}.iam.gserviceaccount.com`)
      && /^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----\s*$/.test(value.private_key ?? "");
  };
  for (const service of GROUPS[group]) {
    if (service === "backend") {
      check("STAGING_BACKEND_URL", origin);
      check("STAGING_REPLICA_COUNT", (value) => integer(value) && Number(value) >= 2);
      check("ROOM_STORE", (value) => value === "firestore");
      check("ALLOW_DEMO_AUTH", (value) => value === "false");
      check("ALLOW_LOCAL_EDITOR", (value) => value === "false");
      check("METRICS_TOKEN", (value) => /^[\x21-\x7e]{32,256}$/.test(value), { secret: true });
    } else if (service === "frontend") {
      check("STAGING_FRONTEND_ORIGIN", origin);
      check("VITE_SERVER_URL", (value) => origin(value) === targets.backend);
      check("CLIENT_ORIGIN", (value) => value.split(",").every((item) => origin(item.trim()) === targets.frontend));
      check("VITE_FIREBASE_PROJECT_ID", (value) => value === targets.firebase);
      check("VITE_FIREBASE_STORAGE_BUCKET", (value) => value === targets.storage);
      check("VITE_FIREBASE_API_KEY", present, { secret: true });
      check("VITE_FIREBASE_AUTH_DOMAIN", (value) => /^[a-z0-9.-]+$/i.test(value));
      check("VITE_FIREBASE_APP_ID");
      check("VITE_FIREBASE_MESSAGING_SENDER_ID", integer);
    } else if (service === "proxy") {
      check("TRUST_PROXY", (value) => { parseTrustedProxies(value); return true; });
    } else if (service === "redis" || service === "redisTest") {
      const name = service === "redis" ? "REDIS_URL" : "TEST_REDIS_URL";
      check(name, redisEndpoint, { secret: true });
    } else if (service === "firebase") {
      check("FIREBASE_PROJECT_ID", projectId);
      check("FIREBASE_SERVICE_ACCOUNT_JSON", account, { secret: true });
      check("STAGING_FIREBASE_ADMIN_JSON", account, { secret: true });
      try {
        if (JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON).client_email === JSON.parse(env.STAGING_FIREBASE_ADMIN_JSON).client_email) add("Separate Firebase identities", "INVALID");
      } catch { /* Account checks above already fail closed. */ }
      for (const name of ["FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "GOOGLE_APPLICATION_CREDENTIALS"]) {
        if (present(env[name])) add(name, "INVALID", true, true);
      }
      if (env.FIREBASE_USE_APPLICATION_DEFAULT && env.FIREBASE_USE_APPLICATION_DEFAULT !== "false") add("FIREBASE_USE_APPLICATION_DEFAULT", "INVALID");
    } else if (service === "storage") {
      check("FIREBASE_STORAGE_BUCKET", () => targets.storage !== undefined);
    } else if (service === "cloudinary") {
      const hasUrl = present(env.CLOUDINARY_URL);
      const hasParts = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].some((name) => present(env[name]));
      if (hasUrl && hasParts) add("Cloudinary credential source", "INVALID");
      if (hasUrl) check("CLOUDINARY_URL", (value) => new URL(value).protocol === "cloudinary:" && targets.cloudinary !== undefined, { secret: true });
      else {
        check("CLOUDINARY_CLOUD_NAME", (value) => /^[a-z0-9_-]+$/i.test(value));
        check("CLOUDINARY_API_KEY", present, { secret: true });
        check("CLOUDINARY_API_SECRET", present, { secret: true });
      }
    } else if (service === "gemini") {
      check("STAGING_GEMINI_PROJECT_ID", projectId);
      check("GEMINI_API_KEY", present, { secret: true });
      check("GEMINI_MODEL", (value) => /^[a-z0-9._-]+$/i.test(value));
      check("STAGING_AI_BUDGET_CONFIRMED", (value) => value === "true");
    }
    const proof = isolation?.services?.[service];
    const hash = targets[service] === undefined ? null : fingerprint(targets[service]);
    const denied = isolation?.production?.[service];
    const redisDenied = [isolation?.production?.redis, isolation?.production?.redisTest].filter(Array.isArray).flat();
    const production = isolation?.environment === "production" || proof?.environment === "production"
      || (hash && (service.startsWith("redis") ? redisDenied : Array.isArray(denied) ? denied : []).includes(hash));
    const credentials = credentialFingerprint(env, service);
    const productionListValid = (value) => Array.isArray(value) && value.every((item) => /^[a-f0-9]{64}$/.test(item));
    const confirmed = isolation?.version === 1 && isolation.environment === "staging"
      && isolation.productionInventoryReviewed === true && Array.isArray(denied)
      && productionListValid(denied)
      && (!service.startsWith("redis") || [isolation.production.redis, isolation.production.redisTest].every(productionListValid))
      && proof?.environment === "staging" && proof.isolated === true
      && present(proof.evidence) && hash && proof.targetHash === hash
      && (!credentials || proof.credentialHash === credentials);
    add(`${service} isolation`, production ? "INVALID" : confirmed ? "PASS" : "NOT CONFIGURED", false, false,
      production ? "PRODUCTION_BLOCKED" : confirmed ? undefined : "ISOLATION_UNCONFIRMED");
  }
  const targetHashes = Object.fromEntries(GROUPS[group].filter((service) => targets[service] !== undefined).flatMap((service) => [
    [service, fingerprint(targets[service])],
    ...(credentialFingerprint(env, service) ? [[`${service}:credential`, credentialFingerprint(env, service)]] : []),
  ]));
  return { group, ok: rows.every((row) => row.status === "PASS"), rows, targetHashes };
}

export async function readIsolation(env) {
  if (!present(env.STAGING_ISOLATION_FILE)) return null;
  try {
    const raw = await readFile(env.STAGING_ISOLATION_FILE, "utf8");
    if (raw.length > 64 * 1024) return null;
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : null;
  } catch { return null; }
}

export function printPreflight(result) {
  for (const row of result.rows) console.log(`${row.name}: ${row.status}${"configured" in row ? `; configured: ${row.configured}` : ""}${row.reason ? `; ${row.reason}` : ""}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--write-isolation-template" && args.length === 2) {
    // Deliberately false confirmations. No network, existing file overwrite or credentials in output.
    await writeFile(resolve(args[1]), `${JSON.stringify(isolationTemplate(process.env), null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log("Isolation template: NOT CONFIGURED; ISOLATION_UNCONFIRMED");
    return;
  }
  if (args.length) throw new Error("INVALID_ARGUMENTS");
  const result = evaluatePreflight(process.env, await readIsolation(process.env));
  printPreflight(result);
  process.exitCode = result.ok ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error("Preflight: INVALID"); process.exitCode = 2; });
}
