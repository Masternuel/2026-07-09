import assert from "node:assert/strict";
import test from "node:test";
import { calculateTeamCohesion, cohesionModifier } from "../game/teamCohesion.mjs";
import { DEFAULT_TACTIC_PLAN, FORMATION_ROLES } from "../game/tactics.mjs";

function plan(overrides = {}) {
  const base = structuredClone(DEFAULT_TACTIC_PLAN);
  return {
    ...base,
    ...overrides,
    teamInstructions: {
      ...base.teamInstructions,
      ...(overrides.teamInstructions ?? {}),
    },
  };
}

function squad(formationId = "4-3-3") {
  return FORMATION_ROLES[formationId].map((position, index) => ({
    id: `p${index + 1}`,
    position,
  }));
}

const ids = Array.from({ length: 11 }, (_, index) => `p${index + 1}`);

test("estado inicial e serializavel e mede encaixe exato", () => {
  const state = calculateTeamCohesion({
    lineupIds: ids,
    tactics: plan(),
    players: squad(),
    reason: "save",
  });
  assert.deepEqual(Object.keys(state), [
    "score",
    "formationId",
    "orderedLineupIds",
    "lineupSignature",
    "tacticFingerprint",
    "stableMatches",
    "outOfPositionCount",
    "exactPositionCount",
    "changeImpact",
  ]);
  assert.equal(state.score, 88);
  assert.equal(state.formationId, "4-3-3");
  assert.deepEqual(state.orderedLineupIds, ids);
  assert.equal(state.exactPositionCount, 11);
  assert.equal(state.outOfPositionCount, 0);
  assert.equal(state.stableMatches, 0);
  assert.equal(state.changeImpact, 0);
  assert.doesNotThrow(() => JSON.stringify(state));
});

test("salvar plano identico e idempotente", () => {
  const first = calculateTeamCohesion({ lineupIds: ids, tactics: plan(), players: squad() });
  const second = calculateTeamCohesion({
    previous: { ...first, score: 81, stableMatches: 3, changeImpact: -7 },
    lineupIds: ids,
    tactics: plan(),
    players: squad(),
    reason: "save",
  });
  assert.equal(second.score, 81);
  assert.equal(second.stableMatches, 3);
  assert.equal(second.changeImpact, 0);
});

test("formacao, titulares, slots e estrategia geram penalidades", () => {
  const initial = calculateTeamCohesion({ lineupIds: ids, tactics: plan(), players: squad() });
  const formationChanged = calculateTeamCohesion({
    previous: initial,
    lineupIds: ids,
    tactics: plan({ formationId: "4-4-2" }),
    players: squad(),
  });
  const replacement = calculateTeamCohesion({
    previous: initial,
    lineupIds: [...ids.slice(0, 10), "p12"],
    tactics: plan(),
    players: [...squad(), { id: "p12", position: "PD" }],
  });
  const swapped = [...ids];
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  const slotChanged = calculateTeamCohesion({
    previous: initial,
    lineupIds: swapped,
    tactics: plan(),
    players: squad(),
  });
  const strategyChanged = calculateTeamCohesion({
    previous: initial,
    lineupIds: ids,
    tactics: plan({ mentality: "cautious" }),
    players: squad(),
  });
  for (const changed of [formationChanged, replacement, slotChanged, strategyChanged]) {
    assert.ok(changed.score < initial.score);
    assert.ok(changed.changeImpact < 0);
    assert.equal(changed.stableMatches, 0);
  }
});

test("jogador incompatível reduz entrosamento e correção recupera parte", () => {
  const perfect = calculateTeamCohesion({ lineupIds: ids, tactics: plan(), players: squad() });
  const malformedPlayers = squad().map((player) => (
    player.id === "p1" ? { ...player, position: "ATA" } : player
  ));
  const misplaced = calculateTeamCohesion({
    previous: perfect,
    lineupIds: ids,
    tactics: plan(),
    players: malformedPlayers,
  });
  assert.equal(misplaced.outOfPositionCount, 1);
  assert.equal(misplaced.exactPositionCount, 10);
  assert.ok(misplaced.score < perfect.score);

  const repaired = calculateTeamCohesion({
    previous: misplaced,
    lineupIds: ids,
    tactics: plan(),
    players: squad(),
  });
  assert.equal(repaired.outOfPositionCount, 0);
  assert.ok(repaired.score > misplaced.score);
});

test("partidas repetidas aumentam estabilidade gradualmente e respeitam teto", () => {
  let state = calculateTeamCohesion({ lineupIds: ids, tactics: plan(), players: squad() });
  const gains = [];
  for (let index = 0; index < 12; index += 1) {
    const previousScore = state.score;
    state = calculateTeamCohesion({
      previous: state,
      lineupIds: ids,
      tactics: plan(),
      players: squad(),
      reason: "match",
    });
    gains.push(state.score - previousScore);
  }
  assert.equal(state.stableMatches, 12);
  assert.equal(state.score, 100);
  assert.ok(gains[4] >= gains[0]);
  assert.ok(gains.every((gain) => gain >= 0));
});

test("conclusao sem catalogo de jogadores preserva o encaixe salvo", () => {
  const initial = calculateTeamCohesion({
    lineupIds: ids,
    tactics: plan(),
    players: squad(),
  });
  const completed = calculateTeamCohesion({
    previous: initial,
    lineupIds: ids,
    tactics: plan(),
    reason: "match",
  });
  assert.equal(completed.exactPositionCount, initial.exactPositionCount);
  assert.equal(completed.outOfPositionCount, initial.outOfPositionCount);
  assert.equal(completed.stableMatches, 1);
  assert.ok(completed.score > initial.score);
});

test("mudanca antes da partida reinicia sequencia estavel", () => {
  const initial = calculateTeamCohesion({ lineupIds: ids, tactics: plan(), players: squad() });
  const stable = calculateTeamCohesion({
    previous: { ...initial, stableMatches: 5 },
    lineupIds: ids,
    tactics: plan(),
    players: squad(),
    reason: "match",
  });
  const changed = calculateTeamCohesion({
    previous: stable,
    lineupIds: ids,
    tactics: plan({ teamInstructions: { tempo: "very-slow" } }),
    players: squad(),
    reason: "match",
  });
  assert.equal(stable.stableMatches, 6);
  assert.equal(changed.stableMatches, 0);
  assert.ok(changed.changeImpact < 0);
});

test("segredo e ordem das instrucoes nao alteram fingerprint esportivo", () => {
  const instructions = [
    { playerId: "p9", withBall: "attack-space", withoutBall: "press-more" },
    { playerId: "p8", withBall: "support-inside", withoutBall: "hold-position" },
  ];
  const firstPlan = plan({ individualInstructions: instructions, secret: true });
  const first = calculateTeamCohesion({ lineupIds: ids, tactics: firstPlan, players: squad() });
  const second = calculateTeamCohesion({
    previous: first,
    lineupIds: ids,
    tactics: plan({ individualInstructions: [...instructions].reverse(), secret: false }),
    players: squad(),
  });
  assert.equal(second.tacticFingerprint, first.tacticFingerprint);
  assert.equal(second.score, first.score);
  assert.equal(second.changeImpact, 0);
});

test("modificador e pequeno, monotônico e limitado", () => {
  assert.equal(cohesionModifier(Number.NaN), 0);
  assert.equal(cohesionModifier(70), 0);
  assert.equal(cohesionModifier(100), 0.25);
  assert.equal(cohesionModifier(0), -0.35);
  assert.equal(cohesionModifier(-500), -0.35);
  assert.equal(cohesionModifier(500), 0.25);
  assert.ok(cohesionModifier(85) > cohesionModifier(60));
});

test("comissão acelera estabilidade e reduz penalidade de mudanças", () => {
  const base = calculateTeamCohesion({ lineupIds: ids, tactics: plan(), players: squad() });
  const normalStable = calculateTeamCohesion({
    previous: base,
    lineupIds: ids,
    tactics: plan(),
    players: squad(),
    reason: "match",
  });
  const supportedStable = calculateTeamCohesion({
    previous: base,
    lineupIds: ids,
    tactics: plan(),
    players: squad(),
    reason: "match",
    cohesionGainBonus: 2,
  });
  const changedIds = [...ids];
  [changedIds[0], changedIds[1]] = [changedIds[1], changedIds[0]];
  const normalChange = calculateTeamCohesion({
    previous: base,
    lineupIds: changedIds,
    tactics: plan(),
    players: squad(),
  });
  const supportedChange = calculateTeamCohesion({
    previous: base,
    lineupIds: changedIds,
    tactics: plan(),
    players: squad(),
    cohesionChangePenaltyMultiplier: 0.7,
  });

  assert.ok(supportedStable.score > normalStable.score);
  assert.ok(supportedChange.score > normalChange.score);
});
