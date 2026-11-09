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
  probePath = "health/readiness",
} = {}) {
  const probe = singleFlight(() => typeof firestore.doc === "function"
    ? firestore.doc(probePath).get() : firestore.listCollections());
  return async function checkFirestore() {
    if (!firestore) return { ok: false, status: "disabled" };
    const startedAt = Date.now();
    try {
      await withTimeout(probe(), timeoutMs, "firestore");
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
  const probe = singleFlight(() => redis.ping());
  return async function checkRedis() {
    if (!redis) return { ok: false, status: "disabled" };
    const startedAt = Date.now();
    try {
      const result = await withTimeout(probe(), timeoutMs, "redis");
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
  const entries = Object.entries(checks).filter(([, check]) => typeof check === "function")
    .map(([name, check]) => [name, singleFlight(check)]);
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
          status: ["ready", "unavailable", "disabled", "timeout"].includes(normalized.status)
            ? normalized.status : (normalized.ok ? "ready" : "unavailable"),
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

function singleFlight(check) {
  let pending;
  return () => {
    // Keep the underlying operation shared even after a caller times out.
    if (!pending) pending = Promise.resolve().then(check).finally(() => { pending = null; });
    return pending;
  };
}

export function createCachedReadiness(check, { cacheMs = 1_000, timeoutMs = 2_500, now = Date.now } = {}) {
  const duration = Math.min(2_000, positiveInteger(cacheMs, 1_000));
  const probe = singleFlight(check);
  let pending;
  let cached;
  let expiresAt = 0;
  return () => {
    if (cached && now() < expiresAt) return Promise.resolve(cached);
    if (!pending) {
      pending = withTimeout(probe(), timeoutMs, "readiness").then((result) => {
        const dependencies = Object.fromEntries(Object.entries(result?.dependencies ?? {}).map(([name, value]) => [name, {
          ok: value?.ok === true,
          status: ["ready", "unavailable", "disabled", "timeout"].includes(value?.status) ? value.status : "unavailable",
        }]));
        return { ok: result?.ok === true, status: result?.ok === true ? "ready" : "not-ready", dependencies };
      }).catch(() => ({ ok: false, status: "not-ready", dependencies: {} })).then((result) => {
        cached = result;
        expiresAt = now() + duration;
        return result;
      }).finally(() => { pending = null; });
    }
    return pending;
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
