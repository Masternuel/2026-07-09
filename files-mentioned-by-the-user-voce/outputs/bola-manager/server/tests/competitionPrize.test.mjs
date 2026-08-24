import assert from "node:assert/strict";
import test from "node:test";
import {
  awardCompletedCompetitionPrizes,
  configuredChampionPrize,
  ensureClubCareerSystems,
} from "../game/clubCareerSystem.mjs";
import { createCompetitionState, recordCompetitionResult } from "../game/competitionEngine.mjs";
import { createLeagueFixtureSchedule } from "../game/fixtures.mjs";

const NOW = "2026-12-20T20:00:00.000Z";

function club(id, budget = 50_000_000) {
  return {
    id,
    name: `Clube ${id}`,
    code: id,
    budget,
    reputation: 10,
    stadium: `Estadio ${id}`,
    stadiumCapacity: 20_000,
  };
}

function baseRoom() {
  return {
    id: "prize-save",
    code: "PRIZE",
    currentSeason: 1,
    seasonYear: 2026,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    seasonStartedAt: "2026-01-01T00:00:00.000Z",
    managers: [{ id: "manager-a", clubId: "A" }],
    competitionCatalog: [],
    tournamentCatalog: [],
    leagueFixtureSchedule: [],
    leagueMatchResults: [],
  };
}

function completedCup({ prizeMoney } = {}) {
  const room = baseRoom();
  const definition = {
    id: "CUP",
    name: "Copa Persistida",
    format: "knockout",
    legs: "single",
    teamCount: 2,
    teamIds: ["A", "B"],
    participants: [club("A"), club("B")],
    tiebreakers: ["extra_time", "penalties"],
    active: true,
    ...(prizeMoney === undefined ? {} : { prizeMoney }),
  };
  let state = createCompetitionState(definition, {
    seasonNumber: 1,
    seasonYear: 2026,
    startDate: NOW,
  });
  state = recordCompetitionResult(state, state.fixtures[0].id, {
    score: [2, 0],
    winnerClubId: state.fixtures[0].homeClubId,
  }, { completedAt: NOW });
  room.tournamentCatalog = [definition];
  room.competitionSeason = { competitions: [state] };
  return { room, state };
}

test("copa concluida credita premio configurado uma vez mesmo com retry", () => {
  const { room, state } = completedCup({ prizeMoney: 12_000_000 });
  ensureClubCareerSystems(room, { now: NOW });
  const originalWinnerClubId = state.winnerClubId;
  const account = room.marketState.finances.find((item) => item.clubId === originalWinnerClubId);
  const balanceBefore = account.balance;

  const first = awardCompletedCompetitionPrizes(room, { occurredAt: NOW });
  room.competitionSeason.competitions[0].winnerClubId = originalWinnerClubId === "A" ? "B" : "A";
  const retry = awardCompletedCompetitionPrizes(room, { occurredAt: NOW });

  assert.equal(first.length, 1);
  assert.equal(first[0].awarded, true);
  assert.equal(retry[0].awarded, false);
  assert.equal(retry[0].winnerClubId, originalWinnerClubId);
  assert.equal(
    room.marketState.finances.find((item) => item.clubId === originalWinnerClubId).balance,
    balanceBefore + 12_000_000,
  );
  assert.equal(room.clubCareerState.financialTransactions.filter((entry) => entry.category === "prize").length, 1);
  assert.deepEqual(room.clubCareerState.events.map((event) => event.type), [
    "COMPETITION_WON",
    "PRIZE_RECEIVED",
  ]);
  assert.equal(room.clubCareerState.news.length, 2);
  assert.match(room.clubCareerState.news[0].title, /conquista/i);
});

test("titulo sem premio configurado nao fabrica receita", () => {
  const { room } = completedCup();
  ensureClubCareerSystems(room, { now: NOW });
  const result = awardCompletedCompetitionPrizes(room, { occurredAt: NOW });

  assert.equal(result[0].amount, 0);
  assert.equal(result[0].prize, null);
  assert.equal(room.clubCareerState.financialTransactions.length, 0);
  assert.deepEqual(room.clubCareerState.events.map((event) => event.type), ["COMPETITION_WON"]);
  assert.equal(room.clubCareerState.news.length, 1);
});

test("liga concluida usa campeao da tabela e premio persistido legado", () => {
  const room = baseRoom();
  room.competitionCatalog = [{
    id: "LEAGUE",
    name: "Liga Real",
    country: "Brasil",
    division: "Serie A",
    legs: "single",
    championPrize: 8_000_000,
    clubs: [club("A"), club("B")],
  }];
  room.leagueFixtureSchedule = createLeagueFixtureSchedule(room);
  const fixture = room.leagueFixtureSchedule[0];
  room.leagueMatchResults = [{
    leagueFixtureId: fixture.leagueFixtureId,
    leagueId: fixture.leagueId,
    round: fixture.round,
    score: [3, 0],
    completedAt: NOW,
  }];
  ensureClubCareerSystems(room, { now: NOW });
  const winnerClubId = fixture.homeClubId;
  const account = room.marketState.finances.find((item) => item.clubId === winnerClubId);
  const balanceBefore = account.balance;

  const result = awardCompletedCompetitionPrizes(room, { occurredAt: NOW });

  assert.equal(result.length, 1);
  assert.equal(result[0].competitionId, "LEAGUE");
  assert.equal(result[0].winnerClubId, winnerClubId);
  assert.equal(result[0].amount, 8_000_000);
  assert.equal(
    room.marketState.finances.find((item) => item.clubId === winnerClubId).balance,
    balanceBefore + 8_000_000,
  );
});

test("resolver aceita lista persistida de premios por posicao", () => {
  assert.deepEqual(configuredChampionPrize({
    prizes: [{ position: 2, amount: 2_000_000 }, { position: 1, amount: 5_000_000, name: "Campeao" }],
  }), { amount: 5_000_000, reason: "Campeao" });
});
