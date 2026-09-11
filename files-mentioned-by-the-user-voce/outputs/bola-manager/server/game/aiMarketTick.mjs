import { createHash } from "node:crypto";
import { ensureMarketState, runAiTransferTick } from "./market.mjs";

const MAX_RUNS = 100;
const MAX_KEYS = 500;
const OUTCOMES = new Set(["completed", "cadence", "window-closed", "not-enough-ai-clubs", "no-deal"]);
const TRANSIENT_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "UNAVAILABLE", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED"]);
const positiveInteger = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

export function aiMarketFailure(error) {
  const raw = typeof error?.code === "string" && error.code.length <= 64
    ? error.code.toUpperCase().replaceAll("-", "_") : "";
  const code = TRANSIENT_CODES.has(raw) || /^(?:MARKET|SAVE)_[A-Z_]{1,56}$/.test(raw)
    ? raw : "AI_MARKET_UNEXPECTED_ERROR";
  const category = TRANSIENT_CODES.has(code) ? "transient"
    : code.startsWith("MARKET_INTEGRITY_") ? "integrity"
      : code.startsWith("SAVE_") ? "persistence"
      : Number(error?.status) >= 400 && Number(error?.status) < 500 ? "validation" : "unexpected";
  // Never persist exception messages/stacks: they may contain provider credentials.
  return { code, category, retryable: category === "transient" };
}

function replaceRoom(room, snapshot) {
  for (const key of Object.keys(room)) delete room[key];
  Object.assign(room, snapshot);
}

/** Synchronous, room-local work only. Persistence owns commit/CAS and retries of that commit. */
export function runRecordedAiMarketTick(room, input, now, {
  execute = runAiTransferTick,
  maxAttempts = 3,
  clock = performance.now.bind(performance),
} = {}) {
  const seasonNumber = positiveInteger(input.seasonNumber, positiveInteger(room.currentSeason, 1));
  const round = positiveInteger(input.round, 1);
  const tickKey = `${seasonNumber}:global:${round}`;
  const state = ensureMarketState(room, now);
  const previous = state.aiTickRuns.find((run) => run.tickKey === tickKey);
  if (previous) return { duplicate: true, changed: false, record: structuredClone(previous) };
  // Saves predating receipts already carry a durable processed-key ledger.
  if (state.aiTransferTickKeys.some((key) => key.startsWith(`${seasonNumber}:`) && key.endsWith(`:${round}`))) {
    return { duplicate: true, changed: false, record: null };
  }

  const started = clock();
  const at = new Date(now).toISOString();
  const limit = Math.min(3, positiveInteger(maxAttempts, 3));
  const record = {
    id: `ai-tick:${createHash("sha256").update(`${room.id ?? room.code}:${tickKey}`).digest("hex").slice(0, 24)}`,
    tickKey, seasonNumber, round,
    status: "running", outcome: null, startedAt: at, completedAt: null,
    maxAttempts: limit, attemptCount: 0, attempts: [], error: null, retryExhausted: false,
  };
  const before = structuredClone(room);
  let result;
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    const attemptStarted = clock();
    try {
      result = execute(room, { ...input, seasonNumber, round }, now);
      if (!result || !OUTCOMES.has(result.status) || result.tickKey !== tickKey) {
        throw new Error("Invalid autonomous market result");
      }
      record.attempts.push({ number: attempt, status: "succeeded", durationMs: Math.max(0, clock() - attemptStarted) });
      record.status = result.changed ? "succeeded" : "skipped";
      record.outcome = result.status;
      break;
    } catch (error) {
      // The complete tick, including any earlier deal, must roll back before retry.
      replaceRoom(room, structuredClone(before));
      const failure = aiMarketFailure(error);
      record.attempts.push({ number: attempt, status: "failed", error: failure, durationMs: Math.max(0, clock() - attemptStarted) });
      if (!failure.retryable || attempt === limit) {
        record.status = "failed";
        record.outcome = "failed";
        record.error = failure;
        record.retryExhausted = failure.retryable && attempt === limit;
        result = { changed: false, tickKey, status: "failed" };
        break;
      }
    }
  }
  record.attemptCount = record.attempts.length;
  record.durationMs = Math.max(0, clock() - started);
  record.completedAt = at;
  const committedState = ensureMarketState(room, now);
  if (record.status === "failed") {
    committedState.revision += 1;
    committedState.updatedAt = at;
  }
  committedState.aiTickRuns = [...committedState.aiTickRuns, record].slice(-MAX_RUNS);
  committedState.aiTransferTickKeys = [...new Set([...committedState.aiTransferTickKeys, tickKey])].slice(-MAX_KEYS);
  committedState.lastAiTransferTick = {
    ...result,
    tickKey, seasonNumber, round, leagueId: input.leagueId ?? null,
    runId: record.id, executionAttempts: record.attemptCount,
    completedAt: at, error: record.error,
  };
  return { ...result, duplicate: false, record: structuredClone(record) };
}

function telemetry(channel, runId, operation) {
  try { operation(); } catch {
    console.warn(JSON.stringify({ event: "ai_market.telemetry_failed", channel, runId }));
  }
}

/** Emit only after the room commit, never from a replayable persistence callback. */
export function publishAiMarketTick(record, { logger, metrics } = {}) {
  if (!record) return;
  const context = { runId: record.id, tickKey: record.tickKey, seasonNumber: record.seasonNumber, round: record.round, committed: true };
  telemetry("logger", record.id, () => {
    logger?.info("ai_market.tick_started", { ...context, startedAt: record.startedAt });
    for (const attempt of record.attempts) {
      if (attempt.status === "failed") logger?.warn("ai_market.attempt_failed", { ...context, ...attempt });
    }
    const level = record.status === "failed" ? "error" : "info";
    logger?.[level]("ai_market.tick_finished", { ...context, status: record.status, outcome: record.outcome,
      attemptCount: record.attemptCount, retryExhausted: record.retryExhausted, error: record.error, durationMs: record.durationMs });
  });
  telemetry("metrics", record.id, () => {
    metrics?.increment("ai_market_ticks_total", 1, { status: record.status });
    metrics?.observe("ai_market_tick_duration_ms", record.durationMs, { status: record.status });
    for (const attempt of record.attempts) {
      metrics?.increment("ai_market_attempts_total", 1, { status: attempt.status, category: attempt.error?.category ?? "none" });
      if (attempt.number < record.attemptCount) metrics?.increment("ai_market_retries_total", 1, { category: attempt.error?.category ?? "none" });
    }
  });
}

export function publishAiMarketCommitFailure(record, error, { logger, metrics } = {}) {
  if (!record) return;
  const failure = aiMarketFailure(error);
  telemetry("logger", record.id, () => logger?.error("ai_market.commit_failed", {
    runId: record.id, tickKey: record.tickKey, committed: null, commitStatus: "unconfirmed", error: failure,
  }));
  telemetry("metrics", record.id, () => metrics?.increment("ai_market_commit_failures_total", 1, { category: failure.category }));
}
