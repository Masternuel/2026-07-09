import { randomUUID } from "node:crypto";
import { withTimeout } from "./readiness.mjs";
import { lockMetricResource } from "./metricPolicy.mjs";

export const RELEASE_LOCK_SCRIPT = `
-- bola-manager:lock:release
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export const RENEW_LOCK_SCRIPT = `
-- bola-manager:lock:renew
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultSleep(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Operacao cancelada"));
      return;
    }
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Operacao cancelada"));
    }, { once: true });
  });
}

export class DistributedLockTimeoutError extends Error {
  constructor(resource) {
    super(`Tempo limite ao adquirir lock: ${resource}`);
    this.name = "DistributedLockTimeoutError";
    this.code = "DISTRIBUTED_LOCK_TIMEOUT";
    this.resource = resource;
  }
}

export class DistributedLockLostError extends Error {
  constructor(resource) {
    super(`Lock distribuido perdido: ${resource}`);
    this.name = "DistributedLockLostError";
    this.code = "DISTRIBUTED_LOCK_LOST";
    this.resource = resource;
  }
}

export function createDistributedLock({
  client,
  prefix = "bola-manager:lock",
  defaultTtlMs = 15_000,
  defaultWaitTimeoutMs = 2_000,
  retryMinMs = 25,
  retryMaxMs = 250,
  instanceId = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local",
  now = Date.now,
  random = Math.random,
  sleep = defaultSleep,
  ownerFactory = randomUUID,
  commandTimeoutMs = 2_500,
  logger,
  metrics,
} = {}) {
  if (!client?.set || !client?.incr || !client?.eval) {
    throw new TypeError("Cliente Redis invalido para distributed lock");
  }
  const ttlDefault = positiveInteger(defaultTtlMs, 15_000);
  const waitDefault = Math.max(0, Number(defaultWaitTimeoutMs) || 0);
  const retryFloor = positiveInteger(retryMinMs, 25);
  const retryCeiling = Math.max(retryFloor, positiveInteger(retryMaxMs, 250));
  const commandTimeout = positiveInteger(commandTimeoutMs, 2_500);

  function command(promise, operation) {
    return withTimeout(promise, commandTimeout, `redis-lock-${operation}`);
  }

  async function evaluate(script, key, args) {
    return command(client.eval(script, {
      keys: [key],
      arguments: args.map(String),
    }), "eval");
  }

  async function acquire(resource, options = {}) {
    const normalizedResource = String(resource ?? "").trim();
    if (!normalizedResource) throw new TypeError("Resource do lock obrigatorio");
    const metricLabels = { resource: lockMetricResource(normalizedResource) };
    const ttlMs = positiveInteger(options.ttlMs, ttlDefault);
    const waitTimeoutMs = Math.max(0, Number(options.waitTimeoutMs ?? waitDefault) || 0);
    const lockKey = `${prefix}:${normalizedResource}`;
    const fenceKey = `${prefix}:fence:${normalizedResource}`;
    const owner = `${instanceId}:${ownerFactory()}`;
    const startedAt = now();
    const deadline = startedAt + waitTimeoutMs;
    let attempt = 0;

    while (true) {
      attempt += 1;
      let acquired;
      try {
        acquired = await command(client.set(lockKey, owner, { NX: true, PX: ttlMs }), "set");
      } catch (error) {
        metrics?.increment?.("distributed_lock_errors_total", 1, { operation: "acquire" });
        throw error;
      }
      if (acquired === "OK" || acquired === true) {
        let fencingToken;
        try {
          fencingToken = await command(client.incr(fenceKey), "fence");
        } catch (error) {
          await evaluate(RELEASE_LOCK_SCRIPT, lockKey, [owner]).catch(() => {});
          throw error;
        }
        metrics?.increment?.("distributed_lock_acquired_total", 1, metricLabels);
        metrics?.observe?.("distributed_lock_wait_ms", Math.max(0, now() - startedAt), metricLabels);
        logger?.info?.("distributed_lock.acquired", {
          resource: normalizedResource,
          fencingToken,
          attempts: attempt,
        });
        let held = true;
        return {
          resource: normalizedResource,
          key: lockKey,
          owner,
          fencingToken,
          ttlMs,
          get held() {
            return held;
          },
          async renew(nextTtlMs = ttlMs) {
            if (!held) throw new DistributedLockLostError(normalizedResource);
            const renewalTtl = positiveInteger(nextTtlMs, ttlMs);
            const renewed = Number(await evaluate(RENEW_LOCK_SCRIPT, lockKey, [owner, renewalTtl]));
            if (renewed !== 1) {
              held = false;
              metrics?.increment?.("distributed_lock_lost_total", 1, metricLabels);
              logger?.warn?.("distributed_lock.lost", { resource: normalizedResource });
              throw new DistributedLockLostError(normalizedResource);
            }
            metrics?.increment?.("distributed_lock_renewed_total", 1, metricLabels);
            return true;
          },
          async release() {
            if (!held) return false;
            const released = Number(await evaluate(RELEASE_LOCK_SCRIPT, lockKey, [owner])) === 1;
            held = false;
            metrics?.increment?.(
              released ? "distributed_lock_released_total" : "distributed_lock_lost_total",
              1,
              metricLabels,
            );
            logger?.info?.("distributed_lock.released", {
              resource: normalizedResource,
              fencingToken,
              released,
            });
            return released;
          },
        };
      }

      const remainingMs = deadline - now();
      if (remainingMs <= 0 || waitTimeoutMs === 0) {
        metrics?.increment?.("distributed_lock_timeout_total", 1, metricLabels);
        logger?.warn?.("distributed_lock.timeout", { resource: normalizedResource, attempts: attempt });
        throw new DistributedLockTimeoutError(normalizedResource);
      }
      const exponential = Math.min(retryCeiling, retryFloor * (2 ** Math.min(attempt - 1, 8)));
      const jittered = Math.max(1, Math.floor(exponential * (0.5 + random() * 0.5)));
      await sleep(Math.min(jittered, remainingMs), options.signal);
    }
  }

  async function withLock(resource, task, options = {}) {
    const lock = await acquire(resource, options);
    const renewEveryMs = positiveInteger(options.renewEveryMs, Math.max(1, Math.floor(lock.ttlMs / 3)));
    let renewalError = null;
    const timer = options.autoRenew === false ? null : setInterval(() => {
      void lock.renew().catch((error) => {
        renewalError = error;
        clearInterval(timer);
      });
    }, renewEveryMs);
    timer?.unref?.();
    try {
      const result = await task({ fencingToken: lock.fencingToken, lock });
      if (renewalError) throw renewalError;
      return result;
    } finally {
      if (timer) clearInterval(timer);
      await lock.release().catch((error) => {
        logger?.error?.("distributed_lock.release_error", { resource, error });
      });
    }
  }

  return { acquire, withLock };
}
