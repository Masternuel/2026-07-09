import assert from "node:assert/strict";
import test from "node:test";
import {
  createDistributedLock,
  DistributedLockLostError,
  DistributedLockTimeoutError,
} from "../infrastructure/distributedLock.mjs";
import { createDistributedRateLimiter } from "../infrastructure/distributedRateLimit.mjs";
import {
  createHttpMetricsMiddleware,
  createMetricsRegistry,
  createStructuredLogger,
} from "../infrastructure/observability.mjs";
import {
  createFirestoreReadinessCheck,
  createLivenessPayload,
  createReadinessChecker,
} from "../infrastructure/readiness.mjs";
import { createRedisRuntime } from "../infrastructure/redisRuntime.mjs";

class FakeRedisBackend {
  constructor() {
    this.clock = 1_000;
    this.values = new Map();
  }

  advance(milliseconds) {
    this.clock += milliseconds;
  }

  read(key) {
    const entry = this.values.get(key);
    if (entry?.expiresAt !== null && entry?.expiresAt <= this.clock) {
      this.values.delete(key);
      return null;
    }
    return entry ?? null;
  }
}

class FakeRedisClient {
  constructor(backend = new FakeRedisBackend()) {
    this.backend = backend;
    this.isOpen = false;
    this.connectCount = 0;
    this.quitCount = 0;
  }

  duplicate() {
    return new FakeRedisClient(this.backend);
  }

  on() {}

  async connect() {
    this.isOpen = true;
    this.connectCount += 1;
  }

  async quit() {
    this.isOpen = false;
    this.quitCount += 1;
  }

  async ping() {
    return "PONG";
  }

  async set(key, value, options = {}) {
    const current = this.backend.read(key);
    if (options.NX && current) return null;
    this.backend.values.set(key, {
      value: String(value),
      expiresAt: options.PX ? this.backend.clock + Number(options.PX) : null,
    });
    return "OK";
  }

  async incr(key) {
    const current = this.backend.read(key);
    const value = Number(current?.value ?? 0) + 1;
    this.backend.values.set(key, { value: String(value), expiresAt: null });
    return value;
  }

  async eval(script, { keys, arguments: args }) {
    const key = keys[0];
    const current = this.backend.read(key);
    if (script.includes("lock:release")) {
      if (current?.value !== String(args[0])) return 0;
      this.backend.values.delete(key);
      return 1;
    }
    if (script.includes("lock:renew")) {
      if (current?.value !== String(args[0])) return 0;
      current.expiresAt = this.backend.clock + Number(args[1]);
      return 1;
    }
    if (script.includes("rate-limit:fixed-window")) {
      const count = Number(current?.value ?? 0) + Number(args[0]);
      const expiresAt = current?.expiresAt ?? (this.backend.clock + Number(args[1]));
      this.backend.values.set(key, { value: String(count), expiresAt });
      return [count, Math.max(0, expiresAt - this.backend.clock)];
    }
    throw new Error("Script desconhecido");
  }
}

function lockFor(client, backend, instanceId, extra = {}) {
  let owner = 0;
  return createDistributedLock({
    client,
    instanceId,
    now: () => backend.clock,
    random: () => 0,
    ownerFactory: () => `${instanceId}-${++owner}`,
    ...extra,
  });
}

test("distributed lock concorrente permite somente um dono e gera fencing crescente", async () => {
  const backend = new FakeRedisBackend();
  const first = lockFor(new FakeRedisClient(backend), backend, "replica-a");
  const second = lockFor(new FakeRedisClient(backend), backend, "replica-b");
  const attempts = await Promise.allSettled([
    first.acquire("room:ABC", { ttlMs: 100, waitTimeoutMs: 0 }),
    second.acquire("room:ABC", { ttlMs: 100, waitTimeoutMs: 0 }),
  ]);
  const winners = attempts.filter((attempt) => attempt.status === "fulfilled");
  const losers = attempts.filter((attempt) => attempt.status === "rejected");
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.ok(losers[0].reason instanceof DistributedLockTimeoutError);
  const held = winners[0].value;
  assert.equal(held.fencingToken, 1);
  assert.equal(await held.release(), true);
  const next = await second.acquire("room:ABC", { ttlMs: 100, waitTimeoutMs: 0 });
  assert.equal(next.fencingToken, 2);
});

test("lock expira apos crash e dono antigo nao renova nem libera novo lock", async () => {
  const backend = new FakeRedisBackend();
  const first = lockFor(new FakeRedisClient(backend), backend, "replica-a");
  const second = lockFor(new FakeRedisClient(backend), backend, "replica-b");
  const expired = await first.acquire("job:season", { ttlMs: 50, waitTimeoutMs: 0 });
  backend.advance(51);
  const current = await second.acquire("job:season", { ttlMs: 50, waitTimeoutMs: 0 });

  await assert.rejects(expired.renew(), DistributedLockLostError);
  assert.equal(await expired.release(), false);
  assert.equal(current.held, true);
});

test("lock concorrente aplica retry e adquire depois da liberacao", async () => {
  const backend = new FakeRedisBackend();
  const client = new FakeRedisClient(backend);
  const first = lockFor(client, backend, "replica-a");
  const holder = await first.acquire("job:market", { ttlMs: 100, waitTimeoutMs: 0 });
  let retries = 0;
  const second = lockFor(new FakeRedisClient(backend), backend, "replica-b", {
    sleep: async (milliseconds) => {
      retries += 1;
      backend.advance(milliseconds);
      await holder.release();
    },
  });
  const acquired = await second.acquire("job:market", { ttlMs: 100, waitTimeoutMs: 100 });

  assert.equal(retries, 1);
  assert.equal(acquired.fencingToken, 2);
});

test("rate limit e compartilhado entre replicas e reinicia no TTL", async () => {
  const backend = new FakeRedisBackend();
  const first = createDistributedRateLimiter({
    client: new FakeRedisClient(backend),
    limit: 3,
    windowMs: 1_000,
    now: () => backend.clock,
  });
  const second = createDistributedRateLimiter({
    client: new FakeRedisClient(backend),
    limit: 3,
    windowMs: 1_000,
    now: () => backend.clock,
  });

  assert.equal((await first.consume("uid-1")).allowed, true);
  assert.equal((await second.consume("uid-1")).remaining, 1);
  assert.equal((await first.consume("uid-1")).allowed, true);
  assert.equal((await second.consume("uid-1")).allowed, false);
  backend.advance(1_001);
  assert.equal((await second.consume("uid-1")).count, 1);
});

test("readiness limita dependencia lenta sem derrubar liveness", async () => {
  const firestore = {
    doc() {
      return { get: () => new Promise(() => {}) };
    },
  };
  const readiness = createReadinessChecker({
    checks: { firestore: createFirestoreReadinessCheck(firestore, { timeoutMs: 10 }) },
    timeoutMs: 20,
  });
  const result = await readiness();
  const live = createLivenessPayload({ startedAt: 0, now: () => 5_000 })();

  assert.equal(result.ok, false);
  assert.equal(result.dependencies.firestore.status, "timeout");
  assert.equal(live.ok, true);
  assert.equal(live.uptimeSeconds, 5);
});

test("Redis runtime separa command/publisher/subscriber e fecha uma vez", async () => {
  const backend = new FakeRedisBackend();
  const publisher = new FakeRedisClient(backend);
  let clientOptions;
  const runtime = await createRedisRuntime({
    url: "redis://fake",
    clientFactory: async (options) => {
      clientOptions = options;
      return publisher;
    },
  });

  assert.equal(runtime.enabled, true);
  assert.equal(clientOptions.disableOfflineQueue, true);
  assert.equal(clientOptions.socket.connectTimeout, 3_000);
  assert.equal(runtime.client.connectCount, 1);
  assert.equal(runtime.publisher.connectCount, 1);
  assert.equal(runtime.subscriber.connectCount, 1);
  assert.equal((await runtime.ping()).ok, true);
  await runtime.close();
  await runtime.close();
  assert.equal(runtime.client.quitCount, 1);
  assert.equal(runtime.publisher.quitCount, 1);
  assert.equal(runtime.subscriber.quitCount, 1);
});

test("comando Redis travado expira sem prender lock ou rate limit", async () => {
  const stalled = new Promise(() => {});
  const client = {
    set: () => stalled,
    incr: () => stalled,
    eval: () => stalled,
  };
  const lock = createDistributedLock({ client, commandTimeoutMs: 5 });
  const limiter = createDistributedRateLimiter({ client, commandTimeoutMs: 5 });
  await assert.rejects(lock.acquire("room"), { name: "TimeoutError" });
  await assert.rejects(limiter.consume("uid"), { name: "TimeoutError" });
});

test("logger remove segredos e metrics registram HTTP", async () => {
  const lines = [];
  const logger = createStructuredLogger({
    output: { info: (line) => lines.push(line) },
    level: "info",
    now: () => 0,
  });
  logger.info("request", { authorization: "Bearer secret", nested: { apiKey: "secret" } });
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.authorization, "[REDACTED]");
  assert.equal(parsed.nested.apiKey, "[REDACTED]");

  const metrics = createMetricsRegistry({ now: () => 20 });
  const middleware = createHttpMetricsMiddleware(metrics, { now: (() => {
    let time = 0;
    return () => (time += 5);
  })() });
  const listeners = {};
  middleware(
    { method: "GET", path: "/health" },
    { statusCode: 200, once: (event, listener) => { listeners[event] = listener; } },
    () => {},
  );
  listeners.finish();
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.counters[0].value, 1);
  assert.equal(snapshot.counters[0].labels.route, "unmatched");
  assert.equal(snapshot.summaries[0].count, 1);
});
