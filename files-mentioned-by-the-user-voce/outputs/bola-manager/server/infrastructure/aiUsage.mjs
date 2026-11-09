import { createHash, randomUUID } from "node:crypto";
import { coordinationUnavailable, redisCoordinationAvailable } from "./coordinationAvailability.mjs";
import { withTimeout } from "./readiness.mjs";

export const AI_OPERATIONS = Object.freeze({ feed: 10_000, post: 5_000, comment: 3_000, press: 10_000, interview: 2_000 });

export const AI_ACQUIRE_SCRIPT = `
-- bola-manager:ai:acquire
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local p = cjson.decode(ARGV[1])
local counts = {}
local resets = {}
for i = 1, 3 do
  resets[i] = tonumber(redis.call('HGET', KEYS[i], 'reset') or '0')
  counts[i] = tonumber(redis.call('HGET', KEYS[i], 'count') or '0')
  if resets[i] <= now then counts[i] = 0; resets[i] = now + p.windowMs end
end
if tonumber(redis.call('HGET', KEYS[1], 'cooldown') or '0') > now then return {0, 'cooldown'} end
for i = 4, 5 do redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now) end
if redis.call('ZCARD', KEYS[4]) >= p.userConcurrent or redis.call('ZCARD', KEYS[5]) >= p.globalConcurrent then return {0, 'concurrency'} end
if counts[1] + p.units > p.operationLimit or counts[2] + p.units > p.userLimit or counts[3] + p.units > p.globalLimit then return {0, 'budget'} end
for i = 1, 3 do
  redis.call('HSET', KEYS[i], 'reset', resets[i], 'count', counts[i] + p.units)
  redis.call('PEXPIRE', KEYS[i], math.max(p.windowMs, p.cooldownMs) + p.leaseMs)
end
redis.call('HSET', KEYS[1], 'cooldown', now + p.cooldownMs)
for i = 4, 5 do
  redis.call('ZADD', KEYS[i], now + p.leaseMs, ARGV[2])
  redis.call('PEXPIRE', KEYS[i], math.max(redis.call('PTTL', KEYS[i]), p.leaseMs))
end
return {1, 'accepted'}
`;

export const AI_RELEASE_SCRIPT = `
-- bola-manager:ai:release
for i = 1, 2 do redis.call('ZREM', KEYS[i], ARGV[1]) end
return 1
`;

function limited(reason) {
  return Object.assign(new Error("Limite de geracao de IA atingido. Tente novamente mais tarde."), {
    code: "AI_USAGE_LIMITED", status: 429, expose: true, details: { reason },
  });
}

export function createAiUsage({ runtime, required = false, commandTimeoutMs = 2_500, now = Date.now, limits = {} } = {}) {
  const policy = { windowMs: 3_600_000, operationLimit: 60, userLimit: 120, globalLimit: 1_000, userConcurrent: 1, globalConcurrent: 8, ...limits };
  for (const value of Object.values(policy)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Limite de IA invalido");
  const local = new Map();
  const leases = new Map();
  const distributed = required || runtime?.enabled === true;
  const hash = (uid) => createHash("sha256").update(uid).digest("hex");

  async function command(script, keys, args) {
    if (!redisCoordinationAvailable(runtime)) throw coordinationUnavailable();
    try {
      return await withTimeout(runtime.client.eval(script, { keys, arguments: args }), commandTimeoutMs, "ai-usage");
    } catch (error) { throw coordinationUnavailable(error); }
  }

  async function acquire(uid, operation, { units = 1, leaseMs = 300_000 } = {}) {
    if (typeof uid !== "string" || !uid || !Object.hasOwn(AI_OPERATIONS, operation)) {
      throw Object.assign(new Error("Identidade da operacao de IA ausente"), { code: "AI_IDENTITY_REQUIRED", status: 403 });
    }
    if (!Number.isSafeInteger(units) || units < 1 || !Number.isSafeInteger(leaseMs) || leaseMs < 1) throw new Error("Reserva de IA invalida");
    const p = { ...policy, cooldownMs: AI_OPERATIONS[operation], units, leaseMs };
    const userKey = hash(uid);
    const keys = [`bola-manager:{ai}:op:${userKey}:${operation}`, `bola-manager:{ai}:uid:${userKey}`, "bola-manager:{ai}:global", `bola-manager:{ai}:active:${userKey}`, "bola-manager:{ai}:active:global"];
    const token = randomUUID();
    if (distributed) {
      const [accepted, reason] = await command(AI_ACQUIRE_SCRIPT, keys, [JSON.stringify(p), token]);
      if (Number(accepted) !== 1) throw limited(reason);
    } else {
      const at = now();
      for (const [key, value] of leases) if (value.until <= at) leases.delete(key);
      for (const [key, value] of local) if (Math.max(value.reset, value.cooldown ?? 0) <= at) local.delete(key);
      const counters = keys.slice(0, 3).map((key) => {
        const old = local.get(key);
        return { count: old?.reset > at ? old.count : 0, reset: old?.reset > at ? old.reset : at + p.windowMs, cooldown: old?.cooldown ?? 0 };
      });
      if (counters[0].cooldown > at) throw limited("cooldown");
      if (leases.size >= p.globalConcurrent || [...leases.values()].filter((value) => value.uid === userKey).length >= p.userConcurrent) throw limited("concurrency");
      if (counters.some((counter, index) => counter.count + units > [p.operationLimit, p.userLimit, p.globalLimit][index])) throw limited("budget");
      counters.forEach((counter, index) => local.set(keys[index], { ...counter, count: counter.count + units, ...(index === 0 ? { cooldown: at + p.cooldownMs } : {}) }));
      leases.set(token, { uid: userKey, until: at + leaseMs });
    }
    return async () => {
      if (distributed) await command(AI_RELEASE_SCRIPT, keys.slice(3), [token]);
      else leases.delete(token);
    };
  }

  return {
    acquire,
    async run(uid, operation, reservation, task) {
      const release = await acquire(uid, operation, reservation);
      try { return await task(); } finally { await release(); }
    },
  };
}
