const SECRET_PATTERN = /(authorization|cookie|password|secret|token|private.?key|credential|api.?key)/i;

function sanitizeMetricName(name) {
  return String(name).replace(/[^a-zA-Z0-9_:]/g, "_");
}

function normalizeLabels(labels = {}) {
  return Object.fromEntries(Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, String(value)]));
}

function metricKey(name, labels) {
  return `${name}:${JSON.stringify(normalizeLabels(labels))}`;
}

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

export function createMetricsRegistry({ now = Date.now } = {}) {
  const counters = new Map();
  const gauges = new Map();
  const summaries = new Map();

  function increment(name, value = 1, labels = {}) {
    const metric = sanitizeMetricName(name);
    const key = metricKey(metric, labels);
    const current = counters.get(key) ?? { name: metric, labels: normalizeLabels(labels), value: 0 };
    current.value += Number(value) || 0;
    counters.set(key, current);
    return current.value;
  }

  function setGauge(name, value, labels = {}) {
    const metric = sanitizeMetricName(name);
    const key = metricKey(metric, labels);
    gauges.set(key, { name: metric, labels: normalizeLabels(labels), value: Number(value) || 0 });
  }

  function observe(name, value, labels = {}) {
    const metric = sanitizeMetricName(name);
    const key = metricKey(metric, labels);
    const number = Number(value) || 0;
    const current = summaries.get(key) ?? {
      name: metric,
      labels: normalizeLabels(labels),
      count: 0,
      sum: 0,
      max: Number.NEGATIVE_INFINITY,
    };
    current.count += 1;
    current.sum += number;
    current.max = Math.max(current.max, number);
    summaries.set(key, current);
  }

  function snapshot() {
    return {
      timestamp: new Date(now()).toISOString(),
      counters: [...counters.values()].map((metric) => ({ ...metric })),
      gauges: [...gauges.values()].map((metric) => ({ ...metric })),
      summaries: [...summaries.values()].map((metric) => ({ ...metric })),
    };
  }

  function reset() {
    counters.clear();
    gauges.clear();
    summaries.clear();
  }

  return { increment, setGauge, observe, snapshot, reset };
}

export function createHttpMetricsMiddleware(metrics, { now = Date.now } = {}) {
  return function httpMetrics(request, response, next) {
    const startedAt = now();
    response.once("finish", () => {
      const labels = {
        method: request.method,
        route: request.route?.path
          ? `${request.baseUrl ?? ""}${String(request.route.path)}`
          : "unmatched",
        status: response.statusCode,
      };
      metrics.increment("http_requests_total", 1, labels);
      metrics.observe("http_request_duration_ms", Math.max(0, now() - startedAt), labels);
      if (response.statusCode >= 500) metrics.increment("http_errors_total", 1, labels);
    });
    next();
  };
}
