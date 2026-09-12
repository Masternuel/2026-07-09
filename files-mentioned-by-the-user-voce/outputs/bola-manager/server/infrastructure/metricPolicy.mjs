const choice = (values) => {
  const allowed = new Set(values);
  return (value) => allowed.has(value) ? value : "other";
};

const httpMethods = choice(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const httpRoutes = choice([
  "/health", "/ready", "/metrics", "/api/rooms", "/api/teams", "/api/leagues",
  "/api/tournaments", "/api/matches", "/api/market", "/api/news", "/api/editor", "/api/media", "unmatched",
]);
const socketEvents = choice([
  "auth:refresh", "auth:logout", "chat:send", "chat:direct", "lineup:save",
  "room:create", "room:join", "room:resume", "room:sync", "room:ready", "room:start", "room:delete",
  "club:upgrade", "club:news-read", "career:staff:hire", "career:staff:fire", "career:staff:renew",
  "career:professional:lifecycle", "match:ready", "match:start", "match:skip", "match:speed",
  "match:halftime-plan", "match:halftime-ready", "match:sync", "market:sync", "market:offer",
  "market:respond", "market:list", "market:bid", "market:cancel-listing", "market:exercise-loan-option",
]);
const httpLabels = {
  method: httpMethods,
  route: httpRoutes,
  status: (value) => /^[1-5]\d{2}$/.test(value) ? value : "other",
};
const socketLabels = { event: socketEvents, status: choice(["ok", "error"]) };
const aiMarketStatus = choice(["succeeded", "skipped", "failed"]);
const aiMarketError = choice(["none", "transient", "integrity", "persistence", "validation", "unexpected"]);

export function lockMetricResource(resource) {
  return typeof resource === "string" && (resource === "match" || resource.startsWith("match:"))
    ? "match" : "other";
}

// Only these dimensions may enter the registry. Never retain arbitrary IDs or error messages.
const definitions = new Map([
  ["http_requests_total", ["counter", httpLabels]],
  ["ai_market_ticks_total", ["counter", { status: aiMarketStatus }]],
  ["ai_market_tick_duration_ms", ["summary", { status: aiMarketStatus }]],
  ["ai_market_attempts_total", ["counter", { status: choice(["succeeded", "failed"]), category: aiMarketError }]],
  ["ai_market_retries_total", ["counter", { category: aiMarketError }]],
  ["ai_market_commit_failures_total", ["counter", { category: aiMarketError }]],
  ["http_errors_total", ["counter", httpLabels]],
  ["http_request_duration_ms", ["summary", httpLabels]],
  ["socket_events_total", ["counter", socketLabels]],
  ["socket_event_duration_ms", ["summary", socketLabels]],
  ["socket_background_errors_total", ["counter", { event: socketEvents }]],
  ["rate_limit_hits_total", ["counter", { event: socketEvents }]],
  ["distributed_lock_errors_total", ["counter", { operation: choice(["acquire"]) }]],
  ...["acquired", "lost", "renewed", "released", "timeout"].map((event) => [
    `distributed_lock_${event}_total`, ["counter", { resource: lockMetricResource }],
  ]),
  ["distributed_lock_wait_ms", ["summary", { resource: lockMetricResource }]],
  ["match_persistence_failures_total", ["counter", {
    operation: choice(["save"]),
    error: choice(["MATCH_PERSISTENCE_ERROR", "MATCH_PERSISTENCE_TIMEOUT", "MATCH_OWNERSHIP_LOST"]),
  }]],
  ...["started", "completed", "failed"].map((event) => [
    `jobs_${event}_total`, ["counter", { job: choice(["match_playback"]) }],
  ]),
  ...["socket_connections_total", "socket_disconnections_total"].map((name) => [name, ["counter", {}]]),
  ...["socket_connections_active", "event_loop_lag_ms", "dependency_readiness", "server_ready"]
    .map((name) => [name, ["gauge", {}]]),
]);

export function normalizeMetricSample(name, type, labels = {}) {
  const definition = definitions.get(name);
  if (!definition || definition[0] !== type) return null;
  const normalized = {};
  for (const [key, normalize] of Object.entries(definition[1])) {
    const value = labels?.[key];
    // Do not stringify objects or retain unbounded input strings.
    const text = typeof value === "number" ? String(value)
      : typeof value === "string" && value.length <= 256 ? value : "";
    normalized[key] = normalize(text);
  }
  return normalized;
}

export function httpMetricRoute(path) {
  if (typeof path !== "string") return "unmatched";
  const pathname = path.split("?", 1)[0].toLowerCase().replace(/\/$/, "");
  const family = pathname.startsWith("/api/") ? pathname.split("/", 4).slice(0, 3).join("/") : pathname;
  const route = httpRoutes(family);
  return route === "other" ? "unmatched" : route;
}
