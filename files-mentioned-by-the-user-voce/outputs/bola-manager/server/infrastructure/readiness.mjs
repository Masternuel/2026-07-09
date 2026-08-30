function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeDependencyError(error) {
  if (error?.name === "TimeoutError") return "timeout";
  return "unavailable";
}

export function withTimeout(promise, timeoutMs = 2_000, dependency = "dependency") {
  const duration = positiveInteger(timeoutMs, 2_000);
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`${dependency} readiness timeout`);
      error.name = "TimeoutError";
      error.code = "DEPENDENCY_TIMEOUT";
      reject(error);
    }, duration);
  });
  return Promise.race([Promise.resolve(promise), timeoutPromise])
    .finally(() => clearTimeout(timeout));
}

export function createFirestoreReadinessCheck(firestore, {
  timeoutMs = 2_000,
  probePath = "__health__/readiness",
} = {}) {
  return async function checkFirestore() {
    if (!firestore) return { ok: false, status: "disabled" };
    const startedAt = Date.now();
    try {
      const operation = typeof firestore.doc === "function"
        ? firestore.doc(probePath).get()
        : firestore.listCollections();
      await withTimeout(operation, timeoutMs, "firestore");
      return { ok: true, status: "ready", latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        status: safeDependencyError(error),
        latencyMs: Date.now() - startedAt,
      };
    }
  };
}

export function createRedisReadinessCheck(redis, { timeoutMs = 1_000 } = {}) {
  return async function checkRedis() {
    if (!redis) return { ok: false, status: "disabled" };
    const startedAt = Date.now();
    try {
      const result = await withTimeout(redis.ping(), timeoutMs, "redis");
      if (result?.ok === false) {
        return {
          ok: false,
          status: result.status ?? "unavailable",
          latencyMs: Date.now() - startedAt,
        };
      }
      return { ok: true, status: "ready", latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        status: safeDependencyError(error),
        latencyMs: Date.now() - startedAt,
      };
    }
  };
}

export function createReadinessChecker({
  checks = {},
  timeoutMs = 2_500,
  now = Date.now,
  metrics,
} = {}) {
  const entries = Object.entries(checks).filter(([, check]) => typeof check === "function");
  return async function readiness() {
    const startedAt = now();
    const results = await Promise.all(entries.map(async ([name, check]) => {
      try {
        const result = await withTimeout(check(), timeoutMs, name);
        const normalized = result && typeof result === "object"
          ? result
          : { ok: result === true, status: result === true ? "ready" : "unavailable" };
        return [name, {
          ok: normalized.ok === true,
          status: normalized.status ?? (normalized.ok ? "ready" : "unavailable"),
          ...(Number.isFinite(normalized.latencyMs) ? { latencyMs: normalized.latencyMs } : {}),
        }];
      } catch (error) {
        return [name, { ok: false, status: safeDependencyError(error) }];
      }
    }));
    const dependencies = Object.fromEntries(results);
    const ok = results.every(([, result]) => result.ok);
    metrics?.setGauge?.("dependency_readiness", ok ? 1 : 0);
    return {
      ok,
      status: ok ? "ready" : "not-ready",
      dependencies,
      durationMs: Math.max(0, now() - startedAt),
      timestamp: new Date(now()).toISOString(),
    };
  };
}

export function createLivenessPayload({
  service = "bola-manager-server",
  instanceId = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local",
  startedAt = Date.now(),
  now = Date.now,
} = {}) {
  return function liveness() {
    return {
      ok: true,
      status: "alive",
      service,
      instanceId,
      uptimeSeconds: Math.max(0, Math.floor((now() - startedAt) / 1_000)),
      timestamp: new Date(now()).toISOString(),
    };
  };
}
