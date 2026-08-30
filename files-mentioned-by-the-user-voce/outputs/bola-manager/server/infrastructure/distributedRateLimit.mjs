import { withTimeout } from "./readiness.mjs";

export const FIXED_WINDOW_SCRIPT = `
-- bola-manager:rate-limit:fixed-window
local current = redis.call("INCRBY", KEYS[1], ARGV[1])
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
  ttl = tonumber(ARGV[2])
end
return {current, ttl}
`;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeKey(value) {
  return encodeURIComponent(String(value ?? "anonymous").slice(0, 256));
}

export function createDistributedRateLimiter({
  client,
  prefix = "bola-manager:rate",
  limit = 120,
  windowMs = 60_000,
  now = Date.now,
  commandTimeoutMs = 2_500,
  metrics,
} = {}) {
  if (!client?.eval) throw new TypeError("Cliente Redis invalido para rate limiter");
  const defaultLimit = positiveInteger(limit, 120);
  const defaultWindow = positiveInteger(windowMs, 60_000);
  const commandTimeout = positiveInteger(commandTimeoutMs, 2_500);

  async function consume(identity, options = {}) {
    const requestLimit = positiveInteger(options.limit, defaultLimit);
    const requestWindow = positiveInteger(options.windowMs, defaultWindow);
    const cost = positiveInteger(options.cost, 1);
    const key = `${prefix}:${safeKey(identity)}`;
    const result = await withTimeout(client.eval(FIXED_WINDOW_SCRIPT, {
      keys: [key],
      arguments: [String(cost), String(requestWindow)],
    }), commandTimeout, "redis-rate-limit");
    const count = Number(result?.[0] ?? result?.current ?? 0);
    const ttlMs = Math.max(0, Number(result?.[1] ?? result?.ttlMs ?? requestWindow));
    const allowed = count <= requestLimit;
    if (!allowed) metrics?.increment?.("rate_limit_hits_total", 1, options.labels);
    return {
      allowed,
      limit: requestLimit,
      count,
      remaining: Math.max(0, requestLimit - count),
      retryAfterMs: allowed ? 0 : ttlMs,
      resetAt: new Date(now() + ttlMs).toISOString(),
    };
  }

  return { consume };
}

export function createRateLimitMiddleware(limiter, {
  keyResolver = (request) => request.user?.uid || request.ip || "anonymous",
  limit,
  windowMs,
} = {}) {
  if (!limiter?.consume) throw new TypeError("Rate limiter obrigatorio");
  return async function distributedRateLimit(request, response, next) {
    try {
      const result = await limiter.consume(keyResolver(request), { limit, windowMs });
      response.setHeader("RateLimit-Limit", result.limit);
      response.setHeader("RateLimit-Remaining", result.remaining);
      response.setHeader("RateLimit-Reset", Math.ceil(Date.parse(result.resetAt) / 1_000));
      if (!result.allowed) {
        response.setHeader("Retry-After", Math.max(1, Math.ceil(result.retryAfterMs / 1_000)));
        response.status(429).json({
          error: {
            code: "RATE_LIMITED",
            message: "Muitas requisicoes. Tente novamente em instantes.",
          },
        });
        return;
      }
      next();
    } catch (error) {
      error.code ??= "RATE_LIMIT_UNAVAILABLE";
      error.status ??= 503;
      next(error);
    }
  };
}
