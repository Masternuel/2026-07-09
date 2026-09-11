import assert from "node:assert/strict";
import test from "node:test";
import { ensureMarketState, MarketError } from "../game/market.mjs";
import { aiMarketFailure, runRecordedAiMarketTick, publishAiMarketTick, publishAiMarketCommitFailure } from "../game/aiMarketTick.mjs";
import { createMetricsRegistry, createStructuredLogger } from "../infrastructure/observability.mjs";

const NOW = new Date("2026-08-01T12:00:00Z");
const input = { seasonNumber: 1, round: 4, leagueId: "L1", players: [] };
function room() { return { id: "PRIVATE_ROOM", code: "PRIVATE_CODE", currentSeason: 1, competitionCatalog: [], managers: [] }; }
const emptyResult = (_room, input) => ({ tickKey: `${input.seasonNumber}:global:${input.round}`, changed: false, status: "no-deal" });
function telemetry() {
  const logs = [];
  const output = Object.fromEntries(["info", "warn", "error"].map((level) => [level, (line) => logs.push(JSON.parse(line))]));
  return { logs, logger: createStructuredLogger({ output }), metrics: createMetricsRegistry() };
}

test("tick sem negocio e cadence tem identificacao, estado e recibo persistivel", () => {
  const current = room();
  const cadence = runRecordedAiMarketTick(current, { ...input, round: 1 }, NOW);
  assert.equal(cadence.record.status, "skipped");
  assert.equal(cadence.record.outcome, "cadence");
  assert.match(cadence.record.id, /^ai-tick:[a-f0-9]{24}$/);
  assert.equal(cadence.record.attemptCount, 1);
  const result = runRecordedAiMarketTick(current, input, NOW);
  assert.equal(result.record.outcome, "not-enough-ai-clubs");
  const restored = JSON.parse(JSON.stringify(current));
  let executions = 0;
  const duplicate = runRecordedAiMarketTick(restored, { ...input, leagueId: "L2" }, NOW, { execute() { executions += 1; } });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.record.id, result.record.id);
  assert.equal(executions, 0);
  assert.equal(ensureMarketState(restored).aiTickRuns.length, 2);
});

test("ledger legado continua idempotente sem criar transferencia ou executar engine", () => {
  const current = room();
  ensureMarketState(current, NOW).aiTransferTickKeys = ["1:L1:4"];
  const result = runRecordedAiMarketTick(current, input, NOW, { execute() { assert.fail("legacy duplicate"); } });
  assert.equal(result.duplicate, true);
  assert.equal(result.record, null);
});

test("temporada nova permite outro tick sem apagar a identificacao anterior", () => {
  const current = room();
  const first = runRecordedAiMarketTick(current, input, NOW, { execute: emptyResult });
  const restored = JSON.parse(JSON.stringify(current));
  restored.currentSeason = 2;
  const next = runRecordedAiMarketTick(restored, { ...input, seasonNumber: 2 }, NOW, { execute: emptyResult });
  assert.notEqual(next.record.id, first.record.id);
  assert.equal(next.duplicate, false);
  assert.equal(restored.marketState.aiTickRuns.length, 2);
  assert.deepEqual(restored.marketState.aiTransferTickKeys, ["1:global:4", "2:global:4"]);
});

test("transiente repete com rollback integral e identifica todas as tentativas", () => {
  const current = room();
  let calls = 0;
  const result = runRecordedAiMarketTick(current, input, NOW, { execute(draft, context) {
    calls += 1;
    assert.equal(draft.partial, undefined);
    assert.equal(ensureMarketState(draft).transactions.length, 0);
    if (calls === 1) {
      draft.partial = { budget: -999 };
      draft.marketState.transactions.push({ id: "partial" });
      throw Object.assign(new Error("PRIVATE_TOKEN"), { code: "ETIMEDOUT" });
    }
    draft.completedProbe = true;
    return { ...emptyResult(draft, context), status: "completed", changed: true };
  } });
  assert.equal(calls, 2);
  assert.equal(current.partial, undefined);
  assert.equal(current.completedProbe, true);
  assert.equal(result.record.status, "succeeded");
  assert.equal(result.record.error, null);
  assert.deepEqual(result.record.attempts.map((entry) => entry.status), ["failed", "succeeded"]);
  assert.equal(result.record.attempts[0].error.retryable, true);
  assert.ok(!JSON.stringify(current).includes("PRIVATE_TOKEN"));
  const captured = telemetry();
  publishAiMarketTick(result.record, captured);
  assert.equal(captured.logs.filter((event) => event.event === "ai_market.attempt_failed").length, 1);
  assert.equal(captured.logs.at(-1).committed, true);
  assert.equal(captured.metrics.snapshot().counters.find((metric) => metric.name === "ai_market_retries_total").value, 1);
});

test("integridade e excecao inesperada ficam visiveis, sem retry nem residuos", () => {
  for (const error of [new MarketError("PRIVATE_TOKEN", "MARKET_INTEGRITY_CONTRACT_DUPLICATE", 500), new Error("PRIVATE_TOKEN")]) {
    const current = room();
    const revision = ensureMarketState(current, NOW).revision;
    let calls = 0;
    const result = runRecordedAiMarketTick(current, input, NOW, { execute(draft) {
      calls += 1;
      draft.partial = true;
      throw error;
    } });
    assert.equal(calls, 1);
    assert.equal(current.partial, undefined);
    assert.equal(result.record.status, "failed");
    assert.equal(result.record.error.retryable, false);
    assert.equal(current.marketState.lastAiTransferTick.status, "failed");
    assert.equal(current.marketState.revision, revision + 1);
    assert.equal(current.marketState.updatedAt, NOW.toISOString());
    assert.equal(current.marketState.lastAiTransferTick.transactionId, undefined);
    const captured = telemetry();
    publishAiMarketTick(result.record, captured);
    assert.equal(captured.logs.at(-1).level, "error");
    assert.ok(!JSON.stringify([current, captured.logs]).includes("PRIVATE_TOKEN"));
    const duplicate = runRecordedAiMarketTick(JSON.parse(JSON.stringify(current)), input, NOW, { execute() { assert.fail("failed tick repeated"); } });
    assert.equal(duplicate.record.status, "failed");
    assert.equal(duplicate.duplicate, true);
  }
});

test("retry esgota em tres tentativas e nao reinicia depois de reload", () => {
  const current = room();
  let calls = 0;
  const execute = () => { calls += 1; throw Object.assign(new Error("timeout"), { code: "ECONNRESET" }); };
  const result = runRecordedAiMarketTick(current, input, NOW, { maxAttempts: 1000, execute });
  assert.equal(calls, 3);
  assert.equal(result.record.retryExhausted, true);
  assert.equal(result.record.attemptCount, 3);
  runRecordedAiMarketTick(structuredClone(current), input, NOW, { execute });
  assert.equal(calls, 3);
  const single = runRecordedAiMarketTick(room(), input, NOW, { maxAttempts: 1, execute });
  assert.equal(single.record.attemptCount, 1);
});

test("retorno invalido da engine nao vira sucesso", () => {
  const current = room();
  const result = runRecordedAiMarketTick(current, input, NOW, { execute(draft) { draft.partial = true; return null; } });
  assert.equal(result.status, "failed");
  assert.equal(result.record.error.code, "AI_MARKET_UNEXPECTED_ERROR");
  assert.equal(current.partial, undefined);
});

test("historico e labels permanecem limitados; IDs ficam somente nos logs", () => {
  const current = room();
  const captured = telemetry();
  for (let round = 1; round <= 150; round += 1) {
    const result = runRecordedAiMarketTick(current, { ...input, round }, NOW, { execute: emptyResult });
    publishAiMarketTick(result.record, captured);
  }
  assert.equal(current.marketState.aiTickRuns.length, 100);
  assert.equal(current.marketState.aiTransferTickKeys.length, 150);
  assert.equal(current.marketState.aiTickRuns[0].round, 51);
  const snapshot = captured.metrics.snapshot();
  assert.equal(snapshot.registry.series, 3);
  assert.ok(!JSON.stringify(snapshot).includes("ai-tick:"));
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE"));
  assert.ok(captured.logs.every((event) => event.runId.startsWith("ai-tick:")));
});

test("commit incerto registra falha sem contar negocio como confirmado", () => {
  const result = runRecordedAiMarketTick(room(), input, NOW, { execute: emptyResult });
  const captured = telemetry();
  publishAiMarketCommitFailure(result.record, Object.assign(new Error("PRIVATE_TOKEN"), { code: "ETIMEDOUT" }), captured);
  assert.equal(captured.logs[0].event, "ai_market.commit_failed");
  assert.equal(captured.logs[0].commitStatus, "unconfirmed");
  assert.equal(captured.logs[0].committed, null);
  assert.equal(captured.metrics.snapshot().counters.length, 1);
  assert.equal(captured.metrics.snapshot().counters[0].name, "ai_market_commit_failures_total");
  assert.deepEqual(aiMarketFailure({ code: "PRIVATE_TOKEN", message: "PRIVATE_TOKEN" }),
    { code: "AI_MARKET_UNEXPECTED_ERROR", category: "unexpected", retryable: false });
});

test("falha de telemetria nao desfaz sucesso confirmado e tem aviso de contingencia", (context) => {
  const warnings = [];
  context.mock.method(console, "warn", (...args) => warnings.push(args));
  const result = runRecordedAiMarketTick(room(), input, NOW, { execute: emptyResult });
  const metrics = createMetricsRegistry();
  assert.doesNotThrow(() => publishAiMarketTick(result.record, {
    logger: { info() { throw new Error("PRIVATE_LOGGER_SECRET"); } }, metrics,
  }));
  assert.equal(warnings.length, 1);
  assert.equal(JSON.parse(warnings[0][0]).event, "ai_market.telemetry_failed");
  assert.ok(!JSON.stringify(warnings).includes("PRIVATE_LOGGER_SECRET"));
  assert.equal(metrics.snapshot().counters.find((entry) => entry.name === "ai_market_ticks_total").value, 1);
});
