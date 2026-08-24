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

function fakeClock() {
  let currentTime = 0;
  let nextTimerId = 1;
  const timers = new Map();
  return {
    now: () => currentTime,
    setTimer(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, dueAt: currentTime + delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(milliseconds) {
      const targetTime = currentTime + milliseconds;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.dueAt <= targetTime)
          .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        currentTime = timer.dueAt;
        timer.callback();
      }
      currentTime = targetTime;
    },
  };
}

async function flushPlayback() {
  await Promise.resolve();
  await Promise.resolve();
}

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

test("mudancas do intervalo preservam o primeiro tempo e alteram somente o segundo", () => {
  const original = simulateMatch(matchInput);
  const adjusted = simulateMatch({
    ...matchInput,
    homeSecondHalfModifier: 3,
    awaySecondHalfModifier: -3,
  });
  const halftimeIndex = original.events.findIndex((event) => event.type === "halftime");

  assert.equal(adjusted.id, original.id);
  assert.deepEqual(adjusted.events.slice(0, halftimeIndex + 1), original.events.slice(0, halftimeIndex + 1));
  assert.notDeepEqual(adjusted.events.slice(halftimeIndex + 1), original.events.slice(halftimeIndex + 1));
  assert.notDeepEqual(adjusted.statistics, original.statistics);
});

test("segundo tempo narra somente jogadores da escalacao aplicada", () => {
  const original = simulateMatch(matchInput);
  const adjusted = simulateMatch({
    ...matchInput,
    homeSecondHalfPlayers: ["Atacante do intervalo"],
    awaySecondHalfPlayers: ["Defensor do intervalo"],
  });
  const halftimeIndex = original.events.findIndex((event) => event.type === "halftime");

  assert.deepEqual(adjusted.events.slice(0, halftimeIndex + 1), original.events.slice(0, halftimeIndex + 1));
  const secondHalfText = adjusted.events.slice(halftimeIndex + 1).map((event) => event.text).join(" ");
  assert.match(secondHalfText, /Atacante do intervalo/);
  assert.match(secondHalfText, /Defensor do intervalo/);
  assert.doesNotMatch(secondHalfText, /Felipe Rocha|Igor Sampaio|Bruno Mendes|Leandro Paiva|Victor Moura|Rafael Silva|Matias Rojas|Lucas Braga|Diego Costa|Joao Victor/);
});

test("playback emite na ordem e pular remove o intervalo restante", async () => {
  const match = simulateMatch(matchInput);
  const received = [];
  let playback;
  playback = new MatchPlayback(match, {
    delayMs: 5_000,
    onEvent(event) {
      received.push(event.id);
      if (received.length === 1) {
        assert.equal(playback.skip(), true);
        assert.equal(playback.skip(), false);
      }
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

test("playback reaproveita o tempo consumido ao mudar de 0.5x para 3x", async () => {
  const clock = fakeClock();
  const received = [];
  const playback = new MatchPlayback({ events: [{ id: "a" }, { id: "b" }] }, {
    delayMs: 800,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onEvent(event) {
      received.push(event.id);
    },
  });
  assert.equal(playback.setSpeed(0.5), true);
  assert.equal(playback.rate, 0.5);
  assert.equal(playback.baseDelayMs, 800);
  assert.equal(playback.effectiveDelayMs, 1_600);

  const running = playback.start();
  await flushPlayback();
  assert.deepEqual(received, ["a"]);
  clock.advance(400); // 200 ms-base consumidos em 0.5x; restam 600.
  assert.equal(playback.setSpeed(3), true);
  assert.equal(playback.effectiveDelayMs, 800 / 3);
  clock.advance(199);
  await flushPlayback();
  assert.deepEqual(received, ["a"]);
  clock.advance(1);
  await flushPlayback();
  assert.deepEqual(received, ["a", "b"]);
  await running;

  assert.equal(playback.setSpeed(3), false);
  assert.throws(() => playback.setSpeed(4), RangeError);
});

test("playback trava no intervalo ate resume mesmo depois de skip", async () => {
  const match = simulateMatch(matchInput);
  const received = [];
  let notifyHalftime;
  const halftime = new Promise((resolve) => { notifyHalftime = resolve; });
  const playback = new MatchPlayback(match, {
    delayMs: 0,
    onEvent(event) {
      received.push(event);
    },
    onHalftime() {
      notifyHalftime();
    },
  });

  const running = playback.start();
  await halftime;
  assert.equal(playback.paused, true);
  assert.equal(received.at(-1).type, "halftime");
  assert.equal(received.some((event) => event.minute > 45), false);
  assert.equal(playback.setSpeed(3), true);
  assert.equal(playback.paused, true, "mudar velocidade nao libera a trava do intervalo");
  assert.equal(playback.skip(), true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(received.some((event) => event.minute > 45), false);
  assert.equal(playback.resume(), true);
  assert.equal(playback.resume(), false);

  const result = await running;
  assert.equal(result.skipped, true);
  assert.equal(result.cancelled, false);
  assert.equal(received.at(-1).type, "fulltime");
});
