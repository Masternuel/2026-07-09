import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { calculateTeamCohesion } from "../game/teamCohesion.mjs";
import { DEFAULT_TACTIC_PLAN, FORMATION_ROLES } from "../game/tactics.mjs";

let vite;
let preview;
let normalizeRoom;
before(async () => {
  vite = await createServer({ configFile: false, envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  ({ previewTeamCohesion: preview } = await vite.ssrLoadModule("/src/utils/teamCohesion.ts"));
  ({ normalizeRoomSnapshot: normalizeRoom } = await vite.ssrLoadModule("/src/utils/normalizeRoom.ts"));
});
after(async () => { await vite?.close(); });

const players = FORMATION_ROLES["4-3-3"].map((position, index) => ({ id: `p${index}`, position }));
const lineupIds = players.map(({ id }) => id);
const initialPlan = structuredClone(DEFAULT_TACTIC_PLAN);
const calculate = (previous, tactics = initialPlan, extra = {}) => calculateTeamCohesion({ previous, tactics, lineupIds, players, ...extra });
const saved = (cohesion, tactics = initialPlan) => ({ managerId: "owner", clubId: "AUR", lineupIds, tactics, cohesion });

test("previa e servidor compartilham calculo para mentalidade, formacoes, estrategia e comissao", () => {
  const initial = calculate(null, initialPlan, { cohesionChangePenaltyMultiplier: 0.7 });
  const candidates = [
    ...Object.keys(FORMATION_ROLES).map((formationId) => ({ ...initialPlan, formationId })),
    ...["cautious", "balanced", "attacking"].map((mentality) => ({ ...initialPlan, mentality })),
    { ...initialPlan, teamInstructions: { ...initialPlan.teamInstructions, pressing: "passive", offensiveTransition: "counter" } },
  ];
  for (const tactics of candidates) {
    const previous = structuredClone(initial);
    assert.equal(preview(saved(previous), tactics, players), calculate(previous, tactics).score);
    assert.deepEqual(previous, initial, "Preview must not mutate persisted experience");
  }
});

test("normalizacao da sala conserva aprendizado e permite reverter depois de reload", () => {
  const first = calculate();
  const alternative = { ...initialPlan, formationId: "4-4-2" };
  let state = calculate(first, alternative);
  state = calculate(state, alternative, { reason: "match" });
  const restored = normalizeRoom(JSON.parse(JSON.stringify({ code: "BOLA-TEST", lineups: [saved(state, alternative)] })));
  assert.deepEqual(restored.lineups[0].cohesion.familiarity, state.familiarity);
  assert.equal(restored.lineups[0].cohesion.acquiredScore, state.acquiredScore);
  assert.equal(restored.lineups[0].cohesion.adaptationPenalty, state.adaptationPenalty);
  const reverting = calculate(state);
  assert.equal(preview(restored.lineups[0], initialPlan, players), reverting.score);
  assert.equal(preview(saved(reverting), alternative, players), state.score);
});

test("previa de save legado conserva o valor adquirido e alteracoes pequenas nao descontam", () => {
  const { version, acquiredScore, familiarity, penaltyMultiplier, adaptationPenalty, ...legacy } = calculate();
  legacy.score = 71;
  const room = normalizeRoom({ code: "BOLA-TEST", lineups: [saved(legacy)] });
  assert.equal(preview(room.lineups[0], { ...initialPlan, mentality: "cautious" }, players), 71);
});

test("normalizacao descarta experiencia malformada em vez de propagar numeros invalidos", () => {
  const malformed = { ...calculate(), acquiredScore: Number.NaN, familiarity: [null, { formationId: "invalid" }] };
  const room = normalizeRoom({ code: "BOLA-TEST", lineups: [saved(malformed)] });
  assert.equal(room.lineups[0].cohesion.familiarity, undefined);
  assert.equal(preview(room.lineups[0], initialPlan, players), malformed.score);
});

test("previa conserva os slots vazios sem deslocar os demais jogadores", () => {
  for (const index of [0, 1, 5, 10]) {
    const incomplete = [...players];
    incomplete[index] = undefined;
    const expected = Math.round(76 + 10 * (12 / 11) - 5);
    assert.equal(preview(undefined, initialPlan, incomplete), expected);
  }
});
