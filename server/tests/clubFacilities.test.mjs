import assert from "node:assert/strict";
import test from "node:test";
import {
  ClubFacilityError,
  calculateMatchdayEconomy,
  ensureClubFacilities,
  facilityEffectsForClub,
  facilityForClub,
  facilitySnapshot,
  facilityView,
  processFacilityProjects,
  recordMatchdayEconomy,
  startFacilityUpgrade,
  upgradeQuote,
} from "../game/clubFacilities.mjs";
import { creditFinance, debitFinance, ensureFinanceAccount } from "../game/clubFinance.mjs";

function roomFixture() {
  return {
    code: "FAC001",
    createdAt: "2026-07-01T00:00:00.000Z",
    managers: [{ id: "m1", clubId: "SAN" }],
    competitionCatalog: [{
      id: "BR-A",
      clubs: [
        {
          id: "SAN",
          name: "Santos",
          reputation: 16,
          budget: 120_000_000,
          stadium: "Vila Belmiro",
          stadiumCapacity: 16_068,
        },
        {
          id: "PAL",
          name: "Palmeiras",
          reputation: 18,
          budget: 140_000_000,
          stadium: "Arena Palmeiras",
          stadiumCapacity: 43_000,
        },
      ],
    }],
  };
}

test("migra save antigo de forma deterministica e preserva estado vizinho", () => {
  const room = roomFixture();
  room.clubCareerState = { events: [{ id: "evento-existente" }] };
  const state = ensureClubFacilities(room, new Date("2026-07-01T00:00:00.000Z"));
  const first = structuredClone(state.clubFacilities);

  ensureClubFacilities(room, new Date("2026-08-01T00:00:00.000Z"));

  assert.deepEqual(state.clubFacilities, first);
  assert.deepEqual(room.clubCareerState.events, [{ id: "evento-existente" }]);
  assert.equal(facilityForClub(room, "san").stadium.name, "Vila Belmiro");
  assert.equal(facilityForClub(room, "SAN").stadium.capacity, 16_068);
  assert.equal(facilityForClub(room, "SAN").areas.length, 17);
});

test("cotacao visivel vem da regra canonica sem ser persistida no save", () => {
  const room = roomFixture();
  ensureClubFacilities(room, new Date("2026-07-01T00:00:00.000Z"));
  const facility = facilityForClub(room, "SAN");
  const pitch = facility.areas.find((area) => area.id === "pitch");
  pitch.nextUpgradeQuote = { cost: 1, durationDays: 1 };
  pitch.benefitLabel = "cotacao obsoleta";
  pitch.upgradeStatus = "available";

  ensureClubFacilities(room, new Date("2026-07-02T00:00:00.000Z"));

  const persisted = facilityForClub(room, "SAN").areas.find((area) => area.id === "pitch");
  assert.equal("nextUpgradeQuote" in persisted, false);
  assert.equal("benefitLabel" in persisted, false);
  assert.equal("upgradeStatus" in persisted, false);

  const quote = upgradeQuote(room, "SAN", "pitch");
  const visible = facilityView(facilityForClub(room, "SAN"));
  const visiblePitch = visible.areas.find((area) => area.id === "pitch");
  assert.deepEqual(visiblePitch.nextUpgradeQuote, quote);
  assert.equal(visiblePitch.upgradeStatus, "available");
  assert.equal(typeof visiblePitch.benefitLabel, "string");
  assert.equal(visiblePitch.benefitLabel.length > 0, true);

  const snapshotPitch = facilitySnapshot(room, "SAN").facility.areas.find((area) => area.id === "pitch");
  assert.deepEqual(snapshotPitch.nextUpgradeQuote, quote);
});

test("snapshot nao oferece cotacao para area em obra ou no nivel maximo", () => {
  const room = roomFixture();
  ensureClubFacilities(room, new Date("2026-07-01T00:00:00.000Z"));
  const facility = facilityForClub(room, "SAN");
  const pitch = facility.areas.find((area) => area.id === "pitch");
  const stands = facility.areas.find((area) => area.id === "stands");
  pitch.activeProjectId = "facility:active";
  stands.level = stands.maxLevel;

  const visible = facilityView(facility);
  const visiblePitch = visible.areas.find((area) => area.id === "pitch");
  const visibleStands = visible.areas.find((area) => area.id === "stands");

  assert.equal(visiblePitch.upgradeStatus, "active");
  assert.equal(visiblePitch.nextUpgradeQuote, null);
  assert.equal(visibleStands.upgradeStatus, "max");
  assert.equal(visibleStands.nextUpgradeQuote, null);
});

test("migra historico legado separando reformas e partidas sem perder compatibilidade", () => {
  const room = roomFixture();
  const renovation = {
    projectId: "facility:legacy-upgrade",
    areaId: "pitch",
    name: "Gramado",
    level: 3,
    completedAt: "2025-06-01T00:00:00.000Z",
  };
  const matchday = {
    operationId: "matchday:legacy-match",
    type: "matchday",
    fixtureId: "legacy-match",
    occurredAt: "2025-07-01T19:00:00.000Z",
  };
  room.clubCareerState = {
    clubFacilities: [{
      clubId: "SAN",
      stadium: { history: [renovation, matchday] },
      areas: [],
    }],
  };

  const stadium = facilityForClub(room, "SAN", "2026-07-01T00:00:00.000Z").stadium;

  assert.deepEqual(stadium.renovationHistory, [renovation]);
  assert.deepEqual(stadium.matchHistory, [matchday]);
  assert.deepEqual(stadium.history, [renovation, matchday]);
});

test("obra debita uma vez, persiste e conclui no relogio da carreira", () => {
  const room = roomFixture();
  ensureClubFacilities(room, new Date("2026-07-01T00:00:00.000Z"));
  const account = ensureFinanceAccount(room, "SAN");
  const openingBalance = account.balance;
  const events = [];
  const quote = upgradeQuote(room, "SAN", "pitch");
  const first = startFacilityUpgrade(room, {
    clubId: "SAN",
    areaId: "pitch",
    operationId: "upgrade-pitch-1",
    debit: (input) => debitFinance(room, input),
    recordEvent: (event) => events.push(event),
  });
  const duplicate = startFacilityUpgrade(room, {
    clubId: "SAN",
    areaId: "pitch",
    operationId: "upgrade-pitch-1",
    debit: (input) => debitFinance(room, input),
  });

  assert.equal(account.balance, openingBalance - quote.cost);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(events.length, 1);
  assert.equal(facilityForClub(room, "SAN").areas.find((area) => area.id === "pitch").activeProjectId, first.project.id);

  const before = processFacilityProjects(room, new Date("2026-07-10T00:00:00.000Z"));
  const after = processFacilityProjects(room, new Date(first.project.expectedAt), {
    recordEvent: (event) => events.push(event),
  });
  const repeated = processFacilityProjects(room, new Date(first.project.expectedAt), {
    recordEvent: (event) => events.push(event),
  });

  assert.equal(before.changed, false);
  assert.equal(after.changed, true);
  assert.equal(repeated.changed, false);
  assert.equal(events.length, 2);
  assert.equal(first.project.status, "completed");
  assert.equal(facilityForClub(room, "SAN").areas.find((area) => area.id === "pitch").level, quote.nextLevel);
});

test("retencao nunca remove obra ativa paga quando o historico cresce", () => {
  const room = roomFixture();
  const state = ensureClubFacilities(room, new Date("2026-07-01T00:00:00.000Z"));
  const pitch = facilityForClub(room, "SAN").areas.find((area) => area.id === "pitch");
  const active = {
    id: "facility:active-paid",
    operationId: "active-paid",
    clubId: "SAN",
    areaId: "pitch",
    name: "Gramado",
    category: "stadium",
    fromLevel: pitch.level,
    toLevel: pitch.level + 1,
    cost: 3_200_000,
    durationDays: 28,
    startedAt: "2026-07-01T00:00:00.000Z",
    expectedAt: "2026-07-29T00:00:00.000Z",
    completedAt: null,
    status: "active",
  };
  pitch.activeProjectId = active.id;
  state.facilityProjects = [
    active,
    ...Array.from({ length: 100 }, (_, index) => ({
      id: `facility:completed-${index}`,
      operationId: `completed-${index}`,
      clubId: "PAL",
      areaId: "training",
      status: "completed",
      completedAt: `2025-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    })),
  ];

  ensureClubFacilities(room, new Date("2026-07-02T00:00:00.000Z"));

  assert.equal(state.facilityProjects.length, 81);
  assert.equal(state.facilityProjects.some((project) => project.id === active.id), true);
  assert.equal(facilityForClub(room, "SAN").areas.find((area) => area.id === "pitch").activeProjectId, active.id);
});

test("bloqueia segunda obra simultanea na mesma area", () => {
  const room = roomFixture();
  startFacilityUpgrade(room, {
    clubId: "SAN",
    areaId: "training",
    operationId: "training-1",
    debit: (input) => debitFinance(room, input),
  });

  assert.throws(() => startFacilityUpgrade(room, {
    clubId: "SAN",
    areaId: "training",
    operationId: "training-2",
    debit: (input) => debitFinance(room, input),
  }), (error) => error instanceof ClubFacilityError && error.code === "FACILITY_PROJECT_ACTIVE");
});

test("dia de jogo atualiza estadio e caixa uma unica vez", () => {
  const room = roomFixture();
  ensureClubFacilities(room, new Date("2026-07-01T00:00:00.000Z"));
  const account = ensureFinanceAccount(room, "SAN");
  const openingBalance = account.balance;
  const events = [];
  const input = {
    fixtureId: "BR-A-R1-SAN-PAL",
    homeClubId: "SAN",
    awayClubId: "PAL",
    competitionId: "BR-A",
    score: [2, 1],
    occurredAt: "2026-07-12T19:00:00.000Z",
  };
  const first = recordMatchdayEconomy(room, input, {
    credit: (entry) => creditFinance(room, entry),
    recordEvent: (event) => events.push(event),
  });
  const duplicate = recordMatchdayEconomy(room, input, {
    credit: (entry) => creditFinance(room, entry),
    recordEvent: (event) => events.push(event),
  });
  const stadium = facilityForClub(room, "SAN").stadium;

  assert.ok(first.netRevenue > 0);
  assert.equal(duplicate.duplicate, true);
  assert.equal(account.balance, openingBalance + first.netRevenue);
  assert.equal(stadium.matchesHosted, 1);
  assert.equal(stadium.totalAttendance, first.attendance);
  assert.equal(stadium.averageMatchRevenue, first.netRevenue);
  assert.equal(events.length, 1);
});

test("mesma fixture gera bilheteria e evento independentes em cada temporada", () => {
  const room = roomFixture();
  room.currentSeason = 1;
  room.seasonStartedAt = "2026-07-01T00:00:00.000Z";
  const events = [];
  const account = ensureFinanceAccount(room, "SAN");
  const openingBalance = account.balance;
  const input = {
    fixtureId: "BR-A-R1-SAN-PAL",
    homeClubId: "SAN",
    awayClubId: "PAL",
    competitionId: "BR-A",
    score: [1, 0],
    occurredAt: "2026-07-12T19:00:00.000Z",
  };
  const callbacks = {
    credit: (entry) => creditFinance(room, entry),
    recordEvent: (event) => events.push(event),
  };

  const first = recordMatchdayEconomy(room, input, callbacks);
  const duplicate = recordMatchdayEconomy(room, input, callbacks);
  room.seasonHistory = [{
    seasonNumber: 1,
    startedAt: room.seasonStartedAt,
    completedAt: "2027-06-30T23:59:59.999Z",
  }];
  room.currentSeason = 2;
  room.seasonStartedAt = "2027-07-01T00:00:00.000Z";
  const second = recordMatchdayEconomy(room, {
    ...input,
    occurredAt: "2027-07-12T19:00:00.000Z",
  }, callbacks);

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(second.duplicate, false);
  assert.notEqual(first.financeOperationId, second.financeOperationId);
  assert.notEqual(first.eventOperationId, second.eventOperationId);
  assert.equal(account.balance, openingBalance + first.netRevenue + second.netRevenue);
  assert.equal(facilityForClub(room, "SAN").stadium.matchesHosted, 2);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(({ seasonNumber }) => seasonNumber), [1, 2]);
});

test("mais de 120 jogos nao expulsam reformas do historico do estadio", () => {
  const room = roomFixture();
  const started = startFacilityUpgrade(room, {
    clubId: "SAN",
    areaId: "pitch",
    operationId: "upgrade-pitch-history",
    debit: () => {},
  });
  processFacilityProjects(room, started.project.expectedAt);

  for (let index = 0; index < 121; index += 1) {
    recordMatchdayEconomy(room, {
      fixtureId: `BR-A-HISTORY-${index + 1}`,
      homeClubId: "SAN",
      awayClubId: "PAL",
      competitionId: "BR-A",
      score: [1, 0],
      occurredAt: new Date(Date.UTC(2027, 0, index + 1, 19)).toISOString(),
    }, { credit: () => {} });
  }

  const stadium = facilityForClub(room, "SAN").stadium;
  assert.equal(stadium.renovationHistory.length, 1);
  assert.equal(stadium.renovationHistory[0].projectId, started.project.id);
  assert.equal(stadium.matchHistory.length, 120);
  assert.equal(stadium.matchHistory.some(({ fixtureId }) => fixtureId === "BR-A-HISTORY-1"), false);
  assert.equal(stadium.matchHistory.some(({ fixtureId }) => fixtureId === "BR-A-HISTORY-121"), true);
  assert.equal(stadium.history.some(({ projectId }) => projectId === started.project.id), true);
});

test("niveis de infraestrutura produzem efeitos reais", () => {
  const room = roomFixture();
  const facility = facilityForClub(room, "SAN");
  const baseline = facilityEffectsForClub(room, "SAN");
  facility.areas.find((area) => area.id === "training").level = 5;
  facility.areas.find((area) => area.id === "medical").level = 5;
  facility.areas.find((area) => area.id === "recovery").level = 5;
  const improved = facilityEffectsForClub(room, "SAN");

  assert.ok(improved.developmentMultiplier > baseline.developmentMultiplier);
  assert.ok(improved.injuryRiskMultiplier < baseline.injuryRiskMultiplier);
  assert.ok(improved.recoveryBonus > baseline.recoveryBonus);
});

test("clubes exclusivos de torneio recebem instalacoes e economia de jogo", () => {
  const room = roomFixture();
  room.tournamentCatalog = [{
    id: "CUP",
    participants: [{
      id: "EXC",
      name: "Exclusivo FC",
      reputation: 12,
      stadium: "Arena Exclusiva",
      stadiumCapacity: 22_000,
    }],
  }];

  ensureClubFacilities(room, "2026-07-01T00:00:00.000Z");
  const facility = facilityForClub(room, "EXC");
  const economy = calculateMatchdayEconomy(room, {
    fixtureId: "CUP-R1-EXC-SAN",
    homeClubId: "EXC",
    awayClubId: "SAN",
    competitionId: "CUP",
    occurredAt: "2026-07-12T20:00:00.000Z",
  });

  assert.equal(facility.stadium.name, "Arena Exclusiva");
  assert.equal(economy.capacity, 22_000);
  assert.ok(economy.netRevenue > 0);
});

test("cobertura iluminacao estacionamento e administracao afetam a renda factual", () => {
  const room = roomFixture();
  const facility = facilityForClub(room, "SAN");
  facility.stadium.coverage = 0;
  facility.stadium.lighting = 0;
  facility.stadium.parking = 0;
  facility.areas.find((area) => area.id === "administration").level = 0;
  const input = {
    fixtureId: "BR-A-R1-SAN-PAL",
    homeClubId: "SAN",
    awayClubId: "PAL",
    occurredAt: "2026-07-12T22:00:00.000Z",
  };
  const baseline = calculateMatchdayEconomy(room, input);

  facility.stadium.coverage = 100;
  facility.stadium.lighting = 100;
  facility.stadium.parking = 100;
  facility.areas.find((area) => area.id === "administration").level = 5;
  const improved = calculateMatchdayEconomy(room, input);
  const originalOperatingCost = improved.operatingCost;
  facility.stadium.maintenanceCost += 100_000_000;
  const afterMaintenanceChange = calculateMatchdayEconomy(room, input);

  assert.ok(improved.attendance > baseline.attendance);
  assert.ok(improved.grossRevenue > baseline.grossRevenue);
  assert.ok(improved.administrationDiscount > baseline.administrationDiscount);
  assert.ok(improved.operatingCost < Math.round(improved.attendance * 4.5));
  assert.equal(afterMaintenanceChange.operatingCost, originalOperatingCost, "manutencao fixa nao volta a ser cobrada no jogo");
});
