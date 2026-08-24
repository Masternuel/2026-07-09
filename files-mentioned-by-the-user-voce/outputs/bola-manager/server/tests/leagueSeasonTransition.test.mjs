import assert from "node:assert/strict";
import test from "node:test";
import { createCompetitionState, getCompetitionStandings } from "../game/competitionEngine.mjs";
import {
  buildCompletedLeagueStates,
  transitionLeagueDivisions,
} from "../game/leagueSeasonTransition.mjs";

function club(id, leagueId) {
  return {
    id,
    name: `Clube ${id}`,
    code: id,
    leagueId,
    reputation: 10,
  };
}

function league(id, level, ids, extra = {}) {
  return {
    id,
    name: `Liga ${id}`,
    country: "Brasil",
    division: `Serie ${String.fromCharCode(64 + level)}`,
    level,
    legs: "double",
    clubs: ids.map((clubId) => club(clubId, id)),
    ...extra,
  };
}

function engineSchedule(leagueRecord, room) {
  return createCompetitionState({
    id: leagueRecord.id,
    name: leagueRecord.name,
    format: "league",
    legs: "double",
    tiebreakers: ["points", "wins", "goal_difference", "goals_scored", "head_to_head"],
    teamCount: leagueRecord.clubs.length,
    participants: leagueRecord.clubs.map((item) => ({ id: item.id, name: item.name })),
  }, {
    seasonNumber: room.currentSeason,
    seasonYear: room.seasonYear,
    startDate: room.seasonStartedAt,
    roundIntervalDays: 7,
  }).fixtures;
}

function completeRoom({ reverseFirstFixture = false } = {}) {
  const competitionCatalog = [
    league("BR-A", 1, ["A1", "A2", "A3", "A4"], { relegationSlots: 1 }),
    league("BR-B", 2, ["B1", "B2", "B3", "B4"], { promotionSlots: 1 }),
  ];
  const room = {
    currentSeason: 2,
    seasonYear: 2027,
    seasonStartedAt: "2027-01-10T12:00:00.000Z",
    competitionCatalog,
    leagueFixtureSchedule: [],
    leagueMatchResults: [],
  };

  for (const competition of competitionCatalog) {
    const orderedIds = competition.clubs.map((item) => item.id);
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    engineSchedule(competition, room).forEach((fixture, index) => {
      const reverse = reverseFirstFixture && index === 0;
      const homeClubId = reverse ? fixture.awayClubId : fixture.homeClubId;
      const awayClubId = reverse ? fixture.homeClubId : fixture.awayClubId;
      const engineScore = rank.get(fixture.homeClubId) < rank.get(fixture.awayClubId)
        ? [2, 0]
        : [0, 2];
      const storedScore = reverse ? [engineScore[1], engineScore[0]] : engineScore;
      const leagueFixtureId = `${competition.id}-R${fixture.round}-M${index + 1}`;
      room.leagueFixtureSchedule.push({
        leagueFixtureId,
        leagueId: competition.id,
        round: fixture.round,
        homeClubId,
        awayClubId,
      });
      room.leagueMatchResults.push({ leagueFixtureId, score: storedScore });
    });
  }
  return room;
}

test("reconstroi estados completos usando resultados compactos das duas divisoes", () => {
  const room = completeRoom({ reverseFirstFixture: true });
  const states = buildCompletedLeagueStates(room);

  assert.equal(states.length, 2);
  assert.equal(states.every((state) => state.status === "completed"), true);
  assert.deepEqual(states.map((state) => [
    state.id,
    getCompetitionStandings(state).map((row) => [row.clubId, row.points]),
  ]), [
    ["BR-A", [["A1", 18], ["A2", 12], ["A3", 6], ["A4", 0]]],
    ["BR-B", [["B1", 18], ["B2", 12], ["B3", 6], ["B4", 0]]],
  ]);
});

test("promove campeao da segunda divisao e rebaixa ultimo da primeira", () => {
  const room = completeRoom();
  const originalCatalog = structuredClone(room.competitionCatalog);
  const result = transitionLeagueDivisions(room);

  assert.deepEqual(room.competitionCatalog, originalCatalog, "helper nao deve mutar save recebido");
  assert.deepEqual(result.movements, [
    {
      clubId: "B1",
      type: "promotion",
      fromDivisionId: "BR-B",
      toDivisionId: "BR-A",
      position: 1,
    },
    {
      clubId: "A4",
      type: "relegation",
      fromDivisionId: "BR-A",
      toDivisionId: "BR-B",
      position: 4,
    },
  ]);

  const upper = result.competitionCatalog.find((item) => item.id === "BR-A");
  const lower = result.competitionCatalog.find((item) => item.id === "BR-B");
  assert.deepEqual(upper.clubs.map((item) => item.id).sort(), ["A1", "A2", "A3", "B1"]);
  assert.deepEqual(lower.clubs.map((item) => item.id).sort(), ["A4", "B2", "B3", "B4"]);
  assert.equal(upper.clubs.find((item) => item.id === "B1").leagueId, "BR-A");
  assert.equal(lower.clubs.find((item) => item.id === "A4").leagueId, "BR-B");
  assert.equal(new Set(result.competitionCatalog.flatMap((item) => item.clubs.map((entry) => entry.id))).size, 8);
});

test("usa quantidade padrao de vagas quando liga nao configura slots", () => {
  const room = completeRoom();
  delete room.competitionCatalog[0].relegationSlots;
  delete room.competitionCatalog[1].promotionSlots;

  const result = transitionLeagueDivisions(room);
  assert.equal(result.movements.length, 2);
  assert.equal(result.movements.filter((movement) => movement.type === "promotion").length, 1);
  assert.equal(result.movements.filter((movement) => movement.type === "relegation").length, 1);
});

test("resultado ausente torna divisao incompleta e bloqueia movimentos", () => {
  const room = completeRoom();
  const missing = room.leagueMatchResults.findIndex((result) => result.leagueFixtureId.startsWith("BR-B-"));
  room.leagueMatchResults.splice(missing, 1);

  const states = buildCompletedLeagueStates(room);
  assert.deepEqual(states.map((state) => state.id), ["BR-A"]);
  const transitioned = transitionLeagueDivisions(room);
  assert.deepEqual(transitioned.movements, []);
  assert.deepEqual(transitioned.competitionCatalog, room.competitionCatalog);
});

test("ausencia de catalogo, resultado ou duas divisoes retorna estado seguro", () => {
  assert.deepEqual(buildCompletedLeagueStates(), []);
  assert.deepEqual(transitionLeagueDivisions(), { competitionCatalog: [], movements: [] });

  const oneLeagueRoom = completeRoom();
  oneLeagueRoom.competitionCatalog = oneLeagueRoom.competitionCatalog.slice(0, 1);
  oneLeagueRoom.leagueFixtureSchedule = oneLeagueRoom.leagueFixtureSchedule.filter(
    (fixture) => fixture.leagueId === "BR-A",
  );
  oneLeagueRoom.leagueMatchResults = oneLeagueRoom.leagueMatchResults.filter(
    (result) => result.leagueFixtureId.startsWith("BR-A-"),
  );
  const transitioned = transitionLeagueDivisions(oneLeagueRoom);
  assert.deepEqual(transitioned.movements, []);
  assert.equal(transitioned.competitionCatalog.length, 1);
});

test("divisoes de paises diferentes nunca trocam clubes", () => {
  const room = completeRoom();
  room.competitionCatalog[1].country = "Argentina";
  const result = transitionLeagueDivisions(room);
  assert.deepEqual(result.movements, []);
  assert.deepEqual(result.competitionCatalog, room.competitionCatalog);
});
