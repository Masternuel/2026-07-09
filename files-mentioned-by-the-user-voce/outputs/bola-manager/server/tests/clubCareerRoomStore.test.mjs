import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";
import { clubCareerPerformanceEffects } from "../game/clubCareerSystem.mjs";

const OWNER_ID = "career-owner";
const MEMBER_ID = "career-member";
const NOW = new Date("2026-07-21T12:00:00.000Z");

function testCatalog() {
  const leagues = [{
    id: "BR-A",
    name: "Liga persistente",
    country: "Brasil",
    division: "Serie A",
    active: true,
    clubs: [
      {
        id: "AUR",
        name: "Aurora",
        code: "AUR",
        reputation: 15,
        budget: 80_000_000,
        stadium: "Estadio Aurora",
        stadiumCapacity: 28_000,
        leagueId: "BR-A",
        active: true,
      },
      {
        id: "SAN",
        name: "Santos",
        code: "SAN",
        reputation: 14,
        budget: 60_000_000,
        stadium: "Vila de Teste",
        stadiumCapacity: 22_000,
        leagueId: "BR-A",
        active: true,
      },
    ],
  }];
  return {
    leagues,
    async listCompetitionCatalog() {
      return structuredClone(leagues);
    },
    async listPlayers() {
      return { players: [], count: 0, source: "career-test" };
    },
  };
}

function createHarness() {
  const persistence = new MemoryRoomPersistence();
  const catalog = testCatalog();
  let currentNow = NOW;
  const options = {
    persistence,
    catalogStore: {
      forOwner() {
        return catalog;
      },
    },
    codeFactory: () => "BOLA-C4R1",
    now: () => new Date(currentNow),
  };
  return {
    persistence,
    store: new RoomStore(options),
    reload: () => new RoomStore({ ...options, codeFactory: () => "BOLA-RLD2" }),
    setNow(value) {
      currentNow = new Date(value);
    },
  };
}

async function startCareer(store) {
  const created = await store.createRoom({
    name: "Carreira persistente",
    creatorId: OWNER_ID,
    creatorName: "Owner",
    clubId: "AUR",
    activeLeagues: ["BR-A"],
    seasonLength: 2,
    maxManagers: 2,
  });
  await store.joinRoom(created.code, {
    managerId: MEMBER_ID,
    managerName: "Member",
    clubId: "SAN",
  });
  await store.setReady(created.code, OWNER_ID, true);
  await store.setReady(created.code, MEMBER_ID, true);
  return store.startRoom(created.code, OWNER_ID);
}

function financeAccount(room, clubId) {
  return room.marketState.finances.find((account) => account.clubId === clubId);
}

function transactionsFor(room, clubId, originId) {
  return room.clubCareerState.financialTransactions.filter((transaction) => (
    transaction.clubId === clubId && transaction.originId === originId
  ));
}

function eventsFor(room, operationId) {
  return room.clubCareerState.events.filter((event) => event.operationId === operationId);
}

function newsForOperation(room, operationId) {
  return room.clubCareerState.news.filter((news) => news.originOperationId === operationId);
}

test("migra save ativo antigo e persiste os agregados da carreira sem inventar eventos", async () => {
  const harness = createHarness();
  const active = await startCareer(harness.store);
  const legacy = await harness.store.requireRoom(active.code);
  const previousRevision = legacy.revision;
  delete legacy.marketState;
  delete legacy.clubCareerState;
  await harness.persistence.save(legacy);

  const migrated = await harness.reload().requireMembership(active.code, OWNER_ID);
  assert.equal(migrated.revision, previousRevision + 1);
  assert.deepEqual(
    migrated.marketState.finances.map(({ clubId, balance }) => ({ clubId, balance })),
    [
      { clubId: "AUR", balance: 80_000_000 },
      { clubId: "SAN", balance: 60_000_000 },
    ],
  );
  assert.equal(migrated.clubCareerState.clubFacilities.length, 2);
  assert.equal(migrated.clubCareerState.staffMembers.length, 18);
  assert.equal(migrated.clubCareerState.staffContracts.filter(({ status }) => status === "active").length, 18);
  assert.equal(migrated.clubCareerState.staffCandidates.length > 0, true);
  assert.deepEqual(migrated.clubCareerState.financialTransactions, []);
  assert.deepEqual(migrated.clubCareerState.events, []);
  assert.deepEqual(migrated.clubCareerState.news, []);

  const persisted = await harness.persistence.get(active.code);
  assert.equal(persisted.clubCareerState.clubFacilities.length, 2);
  assert.equal(persisted.marketState.finances.length, 2);
});

test("primeira fornada usa estrutura e treinador persistidos sem reroll no reload", async () => {
  const harness = createHarness();
  const active = await startCareer(harness.store);
  const firstIntake = active.careerState.players
    .filter((player) => player.academy)
    .map((player) => ({ id: player.id, clubId: player.clubId, youthIntake: player.youthIntake }));

  assert.equal(firstIntake.length, 4);
  for (const manager of active.managers) {
    const effects = clubCareerPerformanceEffects(active, manager.clubId, active.startedAt);
    const clubPlayers = firstIntake.filter((player) => player.clubId === manager.clubId);
    assert.equal(clubPlayers.length, 2);
    assert.equal(effects.youthDevelopment.infrastructureBonus > 0, true);
    assert.equal(effects.youthDevelopment.staffBonus > 0, true);
    assert.equal(clubPlayers.every((player) => (
      player.youthIntake?.effectiveAcademyQuality === effects.youthDevelopment.effectiveAcademyQuality
      && player.youthIntake?.infrastructureBonus === effects.youthDevelopment.infrastructureBonus
      && player.youthIntake?.staffBonus === effects.youthDevelopment.staffBonus
    )), true);
  }

  const reloaded = await harness.reload().requireMembership(active.code, OWNER_ID);
  const reloadedIntake = reloaded.careerState.players
    .filter((player) => player.academy)
    .map((player) => ({ id: player.id, clubId: player.clubId, youthIntake: player.youthIntake }));
  assert.deepEqual(reloadedIntake, firstIntake);
});

test("obra debita uma vez, respeita o clube do manager e sobrevive ao reload", async () => {
  const harness = createHarness();
  const active = await startCareer(harness.store);
  const before = await harness.store.requireRoom(active.code);
  const initialBalance = financeAccount(before, "AUR").balance;

  const started = await harness.store.startClubFacilityUpgrade(active.code, OWNER_ID, {
    requestId: "upgrade-analysis-1",
    clubId: "AUR",
    areaId: "analysis",
  });
  assert.equal(started.project.operationId, "upgrade-analysis-1");
  assert.equal(started.project.status, "active");
  assert.equal(financeAccount(started.room, "AUR").balance, initialBalance - started.quote.cost);
  assert.equal(transactionsFor(started.room, "AUR", "upgrade-analysis-1").length, 1);
  assert.equal(eventsFor(started.room, "upgrade-analysis-1").length, 1);
  assert.equal(newsForOperation(started.room, "upgrade-analysis-1").length, 1);

  const duplicate = await harness.store.startClubFacilityUpgrade(active.code, OWNER_ID, {
    requestId: "upgrade-analysis-1",
    clubId: "AUR",
    areaId: "analysis",
  });
  assert.equal(duplicate.project.id, started.project.id);
  assert.equal(financeAccount(duplicate.room, "AUR").balance, initialBalance - started.quote.cost);
  assert.equal(duplicate.room.clubCareerState.facilityProjects.length, 1);
  assert.equal(transactionsFor(duplicate.room, "AUR", "upgrade-analysis-1").length, 1);
  assert.equal(eventsFor(duplicate.room, "upgrade-analysis-1").length, 1);
  assert.equal(newsForOperation(duplicate.room, "upgrade-analysis-1").length, 1);

  await assert.rejects(
    harness.store.startClubFacilityUpgrade(active.code, MEMBER_ID, {
      requestId: "upgrade-forbidden",
      clubId: "AUR",
      areaId: "training",
    }),
    { code: "CLUB_FORBIDDEN", status: 403 },
  );
  await assert.rejects(
    harness.store.startClubFacilityUpgrade(active.code, "intruder", {
      requestId: "upgrade-intruder",
      areaId: "training",
    }),
    { code: "ROOM_NOT_FOUND", status: 404 },
  );

  const reloaded = await harness.reload().requireRoom(active.code);
  assert.equal(reloaded.clubCareerState.facilityProjects[0].id, started.project.id);
  assert.equal(financeAccount(reloaded, "AUR").balance, initialBalance - started.quote.cost);
  assert.equal(transactionsFor(reloaded, "AUR", "upgrade-analysis-1").length, 1);
});

test("contratar, renovar e demitir comissão atualiza contratos, caixa, eventos e efeitos", async () => {
  const harness = createHarness();
  const active = await startCareer(harness.store);
  const before = await harness.store.requireRoom(active.code);
  const candidate = before.clubCareerState.staffCandidates[0];
  const initialBalance = financeAccount(before, "AUR").balance;

  const hired = await harness.store.hireClubStaff(active.code, OWNER_ID, {
    requestId: "staff-hire-1",
    staffId: candidate.id,
    years: 2,
    wage: 90_000,
    signingBonus: 50_000,
  });
  assert.equal(hired.member.clubId, "AUR");
  assert.equal(hired.contract.status, "active");
  assert.equal(hired.contract.wage, 90_000);
  assert.equal(financeAccount(hired.room, "AUR").balance, initialBalance - 50_000);
  assert.equal(transactionsFor(hired.room, "AUR", "staff-hire-1").length, 1);
  assert.equal(eventsFor(hired.room, "staff-hire-1").length, 1);
  assert.equal(newsForOperation(hired.room, "staff-hire-1").length, 1);

  const duplicatedHire = await harness.store.hireClubStaff(active.code, OWNER_ID, {
    requestId: "staff-hire-1",
    staffId: candidate.id,
    years: 2,
    wage: 90_000,
    signingBonus: 50_000,
  });
  assert.equal(financeAccount(duplicatedHire.room, "AUR").balance, initialBalance - 50_000);
  assert.equal(transactionsFor(duplicatedHire.room, "AUR", "staff-hire-1").length, 1);

  const renewed = await harness.store.renewClubStaff(active.code, OWNER_ID, {
    requestId: "staff-renew-1",
    staffId: candidate.id,
    years: 3,
    wage: 100_000,
    renewalBonus: 30_000,
  });
  assert.equal(renewed.member.contractId, renewed.contract.id);
  assert.equal(renewed.contract.status, "active");
  assert.equal(renewed.contract.wage, 100_000);
  assert.equal(
    renewed.room.clubCareerState.staffContracts.find(({ id }) => id === hired.contract.id).status,
    "replaced",
  );
  assert.equal(financeAccount(renewed.room, "AUR").balance, initialBalance - 80_000);
  assert.equal(transactionsFor(renewed.room, "AUR", "staff-renew-1").length, 1);
  assert.equal(eventsFor(renewed.room, "staff-renew-1").length, 1);
  assert.equal(newsForOperation(renewed.room, "staff-renew-1").length, 1);

  const balanceBeforeFire = financeAccount(renewed.room, "AUR").balance;
  const fired = await harness.store.fireClubStaff(active.code, OWNER_ID, {
    requestId: "staff-fire-1",
    staffId: candidate.id,
    mutualAgreement: true,
  });
  const fireTransaction = transactionsFor(fired.room, "AUR", "staff-fire-1")[0];
  assert.equal(fired.member.clubId, null);
  assert.equal(fired.member.status, "free_agent");
  assert.equal(fired.contract.status, "terminated");
  assert.equal(fired.room.clubCareerState.staffMembers.some(({ id }) => id === candidate.id), false);
  assert.equal(fired.room.clubCareerState.staffCandidates.some(({ id }) => id === candidate.id), true);
  assert.equal(
    fired.room.clubCareerState.staffContracts.filter(({ staffId, status }) => (
      staffId === candidate.id && status === "active"
    )).length,
    0,
  );
  assert.equal(financeAccount(fired.room, "AUR").balance, balanceBeforeFire - fireTransaction.amount);
  assert.equal(eventsFor(fired.room, "staff-fire-1").length, 1);
  assert.equal(newsForOperation(fired.room, "staff-fire-1").length, 1);
  assert.equal(fired.room.clubCareerState.staffEffectsByClub.AUR.memberCount, 9);

  const reloaded = await harness.reload().requireRoom(active.code);
  assert.equal(reloaded.clubCareerState.staffCandidates.some(({ id }) => id === candidate.id), true);
  assert.equal(eventsFor(reloaded, "staff-hire-1").length, 1);
  assert.equal(eventsFor(reloaded, "staff-renew-1").length, 1);
  assert.equal(eventsFor(reloaded, "staff-fire-1").length, 1);
});

test("estado de leitura da notícia é idempotente e persistente por manager", async () => {
  const harness = createHarness();
  const active = await startCareer(harness.store);
  const upgrade = await harness.store.startClubFacilityUpgrade(active.code, OWNER_ID, {
    requestId: "upgrade-news-1",
    areaId: "training",
  });
  const newsId = newsForOperation(upgrade.room, "upgrade-news-1")[0].id;

  const read = await harness.store.markClubNewsRead(active.code, OWNER_ID, { newsId });
  assert.equal(read.readCount, 1);
  assert.deepEqual(read.news[0].readByManagerIds, [OWNER_ID]);
  assert.equal(read.news[0].readAtByManagerId[OWNER_ID], NOW.toISOString());

  const duplicated = await harness.store.markClubNewsRead(active.code, OWNER_ID, { newsId });
  assert.deepEqual(duplicated.news[0].readByManagerIds, [OWNER_ID]);
  assert.equal(duplicated.room.clubCareerState.news.length, 1);

  const reloaded = await harness.reload().requireRoom(active.code);
  const persisted = reloaded.clubCareerState.news.find(({ id }) => id === newsId);
  assert.deepEqual(persisted.readByManagerIds, [OWNER_ID]);
  assert.equal(persisted.readAtByManagerId[OWNER_ID], NOW.toISOString());
});

test("fim de jogo registra bilheteria, evento e notícia uma única vez", async () => {
  const harness = createHarness();
  const active = await startCareer(harness.store);
  const fixture = active.fixtureSchedule.find(({ fixtureId }) => fixtureId === active.currentFixtureId);
  const economyFixtureId = fixture.leagueFixtureId ?? fixture.fixtureId;

  const completed = await harness.store.completeMatch(active.code, fixture.fixtureId, {
    id: "career-match-1",
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    score: [2, 1],
    statistics: { home: { possession: 54 }, away: { possession: 46 } },
    skipped: false,
  });
  const economy = completed.summary.matchdayEconomies.find(({ fixtureId }) => fixtureId === economyFixtureId);
  assert.ok(economy);
  assert.equal(economy.duplicate, false);
  const matchdayTransactions = transactionsFor(
    completed.room,
    fixture.homeClubId,
    economy.financeOperationId,
  );
  assert.equal(matchdayTransactions.length, 1);
  assert.equal(matchdayTransactions[0].category, "matchday_revenue");
  assert.equal(matchdayTransactions[0].amount, economy.netRevenue);
  assert.equal(matchdayTransactions[0].balanceAfter - matchdayTransactions[0].balanceBefore, economy.netRevenue);
  const facility = completed.room.clubCareerState.clubFacilities.find(({ clubId }) => clubId === fixture.homeClubId);
  assert.equal(facility.stadium.matchesHosted, 1);
  assert.equal(
    facility.stadium.history.filter(({ operationId }) => operationId === economy.financeOperationId).length,
    1,
  );
  assert.equal(eventsFor(completed.room, economy.eventOperationId).length, 1);
  assert.equal(newsForOperation(completed.room, economy.eventOperationId).length, 1);

  await assert.rejects(
    harness.store.completeMatch(active.code, fixture.fixtureId, {
      id: "career-match-repeated",
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      score: [2, 1],
      statistics: { home: {}, away: {} },
      skipped: false,
    }),
    { code: "FIXTURE_ALREADY_COMPLETED", status: 409 },
  );

  const reloaded = await harness.reload().requireRoom(active.code);
  assert.equal(transactionsFor(reloaded, fixture.homeClubId, economy.financeOperationId).length, 1);
  assert.equal(eventsFor(reloaded, economy.eventOperationId).length, 1);
  assert.equal(newsForOperation(reloaded, economy.eventOperationId).length, 1);
});
