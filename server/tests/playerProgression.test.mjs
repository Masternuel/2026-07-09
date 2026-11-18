import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMatchPlayerProgression,
  derivePlayerStatus,
  mergePlayerStates,
} from "../game/playerProgression.mjs";

function stats(seasonNumber = 1, overrides = {}) {
  return {
    seasonNumber,
    appearances: 0,
    starts: 0,
    minutes: 0,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    injuries: 0,
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    playerId: "p1",
    clubId: "A",
    condition: 90,
    injuryMatches: 0,
    suspensionMatches: 0,
    yellowCardAccumulator: 0,
    seasonStats: stats(),
    careerStats: stats().valueOf(),
    updatedAt: null,
    lastMatchId: null,
    ...overrides,
  };
}

test("mergePlayerStates aplica overlay do save sem alterar o catalogo", () => {
  const players = [
    { id: "p1", clubId: "A", name: "Um", condition: 100, status: "Disponível" },
    { id: "p2", clubId: "A", name: "Dois", condition: 85, status: "Cansado" },
  ];
  const room = {
    currentSeason: 2,
    playerStates: [state({
      condition: 64,
      suspensionMatches: 1,
      seasonStats: stats(2, { goals: 2 }),
      careerStats: { ...stats(), goals: 3 },
    })],
  };

  const merged = mergePlayerStates(players, room, "A");

  assert.equal(merged[0].condition, 64);
  assert.equal(merged[0].status, "Suspenso");
  assert.equal(merged[0].seasonStats.goals, 2);
  assert.equal(merged[0].careerStats.goals, 3);
  assert.equal(merged[1].status, "Cansado");
  assert.equal(merged[1].seasonStats.goals, 0);
  assert.equal(players[0].condition, 100);
  assert.equal("seasonStats" in players[0], false);
});

test("mergePlayerStates migra afastamentos numericos e status legado por uma partida", () => {
  const merged = mergePlayerStates([
    { id: "injured-count", clubId: "A", condition: 88, injuryMatches: 2, status: "Disponível" },
    { id: "legacy-injured", clubId: "A", condition: 72, status: "Lesionado" },
    { id: "legacy-suspended", clubId: "A", condition: 100, status: "Suspenso" },
  ], { currentSeason: 1, playerStates: [] }, "A");

  assert.equal(merged[0].injuryMatches, 2);
  assert.equal(merged[0].status, "Lesionado");
  assert.equal(merged[1].injuryMatches, 1);
  assert.equal(merged[1].status, "Lesionado");
  assert.equal(merged[2].suspensionMatches, 1);
  assert.equal(merged[2].status, "Suspenso");
});

test("baseline legado e persistido uma vez e o afastamento termina", () => {
  const room = { currentSeason: 1, playerStates: [] };
  const fixture = { fixtureId: "f1", homeClubId: "A", awayClubId: "B" };
  const baselines = [
    { playerId: "injured", clubId: "A", condition: 80, injuryMatches: 2, suspensionMatches: 0 },
    { playerId: "suspended", clubId: "A", condition: 100, injuryMatches: 0, suspensionMatches: 1 },
  ];

  applyMatchPlayerProgression(room, fixture, {
    id: "legacy-match-1",
    playerStateBaselines: baselines,
    playerStatistics: { home: [], away: [] },
  }, "2026-07-18T10:00:00.000Z");
  assert.equal(room.playerStates.find((candidate) => candidate.playerId === "injured").injuryMatches, 1);
  assert.equal(room.playerStates.find((candidate) => candidate.playerId === "suspended").suspensionMatches, 0);

  applyMatchPlayerProgression(room, { ...fixture, fixtureId: "f2" }, {
    id: "legacy-match-2",
    playerStateBaselines: baselines,
    playerStatistics: { home: [], away: [] },
  }, "2026-07-18T11:00:00.000Z");
  assert.equal(room.playerStates.find((candidate) => candidate.playerId === "injured").injuryMatches, 0);
  assert.equal(room.playerStates.find((candidate) => candidate.playerId === "suspended").suspensionMatches, 0);
  const served = mergePlayerStates([
    { id: "injured", clubId: "A", condition: 80, injuryMatches: 2, status: "Lesionado" },
    { id: "suspended", clubId: "A", condition: 100, status: "Suspenso" },
  ], room, "A");
  assert.equal(served[0].status, "Disponível");
  assert.equal(served[1].status, "Disponível");
});

test("progressao acumula gols, assistencias, cartoes, lesao e condicao", () => {
  const room = {
    currentSeason: 1,
    playerStates: [
      state({ yellowCardAccumulator: 2 }),
      state({
        playerId: "p2",
        condition: 80,
        injuryMatches: 2,
        suspensionMatches: 1,
      }),
    ],
  };
  const fixture = { fixtureId: "f1", homeClubId: "A", awayClubId: "B" };
  const result = {
    id: "m1",
    homeClubId: "A",
    awayClubId: "B",
    events: [{ type: "injury", playerId: "p1", teamId: "A", severity: "severe" }],
    playerStatistics: {
      home: [{
        playerId: "p1",
        clubId: "A",
        started: true,
        minutesPlayed: 90,
        goals: 1,
        assists: 1,
        yellowCards: 1,
        redCards: 0,
        injured: true,
      }],
      away: [{
        playerId: "p3",
        clubId: "B",
        started: true,
        minutesPlayed: 90,
        goals: 0,
        assists: 0,
        yellowCards: 0,
        redCards: 1,
        injured: false,
      }],
    },
    playerEffects: [{
        playerId: "p1",
        clubId: "A",
        side: "home",
        conditionBefore: 90,
        conditionAfter: 70,
        injuryMatches: 3,
        suspensionMatches: 1,
      }, {
        playerId: "p3",
        clubId: "B",
        side: "away",
        conditionBefore: 100,
        conditionAfter: 80,
        injuryMatches: 0,
        suspensionMatches: 1,
      }],
  };

  const progression = applyMatchPlayerProgression(room, fixture, result, "2026-07-18T12:00:00.000Z");
  const p1 = room.playerStates.find((candidate) => candidate.playerId === "p1");
  const p2 = room.playerStates.find((candidate) => candidate.playerId === "p2");
  const p3 = room.playerStates.find((candidate) => candidate.playerId === "p3");

  assert.deepEqual(
    {
      appearances: p1.seasonStats.appearances,
      starts: p1.seasonStats.starts,
      minutes: p1.seasonStats.minutes,
      goals: p1.seasonStats.goals,
      assists: p1.seasonStats.assists,
      yellowCards: p1.seasonStats.yellowCards,
      injuries: p1.seasonStats.injuries,
    },
    { appearances: 1, starts: 1, minutes: 90, goals: 1, assists: 1, yellowCards: 1, injuries: 1 },
  );
  assert.equal(p1.careerStats.goals, 1);
  assert.equal(p1.yellowCardAccumulator, 0);
  assert.equal(p1.suspensionMatches, 1);
  assert.equal(p1.injuryMatches, 4);
  assert.equal(p1.condition, 70);
  assert.equal(derivePlayerStatus(p1), "Lesionado");
  assert.equal(p2.injuryMatches, 1);
  assert.equal(p2.suspensionMatches, 0);
  assert.equal(p2.condition, 86);
  assert.equal(p3.suspensionMatches, 1);
  assert.equal(p3.seasonStats.redCards, 1);
  assert.equal(progression.playerEffects.length, 2);
});

test("progressao e idempotente por partida", () => {
  const room = { currentSeason: 1, playerStates: [] };
  const fixture = { fixtureId: "f1", homeClubId: "A", awayClubId: "B" };
  const result = {
    id: "same-match",
    playerStatistics: {
      home: [{ playerId: "p1", clubId: "A", started: true, minutesPlayed: 90, goals: 2 }],
      away: [],
    },
  };

  applyMatchPlayerProgression(room, fixture, result, "2026-07-18T12:00:00.000Z");
  const once = structuredClone(room.playerStates);
  const repeated = applyMatchPlayerProgression(room, fixture, result, "2026-07-18T12:05:00.000Z");

  assert.deepEqual(room.playerStates, once);
  assert.equal(repeated.playerEffects.length, 0);
});

test("partida cumprida reduz afastamentos e recupera quem nao entrou", () => {
  const room = {
    currentSeason: 2,
    playerStates: [state({
      condition: 75,
      injuryMatches: 3,
      suspensionMatches: 2,
      yellowCardAccumulator: 2,
      seasonStats: stats(1, { appearances: 9, goals: 4 }),
      careerStats: { ...stats(), appearances: 40, goals: 12 },
    })],
  };

  applyMatchPlayerProgression(
    room,
    { fixtureId: "f2", homeClubId: "A", awayClubId: "B" },
    { id: "m2", playerStatistics: { home: [], away: [] } },
    "2026-07-18T13:00:00.000Z",
  );

  const runtime = room.playerStates[0];
  assert.equal(runtime.condition, 81);
  assert.equal(runtime.injuryMatches, 2);
  assert.equal(runtime.suspensionMatches, 1);
  assert.equal(runtime.yellowCardAccumulator, 0);
  assert.equal(runtime.seasonStats.seasonNumber, 2);
  assert.equal(runtime.seasonStats.appearances, 0);
  assert.equal(runtime.careerStats.appearances, 40);
});

test("estatisticas ficam isoladas por competicao e cobertura ignora a partida atual", () => {
  const room = {
    currentSeason: 1,
    playerStates: [],
    leagueFixtureSchedule: [{
      leagueFixtureId: "l1-f1",
      leagueId: "L1",
      homeClubId: "A",
      awayClubId: "B",
    }],
    // Alguns fluxos podem registrar o placar compacto antes da progressao.
    leagueMatchResults: [{ leagueFixtureId: "l1-f1", score: [2, 0] }],
  };
  const leagueFixture = {
    fixtureId: "managed-l1-f1",
    leagueFixtureId: "l1-f1",
    leagueId: "L1",
    homeClubId: "A",
    awayClubId: "B",
  };
  const leagueResult = {
    id: "m-l1",
    playerStatistics: {
      home: [{
        playerId: "p1",
        clubId: "A",
        position: "ATA",
        started: true,
        minutesPlayed: 90,
        goals: 2,
        shots: 4,
        shotsOnTarget: 3,
      }],
      away: [{
        playerId: "p2",
        clubId: "B",
        position: "ATA",
        started: true,
        minutesPlayed: 90,
        shots: 1,
        shotsOnTarget: 0,
      }],
    },
  };

  applyMatchPlayerProgression(room, leagueFixture, leagueResult, "2026-07-18T14:00:00.000Z");
  applyMatchPlayerProgression(room, {
    fixtureId: "cup-f1",
    competitionFixtureId: "cup-f1",
    competitionId: "CUP",
    homeClubId: "A",
    awayClubId: "B",
  }, {
    id: "m-cup",
    playerStatistics: {
      home: [{
        playerId: "p1",
        clubId: "A",
        position: "ATA",
        started: true,
        minutesPlayed: 90,
        assists: 1,
        shots: 2,
        shotsOnTarget: 1,
      }],
      away: [{
        playerId: "p2",
        clubId: "B",
        position: "ATA",
        started: true,
        minutesPlayed: 90,
        shots: 2,
        shotsOnTarget: 1,
      }],
    },
  }, "2026-07-18T15:00:00.000Z");

  const player = room.playerStates.find((candidate) => candidate.playerId === "p1");
  const league = player.competitionStats.find((entry) => entry.competitionId === "L1");
  const cup = player.competitionStats.find((entry) => entry.competitionId === "CUP");
  assert.deepEqual({ goals: league.goals, assists: league.assists, shots: league.shots, ratedMatches: league.ratedMatches, ratingTotal: league.ratingTotal }, {
    goals: 2,
    assists: 0,
    shots: 4,
    ratedMatches: 1,
    ratingTotal: 8.64,
  });
  assert.deepEqual({ goals: cup.goals, assists: cup.assists, shots: cup.shots, ratedMatches: cup.ratedMatches, ratingTotal: cup.ratingTotal }, {
    goals: 0,
    assists: 1,
    shots: 2,
    ratedMatches: 1,
    ratingTotal: 6.88,
  });
  assert.equal(player.seasonStats.goals, 2);
  assert.equal(player.seasonStats.assists, 1);
  assert.equal(player.seasonStats.ratedMatches, 2);
  assert.equal(Number((player.seasonStats.ratingTotal / player.seasonStats.ratedMatches).toFixed(2)), 7.76);
  assert.deepEqual(room.playerCompetitionStatsCoverage.map((entry) => ({
    competitionId: entry.competitionId,
    complete: entry.complete,
    trackedMatches: entry.trackedMatches,
  })), [
    { competitionId: "L1", complete: true, trackedMatches: 1 },
    { competitionId: "CUP", complete: true, trackedMatches: 1 },
  ]);

  applyMatchPlayerProgression(room, leagueFixture, leagueResult, "2026-07-18T16:00:00.000Z");
  assert.equal(
    room.playerStates.find((candidate) => candidate.playerId === "p1")
      .competitionStats.find((entry) => entry.competitionId === "L1").goals,
    2,
  );
  assert.equal(room.playerCompetitionStatsCoverage[0].trackedMatches, 1);
});

test("cobertura nova permanece parcial quando save ja possui partida antiga", () => {
  const room = {
    currentSeason: 1,
    playerStates: [],
    leagueFixtureSchedule: [
      { leagueFixtureId: "old", leagueId: "L1" },
      { leagueFixtureId: "current", leagueId: "L1" },
    ],
    leagueMatchResults: [
      { leagueFixtureId: "old", score: [1, 0] },
      { leagueFixtureId: "current", score: [0, 0] },
    ],
  };

  applyMatchPlayerProgression(room, {
    fixtureId: "managed-current",
    leagueFixtureId: "current",
    leagueId: "L1",
    homeClubId: "A",
    awayClubId: "B",
  }, {
    id: "current-result",
    playerStatistics: {
      home: [{ playerId: "p1", clubId: "A", started: true, minutesPlayed: 90 }],
      away: [{ playerId: "p2", clubId: "B", started: true, minutesPlayed: 90 }],
    },
  }, "2026-07-18T17:00:00.000Z");

  assert.equal(room.playerCompetitionStatsCoverage[0].complete, false);
  assert.equal(room.playerCompetitionStatsCoverage[0].trackedMatches, 1);
});

test("cobertura reconhece partidas antigas na estrutura real de copas", () => {
  const room = {
    currentSeason: 1,
    playerStates: [],
    competitionSeason: {
      competitions: [{
        id: "CUP",
        fixtures: [
          { competitionFixtureId: "cup-old", status: "completed" },
          { competitionFixtureId: "cup-current", status: "completed" },
        ],
      }],
    },
  };

  applyMatchPlayerProgression(room, {
    fixtureId: "managed-cup-current",
    competitionFixtureId: "cup-current",
    competitionId: "CUP",
    homeClubId: "A",
    awayClubId: "B",
  }, {
    id: "cup-current-result",
    playerStatistics: {
      home: [{ playerId: "p1", clubId: "A", started: true, minutesPlayed: 90 }],
      away: [{ playerId: "p2", clubId: "B", started: true, minutesPlayed: 90 }],
    },
  }, "2026-07-18T18:00:00.000Z");

  assert.equal(room.playerCompetitionStatsCoverage[0].competitionId, "CUP");
  assert.equal(room.playerCompetitionStatsCoverage[0].complete, false);
});
