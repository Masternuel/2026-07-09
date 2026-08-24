import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { ensureCoachCareerState } from "../game/career.mjs";
import { createRoomsRouter } from "../routes/rooms.mjs";
import { buildRoomRankings } from "../services/rankings.mjs";
import { jsonRequest } from "./testHarness.mjs";

const clubs = Object.freeze({
  A: { id: "A", name: "Aurora", code: "AUR", color: "#c8ff3d", crestImageUrl: "https://img.test/a.png" },
  B: { id: "B", name: "Boreal", code: "BOR", color: "#1577aa", crestImageUrl: null },
  C: { id: "C", name: "Celta", code: "CEL", color: "#d12f42", crestImageUrl: null },
});

function rankingRoom() {
  return {
    code: "BOLA-R4NK",
    ownerId: "owner-1",
    catalogOwnerId: "database-owner",
    currentSeason: 1,
    seasonYear: 2026,
    managers: [
      { id: "owner-1", name: "Emanuel", clubId: "A" },
      // Saves can keep the public club code while fixtures use the catalog ID.
      { id: "member-1", name: "Joao", clubId: "BOR" },
      { id: "member-2", name: "Carol", clubId: null },
    ],
    competitionCatalog: [
      { id: "L1", name: "Liga Um", country: "Brasil", division: "Série A", active: true, clubs: [clubs.A, clubs.B] },
      { id: "L2", name: "Liga Dois", country: "Brasil", division: "Série B", active: true, clubs: [clubs.C] },
    ],
    leagueFixtureSchedule: [
      { leagueFixtureId: "f1", leagueId: "L1", round: 1, homeClubId: "A", awayClubId: "B" },
      { leagueFixtureId: "f2", leagueId: "L1", round: 2, homeClubId: "B", awayClubId: "A" },
    ],
    leagueMatchResults: [
      { leagueFixtureId: "f1", score: [2, 0], possession: [60, 40], completedAt: "2026-07-12T20:00:00.000Z" },
      { leagueFixtureId: "f2", score: [1, 1], possession: [55, 45], completedAt: "2026-07-19T20:00:00.000Z" },
    ],
    lineups: [{ managerId: "owner-1", clubId: "A", tactics: { formationId: "4-3-3" } }],
    playerStates: [
      {
        playerId: "A-9",
        clubId: "A",
        condition: 93,
        seasonStats: {
          seasonNumber: 1, goals: 2, assists: 0, appearances: 2, starts: 2, minutes: 180,
          yellowCards: 1, redCards: 0, injuries: 0,
        },
      },
      {
        playerId: "B-10",
        clubId: "B",
        seasonStats: { seasonNumber: 1, goals: 3, assists: 1, appearances: 2 },
      },
    ],
    seasonHistory: [{
      seasonNumber: 0,
      seasonYear: 2025,
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-12-01T00:00:00.000Z",
      completedFixtureIds: ["old-f1", "old-f2"],
      matchIds: ["old-match"],
      tournamentWinners: [{ tournamentId: "CUP", clubId: "A", privateNote: "não vazar" }],
      promotionMovements: [{ clubId: "B", type: "promotion", fromDivisionId: "L2", toDivisionId: "L1", position: 1 }],
      privateAudit: "não pode vazar",
    }],
    marketState: { privateAudit: "nao pode vazar" },
  };
}

function scopedCatalog() {
  const playersByClub = {
    A: [
      {
        id: "A-9",
        clubId: "A",
        name: "Alice",
        position: "ATA",
        shirtNumber: 9,
        age: 24,
        nationality: "BRA",
        overall: 18,
        potential: 19,
        marketValue: 25_000_000,
        wage: 100_000,
        morale: "Boa",
        isStar: true,
        negotiability: "open_to_offers",
        loanAvailable: true,
        attributes: { chute: 18, velocidade: 22, defesa: "17", invalido: "texto" },
        contract: {
          startSeason: 1,
          endSeason: 4,
          wage: 100_000,
          status: "active",
          privateClause: "nao pode vazar",
        },
      },
      { id: "A-5", clubId: "A", name: "Ana", position: "ZAG", shirtNumber: 5, age: 27, nationality: "BRA", overall: 16, potential: 17, marketValue: 10_000_000, wage: 50_000 },
    ],
    B: [
      { id: "B-10", clubId: "B", name: "Bruna", position: "MEI", shirtNumber: 10, age: 23, nationality: "ARG", overall: 17, potential: 18, marketValue: 20_000_000, wage: 80_000 },
    ],
    C: [
      { id: "C-7", clubId: "C", name: "Celia", position: "PE", shirtNumber: 7, overall: 20, marketValue: 200_000_000 },
    ],
  };
  return {
    async listPlayers(clubId) {
      const players = structuredClone(playersByClub[clubId] ?? []);
      return { players, count: players.length, source: "test" };
    },
  };
}

test("rankings usam estatisticas, valores de mercado e campanhas reais da liga", async () => {
  const rankings = await buildRoomRankings({
    room: rankingRoom(),
    catalogStore: scopedCatalog(),
    clubId: "A",
    viewerId: "owner-1",
  });

  assert.deepEqual(rankings.scope, {
    type: "league",
    competitionId: "L1",
    leagueId: "L1",
    leagueName: "Liga Um",
    leagueIds: ["L1"],
    options: [
      { id: "L1", name: "Liga Um", country: "Brasil", division: "Série A", count: 2 },
      { id: "L2", name: "Liga Dois", country: "Brasil", division: "Série B", count: 1 },
    ],
  });
  assert.match(rankings.meta.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual({ ...rankings.meta, generatedAt: "dynamic", updatedAt: "dynamic" }, {
    generatedAt: "dynamic",
    updatedAt: "dynamic",
    updatedRound: 2,
    completedRounds: 2,
    totalRounds: 2,
    currentRound: 2,
    currentSeason: 1,
    seasonYear: 2026,
    status: "completed",
    seasonState: "completed",
    source: "room-save",
    stale: false,
    playerStatsScope: "season-legacy",
    playerStatsComplete: true,
    playerStatsTrackedMatches: 0,
    playerStatsUntrackedMatches: 0,
    playerMetricCoverage: {
      shots: false,
      shotsOnTarget: false,
      saves: false,
      goalsConceded: false,
      cleanSheets: false,
    },
  });
  assert.deepEqual(rankings.players.map(({ id, goals, assists, appearances, overall }) => ({
    id, goals, assists, appearances, overall,
  })), [
    { id: "B-10", goals: 3, assists: 1, appearances: 2, overall: 17 },
    { id: "A-9", goals: 2, assists: 0, appearances: 2, overall: 18 },
    { id: "A-5", goals: 0, assists: 0, appearances: 0, overall: 16 },
  ]);
  assert.deepEqual(rankings.clubs.map(({ id, squadValue, playerCount }) => ({
    id, squadValue, playerCount,
  })), [
    { id: "A", squadValue: 35_000_000, playerCount: 2 },
    { id: "B", squadValue: 20_000_000, playerCount: 1 },
  ]);
  assert.deepEqual(rankings.clubs.map(({ id, averageValue, payroll, played, wins, draws, losses, goalsFor, goalsAgainst, points, recentForm, campaignPosition }) => ({
    id, averageValue, payroll, played, wins, draws, losses, goalsFor, goalsAgainst, points, recentForm, campaignPosition,
  })), [
    { id: "A", averageValue: 17_500_000, payroll: 150_000, played: 2, wins: 1, draws: 1, losses: 0, goalsFor: 3, goalsAgainst: 1, points: 4, recentForm: ["V", "E"], campaignPosition: 1 },
    { id: "B", averageValue: 20_000_000, payroll: 80_000, played: 2, wins: 0, draws: 1, losses: 1, goalsFor: 1, goalsAgainst: 3, points: 1, recentForm: ["D", "E"], campaignPosition: 2 },
  ]);
  assert.equal(rankings.clubs.some((club) => club.id === "C"), false, "outra liga nao entra no escopo");
  assert.deepEqual(rankings.managers.map((manager) => ({
    id: manager.id,
    clubId: manager.clubId,
    played: manager.played,
    wins: manager.wins,
    draws: manager.draws,
    losses: manager.losses,
    goalDifference: manager.goalDifference,
    points: manager.points,
    performancePercent: manager.performancePercent,
    isOwner: manager.isOwner,
    isViewer: manager.isViewer,
    preferredFormation: manager.preferredFormation,
  })), [
    { id: "owner-1", clubId: "A", played: 2, wins: 1, draws: 1, losses: 0, goalDifference: 2, points: 4, performancePercent: 67, isOwner: true, isViewer: true, preferredFormation: "4-3-3" },
    { id: "member-1", clubId: "B", played: 2, wins: 0, draws: 1, losses: 1, goalDifference: -2, points: 1, performancePercent: 17, isOwner: false, isViewer: false, preferredFormation: null },
  ]);
  assert.deepEqual({
    age: rankings.players[1].age,
    nationality: rankings.players[1].nationality,
    marketValue: rankings.players[1].marketValue,
    wage: rankings.players[1].wage,
    condition: rankings.players[1].condition,
    starts: rankings.players[1].starts,
    minutes: rankings.players[1].minutes,
    yellowCards: rankings.players[1].yellowCards,
    averageRating: rankings.players[1].averageRating,
    nonPenaltyGoals: rankings.players[1].nonPenaltyGoals,
    shots: rankings.players[1].shots,
    shotsOnTarget: rankings.players[1].shotsOnTarget,
    rank: rankings.players[1].rank,
    previousRank: rankings.players[1].previousRank,
  }, {
    age: 24,
    nationality: "BRA",
    marketValue: 25_000_000,
    wage: 100_000,
    condition: 93,
    starts: 2,
    minutes: 180,
    yellowCards: 1,
    averageRating: null,
    nonPenaltyGoals: null,
    shots: null,
    shotsOnTarget: null,
    rank: 2,
    previousRank: null,
  });
  const alice = rankings.players.find((player) => player.id === "A-9");
  assert.ok(typeof alice.status === "string" && alice.status.length > 0, "status publico vem do estado real do save");
  assert.deepEqual({
    negotiability: alice.negotiability,
    loanAvailable: alice.loanAvailable,
    attributes: alice.attributes,
    contract: alice.contract,
  }, {
    negotiability: "open_to_offers",
    loanAvailable: true,
    attributes: { chute: 18, velocidade: 20, defesa: 17 },
    contract: { startSeason: 1, endSeason: 4, wage: 100_000, status: "active" },
  });
  assert.equal(JSON.stringify(alice).includes("privateClause"), false, "contrato publico nao expoe campos privados");
  assert.deepEqual({
    leagueId: rankings.clubs[0].leagueId,
    leagueName: rankings.clubs[0].leagueName,
    position: rankings.clubs[0].position,
    campaignPosition: rankings.clubs[0].campaignPosition,
    averageValue: rankings.clubs[0].averageValue,
    averagePlayerValue: rankings.clubs[0].averagePlayerValue,
    averagePossession: rankings.clubs[0].averagePossession,
    possessionPercent: rankings.clubs[0].possessionPercent,
  }, {
    leagueId: "L1",
    leagueName: "Liga Um",
    position: 1,
    campaignPosition: 1,
    averageValue: 17_500_000,
    averagePlayerValue: 17_500_000,
    averagePossession: 52.5,
    possessionPercent: 52.5,
  });
  assert.deepEqual(rankings.history, [{
    seasonNumber: null,
    seasonYear: 2025,
    startedAt: "2025-01-01T00:00:00.000Z",
    completedAt: "2025-12-01T00:00:00.000Z",
    completedFixtureCount: 2,
    matchCount: 1,
    tournamentWinners: [{ tournamentId: "CUP", clubId: "A" }],
    promotionMovements: [{ clubId: "B", type: "promotion", fromDivisionId: "L2", toDivisionId: "L1", position: 1 }],
  }]);
  assert.equal("playerStates" in rankings, false);
  assert.equal("marketState" in rankings, false);
  assert.equal(JSON.stringify(rankings).includes("privateAudit"), false);
});

test("historico de confrontos entre treinadores sobrevive a troca de temporada", async () => {
  const room = rankingRoom();
  room.currentSeason = 2;
  room.seasonYear = 2027;
  room.completedMatches = [{
    id: "season-1-human-match",
    fixtureId: "season-1-human-match",
    homeClubId: "A",
    awayClubId: "B",
    homeManagerId: "owner-1",
    awayManagerId: "member-1",
    managerIds: ["owner-1", "member-1"],
    homeFormation: "4-2-3-1",
    awayFormation: "3-5-2",
    score: [2, 1],
    completedAt: "2026-09-01T20:00:00.000Z",
    seasonNumber: 1,
    seasonYear: 2026,
  }];

  const rankings = await buildRoomRankings({
    room,
    catalogStore: scopedCatalog(),
    competitionId: "L1",
    viewerId: "owner-1",
  });
  const owner = rankings.managers.find((manager) => manager.id === "owner-1");
  const archived = owner?.matchHistory.find((match) => match.fixtureId === "season-1-human-match");

  assert.deepEqual(archived && {
    seasonNumber: archived.seasonNumber,
    opponentManagerId: archived.opponentManagerId,
    opponentId: archived.opponentId,
    result: archived.result,
  }, {
    seasonNumber: 1,
    opponentManagerId: "member-1",
    opponentId: "B",
    result: "V",
  });
  assert.equal(owner?.preferredFormation, "4-2-3-1", "formacao mais usada vem das partidas preservadas");
});

test("historico legado preserva contadores numericos sem listas de ids", async () => {
  const room = rankingRoom();
  room.seasonHistory = [{
    seasonNumber: 1,
    seasonYear: 2025,
    completedFixtureCount: 38,
    matchCount: "40",
  }];

  const rankings = await buildRoomRankings({
    room,
    catalogStore: scopedCatalog(),
    competitionId: "L1",
  });

  assert.deepEqual(rankings.history, [{
    seasonNumber: 1,
    seasonYear: 2025,
    startedAt: null,
    completedAt: null,
    completedFixtureCount: 38,
    matchCount: 40,
    tournamentWinners: [],
    promotionMovements: [],
  }]);
});

test("timeline arquivada preserva divisao antiga fora do escopo atual", async () => {
  const room = rankingRoom();
  room.seasonHistory = [{
    seasonNumber: 1,
    seasonYear: 2025,
    rankingTimeline: [{
      format: "ranking-timeline-v1",
      seasonNumber: 1,
      seasonYear: 2025,
      competitionId: "OLD-L2",
      competitionName: "Liga Antiga",
      clubs: [["A", "AUR", "Aurora"]],
      managers: [["owner-1", "A", "Emanuel"]],
      rounds: [
        { round: 1, clubRows: [[0, 2, 0, 0, 0, 0, 0, 0, 0]], managerRows: [[0, 1, 0, 0, 0, 0, 0, 0, 0]] },
        { round: 2, clubRows: [[0, 1, 3, 1, 1, 0, 0, 2, 0]], managerRows: [[0, 1, 3, 1, 1, 0, 0, 2, 0]] },
      ],
    }],
  }];

  const rankings = await buildRoomRankings({
    room,
    catalogStore: scopedCatalog(),
    competitionId: "L1",
  });
  const archived = rankings.timeline.filter((entry) => entry.competitionId === "OLD-L2");

  assert.deepEqual(archived.map(({ type, round, entityId, position, previousPosition, positionChange }) => ({
    type, round, entityId, position, previousPosition, positionChange,
  })), [
    { type: "club", round: 1, entityId: "A", position: 2, previousPosition: null, positionChange: null },
    { type: "manager", round: 1, entityId: "owner-1", position: 1, previousPosition: null, positionChange: null },
    { type: "club", round: 2, entityId: "A", position: 1, previousPosition: 2, positionChange: 1 },
    { type: "manager", round: 2, entityId: "owner-1", position: 1, previousPosition: 1, positionChange: 0 },
  ]);
});

test("treinador historico permanece no filtro da divisao apos clube mudar de divisao", async () => {
  const room = rankingRoom();
  room.currentSeason = 2;
  room.seasonYear = 2027;
  room.managers = [{ id: "owner-1", name: "Emanuel", clubId: "A" }];
  room.competitionCatalog = [
    { id: "L1", name: "Liga Um", country: "Brasil", division: "Serie A", active: true, clubs: [clubs.B] },
    { id: "L2", name: "Liga Dois", country: "Brasil", division: "Serie B", active: true, clubs: [clubs.A] },
  ];
  room.leagueFixtureSchedule = [];
  room.leagueMatchResults = [];
  room.coachCareerState = {
    version: 1,
    coaches: [
      {
        id: "owner-1",
        name: "Emanuel",
        managerType: "human",
        currentClubId: "A",
        status: "employed",
        assignments: [{
          clubId: "A",
          startedSeason: 1,
          startedRound: 1,
          endedSeason: null,
          endedRound: null,
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: null,
        }],
      },
      {
        id: "historico-sem-l1",
        name: "Sem passagem na Liga Um",
        managerType: "ai",
        currentClubId: null,
        status: "unemployed",
        assignments: [],
      },
    ],
  };
  room.seasonHistory = [{
    seasonNumber: 1,
    seasonYear: 2026,
    rankingTimeline: [{
      format: "ranking-timeline-v1",
      seasonNumber: 1,
      seasonYear: 2026,
      competitionId: "L1",
      competitionName: "Liga Um",
      clubs: [["A", "AUR", "Aurora"], ["B", "BOR", "Boreal"]],
      managers: [["owner-1", "A", "Emanuel"], ["ai-coach:B", "B", "Treinador de Boreal"]],
      rounds: [
        { round: 1, clubRows: [[0, 1, 3, 1, 1, 0, 0, 2, 0], [1, 2, 0, 1, 0, 0, 1, 0, 2]], managerRows: [[0, 1, 3, 1, 1, 0, 0, 2, 0], [1, 2, 0, 1, 0, 0, 1, 0, 2]] },
        { round: 2, clubRows: [[0, 1, 4, 2, 1, 1, 0, 3, 1], [1, 2, 1, 2, 0, 1, 1, 1, 3]], managerRows: [[0, 1, 4, 2, 1, 1, 0, 3, 1], [1, 2, 1, 2, 0, 1, 1, 1, 3]] },
      ],
    }],
  }];

  const oldDivision = await buildRoomRankings({
    room,
    catalogStore: scopedCatalog(),
    competitionId: "L1",
  });
  const newDivision = await buildRoomRankings({
    room,
    catalogStore: scopedCatalog(),
    competitionId: "L2",
  });

  assert.equal(oldDivision.managers.filter((manager) => manager.id === "owner-1").length, 1);
  assert.equal(newDivision.managers.filter((manager) => manager.id === "owner-1").length, 1);
  assert.equal(oldDivision.managers.some((manager) => manager.id === "historico-sem-l1"), false);
  assert.deepEqual(
    oldDivision.managers.find((manager) => manager.id === "owner-1")?.seasonStats.map((entry) => ({
      seasonNumber: entry.seasonNumber,
      competitionId: entry.competitionId,
      clubId: entry.clubId,
      points: entry.points,
    })),
    [{ seasonNumber: 1, competitionId: "L1", clubId: "A", points: 4 }],
  );
});

test("variacao usa ultimo snapshot concluido mesmo com rodada atual parcial", async () => {
  const leagueClubs = [
    clubs.A,
    clubs.B,
    clubs.C,
    { id: "D", name: "Delta", code: "DEL", color: "#444444", crestImageUrl: null },
  ];
  const room = {
    code: "PARTIAL",
    ownerId: "manager-a",
    currentSeason: 1,
    seasonYear: 2026,
    managers: [
      { id: "manager-a", name: "Manager A", clubId: "A" },
      { id: "manager-b", name: "Manager B", clubId: "B" },
    ],
    competitionCatalog: [{
      id: "L1",
      name: "Liga Um",
      country: "Brasil",
      division: "Serie A",
      active: true,
      clubs: leagueClubs,
    }],
    leagueFixtureSchedule: [
      { leagueFixtureId: "r1-a-b", leagueId: "L1", round: 1, homeClubId: "A", awayClubId: "B" },
      { leagueFixtureId: "r1-c-d", leagueId: "L1", round: 1, homeClubId: "C", awayClubId: "D" },
      { leagueFixtureId: "r2-a-c", leagueId: "L1", round: 2, homeClubId: "A", awayClubId: "C" },
      { leagueFixtureId: "r2-b-d", leagueId: "L1", round: 2, homeClubId: "B", awayClubId: "D" },
      { leagueFixtureId: "r3-a-d", leagueId: "L1", round: 3, homeClubId: "A", awayClubId: "D" },
      { leagueFixtureId: "r3-b-c", leagueId: "L1", round: 3, homeClubId: "B", awayClubId: "C" },
    ],
    leagueMatchResults: [
      { leagueFixtureId: "r1-a-b", score: [1, 0] },
      { leagueFixtureId: "r1-c-d", score: [1, 0] },
      { leagueFixtureId: "r2-a-c", score: [0, 2] },
      { leagueFixtureId: "r2-b-d", score: [3, 0] },
      { leagueFixtureId: "r3-a-d", score: [10, 0] },
    ],
    playerStates: [],
    seasonHistory: [],
  };
  const catalogStore = {
    async listPlayers(clubId) {
      return {
        players: [{ id: `${clubId}-1`, clubId, name: `Jogador ${clubId}`, position: "MC", overall: 10 }],
        count: 1,
        source: "test",
      };
    },
  };

  const rankings = await buildRoomRankings({ room, catalogStore, competitionId: "L1" });
  const club = rankings.clubs.find((entry) => entry.id === "A");
  const manager = rankings.managers.find((entry) => entry.id === "manager-a");

  assert.deepEqual({
    position: club.position,
    previousPosition: club.previousPosition,
    positionChange: club.positionChange,
  }, {
    position: 1,
    previousPosition: 1,
    positionChange: -2,
  });
  assert.deepEqual({
    position: manager.position,
    previousPosition: manager.previousPosition,
    positionChange: manager.positionChange,
  }, {
    position: 3,
    previousPosition: 2,
    positionChange: -1,
  });
});

test("clube inexistente nao mistura rankings de ligas diferentes", async () => {
  const rankings = await buildRoomRankings({
    room: rankingRoom(),
    catalogStore: scopedCatalog(),
    clubId: "CLUBE-INEXISTENTE",
    viewerId: "owner-1",
  });

  assert.deepEqual(rankings.players, []);
  assert.deepEqual(rankings.clubs, []);
  assert.deepEqual(rankings.managers, []);
});

test("transferencia na temporada preserva numeros e oculta percentual sem base por clube", async () => {
  const room = rankingRoom();
  room.seasonStartedAt = "2026-01-01T00:00:00.000Z";
  room.marketState = {
    transactions: [{
      id: "transfer-a9",
      player: { id: "A-9", name: "Alice" },
      fromClubId: "B",
      toClubId: "A",
      completedAt: "2026-06-01T00:00:00.000Z",
    }],
  };
  const rankings = await buildRoomRankings({
    room,
    catalogStore: scopedCatalog(),
    clubId: "A",
    viewerId: "owner-1",
  });
  const alice = rankings.players.find((player) => player.id === "A-9");

  assert.equal(alice.goals, 2, "estatisticas acumuladas continuam preservadas");
  assert.equal(alice.clubGoalParticipationPercent, null, "percentual nao atribui gols antigos ao clube novo");
});

test("competitionId tem precedencia e rankings completos nao sao cortados em cinco", async () => {
  const room = rankingRoom();
  const extraClubs = Array.from({ length: 6 }, (_, index) => ({
    id: `X${index + 1}`,
    name: `Clube ${index + 1}`,
    code: `X${index + 1}`,
    color: "#333333",
    reputation: 10 + index,
  }));
  room.competitionCatalog.push({
    id: "L3", name: "Liga Completa", country: "Argentina", division: "Primera", active: true, clubs: extraClubs,
  });
  const catalog = {
    async listPlayers(clubId) {
      const players = [{
        id: `${clubId}-P`, clubId, name: `Jogador ${clubId}`, position: "ATA", overall: 10, marketValue: 1_000_000,
      }];
      return { players, count: players.length, source: "test" };
    },
  };

  const rankings = await buildRoomRankings({
    room,
    catalogStore: catalog,
    clubId: "A",
    competitionId: "L3",
    viewerId: "member-1",
  });
  assert.equal(rankings.scope.leagueId, "L3");
  assert.equal(rankings.clubs.length, 6);
  assert.equal(rankings.players.length, 6);
  assert.equal(rankings.meta.status, "not_started");
  assert.equal(rankings.managers.find((manager) => manager.id === "member-1"), undefined, "manager de outra liga nao entra no escopo");
});

test("ranking de liga nao mistura estatisticas da copa", async () => {
  const room = rankingRoom();
  room.playerStates[0].competitionStats = [{
    competitionId: "L1",
    seasonNumber: 1,
    appearances: 2,
    starts: 2,
    minutes: 180,
    goals: 1,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    injuries: 0,
    ratedMatches: 2,
    ratingTotal: 15.2,
    shots: 4,
    shotsOnTarget: 2,
    saves: null,
    goalsConceded: null,
    cleanSheets: null,
  }, {
    competitionId: "CUP",
    seasonNumber: 1,
    appearances: 3,
    starts: 3,
    minutes: 270,
    goals: 7,
    assists: 2,
    yellowCards: 0,
    redCards: 0,
    injuries: 0,
    ratedMatches: 3,
    ratingTotal: 27,
    shots: 20,
    shotsOnTarget: 12,
    saves: null,
    goalsConceded: null,
    cleanSheets: null,
  }];
  room.playerCompetitionStatsCoverage = [{
    competitionId: "L1",
    seasonNumber: 1,
    complete: true,
    trackedMatches: 2,
    untrackedMatches: 0,
    metrics: {
      shots: true,
      shotsOnTarget: true,
      saves: false,
      goalsConceded: false,
      cleanSheets: false,
    },
  }];

  const rankings = await buildRoomRankings({
    room,
    catalogStore: scopedCatalog(),
    clubId: "A",
    competitionId: "L1",
    viewerId: "owner-1",
  });
  const player = rankings.players.find((candidate) => candidate.id === "A-9");

  assert.deepEqual({
    goals: player.goals,
    assists: player.assists,
    appearances: player.appearances,
    shots: player.shots,
    shotsOnTarget: player.shotsOnTarget,
    averageRating: player.averageRating,
    statisticsScope: player.statisticsScope,
    statisticsComplete: player.statisticsComplete,
  }, {
    goals: 1,
    assists: 0,
    appearances: 2,
    shots: 4,
    shotsOnTarget: 2,
    averageRating: 7.6,
    statisticsScope: "competition",
    statisticsComplete: true,
  });
  assert.equal(rankings.meta.playerStatsScope, "competition");
  assert.equal(rankings.meta.playerStatsTrackedMatches, 2);
});

test("titulo de copa atual fica no historico sem inflar ranking da liga", async () => {
  const room = rankingRoom();
  room.leagueMatchResults = room.leagueMatchResults.slice(0, 1);
  room.tournamentCatalog = [{
    id: "CUP",
    name: "Copa Nacional",
    format: "knockout",
    teamCount: 2,
    teamIds: ["A", "C"],
    active: true,
    participants: [clubs.A, clubs.C],
  }];
  const final = {
    id: "cup-final-s1",
    competitionFixtureId: "cup-final-s1",
    tournamentId: "CUP",
    competitionId: "CUP",
    calendarRound: 1,
    round: 1,
    homeClubId: "A",
    awayClubId: "C",
    status: "completed",
    result: { score: [2, 0] },
    completedAt: "2026-08-01T20:00:00.000Z",
  };
  room.competitionSeason = {
    seasonNumber: 1,
    seasonYear: 2026,
    winners: [{ tournamentId: "CUP", clubId: "A" }],
    fixtures: [final],
    competitions: [{
      id: "CUP",
      name: "Copa Nacional",
      format: "knockout",
      status: "completed",
      winnerClubId: "A",
      participants: [clubs.A, clubs.C],
      fixtures: [final],
    }],
  };
  ensureCoachCareerState(room, new Date("2026-08-01T21:00:00.000Z"));

  const rankings = await buildRoomRankings({
    room,
    catalogStore: scopedCatalog(),
    competitionId: "L1",
    viewerId: "owner-1",
  });
  const manager = rankings.managers.find((candidate) => candidate.id === "owner-1");

  assert.equal(manager?.titles, 0, "titulo da copa nao entra na coluna da liga");
  assert.equal(manager?.rankingBreakdown?.titles, 0, "titulo da copa nao pontua no ranking da liga");
  assert.deepEqual(
    manager?.trophyHistory.map((trophy) => trophy.competitionId),
    ["CUP"],
    "perfil ainda preserva o trofeu no historico completo",
  );
});

test("ranking seleciona torneio persistido sem misturar liga", async () => {
  const room = rankingRoom();
  room.tournamentCatalog = [{
    id: "CUP",
    name: "Copa Nacional",
    format: "knockout",
    teamCount: 2,
    teamIds: ["A", "C"],
    active: true,
    participants: [clubs.A, clubs.C],
  }];
  room.competitionSeason = {
    seasonNumber: 1,
    seasonYear: 2026,
    winners: [{ tournamentId: "CUP", clubId: "C" }],
    competitions: [{
      id: "CUP",
      name: "Copa Nacional",
      format: "knockout",
      status: "completed",
      winnerClubId: "C",
      participants: [{ id: "A", name: "Aurora" }, { id: "C", name: "Celta" }],
      fixtures: [{
        id: "cup-final",
        competitionFixtureId: "cup-final",
        competitionId: "CUP",
        stageId: "knockout",
        stageType: "knockout",
        calendarRound: 1,
        round: 1,
        homeClubId: "A",
        awayClubId: "C",
        status: "completed",
        result: { score: [1, 2], possession: [42, 58] },
        completedAt: "2026-08-01T20:00:00.000Z",
      }],
    }],
  };
  room.playerStates[0].competitionStats = [{
    competitionId: "CUP",
    seasonNumber: 1,
    appearances: 1,
    starts: 1,
    minutes: 90,
    goals: 1,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    injuries: 0,
    ratedMatches: 1,
    ratingTotal: 7.2,
  }];
  room.playerStates.push({
    playerId: "C-7",
    clubId: "C",
    competitionStats: [{
      competitionId: "CUP",
      seasonNumber: 1,
      appearances: 1,
      starts: 1,
      minutes: 90,
      goals: 2,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      injuries: 0,
      ratedMatches: 1,
      ratingTotal: 8.4,
    }],
  });
  room.playerCompetitionStatsCoverage = [{
    competitionId: "CUP",
    seasonNumber: 1,
    complete: true,
    trackedMatches: 1,
    untrackedMatches: 0,
    metrics: {},
  }];
  ensureCoachCareerState(room, new Date("2026-08-01T21:00:00.000Z"));

  const rankings = await buildRoomRankings({
    room,
    catalogStore: scopedCatalog(),
    competitionId: "CUP",
    viewerId: "owner-1",
  });

  assert.deepEqual(rankings.scope, {
    type: "tournament",
    competitionId: "CUP",
    leagueId: null,
    leagueName: "Copa Nacional",
    leagueIds: [],
    options: [
      { id: "L1", name: "Liga Um", country: "Brasil", division: "Série A", count: 2 },
      { id: "L2", name: "Liga Dois", country: "Brasil", division: "Série B", count: 1 },
      {
        id: "CUP", name: "Copa Nacional", country: null, division: null, count: 2,
        type: "tournament", format: "knockout",
      },
    ],
    competitionName: "Copa Nacional",
    competitionFormat: "knockout",
  });
  assert.deepEqual(rankings.clubs.map(({ id, played, wins, losses, goalsFor, points, campaignPosition }) => ({
    id, played, wins, losses, goalsFor, points, campaignPosition,
  })), [
    { id: "C", played: 1, wins: 1, losses: 0, goalsFor: 2, points: 3, campaignPosition: 1 },
    { id: "A", played: 1, wins: 0, losses: 1, goalsFor: 1, points: 0, campaignPosition: 2 },
  ]);
  assert.deepEqual(rankings.clubs.map(({ id, possessionPercent }) => ({ id, possessionPercent })), [
    { id: "C", possessionPercent: 58 },
    { id: "A", possessionPercent: 42 },
  ]);
  assert.deepEqual(rankings.players.map(({ id, goals, appearances, averageRating }) => ({
    id, goals, appearances, averageRating,
  })), [
    { id: "C-7", goals: 2, appearances: 1, averageRating: 8.4 },
    { id: "A-9", goals: 1, appearances: 1, averageRating: 7.2 },
    { id: "A-5", goals: 0, appearances: 0, averageRating: null },
  ]);
  assert.equal(rankings.players.some((player) => player.id === "B-10"), false);
  assert.deepEqual(rankings.managers.map((manager) => manager.id), ["ai-coach:C", "owner-1"]);
  assert.deepEqual(rankings.managers.map(({ id, played, wins, draws, losses, points }) => ({
    id, played, wins, draws, losses, points,
  })), [
    { id: "ai-coach:C", played: 1, wins: 1, draws: 0, losses: 0, points: 3 },
    { id: "owner-1", played: 1, wins: 0, draws: 0, losses: 1, points: 0 },
  ], "torneio usa os resultados reais mesmo sem timeline de liga");
  assert.equal(rankings.managers[0].titles, 1);
  assert.deepEqual(rankings.managers[0].seasonStats.map((entry) => ({
    competitionId: entry.competitionId,
    clubId: entry.clubId,
    played: entry.played,
    wins: entry.wins,
    titles: entry.titles,
  })), [{
    competitionId: "CUP",
    clubId: "C",
    played: 1,
    wins: 1,
    titles: 1,
  }], "campanha da copa integra o historico por temporada do treinador");
  assert.deepEqual(rankings.managers[0].trophyHistory.map(({ competitionId, type, clubId }) => ({
    competitionId, type, clubId,
  })), [{ competitionId: "CUP", type: "tournament", clubId: "C" }]);
  assert.equal(rankings.managers[1].titles, 0);
  assert.equal(rankings.meta.status, "completed");
  assert.equal(rankings.meta.updatedRound, 1);
  assert.equal(rankings.meta.totalRounds, 1);
  assert.equal(rankings.meta.playerStatsScope, "competition");
  assert.equal(rankings.meta.playerStatsTrackedMatches, 1);
  assert.deepEqual(rankings.timeline, [], "timeline de liga nao inventa historico para copa");
});

test("titulo de copa pertence ao treinador da final e nao ao sucessor", async () => {
  const room = rankingRoom();
  room.tournamentCatalog = [{
    id: "CUP",
    name: "Copa Nacional",
    format: "knockout",
    teamCount: 2,
    teamIds: ["A", "C"],
    active: true,
    participants: [clubs.A, clubs.C],
  }];
  room.competitionSeason = {
    seasonNumber: 1,
    seasonYear: 2026,
    winners: [{ tournamentId: "CUP", clubId: "C" }],
    competitions: [{
      id: "CUP",
      name: "Copa Nacional",
      format: "knockout",
      status: "completed",
      winnerClubId: "C",
      participants: [{ id: "A", name: "Aurora" }, { id: "C", name: "Celta" }],
      fixtures: [{
        id: "cup-final",
        competitionFixtureId: "cup-final",
        competitionId: "CUP",
        calendarRound: 1,
        round: 1,
        homeClubId: "A",
        awayClubId: "C",
        status: "completed",
        result: { score: [0, 1] },
        completedAt: "2026-08-01T20:00:00.000Z",
      }],
    }],
  };
  room.coachCareerState = {
    version: 1,
    coaches: [{
      id: "coach-final",
      name: "Treinador da final",
      managerType: "ai",
      currentClubId: null,
      status: "unemployed",
      assignments: [{
        clubId: "C",
        startedSeason: 1,
        startedRound: 1,
        startedAt: "2026-07-01T00:00:00.000Z",
        endedSeason: 1,
        endedRound: 1,
        endedAt: "2026-08-01T22:00:00.000Z",
      }],
    }, {
      id: "coach-successor",
      name: "Treinador sucessor",
      managerType: "ai",
      currentClubId: "C",
      status: "employed",
      assignments: [{
        clubId: "C",
        startedSeason: 1,
        startedRound: 2,
        startedAt: "2026-08-02T00:00:00.000Z",
        endedSeason: null,
        endedRound: null,
        endedAt: null,
      }],
    }],
  };

  const rankings = await buildRoomRankings({
    room,
    catalogStore: scopedCatalog(),
    competitionId: "CUP",
    viewerId: "owner-1",
  });
  const winner = rankings.managers.find((manager) => manager.id === "coach-final");
  const successor = rankings.managers.find((manager) => manager.id === "coach-successor");

  assert.equal(winner?.titles, 1);
  assert.equal(winner?.played, 1);
  assert.equal(successor?.titles, 0);
  assert.equal(successor?.played, 0);
});

test("trofeu antigo permanece no historico sem inflar ranking da temporada atual", async () => {
  const room = rankingRoom();
  room.currentSeason = 2;
  room.seasonYear = 2027;
  room.leagueMatchResults = room.leagueMatchResults.slice(0, 1);
  room.seasonHistory = [{
    seasonNumber: 1,
    seasonYear: 2026,
    completedAt: "2026-12-01T00:00:00.000Z",
    tournamentWinners: [{
      tournamentId: "CUP",
      clubId: "A",
      managerId: "owner-1",
      wonRound: 4,
      wonAt: "2026-11-01T00:00:00.000Z",
    }],
  }];
  room.coachCareerState = {
    version: 1,
    coaches: [{
      id: "owner-1",
      name: "Emanuel",
      managerType: "human",
      currentClubId: "A",
      status: "employed",
      assignments: [{
        clubId: "A",
        startedSeason: 1,
        startedRound: 1,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedSeason: null,
        endedRound: null,
        endedAt: null,
      }],
    }],
  };

  const rankings = await buildRoomRankings({
    room,
    catalogStore: scopedCatalog(),
    competitionId: "L1",
    viewerId: "owner-1",
  });
  const manager = rankings.managers.find((candidate) => candidate.id === "owner-1");

  assert.equal(manager?.titles, 0, "a coluna de titulos representa a temporada selecionada");
  assert.equal(manager?.rankingBreakdown?.titles, 0, "titulo de 2026 nao soma novamente em 2027");
  assert.deepEqual(manager?.trophyHistory.map((trophy) => trophy.seasonNumber), [1]);
});

test("campanha de copa e confronto entre treinadores IA sobrevivem ao rollover", async () => {
  const room = rankingRoom();
  room.currentSeason = 2;
  room.seasonYear = 2027;
  room.managers = [];
  room.leagueFixtureSchedule = [];
  room.leagueMatchResults = [];
  room.tournamentCatalog = [{
    id: "CUP",
    name: "Copa Nacional",
    format: "knockout",
    teamCount: 2,
    teamIds: ["A", "C"],
    active: true,
    participants: [clubs.A, clubs.C],
  }];
  const currentFinal = {
    id: "cup-final-s1",
    competitionFixtureId: "cup-final-s1",
    tournamentId: "CUP",
    competitionId: "CUP",
    calendarRound: 1,
    round: 1,
    homeClubId: "A",
    awayClubId: "C",
    status: "completed",
    result: { score: [0, 0] },
    completedAt: "2027-08-01T20:00:00.000Z",
  };
  room.competitionSeason = {
    seasonNumber: 2,
    seasonYear: 2027,
    winners: [],
    fixtures: [currentFinal],
    competitions: [{
      id: "CUP",
      name: "Copa Nacional",
      format: "knockout",
      status: "active",
      participants: [clubs.A, clubs.C],
      fixtures: [currentFinal],
    }],
  };
  room.seasonHistory = [{
    seasonNumber: 1,
    seasonYear: 2026,
    completedAt: "2026-12-01T00:00:00.000Z",
    managerMatchHistory: [{
      fixtureId: "cup-final-s1",
      competitionId: "CUP",
      round: 4,
      completedAt: "2026-11-01T20:00:00.000Z",
      homeClubId: "A",
      awayClubId: "C",
      homeManagerId: "coach-a",
      awayManagerId: "coach-c",
      score: [1, 2],
    }],
    tournamentWinners: [{
      tournamentId: "CUP",
      clubId: "C",
      managerId: "coach-c",
      wonRound: 4,
      wonAt: "2026-11-01T20:00:00.000Z",
    }],
  }];
  room.coachCareerState = {
    version: 1,
    coaches: [{
      id: "coach-a",
      name: "Treinador Aurora",
      managerType: "ai",
      currentClubId: "A",
      status: "employed",
      assignments: [{
        clubId: "A", startedSeason: 1, startedRound: 1,
        startedAt: "2026-01-01T00:00:00.000Z", endedSeason: null, endedRound: null, endedAt: null,
      }],
    }, {
      id: "coach-c",
      name: "Treinador Celta",
      managerType: "ai",
      currentClubId: "C",
      status: "employed",
      assignments: [{
        clubId: "C", startedSeason: 1, startedRound: 1,
        startedAt: "2026-01-01T00:00:00.000Z", endedSeason: null, endedRound: null, endedAt: null,
      }],
    }],
  };

  const rankings = await buildRoomRankings({
    room,
    catalogStore: scopedCatalog(),
    competitionId: "CUP",
    viewerId: "viewer",
  });
  const champion = rankings.managers.find((manager) => manager.id === "coach-c");
  const runnerUp = rankings.managers.find((manager) => manager.id === "coach-a");
  const archivedCampaign = champion?.seasonStats.find((entry) => (
    entry.seasonNumber === 1 && entry.competitionId === "CUP"
  ));

  assert.deepEqual({
    clubName: archivedCampaign?.clubName,
    played: archivedCampaign?.played,
    wins: archivedCampaign?.wins,
    titles: archivedCampaign?.titles,
  }, { clubName: "Celta", played: 1, wins: 1, titles: 1 });
  assert.equal(champion?.titles, 0, "trofeu antigo nao vira titulo da temporada atual");
  assert.deepEqual(
    champion?.matchHistory.map((match) => [match.seasonNumber, match.opponentManagerId]),
    [[2, "coach-a"], [1, "coach-a"]],
    "IDs de partida repetidos em temporadas diferentes nao apagam o H2H",
  );
  assert.deepEqual(
    runnerUp?.matchHistory.map((match) => [match.seasonNumber, match.opponentManagerId]),
    [[2, "coach-c"], [1, "coach-c"]],
  );
});

async function routeHarness(context) {
  const room = rankingRoom();
  const calls = [];
  const store = {
    async requireMembership(code, managerId) {
      calls.push({ code, managerId });
      if (!["owner-1", "member-1", "member-2"].includes(managerId)) {
        const error = new Error("Manager nao pertence a sala");
        error.code = "ROOM_MEMBERSHIP_REQUIRED";
        error.status = 403;
        throw error;
      }
      return structuredClone(room);
    },
  };
  const ownerIds = [];
  const catalog = scopedCatalog();
  const catalogStore = {
    forOwner(ownerId) {
      ownerIds.push(ownerId);
      return { ...catalog, async ensureInitialized() {} };
    },
  };
  const app = express();
  app.use("/api/rooms", (request, response, next) => {
    const users = {
      "owner-token": { uid: "owner-1", name: "Emanuel" },
      "intruder-token": { uid: "intruder", name: "Intruso" },
    };
    request.user = users[request.headers.authorization?.replace(/^Bearer\s+/i, "")];
    if (!request.user) {
      response.status(401).json({ error: { code: "AUTH_REQUIRED" } });
      return;
    }
    next();
  }, createRoomsRouter(store, catalogStore));
  app.use((error, _request, response, _next) => {
    response.status(error.status ?? 500).json({
      error: { code: error.code ?? "SERVER_ERROR", message: error.message },
    });
  });
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    calls,
    ownerIds,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

test("GET rankings exige membership e usa a base pessoal do dono da sala", async (context) => {
  const { calls, ownerIds, url } = await routeHarness(context);

  const denied = await jsonRequest(`${url}/api/rooms/BOLA-R4NK/rankings?clubId=A`, "intruder-token");
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, "ROOM_MEMBERSHIP_REQUIRED");
  assert.deepEqual(ownerIds, [], "nao abre catalogo antes de provar membership");

  const response = await jsonRequest(`${url}/api/rooms/bola-r4nk/rankings?clubId=C&competitionId=L1`, "owner-token");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.rankings.players[0].id, "B-10");
  assert.equal(body.rankings.scope.competitionId, "L1");
  assert.equal(body.rankings.clubs[0].squadValue, 35_000_000);
  assert.equal(body.rankings.managers[0].points, 4);
  assert.equal(body.rankings.managers[0].isViewer, true);
  assert.deepEqual(ownerIds, ["database-owner"]);
  assert.deepEqual(calls, [
    { code: "BOLA-R4NK", managerId: "intruder" },
    { code: "BOLA-R4NK", managerId: "owner-1" },
  ]);
  assert.equal(JSON.stringify(body).includes("privateAudit"), false);
});
