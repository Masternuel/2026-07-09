import test from "node:test";
import assert from "node:assert/strict";
import { MatchPlayback, simulateMatch } from "../game/matchSimulator.mjs";

const matchInput = {
  homeTeam: "Aurora FC",
  awayTeam: "Santos",
  homeStrength: 14,
  awayStrength: 12,
  seed: "rodada-14",
};

test("simulação é determinística para a mesma seed", () => {
  const first = simulateMatch(matchInput);
  const second = simulateMatch(matchInput);
  assert.deepEqual(first, second);
  assert.match(first.id, /^match-[a-f0-9]{8}$/);
  assert.equal(first.events.at(-1).type, "fulltime");
  assert.deepEqual(first.events.at(-1).score, first.score);
});

test("gera eventos em português e estatísticas coerentes", () => {
  const match = simulateMatch(matchInput);
  const types = new Set(match.events.map((event) => event.type));
  for (const required of ["kickoff", "foul", "yellow-card", "halftime", "post", "injury", "substitution", "penalty", "var", "fulltime"]) {
    assert.equal(types.has(required), true, `evento ausente: ${required}`);
  }
  assert.match(match.events.find((event) => event.type === "penalty").text, /PÊNALTI/);
  assert.equal(match.statistics.home.possession + match.statistics.away.possession, 100);
  assert.equal(match.statistics.home.shots >= match.score[0], true);
  assert.equal(match.statistics.away.shots >= match.score[1], true);
});

test("playback emite na ordem e pular remove o intervalo restante", async () => {
  const match = simulateMatch(matchInput);
  const received = [];
  let playback;
  playback = new MatchPlayback(match, {
    delayMs: 5_000,
    onEvent(event) {
      received.push(event.id);
      if (received.length === 1) playback.skip();
    },
  });

  const startedAt = performance.now();
  const result = await playback.start();
  const elapsed = performance.now() - startedAt;
  assert.deepEqual(received, match.events.map((event) => event.id));
  assert.equal(result.skipped, true);
  assert.equal(result.emittedEvents, match.events.length);
  assert.equal(elapsed < 500, true, `playback levou ${elapsed}ms`);
});
