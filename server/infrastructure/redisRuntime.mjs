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

function forceCloseClient(client) {
  try {
    const closing = typeof client?.destroy === "function" ? client.destroy() : client?.disconnect?.();
    closing?.catch?.(() => {});
  } catch {
    // Cleanup must not replace the original connection error.
  }
}

async function closeClient(client, timeoutMs) {
  if (!client) return;
  try {
    if (client.isOpen !== false && client.isReady !== false) {
      // node-redis 5.8.2 quit()/close() mark the socket closed before draining,
      // preventing destroy() from aborting it. Send QUIT while it is abortable.
      await withTimeout(Promise.resolve().then(() => typeof client.sendCommand === "function"
        ? client.sendCommand(["QUIT"])
        : client.quit?.()), timeoutMs, "redis-close");
    }
  } catch {
    // A disconnected or unresponsive peer cannot finish a graceful shutdown.
  } finally {
    forceCloseClient(client);
  }
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
  let client, publisher, subscriber;
  try {
    client = await clientFactory(clientOptions);
    bindClientErrors(client, "command", logger);
    publisher = typeof client?.duplicate === "function"
      ? client.duplicate()
      : await clientFactory(clientOptions);
    bindClientErrors(publisher, "publisher", logger);
    subscriber = typeof client?.duplicate === "function"
      ? client.duplicate()
      : await clientFactory(clientOptions);
    bindClientErrors(subscriber, "subscriber", logger);
    await Promise.all([
      connectClient(client, timeoutMs, "command"),
      connectClient(publisher, timeoutMs, "publisher"),
      connectClient(subscriber, timeoutMs, "subscriber"),
    ]);
  } catch (error) {
    [subscriber, publisher, client].forEach(forceCloseClient);
    throw error;
  }

  let closed = false;
  let pendingPing;
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
        if (!pendingPing) pendingPing = Promise.resolve().then(() => client.ping()).finally(() => { pendingPing = null; });
        await withTimeout(pendingPing, positiveInteger(timeout, timeoutMs), "redis-ping");
        return { ok: true, status: "ready", latencyMs: Date.now() - startedAt };
      } catch {
        return { ok: false, status: "unavailable", latencyMs: Date.now() - startedAt };
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled([subscriber, publisher, client].map((entry) => closeClient(entry, timeoutMs)));
    },
  };
}
