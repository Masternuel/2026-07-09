import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeSectorMatchup,
  calculateTacticalMatchup,
} from "../game/tacticalAnalysis.mjs";

function tactics(overrides = {}) {
  return {
    formationId: "4-3-3",
    mentality: "balanced",
    teamInstructions: {
      pressureLine: "medium",
      width: "normal",
      tempo: "normal",
      pressing: "moderate",
      offensiveTransition: "direct",
      defensiveTransition: "regroup",
      ...overrides.teamInstructions,
    },
    setPieces: {
      goalKick: { takerId: null, routine: "mixed" },
      ...overrides.setPieces,
    },
    ...overrides,
  };
}

function profile(overrides = {}) {
  return {
    available: true,
    formationId: "4-3-3",
    attack: 0,
    control: 0,
    defense: 0,
    ...overrides,
  };
}

function attributes(overrides = {}) {
  return {
    available: true,
    attack: 10,
    midfield: 10,
    defense: 10,
    goalkeeping: 10,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    homeTactics: tactics(),
    awayTactics: tactics(),
    homeProfile: profile(),
    awayProfile: profile(),
    homeAttributes: attributes(),
    awayAttributes: attributes(),
    ...overrides,
  };
}

function reasonsWithoutSide(result) {
  return result.reasons.map((reason) => ({
    ...reason,
    side: reason.side === "home" ? "away" : "home",
  })).sort((left, right) => (
    Math.abs(right.impact) - Math.abs(left.impact)
      || left.code.localeCompare(right.code, "en")
      || left.side.localeCompare(right.side, "en")
  ));
}

test("duelo idêntico é neutro, determinístico e sem justificativa inventada", () => {
  const data = input();
  const first = calculateTacticalMatchup(data);
  const second = calculateTacticalMatchup(structuredClone(data));

  assert.deepEqual(first, second);
  assert.equal(first.home.edge, 0);
  assert.equal(first.away.edge, 0);
  assert.equal(first.home.modifier, 0);
  assert.equal(first.away.modifier, 0);
  assert.deepEqual(first.reasons, []);
});

test("pressão, amplitude, contra-ataque e setores reais geram vantagem explicável", () => {
  const result = calculateTacticalMatchup(input({
    homeTactics: tactics({
      formationId: "4-3-3",
      teamInstructions: {
        pressureLine: "very-high",
        width: "very-wide",
        pressing: "aggressive",
        offensiveTransition: "counter",
        defensiveTransition: "regroup",
      },
    }),
    awayTactics: tactics({
      formationId: "3-4-3",
      teamInstructions: {
        pressureLine: "high",
        width: "very-narrow",
        pressing: "passive",
        offensiveTransition: "build-up",
        defensiveTransition: "drop",
      },
      setPieces: { goalKick: { takerId: null, routine: "short" } },
    }),
    homeProfile: profile({ attack: 0.4, control: 0.2, defense: 0.1 }),
    awayProfile: profile({ attack: 0, control: -0.1, defense: -0.2 }),
    homeAttributes: attributes({ attack: 16, midfield: 15, defense: 14, goalkeeping: 14 }),
    awayAttributes: attributes({ attack: 10, midfield: 10, defense: 9, goalkeeping: 8 }),
  }));

  assert.ok(result.home.edge > 0);
  assert.equal(result.away.edge, -result.home.edge);
  assert.equal(result.away.modifier, -result.home.modifier);
  assert.ok(result.reasons.every((reason) => (
    typeof reason.code === "string"
      && ["home", "away"].includes(reason.side)
      && typeof reason.label === "string"
      && Number.isFinite(reason.impact)
  )));
  const codes = new Set(result.reasons.map((reason) => reason.code));
  assert.ok(codes.has("width-vs-block"));
  assert.ok(codes.has("press-vs-build-up"));
  assert.ok(codes.has("counter-vs-high-line"));
  assert.ok(codes.has("attack-vs-defense"));
  assert.ok(codes.has("midfield-control"));
});

test("trocar mandante e visitante preserva simetria do cálculo", () => {
  const data = input({
    homeTactics: tactics({
      formationId: "3-5-2",
      teamInstructions: {
        pressureLine: "high",
        width: "wide",
        pressing: "intense",
        offensiveTransition: "counter",
      },
    }),
    awayTactics: tactics({
      formationId: "5-4-1",
      teamInstructions: {
        pressureLine: "low",
        width: "narrow",
        pressing: "moderate",
        offensiveTransition: "build-up",
      },
    }),
    homeProfile: profile({ attack: 0.2, control: 0.3, defense: -0.1 }),
    awayProfile: profile({ formationId: "5-4-1", attack: -0.2, control: 0, defense: 0.4 }),
    homeAttributes: attributes({ attack: 14, midfield: 16, defense: 11, goalkeeping: 12 }),
    awayAttributes: attributes({ attack: 11, midfield: 12, defense: 16, goalkeeping: 17 }),
  });
  const original = calculateTacticalMatchup(data);
  const swapped = calculateTacticalMatchup({
    homeTactics: data.awayTactics,
    awayTactics: data.homeTactics,
    homeProfile: data.awayProfile,
    awayProfile: data.homeProfile,
    homeAttributes: data.awayAttributes,
    awayAttributes: data.homeAttributes,
  });

  assert.equal(swapped.home.edge, original.away.edge);
  assert.equal(swapped.away.edge, original.home.edge);
  assert.equal(swapped.home.modifier, original.away.modifier);
  assert.deepEqual(swapped.reasons, reasonsWithoutSide(original));
});

test("vantagem extrema permanece limitada e não determina sozinha o vencedor", () => {
  const result = calculateTacticalMatchup(input({
    homeTactics: tactics({
      formationId: "4-2-3-1",
      teamInstructions: {
        pressureLine: "very-high",
        width: "very-wide",
        pressing: "aggressive",
        offensiveTransition: "counter",
        defensiveTransition: "counter-press",
      },
    }),
    awayTactics: tactics({
      formationId: "3-4-3",
      teamInstructions: {
        pressureLine: "very-high",
        width: "very-narrow",
        pressing: "passive",
        offensiveTransition: "build-up",
        defensiveTransition: "drop",
      },
    }),
    homeProfile: profile({ attack: 0.75, control: 0.75, defense: 0.75 }),
    awayProfile: profile({ attack: -0.75, control: -0.75, defense: -0.75 }),
    homeAttributes: attributes({ attack: 20, midfield: 20, defense: 20, goalkeeping: 20 }),
    awayAttributes: attributes({ attack: 1, midfield: 1, defense: 1, goalkeeping: 1 }),
  }));

  assert.ok(Math.abs(result.home.edge) <= 0.8);
  assert.ok(Math.abs(result.away.edge) <= 0.8);
  assert.ok(Math.abs(result.home.modifier) <= 0.4);
  assert.ok(Math.abs(result.away.modifier) <= 0.4);
});

test("análise setorial usa goleiro, defesa e meio-campo reais", () => {
  const weakGoalkeeper = analyzeSectorMatchup(
    attributes({ attack: 15, midfield: 14 }),
    attributes({ defense: 12, goalkeeping: 2, midfield: 10 }),
  );
  const strongGoalkeeper = analyzeSectorMatchup(
    attributes({ attack: 15, midfield: 14 }),
    attributes({ defense: 12, goalkeeping: 20, midfield: 10 }),
  );

  assert.ok(weakGoalkeeper.home.attackVsDefense > strongGoalkeeper.home.attackVsDefense);
  assert.ok(weakGoalkeeper.home.midfieldControl > 0);
  assert.equal(weakGoalkeeper.away.midfieldControl, -weakGoalkeeper.home.midfieldControl);

  const unavailable = analyzeSectorMatchup(
    { available: false },
    { available: false },
  );
  assert.equal(unavailable.edge, 0);
  assert.equal(unavailable.home.attackVsDefense, 0);
  assert.equal(unavailable.away.attackVsDefense, 0);
});
