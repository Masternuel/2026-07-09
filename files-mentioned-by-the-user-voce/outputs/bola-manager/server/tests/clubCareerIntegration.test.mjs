import assert from "node:assert/strict";
import test from "node:test";
import {
  applyClubRecoveryEffects,
  processClubCareerDate,
  recordCareerTransitionEvents,
  recordPlayerAvailabilityEvents,
} from "../game/clubCareerSystem.mjs";

function roomFixture() {
  return {
    id: "career-events-save",
    code: "EVENTS",
    currentSeason: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    startedAt: "2026-07-01T00:00:00.000Z",
    seasonStartedAt: "2026-07-01T00:00:00.000Z",
    managers: [{ id: "manager", clubId: "SAN" }],
    competitionCatalog: [{
      id: "BR-A",
      name: "Brasileirão",
      clubs: [{ id: "SAN", name: "Santos", budget: 100_000_000, reputation: 16 }],
    }],
    careerState: {
      players: [{
        id: "P1",
        name: "Jogador Real",
        clubId: "SAN",
        currentClubId: "SAN",
        contract: { clubId: "SAN", startSeason: 1, endSeason: 1, wage: 100_000, status: "active" },
      }],
    },
    playerStates: [],
  };
}

test("lesão, suspensão e retorno geram um evento e uma notícia por fato", () => {
  const room = roomFixture();
  const before = [{ playerId: "P1", clubId: "SAN", injuryMatches: 0, suspensionMatches: 0 }];
  room.playerStates = [{ playerId: "P1", clubId: "SAN", injuryMatches: 2, suspensionMatches: 1 }];

  recordPlayerAvailabilityEvents(room, {
    fixtureId: "FIX-1",
    previousPlayerStates: before,
    occurredAt: "2026-07-10T20:00:00.000Z",
  });
  recordPlayerAvailabilityEvents(room, {
    fixtureId: "FIX-1",
    previousPlayerStates: before,
    occurredAt: "2026-07-10T20:00:00.000Z",
  });

  assert.deepEqual(room.clubCareerState.events.map(({ type }) => type), [
    "PLAYER_INJURED",
    "PLAYER_SUSPENDED",
  ]);
  assert.equal(room.clubCareerState.news.length, 2);

  const injured = structuredClone(room.playerStates);
  room.playerStates[0].injuryMatches = 0;
  room.playerStates[0].suspensionMatches = 0;
  recordPlayerAvailabilityEvents(room, {
    fixtureId: "FIX-2",
    previousPlayerStates: injured,
    occurredAt: "2026-07-17T20:00:00.000Z",
  });

  assert.equal(room.clubCareerState.events.at(-1).type, "PLAYER_RETURNED_FROM_INJURY");
  assert.match(room.clubCareerState.news.at(-1).title, /volta a ficar disponível/i);
});

test("estrutura médica e comissão reduzem duração da lesão e recuperam condição", () => {
  const room = roomFixture();
  room.playerStates = [{
    playerId: "P1",
    clubId: "SAN",
    condition: 70,
    injuryMatches: 4,
    suspensionMatches: 0,
  }];
  room.clubMoraleStates = [{
    clubId: "SAN",
    score: 60,
    playerDeltas: [{ playerId: "P1", delta: -5 }],
  }];

  const result = applyClubRecoveryEffects(room, "2026-07-10T20:00:00.000Z");
  const playerState = room.playerStates[0];

  assert.equal(result.changed, 1);
  assert.ok(playerState.condition > 70);
  assert.ok(playerState.injuryMatches < 4);
  assert.ok(result.injuryRecoveryMultipliers.SAN < 1);
  assert.equal(result.moraleChanged, 1);
  assert.ok(room.clubMoraleStates[0].score > 60);
  assert.ok(room.clubMoraleStates[0].playerDeltas[0].delta > -5);
  assert.ok(result.moraleRecoveryBonuses.SAN > 0);
});

test("transição de temporada noticia somente contratos realmente renovados ou encerrados", () => {
  const room = roomFixture();
  const previousPlayers = structuredClone(room.careerState.players);
  room.currentSeason = 2;
  room.careerState.players[0] = {
    ...room.careerState.players[0],
    contract: { clubId: "SAN", startSeason: 2, endSeason: 4, wage: 120_000, status: "active" },
  };
  recordCareerTransitionEvents(room, {
    summary: {
      seasonNumber: 2,
      contracts: { renewedPlayerIds: ["P1"], expiredPlayerIds: [] },
    },
    previousPlayers,
    occurredAt: "2027-05-30T12:00:00.000Z",
  });

  assert.equal(room.clubCareerState.events.at(-1).type, "PLAYER_CONTRACT_RENEWED");
  assert.match(room.clubCareerState.news.at(-1).title, /renova/i);
  assert.equal(room.clubCareerState.news.at(-1).originOperationId, "season:2:contract-renewed:P1");
});

test("mesma fixture nao colide entre temporadas ou competicoes na disponibilidade", () => {
  const room = roomFixture();
  const before = [{ playerId: "P1", clubId: "SAN", injuryMatches: 0, suspensionMatches: 0 }];
  room.playerStates = [{ playerId: "P1", clubId: "SAN", injuryMatches: 2, suspensionMatches: 0 }];

  recordPlayerAvailabilityEvents(room, {
    fixtureId: "FIX-1",
    competitionId: "BR-A",
    previousPlayerStates: before,
    occurredAt: "2026-07-10T20:00:00.000Z",
  });
  room.currentSeason = 2;
  recordPlayerAvailabilityEvents(room, {
    fixtureId: "FIX-1",
    competitionId: "BR-A",
    previousPlayerStates: before,
    occurredAt: "2027-07-10T20:00:00.000Z",
  });
  recordPlayerAvailabilityEvents(room, {
    fixtureId: "FIX-1",
    competitionId: "BR-A",
    previousPlayerStates: before,
    occurredAt: "2027-07-10T20:00:00.000Z",
  });
  recordPlayerAvailabilityEvents(room, {
    fixtureId: "FIX-1",
    competitionId: "CUP",
    previousPlayerStates: before,
    occurredAt: "2027-07-12T20:00:00.000Z",
  });

  const injuries = room.clubCareerState.events.filter(({ type }) => type === "PLAYER_INJURED");
  assert.equal(injuries.length, 3);
  assert.deepEqual(injuries.map(({ seasonNumber }) => seasonNumber), [1, 2, 2]);
  assert.deepEqual(injuries.map(({ competitionId }) => competitionId), ["BR-A", "BR-A", "CUP"]);
  assert.equal(new Set(injuries.map(({ operationId }) => operationId)).size, 3);
});

test("avanço de data fecha todos os meses pulados uma única vez", () => {
  const room = roomFixture();
  room.clubCareerState = {
    currentDate: "2026-05-15T12:00:00.000Z",
    lastFinancialPeriodByClub: { SAN: "2026-05" },
  };

  const first = processClubCareerDate(room, "2026-08-10T12:00:00.000Z");

  assert.deepEqual(first.finance.map(({ periodKey }) => periodKey), ["2026-06", "2026-07", "2026-08"]);
  assert.deepEqual(first.finance.map(({ transactions }) => transactions[0]?.occurredAt), [
    "2026-06-30T23:59:59.999Z",
    "2026-07-31T23:59:59.999Z",
    "2026-08-31T23:59:59.999Z",
  ]);
  assert.equal(room.clubCareerState.lastFinancialPeriodByClub.SAN, "2026-08");
  const transactionCount = room.clubCareerState.financialTransactions.filter(
    ({ source }) => source === "monthly-finance",
  ).length;

  const duplicate = processClubCareerDate(room, "2026-08-10T12:00:00.000Z");

  assert.deepEqual(duplicate.finance, []);
  assert.equal(
    room.clubCareerState.financialTransactions.filter(({ source }) => source === "monthly-finance").length,
    transactionCount,
  );
});

test("migração sem último período fecha somente o mês atual", () => {
  const room = roomFixture();
  room.clubCareerState = { currentDate: "2024-01-15T12:00:00.000Z" };

  const migrated = processClubCareerDate(room, "2026-08-10T12:00:00.000Z");

  assert.deepEqual(migrated.finance.map(({ periodKey }) => periodKey), ["2026-08"]);
  assert.equal(room.clubCareerState.lastFinancialPeriodByClub.SAN, "2026-08");
});

test("falha mensal para no primeiro período pendente e permite retry sem lacuna", () => {
  const room = roomFixture();
  room.competitionCatalog[0].clubs[0].budget = 1;
  room.clubCareerState = {
    currentDate: "2026-05-15T12:00:00.000Z",
    lastFinancialPeriodByClub: { SAN: "2026-05" },
  };

  const failed = processClubCareerDate(room, "2026-08-10T12:00:00.000Z");

  assert.deepEqual(failed.finance, []);
  assert.equal(room.clubCareerState.lastFinancialPeriodByClub.SAN, "2026-05");
  assert.deepEqual(room.clubCareerState.financialAlerts.map(({ periodKey }) => periodKey), ["2026-06"]);
  assert.equal(
    room.clubCareerState.financialTransactions.some(({ periodKey }) => ["2026-07", "2026-08"].includes(periodKey)),
    false,
  );

  room.marketState.finances.find(({ clubId }) => clubId === "SAN").balance = 100_000_000;
  const retried = processClubCareerDate(room, "2026-08-10T12:00:00.000Z");

  assert.deepEqual(retried.finance.map(({ periodKey }) => periodKey), ["2026-06", "2026-07", "2026-08"]);
  assert.equal(room.clubCareerState.lastFinancialPeriodByClub.SAN, "2026-08");
});
