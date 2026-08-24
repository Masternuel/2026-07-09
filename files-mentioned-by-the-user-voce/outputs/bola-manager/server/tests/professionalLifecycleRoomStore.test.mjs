import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

const OWNER_ID = "lifecycle-owner";
const MEMBER_ID = "lifecycle-member";
const NOW = new Date("2026-07-21T12:00:00.000Z");

function testCatalog() {
  const leagues = [{
    id: "BR-A",
    name: "Liga de ciclos",
    country: "Brasil",
    division: "Serie A",
    active: true,
    clubs: [{
      id: "AUR",
      code: "AUR",
      name: "Aurora",
      reputation: 72,
      budget: 80_000_000,
      stadium: "Estadio Aurora",
      stadiumCapacity: 28_000,
      leagueId: "BR-A",
      active: true,
    }, {
      id: "SAN",
      code: "SAN",
      name: "Santos",
      reputation: 76,
      budget: 60_000_000,
      stadium: "Vila de Teste",
      stadiumCapacity: 22_000,
      leagueId: "BR-A",
      active: true,
    }],
  }];
  return {
    leagues,
    async listCompetitionCatalog() {
      return structuredClone(leagues);
    },
    async listPlayers() {
      return { players: [], count: 0, source: "lifecycle-room-store-test" };
    },
  };
}

function createHarness() {
  const persistence = new MemoryRoomPersistence();
  const catalog = testCatalog();
  const options = {
    persistence,
    catalogStore: {
      forOwner() {
        return catalog;
      },
    },
    codeFactory: () => "LIFE-RS1",
    now: () => new Date(NOW),
  };
  return {
    persistence,
    store: new RoomStore(options),
    reload: () => new RoomStore({ ...options, codeFactory: () => "LIFE-RS2" }),
  };
}

async function startCareer(harness) {
  const created = await harness.store.createRoom({
    name: "Ciclos profissionais",
    creatorId: OWNER_ID,
    creatorName: "Owner",
    clubId: "AUR",
    activeLeagues: ["BR-A"],
    seasonLength: 2,
    maxManagers: 2,
  });
  await harness.store.joinRoom(created.code, {
    managerId: MEMBER_ID,
    managerName: "Member",
    clubId: "SAN",
  });
  await harness.store.setReady(created.code, OWNER_ID, true);
  await harness.store.setReady(created.code, MEMBER_ID, true);
  await harness.store.startRoom(created.code, OWNER_ID);
  return created.code;
}

function lifecycleState(room) {
  assert.equal(room.professionalLifecycleState?.version, 1);
  return room.professionalLifecycleState;
}

test("RoomStore persiste aviso profissional e snapshot privado apos reload", async () => {
  const harness = createHarness();
  const code = await startCareer(harness);
  const effectiveAt = "2026-08-20T12:00:00.000Z";

  const started = await harness.store.manageProfessionalLifecycle(code, OWNER_ID, {
    requestId: "room-notice:start",
    action: "notice_start",
    professionalType: "coach",
    effectiveAt,
    reason: "planned_transition",
    interviewPermission: true,
  });

  assert.equal(started.lifecycle.status, "active");
  assert.equal(started.lifecycle.expectedEndDate, effectiveAt);
  assert.equal(started.coachCareer.activeEmployment.clubId, "AUR");
  assert.equal(started.coachCareer.lifecycle.notices.length, 1);
  assert.equal(started.coachCareer.lifecycle.notices[0].id, started.lifecycle.id);

  const reloaded = harness.reload();
  const persisted = await reloaded.getRoom(code);
  const notice = lifecycleState(persisted).notices.find(({ id }) => id === started.lifecycle.id);
  assert.equal(notice.status, "active");
  assert.equal(notice.interviewAllowed, true);
  assert.equal(notice.expectedEndDate, effectiveAt);

  const privateSnapshot = await reloaded.getCoachCareerSnapshot(code, OWNER_ID);
  assert.equal(privateSnapshot.lifecycle.notices[0].id, notice.id);
  assert.equal(privateSnapshot.lifecycle.notices[0].endsAt, effectiveAt);
});

test("aviso negociado persiste como iniciativa mutua", async () => {
  const harness = createHarness();
  const code = await startCareer(harness);

  const started = await harness.store.manageProfessionalLifecycle(code, OWNER_ID, {
    requestId: "room-notice:negotiated",
    action: "notice_start",
    professionalType: "coach",
    noticeType: "negotiated",
    effectiveAt: "2026-08-20T12:00:00.000Z",
    reason: "agreed_transition",
  });

  assert.equal(started.lifecycle.initiatedBy, "mutual");
  const persisted = await harness.reload().getRoom(code);
  assert.equal(lifecycleState(persisted).notices
    .find(({ id }) => id === started.lifecycle.id)?.initiatedBy, "mutual");
});

test("aviso de treinador so termina cedo com sucessor realmente contratado", async () => {
  const harness = createHarness();
  const code = await startCareer(harness);
  const started = await harness.store.manageProfessionalLifecycle(code, OWNER_ID, {
    requestId: "room-notice:successor:start",
    action: "notice_start",
    professionalType: "coach",
    effectiveAt: "2026-08-20T12:00:00.000Z",
    reason: "planned_transition",
  });

  await assert.rejects(
    harness.store.manageProfessionalLifecycle(code, OWNER_ID, {
      requestId: "room-notice:successor:missing",
      action: "notice_end_early",
      professionalType: "coach",
      lifecycleId: started.lifecycle.id,
    }),
    { code: "PROFESSIONAL_NOTICE_SUCCESSOR_REQUIRED", status: 409 },
  );

  await harness.persistence.mutate(code, (room) => {
    room.coachCareerState.coaches.push({
      id: "successor-coach",
      name: "Treinador Sucessor",
      managerType: "ai",
      status: "unemployed",
      currentClubId: null,
      assignments: [],
    });
    room.coachEmploymentState.contracts.push({
      id: "successor-contract",
      coachId: "successor-coach",
      clubId: "AUR",
      role: "head_coach",
      status: "scheduled",
      signedAt: NOW.toISOString(),
      startDate: "2026-08-01T12:00:00.000Z",
      endDate: "2028-08-01T12:00:00.000Z",
      wage: 100_000,
    });
    room.coachEmploymentState.appointments.push({
      id: "successor-appointment",
      coachId: "successor-coach",
      clubId: "AUR",
      contractId: "successor-contract",
      role: "head_coach",
      status: "scheduled",
      appointedAt: NOW.toISOString(),
      expectedStartAt: "2026-08-01T12:00:00.000Z",
    });
    return room;
  });

  const ended = await harness.reload().manageProfessionalLifecycle(code, OWNER_ID, {
    requestId: "room-notice:successor:confirmed",
    action: "notice_end_early",
    professionalType: "coach",
    lifecycleId: started.lifecycle.id,
    substituteCoachId: "successor-coach",
    reason: "successor_confirmed",
  });
  assert.equal(ended.lifecycle.status, "ended_early");
  assert.equal(ended.lifecycle.substituteCoachId, "successor-coach");
});

test("obra de longo prazo exige aprovacao explicita durante aviso", async () => {
  const harness = createHarness();
  const code = await startCareer(harness);
  await harness.store.manageProfessionalLifecycle(code, OWNER_ID, {
    requestId: "room-notice:facility:start",
    action: "notice_start",
    professionalType: "coach",
    effectiveAt: "2026-08-20T12:00:00.000Z",
    reason: "planned_transition",
  });

  await assert.rejects(
    harness.store.startClubFacilityUpgrade(code, OWNER_ID, {
      requestId: "room-notice:facility:blocked",
      clubId: "AUR",
      areaId: "pitch",
    }),
    { code: "PROFESSIONAL_NOTICE_BOARD_APPROVAL_REQUIRED", status: 409 },
  );
  const approved = await harness.reload().startClubFacilityUpgrade(code, OWNER_ID, {
    requestId: "room-notice:facility:approved",
    clubId: "AUR",
    areaId: "pitch",
    noticeApproval: true,
  });
  assert.equal(approved.project.areaId, "pitch");
});

test("nomeacao real de sucessor encerra aviso automaticamente", async () => {
  const harness = createHarness();
  const code = await startCareer(harness);
  const started = await harness.store.manageProfessionalLifecycle(code, OWNER_ID, {
    requestId: "room-notice:auto-successor:start",
    action: "notice_start",
    professionalType: "coach",
    noticeType: "negotiated",
    effectiveAt: "2026-08-20T12:00:00.000Z",
    reason: "agreed_transition",
  });

  await harness.persistence.mutate(code, (room) => {
    const oldAppointment = room.coachEmploymentState.appointments.find((appointment) => (
      appointment.coachId === OWNER_ID && appointment.clubId === "AUR" && appointment.status === "active"
    ));
    const oldContract = room.coachEmploymentState.contracts.find((contract) => (
      contract.id === oldAppointment?.contractId
    ));
    Object.assign(oldAppointment, { status: "ended", endedAt: NOW.toISOString(), exitReason: "replaced_by_appointment" });
    Object.assign(oldContract, { status: "terminated", endedAt: NOW.toISOString(), endReason: "replaced_by_appointment" });
    const oldCoach = room.coachCareerState.coaches.find(({ id }) => id === OWNER_ID);
    Object.assign(oldCoach, { status: "unemployed", currentClubId: null });
    room.coachCareerState.coaches.push({
      id: "active-successor",
      name: "Sucessor Ativo",
      managerType: "ai",
      status: "employed",
      currentClubId: "AUR",
      assignments: [],
    });
    room.coachEmploymentState.contracts.push({
      id: "active-successor-contract",
      coachId: "active-successor",
      clubId: "AUR",
      role: "head_coach",
      status: "active",
      signedAt: NOW.toISOString(),
      startDate: NOW.toISOString(),
      endDate: "2028-07-21T12:00:00.000Z",
      wage: 100_000,
    });
    room.coachEmploymentState.appointments.push({
      id: "active-successor-appointment",
      coachId: "active-successor",
      clubId: "AUR",
      contractId: "active-successor-contract",
      role: "head_coach",
      status: "active",
      appointedAt: NOW.toISOString(),
      startedAt: NOW.toISOString(),
    });
    return room;
  });

  await harness.reload().startClubFacilityUpgrade(code, OWNER_ID, {
    requestId: "room-notice:auto-successor:reconcile",
    clubId: "AUR",
    areaId: "pitch",
    noticeApproval: true,
  });
  const persisted = await harness.reload().getRoom(code);
  const notice = lifecycleState(persisted).notices.find(({ id }) => id === started.lifecycle.id);
  assert.equal(notice.status, "ended_early");
  assert.equal(notice.endReason, "successor_started");
  assert.equal(notice.substituteCoachId, "active-successor");
  assert.equal(lifecycleState(persisted).timeline.some((entry) => (
    entry.lifecycleId === notice.id && entry.metadata?.automatic === true
  )), true);
});

test("aposentadoria imediata de staff atualiza comissao e persiste no reload", async () => {
  const harness = createHarness();
  const code = await startCareer(harness);
  const before = await harness.store.getRoom(code);
  const member = before.clubCareerState.staffMembers.find(({ clubId }) => clubId === "AUR");
  assert.ok(member);

  const retired = await harness.store.manageProfessionalLifecycle(code, OWNER_ID, {
    requestId: "room-staff-retirement:announce",
    action: "retirement_announce",
    professionalType: "staff",
    professionalId: member.id,
    retirementType: "immediate",
    reason: "career_complete",
  });

  assert.equal(retired.lifecycle.professionalId, member.id);
  assert.equal(retired.lifecycle.status, "effective");
  assert.equal(retired.room.clubCareerState.staffMembers
    .find(({ id }) => id === member.id)?.status, "retired");

  const persisted = await harness.reload().getRoom(code);
  assert.equal(lifecycleState(persisted).retirements
    .find(({ professionalId }) => professionalId === member.id)?.status, "effective");
  assert.equal(persisted.clubCareerState.staffMembers
    .find(({ id }) => id === member.id)?.status, "retired");
  assert.equal(persisted.clubCareerState.staffContracts
    .filter(({ staffId, status }) => staffId === member.id && status === "active").length, 0);
});

test("acordo mutuo nao permite ao treinador responder pela diretoria", async () => {
  const harness = createHarness();
  const code = await startCareer(harness);

  const proposed = await harness.store.manageProfessionalLifecycle(code, OWNER_ID, {
    requestId: "room-mutual:propose",
    action: "mutual_agreement_propose",
    professionalType: "coach",
    proposedExitAt: NOW.toISOString(),
    compensation: 50_000,
    reason: "mutual_transition",
    terms: { confidentiality: true },
  });
  assert.equal(proposed.lifecycle.status, "proposed");

  await assert.rejects(
    harness.store.manageProfessionalLifecycle(code, OWNER_ID, {
      requestId: "room-mutual:accept",
      action: "mutual_agreement_accept",
      professionalType: "coach",
      lifecycleId: proposed.lifecycle.id,
    }),
    { code: "PROFESSIONAL_MUTUAL_WAITING_COUNTERPARTY", status: 409 },
  );

  const persisted = await harness.reload().getRoom(code);
  const agreement = lifecycleState(persisted).mutualAgreements
    .find(({ id }) => id === proposed.lifecycle.id);
  assert.equal(agreement.status, "proposed");
  assert.equal(agreement.nextResponder, "club");
  assert.equal(persisted.coachEmploymentState.contracts
    .filter(({ coachId, status }) => coachId === OWNER_ID && status === "active").length, 1);
});

test("rede preferida vincula staff ao treinador, persiste e permite remover", async () => {
  const harness = createHarness();
  const code = await startCareer(harness);
  const before = await harness.store.getRoom(code);
  const member = before.clubCareerState.staffMembers.find(({ clubId }) => clubId === "AUR");
  assert.ok(member);

  await harness.store.manageProfessionalLifecycle(code, OWNER_ID, {
    requestId: "room-preferred:add",
    action: "preferred_staff_update",
    professionalType: "coach",
    staffId: member.id,
    preferred: true,
    affiliationType: "personal_team",
  });

  let persisted = await harness.reload().getRoom(code);
  assert.deepEqual(
    lifecycleState(persisted).preferredStaffByCoach[OWNER_ID].map(({ staffId }) => staffId),
    [member.id],
  );
  assert.equal(persisted.clubCareerState.staffMembers
    .find(({ id }) => id === member.id)?.linkedCoachId, OWNER_ID);
  assert.equal(persisted.clubCareerState.staffMembers
    .find(({ id }) => id === member.id)?.affiliationType, "personal_team");

  await harness.reload().manageProfessionalLifecycle(code, OWNER_ID, {
    requestId: "room-preferred:remove",
    action: "preferred_staff_update",
    professionalType: "coach",
    staffId: member.id,
    preferred: false,
  });
  persisted = await harness.reload().getRoom(code);
  assert.deepEqual(lifecycleState(persisted).preferredStaffByCoach[OWNER_ID], []);
  assert.equal(persisted.clubCareerState.staffMembers
    .find(({ id }) => id === member.id)?.linkedCoachId, null);
  assert.equal(persisted.clubCareerState.staffMembers
    .find(({ id }) => id === member.id)?.affiliationType, "independent");
});

test("manager nao altera ciclo de profissional pertencente a outro clube", async () => {
  const harness = createHarness();
  const code = await startCareer(harness);
  const room = await harness.store.getRoom(code);
  const auroraStaff = room.clubCareerState.staffMembers.find(({ clubId }) => clubId === "AUR");
  assert.ok(auroraStaff);

  await assert.rejects(
    harness.store.manageProfessionalLifecycle(code, MEMBER_ID, {
      requestId: "room-lifecycle:cross-club",
      action: "retirement_announce",
      professionalType: "staff",
      professionalId: auroraStaff.id,
      clubId: "AUR",
      retirementType: "immediate",
    }),
    { code: "CLUB_FORBIDDEN", status: 403 },
  );

  const persisted = await harness.store.getRoom(code);
  assert.equal(persisted.clubCareerState.staffMembers
    .find(({ id }) => id === auroraStaff.id)?.status, "employed");
  assert.equal(lifecycleState(persisted).retirements
    .some(({ professionalId }) => professionalId === auroraStaff.id), false);
});

test("treinador sem clube pode anunciar aposentadoria no fim da temporada", async () => {
  const harness = createHarness();
  const code = await startCareer(harness);
  await harness.store.resignCoach(code, OWNER_ID, {
    requestId: "room-coach-resign-before-retirement",
    reason: "career_transition",
  });

  const announced = await harness.store.manageProfessionalLifecycle(code, OWNER_ID, {
    requestId: "room-coach-retirement:end-season",
    action: "retirement_announce",
    professionalType: "coach",
    retirementType: "end_of_season",
    reason: "career_complete",
  });

  assert.equal(announced.lifecycle.professionalId, OWNER_ID);
  assert.equal(announced.lifecycle.clubId, null);
  assert.equal(announced.lifecycle.kind, "end_season");
  assert.equal(announced.lifecycle.status, "scheduled");
  assert.equal(announced.coachCareer.coach.status, "retiring");

  const persisted = await harness.reload().getRoom(code);
  assert.equal(lifecycleState(persisted).retirements
    .find(({ professionalId }) => professionalId === OWNER_ID)?.kind, "end_season");
});

test("RoomStore afasta e reintegra treinador sem encerrar contrato", async () => {
  const harness = createHarness();
  const code = await startCareer(harness);
  const expectedEndAt = "2026-08-05T12:00:00.000Z";

  const started = await harness.store.manageProfessionalLifecycle(code, OWNER_ID, {
    requestId: "room-coach-leave:start",
    action: "leave_start",
    professionalType: "coach",
    reason: "medical_recovery",
    startsAt: NOW.toISOString(),
    expectedEndAt,
    paymentType: "full",
  });

  assert.equal(started.lifecycle.status, "active");
  assert.equal(started.lifecycle.expectedEndAt, expectedEndAt);
  assert.equal(started.coachCareer.coach.status, "on_leave");
  assert.equal(started.room.coachEmploymentState.contracts
    .filter(({ coachId, status }) => coachId === OWNER_ID && status === "active").length, 1);

  const ended = await harness.store.manageProfessionalLifecycle(code, OWNER_ID, {
    requestId: "room-coach-leave:end",
    action: "leave_end",
    professionalType: "coach",
    lifecycleId: started.lifecycle.id,
    reason: "medical_clearance",
  });

  assert.equal(ended.lifecycle.status, "ended_early");
  assert.equal(ended.coachCareer.coach.status, "employed");
  assert.equal(ended.room.coachEmploymentState.contracts
    .filter(({ coachId, status }) => coachId === OWNER_ID && status === "active").length, 1);

  const persisted = await harness.reload().getRoom(code);
  assert.equal(persisted.professionalLeaveState.leaves
    .find(({ id }) => id === started.lifecycle.id)?.status, "ended_early");
});

test("interim_confirm efetiva, persiste e repete sem duplicar pelo RoomStore", async () => {
  const harness = createHarness();
  const code = await startCareer(harness);
  const requestId = "room-interim:confirm";

  const resigned = await harness.store.resignCoach(code, OWNER_ID, {
    requestId: "room-interim:prepare",
    reason: "career_transition",
  });
  const interim = resigned.room.coachEmploymentState.appointments.find((appointment) => (
    appointment.clubId === "AUR"
      && appointment.status === "active"
      && appointment.role === "interim"
  ));
  assert.ok(interim?.sourceStaffId, "renuncia deve promover auxiliar interino elegivel");

  const confirmingManagerId = interim.coachId;
  await harness.persistence.mutate(code, (room) => {
    room.managerIds.push(confirmingManagerId);
    room.managers.push({
      id: confirmingManagerId,
      name: "Auxiliar interino",
      clubId: "AUR",
      ready: true,
      connected: true,
    });
    return room;
  });

  const confirmed = await harness.reload().manageProfessionalLifecycle(code, confirmingManagerId, {
    requestId,
    action: "interim_confirm",
    professionalType: "staff",
    professionalId: interim.sourceStaffId,
  });
  const endedInterim = confirmed.room.coachEmploymentState.appointments
    .find(({ id }) => id === interim.id);
  const headCoach = confirmed.room.coachEmploymentState.appointments.find((appointment) => (
    appointment.status === "active"
      && appointment.role === "head_coach"
      && appointment.interimAppointmentId === interim.id
  ));
  assert.equal(endedInterim.status, "ended");
  assert.equal(endedInterim.exitReason, "interim_confirmed");
  assert.equal(endedInterim.confirmationOperationId, requestId);
  assert.ok(headCoach);
  assert.equal(headCoach.sourceStaffId, interim.sourceStaffId);
  assert.equal(headCoach.operationId, `${requestId}:head`);
  assert.equal(confirmed.room.coachEmploymentState.contracts
    .filter(({ id, status }) => id === headCoach.contractId && status === "active").length, 1);
  assert.equal(confirmed.room.clubCareerState.staffMembers
    .find(({ id }) => id === interim.sourceStaffId)?.availability?.status, "head_coach");
  assert.equal(confirmed.room.clubCareerState.events
    .filter(({ type, operationId }) => type === "COACH_INTERIM_CONFIRMED" && operationId === requestId).length, 1);

  const persisted = await harness.reload().getRoom(code);
  assert.equal(persisted.coachEmploymentState.appointments
    .find(({ id }) => id === interim.id)?.confirmedAppointmentId, headCoach.id);
  assert.equal(persisted.coachEmploymentState.appointments
    .filter(({ interimAppointmentId }) => interimAppointmentId === interim.id).length, 1);
  assert.equal(persisted.coachEmploymentState.contracts
    .filter(({ id }) => id === headCoach.contractId).length, 1);

  const countsBeforeReplay = {
    appointments: persisted.coachEmploymentState.appointments.length,
    contracts: persisted.coachEmploymentState.contracts.length,
    events: persisted.clubCareerState.events.length,
  };
  const replayed = await harness.reload().manageProfessionalLifecycle(code, confirmingManagerId, {
    requestId,
    action: "interim_confirm",
    professionalType: "staff",
    professionalId: interim.sourceStaffId,
  });

  assert.equal(replayed.room.coachEmploymentState.appointments.length, countsBeforeReplay.appointments);
  assert.equal(replayed.room.coachEmploymentState.contracts.length, countsBeforeReplay.contracts);
  assert.equal(replayed.room.clubCareerState.events.length, countsBeforeReplay.events);
  assert.equal(replayed.room.coachEmploymentState.appointments
    .filter(({ interimAppointmentId }) => interimAppointmentId === interim.id).length, 1);
  assert.equal(replayed.room.clubCareerState.events
    .filter(({ type, operationId }) => type === "COACH_INTERIM_CONFIRMED" && operationId === requestId).length, 1);
});
