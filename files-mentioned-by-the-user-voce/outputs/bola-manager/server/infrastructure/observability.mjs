import { httpMetricRoute, normalizeMetricSample } from "./metricPolicy.mjs";

const SECRET_PATTERN = /(authorization|cookie|password|secret|token|private.?key|credential|api.?key)/i;

function safeText(value) {
  return value
    .replace(/\b(Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(\b(?:redis|rediss|https?):\/\/)[^@\s/]+@/gi, "$1[REDACTED]@");
}

function safeValue(value, key = "", seen = new WeakSet()) {
  if (SECRET_PATTERN.test(key)) return "[REDACTED]";
  if (typeof value === "string") return safeText(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      code: value.code,
      message: safeText(value.message),
      stack: safeText(value.stack ?? ""),
    };
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => safeValue(item, "", seen));
  return Object.fromEntries(Object.entries(value)
    .map(([childKey, childValue]) => [childKey, safeValue(childValue, childKey, seen)]));
}

function outputLine(output, level, line) {
  const method = typeof output?.[level] === "function"
    ? output[level].bind(output)
    : output?.log?.bind(output);
  method?.(line);
}

export function resolveInstanceId(env = process.env) {
  return env.RAILWAY_REPLICA_ID || env.RAILWAY_DEPLOYMENT_ID || env.HOSTNAME || "local";
}

export function createStructuredLogger({
  output = console,
  service = "bola-manager-server",
  instanceId = resolveInstanceId(),
  level = "info",
  base = {},
  now = Date.now,
} = {}) {
  const priorities = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = priorities[level] ?? priorities.info;
  const makeLogger = (context) => {
    const logger = {};
    for (const method of Object.keys(priorities)) {
      logger[method] = (event, fields = {}) => {
        if (priorities[method] < threshold) return;
        const payload = safeValue({
          timestamp: new Date(now()).toISOString(),
          level: method,
          service,
          instanceId,
          ...base,
          ...context,
          event: typeof event === "string" ? event : "log",
          ...(typeof event === "string" ? fields : event),
        });
        outputLine(output, method, JSON.stringify(payload));
      };
    }
    logger.child = (fields = {}) => makeLogger({ ...context, ...fields });
    return logger;
  };
  return makeLogger({});
}

export function createMetricsRegistry({ now = Date.now, maxSeries = 2048, maxSeriesPerMetric = 256 } = {}) {
  const counters = new Map();
  const gauges = new Map();
  const summaries = new Map();
  const seriesByMetric = new Map();
  const boundedLimit = (value, fallback, ceiling) => Number.isInteger(value) && value > 0
    ? Math.min(value, ceiling) : fallback;
  const seriesLimit = boundedLimit(maxSeries, 2048, 4096);
  const metricLimit = boundedLimit(maxSeriesPerMetric, 256, 512);
  let series = 0;
  let droppedSamples = 0;

  function drop() {
    droppedSamples = Math.min(Number.MAX_SAFE_INTEGER, droppedSamples + 1);
    return 0;
  }

  function sample(store, type, name, labels, value) {
    const normalized = normalizeMetricSample(name, type, labels);
    const number = typeof value === "number" ? value
      : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (!normalized || !Number.isFinite(number) || (type !== "gauge" && number < 0)) return null;
    const key = `${name}:${JSON.stringify(normalized)}`;
    const current = store.get(key);
    if (!current && (series >= seriesLimit || (seriesByMetric.get(name) ?? 0) >= metricLimit)) return null;
    return { key, current, number, labels: normalized };
  }

  function save(store, key, metric) {
    if (!store.has(key)) {
      series += 1;
      seriesByMetric.set(metric.name, (seriesByMetric.get(metric.name) ?? 0) + 1);
    }
    store.set(key, metric);
  }

  function increment(name, value = 1, labels = {}) {
    const next = sample(counters, "counter", name, labels, value);
    if (!next) return drop();
    const current = next.current ?? { name, labels: next.labels, value: 0 };
    const total = current.value + next.number;
    if (!Number.isFinite(total)) return drop();
    current.value = total;
    save(counters, next.key, current);
    return current.value;
  }

  function setGauge(name, value, labels = {}) {
    const next = sample(gauges, "gauge", name, labels, value);
    if (!next) return drop();
    save(gauges, next.key, { name, labels: next.labels, value: next.number });
  }

  function observe(name, value, labels = {}) {
    const next = sample(summaries, "summary", name, labels, value);
    if (!next) return drop();
    const current = next.current ?? {
      name,
      labels: next.labels,
      count: 0,
      sum: 0,
      max: Number.NEGATIVE_INFINITY,
    };
    if (!Number.isFinite(current.sum + next.number) || current.count >= Number.MAX_SAFE_INTEGER) return drop();
    current.count += 1;
    current.sum += next.number;
    current.max = Math.max(current.max, next.number);
    save(summaries, next.key, current);
  }

  function snapshot() {
    return {
      timestamp: new Date(now()).toISOString(),
      counters: [...counters.values()].map((metric) => ({ ...metric, labels: { ...metric.labels } })),
      gauges: [...gauges.values()].map((metric) => ({ ...metric, labels: { ...metric.labels } })),
      summaries: [...summaries.values()].map((metric) => ({ ...metric, labels: { ...metric.labels } })),
      registry: { series, maxSeries: seriesLimit, maxSeriesPerMetric: metricLimit, droppedSamples },
    };
  }

  function reset() {
    counters.clear();
    gauges.clear();
    summaries.clear();
    seriesByMetric.clear();
    series = 0;
    droppedSamples = 0;
  }

  return { increment, setGauge, observe, snapshot, reset };
}

export function createHttpMetricsMiddleware(metrics, { now = Date.now } = {}) {
  return function httpMetrics(request, response, next) {
    const startedAt = now();
    const route = httpMetricRoute(request.originalUrl ?? request.url);
    response.once("finish", () => {
      const labels = {
        method: request.method,
        route: request.route?.path ? route : "unmatched",
        status: response.statusCode,
      };
      metrics.increment("http_requests_total", 1, labels);
      metrics.observe("http_request_duration_ms", Math.max(0, now() - startedAt), labels);
      if (response.statusCode >= 500) metrics.increment("http_errors_total", 1, labels);
    });
    next();
  };
}
