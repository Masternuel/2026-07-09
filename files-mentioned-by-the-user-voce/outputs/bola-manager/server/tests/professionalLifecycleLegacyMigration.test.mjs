import assert from "node:assert/strict";
import test from "node:test";
import { ensureProfessionalLifecycleState } from "../game/professionalLifecycle.mjs";
import {
  migrateLegacyProfessionalLifecycle,
  reconstructLegacyProfessionalLifecycle,
} from "../game/professionalLifecycleLegacyMigration.mjs";

const NOW = "2026-07-28T12:00:00.000Z";

function legacyRoom() {
  return {
    code: "LEGACY-LIFECYCLE",
    createdAt: "2026-01-01T00:00:00.000Z",
    coachCareerState: {
      coaches: [{
        id: "coach-notice",
        name: "Treinador em aviso",
        status: "notice",
        currentClubId: "club-a",
        updatedAt: "2026-07-01T10:00:00.000Z",
      }, {
        id: "coach-retired",
        name: "Treinador aposentado",
        status: "retired",
        currentClubId: null,
        updatedAt: "2026-06-30T18:00:00.000Z",
      }, {
        id: "coach-mutual",
        name: "Treinador separado",
        status: "available",
        currentClubId: null,
        assignments: [{
          clubId: "club-c",
          role: "head_coach",
          contractId: "coach-contract-mutual",
          startedAt: "2025-01-01T00:00:00.000Z",
          endedAt: "2026-05-10T15:00:00.000Z",
          exitReason: "mutual_agreement",
        }],
      }],
    },
    coachEmploymentState: {
      currentDate: NOW,
      contracts: [{
        id: "coach-contract-notice",
        coachId: "coach-notice",
        clubId: "club-a",
        role: "head_coach",
        status: "active",
        lifecycleStatus: "notice",
        noticeId: "legacy-coach-notice",
        noticeStartDate: "2026-07-01T10:00:00.000Z",
        noticeEndDate: "2026-07-31T10:00:00.000Z",
        noticeReason: "change_of_project",
        startDate: "2025-01-01T00:00:00.000Z",
        endDate: "2026-12-31T00:00:00.000Z",
      }, {
        id: "coach-contract-retired",
        coachId: "coach-retired",
        clubId: "club-b",
        role: "head_coach",
        status: "ended",
        lifecycleStatus: "retired",
        retirementId: "legacy-coach-retirement",
        retirementAnnouncedAt: "2026-03-01T09:00:00.000Z",
        endedAt: "2026-06-30T18:00:00.000Z",
        endReason: "retirement",
      }, {
        id: "coach-contract-mutual",
        coachId: "coach-mutual",
        clubId: "club-c",
        role: "head_coach",
        status: "ended",
        lifecycleStatus: "separated",
        mutualAgreementId: "legacy-coach-mutual",
        endedAt: "2026-05-10T15:00:00.000Z",
        endReason: "mutual_agreement",
        terms: { compensation: 75_000 },
      }],
      appointments: [{
        id: "appointment-coach-mutual",
        coachId: "coach-mutual",
        clubId: "club-c",
        role: "head_coach",
        contractId: "coach-contract-mutual",
        status: "ended",
        endedAt: "2026-05-10T15:00:00.000Z",
        exitReason: "mutual_agreement",
      }],
    },
    clubCareerState: {
      currentDate: NOW,
      staffMembers: [{
        id: "staff-retiring",
        name: "Auxiliar em aposentadoria",
        role: "assistant_coach",
        clubId: "club-a",
        status: "retiring",
        updatedAt: "2026-07-15T08:00:00.000Z",
        availability: {
          status: "retiring",
          effectiveAt: "2026-12-31T18:00:00.000Z",
          reason: "end_of_career",
        },
      }, {
        id: "staff-mutual",
        name: "Preparador separado",
        role: "fitness_coach",
        clubId: null,
        status: "available",
        professionalHistory: [{
          clubId: "club-d",
          role: "fitness_coach",
          contractId: "staff-contract-mutual",
          endedAt: "2026-04-20T16:00:00.000Z",
          endReason: "mutual_agreement",
        }],
      }],
      staffCandidates: [],
      staffContracts: [{
        id: "staff-contract-retiring",
        staffId: "staff-retiring",
        clubId: "club-a",
        role: "assistant_coach",
        status: "active",
        lifecycleStatus: "retiring",
        retirementId: "legacy-staff-retirement",
        retirementAnnouncedAt: "2026-07-15T08:00:00.000Z",
        endDate: "2026-12-31T18:00:00.000Z",
      }, {
        id: "staff-contract-mutual",
        staffId: "staff-mutual",
        clubId: "club-d",
        role: "fitness_coach",
        status: "ended",
        lifecycleStatus: "separated",
        mutualAgreementId: "legacy-staff-mutual",
        endedAt: "2026-04-20T16:00:00.000Z",
        endReason: "mutual_agreement",
        agreementTerms: { compensation: 90_000 },
      }],
      staffHistory: [{
        id: "staff-history-mutual",
        type: "STAFF_SEPARATED_BY_AGREEMENT",
        staffId: "staff-mutual",
        clubId: "club-d",
        contractId: "staff-contract-mutual",
        agreementId: "legacy-staff-mutual",
        occurredAt: "2026-04-20T16:00:00.000Z",
        amount: 120_000,
        reason: "mutual_agreement",
      }],
    },
  };
}

function mergeMigration(room, migration) {
  const existing = room.professionalLifecycleState ?? {};
  return {
    ...structuredClone(room),
    professionalLifecycleState: {
      ...structuredClone(existing),
      version: 1,
      currentDate: migration.currentDate,
      notices: [...(existing.notices ?? []), ...migration.notices],
      retirements: [...(existing.retirements ?? []), ...migration.retirements],
      mutualAgreements: [...(existing.mutualAgreements ?? []), ...migration.mutualAgreements],
      transitions: [...(existing.transitions ?? []), ...migration.transitions],
      timeline: [...(existing.timeline ?? []), ...migration.timeline],
      processedOperationIds: [
        ...(existing.processedOperationIds ?? []),
        ...migration.processedOperationIds,
      ],
    },
  };
}

test("reconstroi ciclos legados com IDs, datas e contratos preservados", () => {
  const room = legacyRoom();
  const original = structuredClone(room);
  const migration = migrateLegacyProfessionalLifecycle(room);

  assert.deepEqual(room, original, "migracao deve ser pura");
  assert.deepEqual(migration, migrateLegacyProfessionalLifecycle(room), "resultado deve ser deterministico");
  assert.deepEqual(migration, reconstructLegacyProfessionalLifecycle(room), "alias deve manter contrato publico");

  assert.equal(migration.notices.length, 1);
  assert.equal(migration.retirements.length, 2);
  assert.equal(migration.mutualAgreements.length, 2);
  assert.equal(migration.transitions.length, 5);
  assert.equal(migration.timeline.length, 6);
  assert.equal(migration.processedOperationIds.length, 5);

  const notice = migration.notices[0];
  assert.equal(notice.id, "legacy-coach-notice");
  assert.equal(notice.contractId, "coach-contract-notice");
  assert.equal(notice.startDate, "2026-07-01T10:00:00.000Z");
  assert.equal(notice.expectedEndDate, "2026-07-31T10:00:00.000Z");
  assert.equal(notice.durationDays, 30);

  const coachRetirement = migration.retirements.find(({ professionalId }) => professionalId === "coach-retired");
  assert.equal(coachRetirement.id, "legacy-coach-retirement");
  assert.equal(coachRetirement.contractId, "coach-contract-retired");
  assert.equal(coachRetirement.announcedAt, "2026-03-01T09:00:00.000Z");
  assert.equal(coachRetirement.effectiveAt, "2026-06-30T18:00:00.000Z");
  assert.equal(coachRetirement.status, "effective");

  const staffRetirement = migration.retirements.find(({ professionalId }) => professionalId === "staff-retiring");
  assert.equal(staffRetirement.id, "legacy-staff-retirement");
  assert.equal(staffRetirement.contractId, "staff-contract-retiring");
  assert.equal(staffRetirement.effectiveAt, "2026-12-31T18:00:00.000Z");
  assert.equal(staffRetirement.status, "scheduled");
  assert.equal(staffRetirement.kind, "end_contract");

  const staffAgreement = migration.mutualAgreements.find(({ professionalId }) => professionalId === "staff-mutual");
  assert.equal(staffAgreement.id, "legacy-staff-mutual");
  assert.equal(staffAgreement.contractId, "staff-contract-mutual");
  assert.equal(staffAgreement.executedAt, "2026-04-20T16:00:00.000Z");
  assert.equal(staffAgreement.terms.compensation, 120_000, "historico mais completo complementa contrato");
  assert.equal(staffAgreement.signatures.club, staffAgreement.executedAt);
  assert.equal(staffAgreement.signatures.professional, staffAgreement.executedAt);
  assert.deepEqual(staffAgreement.migration.source, ["contract", "history", "professional_history"]);

  const normalized = ensureProfessionalLifecycleState(mergeMigration(room, migration), { now: NOW });
  assert.equal(normalized.professionalLifecycleState.notices.length, 1);
  assert.equal(normalized.professionalLifecycleState.retirements.length, 2);
  assert.equal(normalized.professionalLifecycleState.mutualAgreements.length, 2);
});

test("nao recria ciclos e auditorias ja presentes no agregado moderno", () => {
  const room = legacyRoom();
  const first = migrateLegacyProfessionalLifecycle(room);
  const migratedRoom = mergeMigration(room, first);
  const replay = migrateLegacyProfessionalLifecycle(migratedRoom);

  assert.deepEqual(replay.notices, []);
  assert.deepEqual(replay.retirements, []);
  assert.deepEqual(replay.mutualAgreements, []);
  assert.deepEqual(replay.transitions, []);
  assert.deepEqual(replay.timeline, []);
  assert.deepEqual(replay.processedOperationIds, []);
});

test("normalizacao principal aplica migracao legada uma vez e persiste marcador", () => {
  const room = legacyRoom();
  const normalized = ensureProfessionalLifecycleState(room, { now: NOW });

  assert.equal(normalized.professionalLifecycleState.legacyMigrationVersion, 1);
  assert.equal(normalized.professionalLifecycleState.notices.length, 1);
  assert.equal(normalized.professionalLifecycleState.retirements.length, 2);
  assert.equal(normalized.professionalLifecycleState.mutualAgreements.length, 2);
  assert.equal(room.professionalLifecycleState, undefined, "normalizacao deve preservar entrada");

  const replay = ensureProfessionalLifecycleState(normalized, { now: NOW });
  assert.deepEqual(replay.professionalLifecycleState, normalized.professionalLifecycleState);
});

test("rejeita payload que nao representa save", () => {
  assert.throws(() => migrateLegacyProfessionalLifecycle(null), /Save legado invalido/);
  assert.throws(() => migrateLegacyProfessionalLifecycle([]), /Save legado invalido/);
});
