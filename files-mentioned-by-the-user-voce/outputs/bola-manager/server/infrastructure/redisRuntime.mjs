import { withTimeout } from "./readiness.mjs";
import { redisCoordinationAvailable } from "./coordinationAvailability.mjs";

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function defaultClientFactory(options) {
  const { createClient } = await import("redis");
  return createClient(options);
}

async function connectClient(client, timeoutMs, label) {
  if (!client || typeof client.connect !== "function") {
    throw new TypeError(`Cliente Redis ${label} invalido`);
  }
  if (client.isOpen) return client;
  await withTimeout(client.connect(), timeoutMs, `redis-${label}`);
  return client;
}

async function closeClient(client) {
  if (!client) return;
  try {
    if (typeof client.quit === "function" && client.isOpen !== false) {
      await client.quit();
      return;
    }
  } catch {
    // A conexao pode ter caido antes do shutdown.
  }
  client.disconnect?.();
}

function bindClientErrors(client, role, logger) {
  client?.on?.("error", (error) => {
    logger?.error?.("redis.client_error", {
      role,
      error,
    });
  });
}

export function createDisabledRedisRuntime(reason = "url-not-configured") {
  return {
    enabled: false,
    reason,
    client: null,
    publisher: null,
    subscriber: null,
    async ping() {
      return { ok: false, status: "disabled" };
    },
    async close() {},
  };
}

export async function createRedisRuntime({
  url,
  connectTimeoutMs = 3_000,
  clientFactory = defaultClientFactory,
  logger = console,
  socket = {},
} = {}) {
  const redisUrl = String(url ?? "").trim();
  if (!redisUrl) return createDisabledRedisRuntime();

  const timeoutMs = positiveInteger(connectTimeoutMs, 3_000);
  const clientOptions = {
    url: redisUrl,
    disableOfflineQueue: true,
    socket: { connectTimeout: timeoutMs, ...socket },
  };
  const client = await clientFactory(clientOptions);
  const publisher = typeof client?.duplicate === "function"
    ? client.duplicate()
    : await clientFactory(clientOptions);
  const subscriber = typeof client?.duplicate === "function"
    ? client.duplicate()
    : await clientFactory(clientOptions);
  bindClientErrors(client, "command", logger);
  bindClientErrors(publisher, "publisher", logger);
  bindClientErrors(subscriber, "subscriber", logger);

  try {
    await Promise.all([
      connectClient(client, timeoutMs, "command"),
      connectClient(publisher, timeoutMs, "publisher"),
      connectClient(subscriber, timeoutMs, "subscriber"),
    ]);
  } catch (error) {
    await Promise.allSettled([closeClient(subscriber), closeClient(publisher), closeClient(client)]);
    throw error;
  }

  let closed = false;
  return {
    enabled: true,
    reason: null,
    client,
    publisher,
    subscriber,
    async ping(timeout = timeoutMs) {
      const startedAt = Date.now();
      try {
        if (!redisCoordinationAvailable(this)) return { ok: false, status: "unavailable" };
        await withTimeout(client.ping(), positiveInteger(timeout, timeoutMs), "redis-ping");
        return { ok: true, status: "ready", latencyMs: Date.now() - startedAt };
      } catch {
        return { ok: false, status: "unavailable", latencyMs: Date.now() - startedAt };
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled([closeClient(subscriber), closeClient(publisher), closeClient(client)]);
    },
  };
}
