import assert from "node:assert/strict";
import test from "node:test";
import { simulateAiFixture } from "../game/aiMatchSimulation.mjs";

const COMPLETED_AT = "2026-07-18T12:00:00.000Z";

function room(id) {
  return { id, code: "BOLA-SYMM", currentSeason: 1, playerStates: [] };
}

function fixture(id) {
  return {
    leagueFixtureId: id,
    leagueId: "TEST-L1",
    round: 1,
    homeClubId: "HOME",
    awayClubId: "AWAY",
    homeTeam: "Casa",
    awayTeam: "Fora",
    homeStrength: 10,
    awayStrength: 10,
  };
}

function roster(clubId, { count = 11, star = false } = {}) {
  const positions = ["GOL", "LD", "ZAG", "ZAG", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"];
  return positions.slice(0, count).map((position, index) => ({
    id: `${clubId}-P${index + 1}`,
    clubId,
    name: `${clubId} Jogador ${index + 1}`,
    position,
    overall: star ? 20 : 10,
    isStar: star,
    condition: 100,
    active: true,
  }));
}

function simulate(id, entries) {
  return simulateAiFixture(room(id), fixture(`fixture-${id}`), new Map(entries), COMPLETED_AT);
}

function matchProjection(result) {
  return {
    score: result.score,
    statistics: result.statistics,
    strengthProfile: result.strengthProfile,
    simulationVersion: result.simulationVersion,
  };
}

function fallbackFor(id) {
  return simulate(id, [["HOME", []], ["AWAY", []]]);
}

test("mandante ausente remove dados do visitante e usa fallback simetrico", () => {
  const actual = simulate("home-missing", [["AWAY", roster("AWAY", { star: true })]]);
  const expected = fallbackFor("home-missing");
  assert.equal(actual.rosterMode, "symmetric_fallback");
  assert.deepEqual(matchProjection(actual), matchProjection(expected));
});

test("visitante ausente remove dados do mandante e usa fallback simetrico", () => {
  const actual = simulate("away-missing", [["HOME", roster("HOME", { star: true })]]);
  const expected = fallbackFor("away-missing");
  assert.equal(actual.rosterMode, "symmetric_fallback");
  assert.deepEqual(matchProjection(actual), matchProjection(expected));
});

test("ambos ausentes preservam o fallback legado sem progressao inventada", () => {
  const state = room("both-missing");
  const result = simulateAiFixture(
    state,
    fixture("fixture-both-missing"),
    new Map(),
    COMPLETED_AT,
  );
  assert.equal(result.rosterMode, "symmetric_fallback");
  assert.equal(result.simulationVersion, undefined);
  assert.deepEqual(state.playerStates, []);
});

test("roster parcial invalida os dois lados da simulacao oficial", () => {
  const actual = simulate("partial", [
    ["HOME", roster("HOME", { count: 10, star: true })],
    ["AWAY", roster("AWAY")],
  ]);
  const expected = fallbackFor("partial");
  assert.equal(actual.rosterCoverage.home.status, "partial");
  assert.deepEqual(matchProjection(actual), matchProjection(expected));
});

test("jogador duplicado entre clubes invalida ambos os rosters", () => {
  const home = roster("HOME", { star: true });
  const away = roster("AWAY");
  away[1] = { ...away[1], id: home[1].id, clubId: "AWAY" };
  const actual = simulate("duplicate", [["HOME", home], ["AWAY", away]]);
  const expected = fallbackFor("duplicate");
  assert.equal(actual.rosterCoverage.home.status, "duplicate");
  assert.equal(actual.rosterCoverage.away.status, "duplicate");
  assert.deepEqual(matchProjection(actual), matchProjection(expected));
});

test("cobertura completa usa catalogo, bonus e estatisticas individuais", () => {
  const state = room("complete");
  const result = simulateAiFixture(state, fixture("fixture-complete"), new Map([
    ["HOME", roster("HOME", { star: true })],
    ["AWAY", roster("AWAY")],
  ]), COMPLETED_AT);
  assert.equal(result.rosterMode, "catalog");
  assert.equal(result.simulationVersion, 2);
  assert.equal(result.strengthProfile.home.starBonus > result.strengthProfile.away.starBonus, true);
  assert.equal(state.playerStates.some((player) => player.seasonStats.appearances === 1), true);
});
