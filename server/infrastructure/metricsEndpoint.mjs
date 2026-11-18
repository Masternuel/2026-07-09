import { createHash, timingSafeEqual } from "node:crypto";

export function validateMetricsToken(value) {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length < 32 || value.length > 256
    || !/^[A-Za-z0-9._~+/-]+={0,2}$/.test(value)) {
    throw new Error("METRICS_TOKEN deve conter 32 a 256 caracteres seguros, sem espacos");
  }
  return value;
}

const digest = (value) => createHash("sha256").update(value).digest();

export function createMetricsHandler({ token = "", metrics, instanceId, now = Date.now, limit = 60 } = {}) {
  const expected = validateMetricsToken(token);
  const expectedDigest = expected ? digest(expected) : null;
  const scrapeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 600) : 60;
  let windowStartedAt = now();
  let scrapes = 0;
  return function metricsEndpoint(request, response) {
    response.setHeader("Cache-Control", "no-store, private");
    response.vary("Authorization");
    if (!expectedDigest) {
      return response.status(404).json({ error: { code: "NOT_FOUND", message: "Recurso indisponivel" } });
    }
    const header = request.headers.authorization;
    const match = typeof header === "string" && header.length <= 263
      ? /^Bearer ([A-Za-z0-9._~+/-]+={0,2})$/i.exec(header) : null;
    if (!match || !timingSafeEqual(digest(match[1]), expectedDigest)) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="metrics"');
      return response.status(401).json({ error: { code: "METRICS_UNAUTHORIZED", message: "Acesso restrito" } });
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      return response.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "Metodo nao permitido" } });
    }
    const time = now();
    if (time - windowStartedAt >= 60_000 || time < windowStartedAt) {
      windowStartedAt = time;
      scrapes = 0;
    }
    if (scrapes >= scrapeLimit) {
      response.setHeader("Retry-After", Math.max(1, Math.ceil((60_000 - (time - windowStartedAt)) / 1_000)));
      return response.status(429).json({ error: { code: "METRICS_RATE_LIMITED", message: "Limite de coletas atingido" } });
    }
    scrapes += 1;
    return response.json({ instanceId, ...metrics.snapshot() });
  };
}
