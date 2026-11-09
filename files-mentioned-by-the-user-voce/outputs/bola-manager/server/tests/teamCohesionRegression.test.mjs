import assert from "node:assert/strict";
import test from "node:test";
import { calculateTeamCohesion } from "../game/teamCohesion.mjs";
import { DEFAULT_TACTIC_PLAN, FORMATION_ROLES } from "../game/tactics.mjs";

const players = FORMATION_ROLES["4-3-3"].map((position, index) => ({ id: `p${index}`, position }));
const lineupIds = players.map(({ id }) => id);
const plan = (overrides = {}) => ({ ...structuredClone(DEFAULT_TACTIC_PLAN), ...overrides });
const calculate = (previous, tactics = plan(), options = {}) => calculateTeamCohesion({
  previous, lineupIds, tactics, players, ...options,
});

test("alternar mentalidade e salvar nao consome entrosamento adquirido", () => {
  const initial = calculate();
  let state = initial;
  for (let index = 0; index < 20; index += 1) {
    state = calculate(state, plan({ mentality: index % 2 ? "positive" : "cautious" }));
    assert.equal(state.score, initial.score);
    assert.equal(state.acquiredScore, initial.acquiredScore);
    assert.deepEqual(state.familiarity, initial.familiarity);
  }
});

test("formacao nova afeta adaptacao mas reverter sem jogar restaura familiaridade", () => {
  const initial = calculate();
  let state = initial;
  for (let index = 0; index < 10; index += 1) {
    const changed = calculate(state, plan({ formationId: "4-4-2" }));
    assert.ok(changed.score < initial.score);
    assert.equal(changed.acquiredScore, initial.acquiredScore);
    state = calculate(changed);
    assert.equal(state.score, initial.score);
  }
});

test("salvar e recarregar repetidamente nao altera familiaridade nem experiencia", () => {
  const initial = calculate();
  let state = calculate(initial, plan({ formationId: "4-4-2" }));
  const expected = structuredClone(state);
  for (let index = 0; index < 20; index += 1) {
    state = calculate(JSON.parse(JSON.stringify(state)), plan({ formationId: "4-4-2" }));
    assert.equal(state.score, expected.score);
    assert.equal(state.acquiredScore, expected.acquiredScore);
    assert.deepEqual(state.familiarity, expected.familiarity);
  }
  state = calculate(JSON.parse(JSON.stringify(state)));
  assert.equal(state.score, initial.score);
});

test("titulares, posicoes e estrategia tem custo temporario proporcional e reversivel", () => {
  const initial = calculate();
  const variants = [
    { lineupIds: [...lineupIds.slice(0, 10), "reserve"], players: [...players, { id: "reserve", position: "PD" }] },
    { lineupIds: [lineupIds[0], lineupIds[9], ...lineupIds.slice(2, 9), lineupIds[1], lineupIds[10]] },
    { tactics: plan({ teamInstructions: { ...DEFAULT_TACTIC_PLAN.teamInstructions, pressing: "passive", offensiveTransition: "counter", defensiveTransition: "drop" } }) },
  ];
  for (const variant of variants) {
    let state = initial;
    for (let count = 0; count < 5; count += 1) {
      const changed = calculate(state, variant.tactics ?? plan(), variant);
      assert.ok(changed.score < initial.score);
      assert.equal(changed.acquiredScore, initial.acquiredScore);
      assert.equal(calculate(changed, variant.tactics ?? plan(), variant).score, changed.score);
      state = calculate(changed);
      assert.equal(state.score, initial.score);
    }
  }
  const slight = calculate(initial, plan({ teamInstructions: { ...DEFAULT_TACTIC_PLAN.teamInstructions, tempo: "normal" } }));
  const significant = calculate(initial, variants[2].tactics);
  assert.ok(slight.adaptationPenalty < significant.adaptationPenalty);
});

test("partidas desenvolvem uma nova configuracao e conservam o aprendizado ao voltar", () => {
  const initial = calculate();
  const alternative = plan({ formationId: "4-4-2" });
  let state = calculate(initial, alternative);
  const firstPenalty = state.adaptationPenalty;
  const before = state.score;
  for (let count = 0; count < 3; count += 1) state = calculate(state, alternative, { reason: "match" });
  assert.ok(state.acquiredScore > initial.acquiredScore);
  assert.ok(state.adaptationPenalty < firstPenalty);
  assert.ok(state.score > before);
  assert.equal(state.stableMatches, 3);
  const learned = structuredClone(state);
  state = calculate(state);
  assert.equal(state.adaptationPenalty, 0);
  state = calculate(JSON.parse(JSON.stringify(state)), alternative);
  assert.equal(state.score, learned.score);
  assert.equal(state.stableMatches, learned.stableMatches);
  assert.deepEqual(state.familiarity, learned.familiarity);
});

test("calculo e puro, snapshots legados mantem score e nao inventam experiencia perdida", () => {
  const initial = calculate();
  const { version, acquiredScore, adaptationPenalty, penaltyMultiplier, familiarity, ...legacy } = initial;
  legacy.score = 62;
  legacy.stableMatches = 4;
  const frozen = structuredClone(legacy);
  const migrated = calculate(legacy, plan({ mentality: "balanced" }), { previousTactics: plan() });
  assert.deepEqual(legacy, frozen);
  assert.equal(migrated.score, 62);
  assert.equal(migrated.acquiredScore, 62);
  assert.equal(migrated.stableMatches, 4);
  const changed = calculate(migrated, plan({ formationId: "4-4-2" }));
  assert.equal(calculate(changed).score, 62);
  const before = structuredClone(migrated);
  calculate(migrated, plan({ formationId: "4-4-2" }), { reason: "match" });
  assert.deepEqual(migrated, before);
});

test("historico so cresce em partidas, e limitado e nunca por operacoes de salvar", () => {
  let state = calculate();
  for (let count = 0; count < 50; count += 1) {
    state = calculate(state, plan({ individualInstructions: [{ playerId: `reserve-${count}`, withBall: "attack-space", withoutBall: "press-more" }] }));
  }
  assert.equal(state.familiarity.length, 1);
  for (let count = 0; count < 40; count += 1) {
    state = calculate(state, plan(), { lineupIds: [...lineupIds.slice(0, 10), `reserve-${count}`], reason: "match" });
  }
  assert.equal(state.familiarity.length, 32);
  assert.ok(state.score >= 0 && state.score <= 100);
});
