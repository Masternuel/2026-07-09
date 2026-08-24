import assert from "node:assert/strict";
import test from "node:test";
import {
  STAFF_ATTRIBUTE_KEYS,
  STAFF_ROLES,
  StaffError,
  calculateStaffEffects,
  calculateTerminationPenalty,
  ensureStaffState,
  fireStaff,
  hireStaff,
  processStaffContractExpirations,
  retireStaff,
  renewStaffContract,
  separateStaffByAgreement,
  setStaffCoachLink,
  staffSnapshotForClub,
  validateStaffState,
} from "../game/staffEngine.mjs";
import { processClubCareerDate } from "../game/clubCareerSystem.mjs";

const NOW = "2026-07-21T12:00:00.000Z";

function roomFixture({ twoManagedClubs = false } = {}) {
  return {
    code: "STAFF01",
    currentSeason: 2,
    managers: [
      { id: "manager-a", clubId: "A" },
      ...(twoManagedClubs ? [{ id: "manager-b", clubId: "B" }] : []),
    ],
    competitionCatalog: [{
      id: "league-a",
      country: "Brasil",
      clubs: [
        { id: "A", name: "Aurora", country: "Brasil" },
        { id: "B", name: "Boreal", country: "Argentina" },
      ],
    }],
    clubCareerState: {
      keepMe: { untouched: true },
    },
  };
}

function activeContractsFor(room, staffId) {
  return room.clubCareerState.staffContracts.filter((contract) => (
    contract.staffId === staffId && contract.status === "active"
  ));
}

test("migra save, cria comissão e candidatos determinísticos sem apagar estado vizinho", () => {
  const original = roomFixture();
  const first = ensureStaffState(original, { now: NOW });
  const repeated = ensureStaffState(first, { now: NOW });
  const independent = ensureStaffState(roomFixture(), { now: NOW });

  assert.deepEqual(first, independent);
  assert.deepEqual(repeated, first);
  assert.deepEqual(first.clubCareerState.keepMe, { untouched: true });
  assert.equal(first.clubCareerState.staffMembers.length, STAFF_ROLES.length * 2);
  assert.equal(first.clubCareerState.staffCandidates.length, STAFF_ROLES.length * 2);
  assert.equal(first.clubCareerState.staffContracts.filter((contract) => contract.status === "active").length, STAFF_ROLES.length * 2);
  assert.equal(first.clubCareerState.staffEffectsByClub.A.memberCount, STAFF_ROLES.length);
  assert.equal(first.clubCareerState.staffEffectsByClub.B.memberCount, STAFF_ROLES.length);
  assert.notStrictEqual(first, original);
  assert.equal(original.clubCareerState.staffMembers, undefined);
  assert.equal(validateStaffState(first, NOW), true);
});

test("clube da IA mantém comissão, efeitos e folha depois do reload", () => {
  const initialized = ensureStaffState(roomFixture(), { now: NOW });
  const aiMembers = initialized.clubCareerState.staffMembers.filter(({ clubId }) => clubId === "B");
  const aiContracts = initialized.clubCareerState.staffContracts.filter(({ clubId, status }) => (
    clubId === "B" && status === "active"
  ));
  const effectsBeforeReload = calculateStaffEffects(initialized, "B", NOW);

  assert.equal(aiMembers.length, STAFF_ROLES.length);
  assert.equal(aiContracts.length, STAFF_ROLES.length);
  assert.equal(effectsBeforeReload.memberCount, STAFF_ROLES.length);
  assert.ok(effectsBeforeReload.monthlyCost > 0);

  const reloaded = ensureStaffState(JSON.parse(JSON.stringify(initialized)), { now: NOW });
  assert.deepEqual(
    reloaded.clubCareerState.staffMembers.filter(({ clubId }) => clubId === "B"),
    aiMembers,
  );
  assert.deepEqual(calculateStaffEffects(reloaded, "B", NOW), effectsBeforeReload);

  const closed = processClubCareerDate(reloaded, "2026-08-10T12:00:00.000Z");
  const aiFinance = closed.finance.find(({ clubId }) => clubId === "B");
  const aiPayroll = reloaded.clubCareerState.financialTransactions.find((transaction) => (
    transaction.clubId === "B"
    && transaction.category === "payroll"
    && transaction.periodKey === "2026-08"
  ));

  assert.ok(aiFinance);
  assert.equal(aiPayroll.metadata.staffCount, STAFF_ROLES.length);
  assert.equal(aiPayroll.metadata.staffPayroll, effectsBeforeReload.monthlyCost);

  const reloadedAfterPayroll = ensureStaffState(JSON.parse(JSON.stringify(reloaded)), {
    now: "2026-08-10T12:00:00.000Z",
  });
  assert.equal(
    reloadedAfterPayroll.clubCareerState.staffMembers.filter(({ clubId }) => clubId === "B").length,
    STAFF_ROLES.length,
  );
  assert.equal(
    reloadedAfterPayroll.clubCareerState.staffContracts.filter(({ clubId, status }) => (
      clubId === "B" && status === "active"
    )).length,
    STAFF_ROLES.length,
  );
});

test("normaliza funcionário legado, cargo, atributos e contrato textual", () => {
  const room = roomFixture();
  room.clubCareerState = {
    keepMe: true,
    staffInitializedClubIds: ["A"],
    staff: [{
      id: "legacy-renata",
      name: "Renata Campos",
      role: "Preparadora física",
      rating: 9.1,
      clubId: "A",
      contract: "Dez/2028",
      salary: 82_000,
    }],
  };

  const migrated = ensureStaffState(room, { now: NOW });
  const member = migrated.clubCareerState.staffMembers.find((entry) => entry.id === "legacy-renata");
  const contract = activeContractsFor(migrated, member.id)[0];

  assert.equal(migrated.clubCareerState.keepMe, true);
  assert.equal(member.role, "fitness_coach");
  assert.deepEqual(Object.keys(member.attributes), [...STAFF_ATTRIBUTE_KEYS]);
  assert.equal(contract.endDate, "2028-12-31T23:59:59.999Z");
  assert.equal(contract.wage, 82_000);
  assert.equal(validateStaffState(migrated, NOW), true);
});

test("migração preserva contrato indicado pelo funcionário quando existem ativos duplicados", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  const member = room.clubCareerState.staffMembers[0];
  const oldContract = activeContractsFor(room, member.id)[0];
  const preferred = {
    ...oldContract,
    id: `${oldContract.id}:preferred`,
    startDate: "2026-07-20T00:00:00.000Z",
    endDate: "2030-07-20T00:00:00.000Z",
    wage: oldContract.wage + 25_000,
  };
  room.clubCareerState.staffContracts.push(preferred);
  member.contractId = preferred.id;

  const migrated = ensureStaffState(room, { now: NOW });
  const migratedMember = migrated.clubCareerState.staffMembers.find((candidate) => candidate.id === member.id);

  assert.equal(activeContractsFor(migrated, member.id).length, 1);
  assert.equal(migratedMember.contractId, preferred.id);
  assert.equal(migratedMember.salary, preferred.wage);
  assert.equal(migrated.clubCareerState.staffContracts.find((candidate) => candidate.id === oldContract.id).status, "replaced");
});

test("migra schema v2 preservando vínculos, disponibilidade, interinidade e ciclo contratual", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  room.clubCareerState.staffSchemaVersion = 1;
  const [notice, onLeave, retiring] = room.clubCareerState.staffMembers.filter(({ clubId }) => clubId === "A").slice(0, 3);
  notice.status = "notice";
  notice.affiliationType = "personal_staff";
  notice.linkedCoachId = "coach-emanuel";
  notice.affinity = 84;
  notice.sharedJobs = 4;
  notice.preferredByCoachIds = ["coach-emanuel", "coach-other"];
  notice.availability = {
    status: "notice",
    availableFrom: null,
    unavailableUntil: null,
    effectiveAt: "2026-08-15T12:00:00.000Z",
    reason: "coach_departure",
    compensation: 0,
  };
  notice.interimAssignment = {
    id: "interim-notice",
    clubId: "A",
    role: "head_coach",
    startsAt: "2026-07-20T12:00:00.000Z",
    endsAt: "2026-08-01T12:00:00.000Z",
    status: "active",
    temporaryBonus: 25_000,
    authorityLevel: 70,
    sourceCoachId: "coach-emanuel",
  };
  onLeave.status = "on_leave";
  retiring.status = "retiring";
  retiring.availability = {
    status: "retiring",
    effectiveAt: "2027-01-01T12:00:00.000Z",
    reason: "retirement",
  };
  const noticeContract = activeContractsFor(room, notice.id)[0];
  noticeContract.bonuses = { title: 100_000, promotion: 50_000 };
  noticeContract.severance = { type: "fixed", amount: 300_000, rate: 0, months: 0 };
  noticeContract.clauses = ["confidentiality", { type: "release", amount: 450_000 }];
  noticeContract.benefits = ["housing"];
  noticeContract.lifecycleStatus = "notice";

  const migrated = ensureStaffState(room, { now: NOW });
  const migratedNotice = migrated.clubCareerState.staffMembers.find(({ id }) => id === notice.id);
  const migratedContract = migrated.clubCareerState.staffContracts.find(({ id }) => id === noticeContract.id);

  assert.equal(migrated.clubCareerState.staffSchemaVersion, 2);
  assert.equal(migratedNotice.status, "notice");
  assert.equal(migratedNotice.affiliationType, "personal_team");
  assert.equal(migratedNotice.linkedCoachId, "coach-emanuel");
  assert.equal(migratedNotice.affinity, 84);
  assert.equal(migratedNotice.sharedJobs, 4);
  assert.deepEqual(migratedNotice.preferredByCoachIds, ["coach-emanuel", "coach-other"]);
  assert.equal(migratedNotice.availability.status, "notice");
  assert.equal(migratedNotice.interimAssignment.id, "interim-notice");
  assert.equal(migratedNotice.interimAssignment.startedAt, "2026-07-20T12:00:00.000Z");
  assert.equal(migratedContract.lifecycleStatus, "notice");
  assert.deepEqual(migratedContract.bonuses, { title: 100_000, promotion: 50_000 });
  assert.deepEqual(migratedContract.severance, { type: "fixed", amount: 300_000, rate: 0, months: 0 });
  assert.equal(calculateTerminationPenalty(migratedContract, NOW), 300_000);
  assert.equal(
    migrated.clubCareerState.staffCandidates.some(({ id }) => [notice.id, onLeave.id, retiring.id].includes(id)),
    false,
  );
  assert.deepEqual(
    [notice.id, onLeave.id, retiring.id].map((id) => (
      migrated.clubCareerState.staffMembers.find((member) => member.id === id).status
    )),
    ["notice", "on_leave", "retiring"],
  );
  assert.equal(validateStaffState(migrated, NOW), true);
});

test("atualiza vínculo com treinador de forma pura e idempotente", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  const original = structuredClone(room);
  const member = room.clubCareerState.staffMembers.find(({ clubId }) => clubId === "A");
  const events = [];
  const input = {
    operationId: "staff-link-coach-001",
    staffId: member.id,
    affiliationType: "coach_recommended",
    linkedCoachId: "coach-emanuel",
    affinity: 91,
    sharedJobs: 6,
    preferredByCoachIds: ["coach-emanuel"],
  };
  const first = setStaffCoachLink(room, input, {
    now: NOW,
    recordCareerEvent: (_nextRoom, event) => events.push(event),
  });
  const repeated = setStaffCoachLink(first.room, input, {
    now: NOW,
    recordCareerEvent: (_nextRoom, event) => events.push(event),
  });

  assert.deepEqual(room, original);
  assert.equal(first.member.affiliationType, "coach_recommended");
  assert.equal(first.member.linkedCoachId, "coach-emanuel");
  assert.equal(first.member.affinity, 91);
  assert.equal(first.member.sharedJobs, 6);
  assert.deepEqual(first.member.preferredByCoachIds, ["coach-emanuel"]);
  assert.equal(first.event.type, "STAFF_COACH_LINK_UPDATED");
  assert.equal(first.financialTransactions.length, 0);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.room.clubCareerState.staffHistory.length, first.room.clubCareerState.staffHistory.length);
  assert.equal(events.length, 1);
});

test("contrata candidato, persiste contrato, finanças, histórico e efeitos", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  const original = structuredClone(room);
  const candidate = room.clubCareerState.staffCandidates.find((entry) => entry.role === "scout");
  const transactions = [];
  const careerEvents = [];
  const result = hireStaff(room, {
    operationId: "hire:scout:001",
    clubId: "A",
    staffId: candidate.id,
    wage: 120_000,
    years: 3,
    signingBonus: 240_000,
  }, {
    now: NOW,
    postFinancialTransaction: (_nextRoom, transaction) => transactions.push(transaction),
    recordCareerEvent: (_nextRoom, event) => careerEvents.push(event),
  });

  assert.deepEqual(room, original);
  assert.equal(result.duplicate, false);
  assert.equal(result.member.clubId, "A");
  assert.equal(result.contract.status, "active");
  assert.equal(result.contract.wage, 120_000);
  assert.equal(result.event.type, "STAFF_HIRED");
  assert.equal(result.financialTransactions.length, 1);
  assert.equal(result.financialTransactions[0].originId, "hire:scout:001");
  assert.equal(transactions.length, 1);
  assert.equal(careerEvents.length, 1);
  assert.equal(result.room.clubCareerState.staffCandidates.some((entry) => entry.id === candidate.id), false);
  assert.equal(result.room.clubCareerState.staffEffectsByClub.A.sourceStaffIds.includes(candidate.id), true);
  assert.equal(validateStaffState(result.room, NOW), true);

  const repeated = hireStaff(result.room, {
    operationId: "hire:scout:001",
    clubId: "A",
    staffId: candidate.id,
    wage: 120_000,
    years: 3,
  }, {
    now: NOW,
    postFinancialTransaction: () => transactions.push("duplicate"),
    recordCareerEvent: () => careerEvents.push("duplicate"),
  });
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.room.clubCareerState.staffHistory.length, result.room.clubCareerState.staffHistory.length);
  assert.equal(transactions.length, 1);
  assert.equal(careerEvents.length, 1);
});

test("compra funcionário de outro clube e mantém um único vínculo ativo", () => {
  const room = ensureStaffState(roomFixture({ twoManagedClubs: true }), { now: NOW });
  const source = room.clubCareerState.staffMembers.find((entry) => entry.clubId === "A" && entry.role === "doctor");
  const oldContract = activeContractsFor(room, source.id)[0];
  const expectedCompensation = calculateTerminationPenalty(oldContract, NOW);
  const transactions = [];
  const result = hireStaff(room, {
    operationId: "transfer-staff-a-b",
    clubId: "B",
    staffId: source.id,
    wage: oldContract.wage + 10_000,
    years: 4,
    signingBonus: 50_000,
  }, {
    now: NOW,
    postFinancialTransaction: (_nextRoom, transaction) => transactions.push(transaction),
  });

  assert.equal(result.member.clubId, "B");
  assert.equal(activeContractsFor(result.room, source.id).length, 1);
  assert.equal(result.room.clubCareerState.staffContracts.find((entry) => entry.id === oldContract.id).status, "terminated");
  assert.equal(result.event.metadata.compensation, expectedCompensation);
  assert.deepEqual(transactions.map((entry) => entry.type).sort(), ["expense", "income"]);
  assert.equal(transactions.find((entry) => entry.type === "income").clubId, "A");
  assert.equal(validateStaffState(result.room, NOW), true);
});

test("demite, aplica multa e devolve profissional ao mercado", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  const member = room.clubCareerState.staffMembers.find((entry) => entry.role === "assistant_coach");
  const contract = activeContractsFor(room, member.id)[0];
  const expectedPenalty = Math.round(calculateTerminationPenalty(contract, NOW) * 0.5);
  const beforeEffects = calculateStaffEffects(room, "A", NOW);
  const result = fireStaff(room, {
    operationId: "fire-assistant-001",
    clubId: "A",
    staffId: member.id,
    mutualAgreement: true,
  }, { now: NOW });

  assert.equal(result.event.type, "STAFF_FIRED");
  assert.equal(result.event.amount, expectedPenalty);
  assert.equal(result.room.clubCareerState.staffMembers.some((entry) => entry.id === member.id), false);
  assert.equal(result.room.clubCareerState.staffCandidates.find((entry) => entry.id === member.id).status, "free_agent");
  assert.equal(result.room.clubCareerState.staffContracts.find((entry) => entry.id === contract.id).status, "terminated");
  assert.equal(result.room.clubCareerState.staffEffectsByClub.A.memberCount, beforeEffects.memberCount - 1);
  assert.equal(validateStaffState(result.room, NOW), true);
});

test("encerra vínculo por acordo com compensação, histórico e idempotência", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  const original = structuredClone(room);
  const member = room.clubCareerState.staffMembers.find((entry) => (
    entry.clubId === "A" && entry.role === "football_director"
  ));
  const contract = activeContractsFor(room, member.id)[0];
  const expectedCompensation = Math.round(calculateTerminationPenalty(contract, NOW) * 0.5);
  const transactions = [];
  const events = [];
  const input = {
    operationId: "staff-agreement-001",
    clubId: "A",
    staffId: member.id,
    reason: "strategic_change",
    agreementTerms: { confidentiality: true },
  };
  const first = separateStaffByAgreement(room, input, {
    now: NOW,
    postFinancialTransaction: (_nextRoom, transaction) => transactions.push(transaction),
    recordCareerEvent: (_nextRoom, event) => events.push(event),
  });
  const repeated = separateStaffByAgreement(first.room, input, {
    now: NOW,
    postFinancialTransaction: (_nextRoom, transaction) => transactions.push(transaction),
    recordCareerEvent: (_nextRoom, event) => events.push(event),
  });

  assert.deepEqual(room, original);
  assert.equal(first.member.status, "free_agent");
  assert.equal(first.member.clubId, null);
  assert.equal(first.contract.id, contract.id);
  assert.equal(first.contract.status, "terminated");
  assert.equal(first.contract.lifecycleStatus, "separated");
  assert.equal(first.event.type, "STAFF_SEPARATED_BY_AGREEMENT");
  assert.equal(first.event.amount, expectedCompensation);
  assert.equal(first.financialTransactions[0].category, "staff_mutual_separation");
  assert.equal(first.room.clubCareerState.staffMembers.some(({ id }) => id === member.id), false);
  assert.equal(first.room.clubCareerState.staffCandidates.some(({ id }) => id === member.id), true);
  assert.equal(repeated.duplicate, true);
  assert.equal(transactions.length, 1);
  assert.equal(events.length, 1);
  assert.equal(validateStaffState(repeated.room, NOW), true);
});

test("aposenta profissional sem devolvê-lo ao pool livre e não repete efeitos", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  const original = structuredClone(room);
  const member = room.clubCareerState.staffMembers.find((entry) => (
    entry.clubId === "A" && entry.role === "goalkeeper_coach"
  ));
  const beforeEffects = calculateStaffEffects(room, "A", NOW);
  const transactions = [];
  const input = {
    operationId: "staff-retire-001",
    clubId: "A",
    staffId: member.id,
    compensation: 40_000,
  };
  const first = retireStaff(room, input, {
    now: NOW,
    postFinancialTransaction: (_nextRoom, transaction) => transactions.push(transaction),
  });
  const repeated = retireStaff(first.room, input, {
    now: NOW,
    postFinancialTransaction: (_nextRoom, transaction) => transactions.push(transaction),
  });
  const reloaded = ensureStaffState(JSON.parse(JSON.stringify(repeated.room)), { now: NOW });
  const retired = reloaded.clubCareerState.staffMembers.find(({ id }) => id === member.id);

  assert.deepEqual(room, original);
  assert.equal(first.event.type, "STAFF_RETIRED");
  assert.equal(first.member.status, "retired");
  assert.equal(first.member.contractId, null);
  assert.equal(first.member.availability.status, "retired");
  assert.equal(first.contract.status, "terminated");
  assert.equal(first.contract.lifecycleStatus, "retired");
  assert.equal(first.financialTransactions[0].category, "staff_retirement");
  assert.equal(first.room.clubCareerState.staffCandidates.some(({ id }) => id === member.id), false);
  assert.equal(retired.status, "retired");
  assert.equal(reloaded.clubCareerState.staffCandidates.some(({ id }) => id === member.id), false);
  assert.equal(reloaded.clubCareerState.staffContracts.filter(({ staffId }) => staffId === member.id).length, 1);
  assert.equal(calculateStaffEffects(reloaded, "A", NOW).memberCount, beforeEffects.memberCount - 1);
  assert.equal(repeated.duplicate, true);
  assert.equal(transactions.length, 1);
  assert.throws(() => hireStaff(reloaded, {
    operationId: "rehire-retired-001",
    clubId: "B",
    staffId: member.id,
  }, { now: NOW }), (error) => error instanceof StaffError && error.code === "STAFF_RETIRED");
  assert.equal(validateStaffState(reloaded, NOW), true);
});

test("aposentadoria anunciada conclui na data prevista uma única vez", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  const member = room.clubCareerState.staffMembers.find((entry) => (
    entry.clubId === "A" && entry.role === "doctor"
  ));
  activeContractsFor(room, member.id)[0].endDate = "2026-07-25T12:00:00.000Z";
  const announced = retireStaff(room, {
    operationId: "staff-retire-scheduled-001",
    clubId: "A",
    staffId: member.id,
    effectiveAt: "2026-08-01T12:00:00.000Z",
  }, { now: NOW });
  const awaitingRetirement = processStaffContractExpirations(announced.room, {
    now: "2026-07-25T12:00:00.000Z",
  });
  const completed = processStaffContractExpirations(awaitingRetirement.room, {
    now: "2026-08-01T12:00:00.000Z",
  });
  const repeated = processStaffContractExpirations(completed.room, {
    now: "2026-08-01T12:00:00.000Z",
  });

  assert.equal(announced.member.status, "retiring");
  assert.equal(announced.contract.lifecycleStatus, "retiring");
  assert.equal(announced.event.type, "STAFF_RETIREMENT_ANNOUNCED");
  assert.deepEqual(awaitingRetirement.expiredStaffIds, [member.id]);
  assert.equal(
    awaitingRetirement.room.clubCareerState.staffMembers.find(({ id }) => id === member.id).status,
    "retiring",
  );
  assert.equal(awaitingRetirement.room.clubCareerState.staffCandidates.some(({ id }) => id === member.id), false);
  assert.deepEqual(completed.retiredStaffIds, [member.id]);
  assert.equal(completed.events[0].type, "STAFF_RETIRED");
  assert.equal(completed.room.clubCareerState.staffCandidates.some(({ id }) => id === member.id), false);
  assert.deepEqual(repeated.retiredStaffIds, []);
  assert.equal(validateStaffState(repeated.room, "2026-08-01T12:00:00.000Z"), true);
});

test("renova contrato substituindo o anterior e cobrando bônus uma vez", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  const member = room.clubCareerState.staffMembers.find((entry) => entry.role === "youth_coach");
  const previous = activeContractsFor(room, member.id)[0];
  const result = renewStaffContract(room, {
    operationId: "renew-youth-001",
    clubId: "A",
    staffId: member.id,
    wage: 175_000,
    years: 5,
    renewalBonus: 90_000,
  }, { now: NOW });

  assert.equal(result.event.type, "STAFF_CONTRACT_RENEWED");
  assert.equal(result.contract.wage, 175_000);
  assert.equal(activeContractsFor(result.room, member.id).length, 1);
  assert.equal(result.room.clubCareerState.staffContracts.find((entry) => entry.id === previous.id).status, "replaced");
  assert.equal(result.room.clubCareerState.staffMembers.find((entry) => entry.id === member.id).contractId, result.contract.id);
  assert.equal(result.financialTransactions[0].amount, 90_000);
  assert.equal(validateStaffState(result.room, NOW), true);
});

test("vence contrato automaticamente e não repete evento", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  const member = room.clubCareerState.staffMembers.find((entry) => entry.role === "physiotherapist");
  const contract = activeContractsFor(room, member.id)[0];
  contract.endDate = "2026-07-20T12:00:00.000Z";
  const careerEvents = [];
  const first = processStaffContractExpirations(room, {
    now: NOW,
    recordCareerEvent: (_nextRoom, event) => careerEvents.push(event),
  });
  const repeated = processStaffContractExpirations(first.room, {
    now: NOW,
    recordCareerEvent: (_nextRoom, event) => careerEvents.push(event),
  });

  assert.deepEqual(first.expiredStaffIds, [member.id]);
  assert.equal(first.events[0].type, "STAFF_CONTRACT_EXPIRED");
  assert.equal(first.room.clubCareerState.staffContracts.find((entry) => entry.id === contract.id).status, "expired");
  assert.equal(first.room.clubCareerState.staffCandidates.some((entry) => entry.id === member.id), true);
  assert.deepEqual(repeated.expiredStaffIds, []);
  assert.equal(careerEvents.length, 1);
  assert.equal(validateStaffState(repeated.room, NOW), true);
});

test("renova contrato vencido da IA sem perder folha, efeito ou acumular histórico contratual", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  const member = room.clubCareerState.staffMembers.find((entry) => (
    entry.clubId === "B" && entry.role === "performance_analyst"
  ));
  const contract = activeContractsFor(room, member.id)[0];
  const before = calculateStaffEffects(room, "B", NOW);
  contract.endDate = "2026-07-20T12:00:00.000Z";
  const careerEvents = [];

  const first = processStaffContractExpirations(room, {
    now: NOW,
    recordCareerEvent: (_nextRoom, event) => careerEvents.push(event),
  });
  const repeated = processStaffContractExpirations(first.room, {
    now: NOW,
    recordCareerEvent: (_nextRoom, event) => careerEvents.push(event),
  });
  const reloaded = ensureStaffState(JSON.parse(JSON.stringify(repeated.room)), { now: NOW });
  const renewed = activeContractsFor(reloaded, member.id)[0];

  assert.deepEqual(first.renewedStaffIds, [member.id]);
  assert.deepEqual(first.expiredStaffIds, []);
  assert.equal(first.events[0].type, "STAFF_CONTRACT_RENEWED");
  assert.equal(first.events[0].metadata.aiControlled, true);
  assert.notEqual(renewed.id, contract.id);
  assert.equal(reloaded.clubCareerState.staffContracts.find(({ id }) => id === contract.id).status, "replaced");
  assert.equal(
    reloaded.clubCareerState.staffContracts.filter(({ staffId }) => staffId === member.id).length,
    2,
  );
  assert.equal(calculateStaffEffects(reloaded, "B", NOW).memberCount, before.memberCount);
  assert.ok(calculateStaffEffects(reloaded, "B", NOW).monthlyCost >= before.monthlyCost);
  assert.deepEqual(repeated.renewedStaffIds, []);
  assert.equal(careerEvents.length, 1);
  assert.equal(validateStaffState(reloaded, NOW), true);
});

test("encerra contrato vencido sem funcionário correspondente", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  const member = room.clubCareerState.staffMembers[0];
  const contract = activeContractsFor(room, member.id)[0];
  contract.endDate = "2026-07-20T12:00:00.000Z";
  room.clubCareerState.staffMembers = room.clubCareerState.staffMembers.filter((candidate) => candidate.id !== member.id);

  const result = processStaffContractExpirations(room, { now: NOW });

  assert.equal(result.room.clubCareerState.staffContracts.find((candidate) => candidate.id === contract.id).status, "expired");
  assert.equal(result.events[0].staffId, member.id);
  assert.equal(result.events[0].metadata.orphanedContract, true);
});

test("falha de validação ou callback não altera save de entrada", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  const before = structuredClone(room);
  assert.throws(() => hireStaff(room, {
    operationId: "invalid-hire",
    clubId: "A",
    staffId: "missing",
  }, { now: NOW }), (error) => error instanceof StaffError && error.code === "STAFF_NOT_FOUND");
  assert.deepEqual(room, before);

  const candidate = room.clubCareerState.staffCandidates[0];
  assert.throws(() => hireStaff(room, {
    operationId: "callback-fails",
    clubId: "A",
    staffId: candidate.id,
    years: 2,
  }, {
    now: NOW,
    postFinancialTransaction: () => { throw new Error("finance unavailable"); },
  }), /finance unavailable/u);
  assert.deepEqual(room, before);
});

test("snapshot expõe membros, candidatos, contratos, histórico e efeitos do clube", () => {
  const room = ensureStaffState(roomFixture(), { now: NOW });
  const snapshot = staffSnapshotForClub(room, "a", { now: NOW });

  assert.equal(snapshot.clubId, "a");
  assert.equal(snapshot.members.length, STAFF_ROLES.length);
  assert.equal(snapshot.contracts.filter((entry) => entry.status === "active").length, STAFF_ROLES.length);
  assert.equal(snapshot.candidates.length, STAFF_ROLES.length * 2);
  assert.equal(snapshot.effects.memberCount, STAFF_ROLES.length);
  assert.deepEqual(snapshot.history, []);
});
