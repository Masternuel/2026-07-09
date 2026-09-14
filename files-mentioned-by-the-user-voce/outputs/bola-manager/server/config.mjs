import { validateMetricsToken } from "./infrastructure/metricsEndpoint.mjs";
import { createOriginPolicy, parseTrustedProxies } from "./infrastructure/networkPolicy.mjs";

function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = nonNegativeInteger(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function enabled(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function commaSeparatedValues(value) {
  return [...new Set(String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean))];
}

const DEFAULT_LOCAL_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
].join(",");

export function getServerConfig(env = process.env) {
  const explicitNodeEnv = env.NODE_ENV?.trim();
  const nodeEnv = explicitNodeEnv || "development";
  const requestedDemoAuth = enabled(env.ALLOW_DEMO_AUTH);
  const requestedLocalEditor = enabled(env.ALLOW_LOCAL_EDITOR);
  if (nodeEnv === "production" && requestedDemoAuth) {
    throw new Error("ALLOW_DEMO_AUTH nunca pode ser ativado em producao");
  }

  const clientOrigin = env.CLIENT_ORIGIN?.trim() || (nodeEnv === "production" ? "" : DEFAULT_LOCAL_ORIGINS);
  createOriginPolicy(clientOrigin, nodeEnv);
  return {
    port: nonNegativeInteger(env.PORT, 3001),
    clientOrigin,
    trustProxy: parseTrustedProxies(env.TRUST_PROXY?.trim()),
    enableHsts: nodeEnv === "production" && enabled(env.ENABLE_HSTS),
    matchEventDelayMs: nonNegativeInteger(env.MATCH_EVENT_DELAY_MS, 800),
    nodeEnv,
    allowDemoAuth: requestedDemoAuth,
    allowLocalEditor: ["development", "test"].includes(explicitNodeEnv) && requestedLocalEditor,
    editorAdminUids: commaSeparatedValues(env.EDITOR_ADMIN_UIDS),
    roomStoreMode: env.ROOM_STORE?.trim().toLowerCase() || (requestedDemoAuth ? "memory" : "firestore"),
    redisUrl: env.REDIS_URL?.trim() || "",
    instanceId: env.INSTANCE_ID?.trim()
      || env.RAILWAY_REPLICA_ID?.trim()
      || env.HOSTNAME?.trim()
      || `local-${process.pid}`,
    lockTtlMs: positiveInteger(env.LOCK_TTL_MS, 15_000),
    lockWaitMs: nonNegativeInteger(env.LOCK_WAIT_MS, 2_000),
    lockRetryMs: positiveInteger(env.LOCK_RETRY_MS, 100),
    rateLimitWindowMs: positiveInteger(env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitHttpMax: positiveInteger(env.RATE_LIMIT_HTTP_MAX, 240),
    rateLimitSocketMax: positiveInteger(env.RATE_LIMIT_SOCKET_MAX, 120),
    metricsToken: validateMetricsToken(env.METRICS_TOKEN),
    dependencyTimeoutMs: positiveInteger(env.DEPENDENCY_TIMEOUT_MS, 2_500),
    readinessCacheMs: Math.min(2_000, positiveInteger(env.READINESS_CACHE_MS, 1_000)),
    authTimeoutMs: positiveInteger(env.AUTH_TIMEOUT_MS, 10_000),
    socketAuthRecheckMs: positiveInteger(env.SOCKET_AUTH_RECHECK_MS, 60_000),
    httpSlowMs: positiveInteger(env.HTTP_SLOW_MS, 5_000),
    socketSlowMs: positiveInteger(env.SOCKET_SLOW_MS, 5_000),
    eventLoopWarnMs: positiveInteger(env.EVENT_LOOP_WARN_MS, 250),
    matchPersistenceTimeoutMs: positiveInteger(env.MATCH_PERSISTENCE_TIMEOUT_MS, 15_000),
    shutdownTimeoutMs: positiveInteger(env.SHUTDOWN_TIMEOUT_MS, 10_000),
    importObjectTtlDays: positiveInteger(env.IMPORT_OBJECT_TTL_DAYS, 1),
    importQuotas: {
      maxActiveSessionsPerUser: positiveInteger(env.IMPORT_MAX_SESSIONS_PER_UID, 3),
      maxReservedBytesPerUser: positiveInteger(env.IMPORT_MAX_RESERVED_BYTES_PER_UID, 2 * 1024 * 1024 * 1024),
      maxConcurrentProcessesPerUser: positiveInteger(env.IMPORT_MAX_PROCESSES_PER_UID, 1),
    },
    aiLimits: {
      windowMs: positiveInteger(env.AI_BUDGET_WINDOW_MS, 3_600_000),
      operationLimit: positiveInteger(env.AI_OPERATION_ATTEMPTS, 60),
      userLimit: positiveInteger(env.AI_UID_ATTEMPTS, 120),
      globalLimit: positiveInteger(env.AI_GLOBAL_ATTEMPTS, 1_000),
      userConcurrent: positiveInteger(env.AI_UID_CONCURRENCY, 1),
      globalConcurrent: positiveInteger(env.AI_GLOBAL_CONCURRENCY, 8),
    },
  };
}

export function loadLocalEnvironment({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.NODE_ENV === "production" || typeof process.loadEnvFile !== "function") return [];
  const loaded = [];
  for (const filename of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(`${cwd}/${filename}`);
      loaded.push(filename);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return loaded;
}

export { initializeFirebaseAdmin } from "./services/firebaseAdmin.mjs";
