import assert from "node:assert/strict";
import test from "node:test";
import { simulateAiFixture } from "../game/aiMatchSimulation.mjs";

function roster(clubId) {
  const positions = ["GOL", "LE", "ZAG", "ZAG", "LD", "VOL", "MC", "MEI", "PE", "ATA", "PD", "ATA"];
  return positions.map((position, index) => ({
    id: `${clubId}-${index + 1}`,
    clubId,
    name: `${clubId} Jogador ${index + 1}`,
    position,
    overall: 11 + (index % 4),
    condition: 100,
    active: true,
  }));
}

test("partida IA atualiza estatisticas e condicao apenas de jogadores reais", () => {
  const room = {
    id: "room-ai",
    code: "BOLA-AIST",
    currentSeason: 1,
    playerStates: [],
  };
  const fixture = {
    leagueFixtureId: "league:1:round:1:ai",
    leagueId: "league:1",
    round: 1,
    homeClubId: "HOME",
    awayClubId: "AWAY",
    homeTeam: "Casa",
    awayTeam: "Fora",
    homeStrength: 12,
    awayStrength: 11,
  };
  const result = simulateAiFixture(room, fixture, new Map([
    ["HOME", roster("HOME")],
    ["AWAY", roster("AWAY")],
  ]), "2026-07-18T12:00:00.000Z");

  assert.equal(result.simulationVersion, 2);
  assert.equal(result.playerStatistics.home.some((stat) => stat.started && stat.position === "GOL"), true);
  assert.equal(result.playerStatistics.away.some((stat) => stat.started && stat.position === "GOL"), true);
  assert.equal(room.playerStates.length > 0, true);
  assert.equal(room.playerStates.every((state) => !state.playerId.includes("virtual")), true);
  assert.equal(room.playerStates.some((state) => state.seasonStats.appearances === 1), true);
  assert.equal(room.playerStates.some((state) => state.condition < 100), true);
  assert.equal(
    room.playerStates.reduce((total, state) => total + state.seasonStats.goals, 0),
    result.score[0] + result.score[1],
  );
  assert.equal(
    room.playerStates.reduce((total, state) => total + state.seasonStats.assists, 0),
    [...result.playerStatistics.home, ...result.playerStatistics.away]
      .reduce((total, stat) => total + stat.assists, 0),
  );
});

test("partida IA sem catalogo preserva fallback de placar sem criar atletas virtuais no save", () => {
  const room = { id: "room-legacy", code: "BOLA-LEGA", currentSeason: 1, playerStates: [] };
  const fixture = {
    leagueFixtureId: "league:1:round:2:ai",
    leagueId: "league:1",
    round: 2,
    homeClubId: "HOME",
    awayClubId: "AWAY",
    homeTeam: "Casa",
    awayTeam: "Fora",
    homeStrength: 12,
    awayStrength: 11,
  };
  const result = simulateAiFixture(room, fixture, new Map(), "2026-07-18T12:00:00.000Z");
  assert.deepEqual(room.playerStates, []);
  assert.equal(result.simulationVersion, undefined);
  assert.equal(Array.isArray(result.score), true);
});

test("duas partidas de copa usam IDs distintos e atualizam a progressao duas vezes", () => {
  const room = {
    id: "room-cup-ai",
    code: "BOLA-CUPA",
    currentSeason: 1,
    playerStates: [],
  };
  const baseFixture = {
    tournamentId: "CUP",
    round: 1,
    homeClubId: "HOME",
    awayClubId: "AWAY",
    homeTeam: "Casa",
    awayTeam: "Fora",
    homeStrength: 12,
    awayStrength: 11,
  };
  const rosters = new Map([
    ["HOME", roster("HOME")],
    ["AWAY", roster("AWAY")],
  ]);
  const first = simulateAiFixture(room, {
    ...baseFixture,
    competitionFixtureId: "cup:s1:semi:r1:m1:l1",
  }, rosters, "2026-07-18T12:00:00.000Z");
  const firstGoalkeeper = room.playerStates.find((state) => state.playerId === "HOME-1");
  assert.equal(firstGoalkeeper.seasonStats.appearances, 1);
  assert.match(firstGoalkeeper.lastMatchId, /m1:l1$/);

  const second = simulateAiFixture(room, {
    ...baseFixture,
    competitionFixtureId: "cup:s1:semi:r1:m2:l1",
  }, rosters, "2026-07-18T13:00:00.000Z");
  const secondGoalkeeper = room.playerStates.find((state) => state.playerId === "HOME-1");
  assert.equal(secondGoalkeeper.seasonStats.appearances, 2);
  assert.match(secondGoalkeeper.lastMatchId, /m2:l1$/);
  assert.notEqual(first.seed, second.seed);
  assert.notEqual(first.id, second.id);
});

test("partida IA sem qualquer identificador falha sem criar colisao silenciosa", () => {
  assert.throws(() => simulateAiFixture(
    { id: "room-invalid", code: "BOLA-NULL", currentSeason: 1, playerStates: [] },
    { homeClubId: "HOME", awayClubId: "AWAY", homeTeam: "Casa", awayTeam: "Fora" },
    new Map(),
    "2026-07-18T12:00:00.000Z",
  ), /sem identificador/);
});

test("falha parcial de elenco nao grava estatistica assimetrica e ainda cumpre suspensao", () => {
  const room = {
    id: "room-partial",
    code: "BOLA-PART",
    currentSeason: 1,
    playerStates: [{
      playerId: "AWAY-1",
      clubId: "AWAY",
      condition: 80,
      injuryMatches: 0,
      suspensionMatches: 1,
      yellowCardAccumulator: 0,
      seasonStats: { seasonNumber: 1 },
      careerStats: {},
    }],
  };
  const fixture = {
    leagueFixtureId: "league:1:round:3:ai",
    leagueId: "league:1",
    round: 3,
    homeClubId: "HOME",
    awayClubId: "AWAY",
    homeTeam: "Casa",
    awayTeam: "Fora",
    homeStrength: 12,
    awayStrength: 11,
  };
  const result = simulateAiFixture(room, fixture, new Map([
    ["HOME", roster("HOME")],
    ["AWAY", []],
  ]), "2026-07-18T12:00:00.000Z");
  assert.equal(result.simulationVersion, undefined);
  assert.equal(room.playerStates.some((state) => state.seasonStats.appearances > 0), false);
  assert.equal(room.playerStates.find((state) => state.playerId === "AWAY-1").suspensionMatches, 0);
});
