// Appointments, interim confirmation, dismissal, resignation, retirement and succession.
// Split from coachEmployment.mjs (audit Q-02); declarations are unchanged.
import { CoachEmploymentError, MAX_MONEY, activeAppointmentForCoach, activeContractForCoach, assertCoachEmploymentIntegrity, canonicalClubId, careerDate, clone, closeAppointmentMutable, clubKey, coachById, createInterimMutable, deterministicId, ensureCoachEmploymentState, eventRecord, financeRecord, identifier, integer, interimBonusTransactionMutable, normalizeAppointmentStatistics, nullableTimestamp, openVacancyMutable, operationId, synchronizeCareerAndRetain } from "./state.mjs";
import { appendNotification, appointmentStatistics, assertCoachCanSign, duplicateResult, emitCallbacks, markProcessed, performAppointment, performImmediateAppointment, resignCoachMutable, resignationPreview } from "./shared.mjs";

export function appointCoach(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const result = performAppointment(room, state, input, now, id);
  state.currentDate = now;
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, result.events, result.transactions, options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    coach: clone(result.coach),
    contract: clone(result.contract),
    appointment: clone(result.appointment),
    events: clone(result.events),
    financialTransactions: clone(result.transactions),
    compensation: result.compensation ?? 0,
    duplicate: false,
  };
}

/** Confirma um interino em contrato principal sem manter dois vinculos ativos. */
export function confirmInterimCoach(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) {
    const priorInterim = state.appointments.find((appointment) => appointment.confirmationOperationId === id) ?? null;
    const priorAppointment = state.appointments.find((appointment) => appointment.operationId === `${id}:head`) ?? null;
    return {
      ...duplicate,
      interimAppointment: clone(priorInterim),
      appointment: clone(priorAppointment),
      contract: clone(state.contracts.find((contract) => contract.id === priorAppointment?.contractId) ?? null),
    };
  }

  const appointmentId = identifier(input.appointmentId ?? input.interimAppointmentId);
  const coachId = identifier(input.coachId);
  const clubId = canonicalClubId(room, input.clubId);
  const interim = state.appointments.find((appointment) => (
    appointment.status === "active"
      && appointment.role === "interim"
      && (!appointmentId || appointment.id === appointmentId)
      && (!coachId || appointment.coachId === coachId)
      && (!clubId || clubKey(appointment.clubId) === clubKey(clubId))
  ));
  if (!interim) {
    throw new CoachEmploymentError("Interino ativo nao encontrado", "COACH_INTERIM_NOT_FOUND", 404, {
      appointmentId: appointmentId || null,
      coachId: coachId || null,
      clubId: clubId || null,
    });
  }
  if (!interim.canBeConfirmed) {
    throw new CoachEmploymentError("Interino nao pode ser efetivado", "COACH_INTERIM_CONFIRMATION_FORBIDDEN", 409, {
      appointmentId: interim.id,
    });
  }

  const coach = coachById(room, interim.coachId);
  assertCoachCanSign(coach, now);
  const interimContract = activeContractForCoach(state, coach.id);
  const vacancy = state.vacancies.find((candidate) => (
    candidate.status === "open" && clubKey(candidate.clubId) === clubKey(interim.clubId)
  )) ?? null;
  const transactions = [];
  const pendingBonus = interimBonusTransactionMutable(interim, now);
  if (pendingBonus) transactions.push(pendingBonus);
  interim.statistics = appointmentStatistics(room, interim, now);
  closeAppointmentMutable(room, state, interim, now, "interim_confirmed", "unemployed");
  interim.confirmedAt = now;
  interim.confirmationOperationId = id;

  const result = performImmediateAppointment(room, state, {
    coachId: coach.id,
    clubId: interim.clubId,
    vacancyId: vacancy?.id ?? interim.vacancyId,
    role: "head_coach",
    entryReason: "interim_confirmed",
    sourceStaffId: interim.sourceStaffId,
    wage: input.wage ?? input.salary ?? interimContract?.wage ?? coach.salary,
    durationYears: input.durationYears ?? input.years ?? 2,
    endDate: input.endDate,
    terminationClause: input.terminationClause,
    signingBonus: input.signingBonus,
    bonuses: input.bonuses,
    objectives: input.objectives,
    authorityLevel: 100,
    canBeConfirmed: false,
  }, now, `${id}:head`);
  interim.confirmedAppointmentId = result.appointment.id;
  result.appointment.sourceStaffId = interim.sourceStaffId;
  result.appointment.interimAppointmentId = interim.id;
  result.appointment.statistics = normalizeAppointmentStatistics({});

  const sourceStaff = (room?.clubCareerState?.staffMembers ?? []).find((member) => (
    identifier(member?.id) === interim.sourceStaffId
  ));
  if (sourceStaff) {
    sourceStaff.availability = {
      ...(sourceStaff.availability && typeof sourceStaff.availability === "object" ? sourceStaff.availability : {}),
      status: "head_coach",
      effectiveAt: now,
      reason: "promoted_from_interim",
    };
    sourceStaff.headCoachAppointmentId = result.appointment.id;
    if (sourceStaff.interimAssignment?.status === "active") {
      sourceStaff.interimAssignment = {
        ...sourceStaff.interimAssignment,
        status: "ended",
        endedAt: now,
        endsAt: now,
        endReason: "promoted_to_head_coach",
        confirmedAppointmentId: result.appointment.id,
      };
    }
    sourceStaff.updatedAt = now;
    sourceStaff.professionalHistory = [
      ...(Array.isArray(sourceStaff.professionalHistory) ? sourceStaff.professionalHistory : []),
      {
        id: deterministicId("staff-history", `${id}|${sourceStaff.id}`),
        type: "promoted_to_head_coach",
        clubId: interim.clubId,
        occurredAt: now,
        appointmentId: result.appointment.id,
        operationId: id,
      },
    ].slice(-500);
  }

  const events = [eventRecord("COACH_INTERIM_CONFIRMED", id, now, {
    coachId: coach.id,
    clubId: interim.clubId,
    contractId: result.contract.id,
    vacancyId: vacancy?.id ?? interim.vacancyId,
    metadata: {
      interimAppointmentId: interim.id,
      headCoachAppointmentId: result.appointment.id,
      sourceStaffId: interim.sourceStaffId,
      interimStatistics: clone(interim.statistics),
      wage: result.contract.wage,
      endDate: result.contract.endDate,
    },
  }), ...result.events];
  transactions.push(...result.transactions);
  state.currentDate = now;
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, events, transactions, options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    coach: clone(coach),
    interimAppointment: clone(interim),
    appointment: clone(result.appointment),
    previousContract: clone(interimContract),
    contract: clone(result.contract),
    vacancy: clone(vacancy),
    events: clone(events),
    financialTransactions: clone(transactions),
    duplicate: false,
  };
}

function departCoach(roomValue, input, options, kind) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  if (kind === "resigned") {
    const result = resignCoachMutable(room, state, input, now, id, options);
    state.currentDate = now;
    assertCoachEmploymentIntegrity(room, now);
    emitCallbacks(room, result.events, result.transactions, options);
    markProcessed(state, id);
    synchronizeCareerAndRetain(room, state, now);
    return {
      room,
      coach: clone(result.coach),
      contract: clone(result.contract),
      appointment: clone(result.appointment),
      interimAppointment: clone(result.interimAppointment),
      vacancy: clone(result.vacancy),
      events: clone(result.events),
      financialTransactions: clone(result.transactions),
      penalty: result.penalty,
      consequences: clone(result.consequences),
      duplicate: false,
    };
  }
  const coach = coachById(room, input.coachId);
  const appointment = activeAppointmentForCoach(state, coach.id);
  if (!appointment) throw new CoachEmploymentError("Treinador sem vinculo ativo", "COACH_ACTIVE_APPOINTMENT_NOT_FOUND", 409);
  const requestedClubId = canonicalClubId(room, input.clubId);
  if (requestedClubId && clubKey(requestedClubId) !== clubKey(appointment.clubId)) {
    throw new CoachEmploymentError("Treinador nao pertence ao clube", "COACH_CLUB_MISMATCH", 409);
  }
  const contract = activeContractForCoach(state, coach.id);
  const isMutualAgreement = kind === "mutual_agreement";
  const isRetirement = kind === "retired";
  const defaultPenalty = isRetirement ? 0 : contract?.terminationClause;
  const penalty = integer(input.compensation ?? input.penalty ?? defaultPenalty, 0, 0, MAX_MONEY);
  const clubId = appointment.clubId;
  const exitReason = identifier(input.reason)
    || (isRetirement ? "retirement" : isMutualAgreement ? "mutual_agreement" : "board_dismissal");
  const nextCoachStatus = isRetirement ? "retired" : isMutualAgreement ? "unemployed" : kind;
  const closed = closeAppointmentMutable(room, state, appointment, now, exitReason, nextCoachStatus);
  const interim = createInterimMutable(room, state, clubId, exitReason, now, id, { payBonus: true });
  const transactions = penalty > 0 ? [financeRecord(
    "expense",
    isMutualAgreement ? "coach_mutual_agreement" : isRetirement ? "coach_retirement" : "coach_termination",
    id,
    now,
    {
      clubId,
      coachId: coach.id,
      amount: penalty,
      description: isRetirement
        ? `Encerramento de carreira de ${coach.name}`
        : isMutualAgreement
          ? `Acordo de rescisao com ${coach.name}`
          : `Rescisao de ${coach.name}`,
    },
  )] : [];
  transactions.push(...interim.transactions);
  const departureEventType = isRetirement
    ? "COACH_RETIREMENT_EFFECTIVE"
    : isMutualAgreement ? "COACH_MUTUAL_AGREEMENT_COMPLETED" : "COACH_DISMISSED";
  const events = [eventRecord(departureEventType, id, now, {
    coachId: coach.id,
    clubId,
    contractId: contract?.id,
    vacancyId: interim.vacancy?.id,
    amount: penalty,
    metadata: {
      reason: exitReason,
      securityScore: input.securityScore ?? null,
      terms: input.terms && typeof input.terms === "object" ? clone(input.terms) : null,
    },
  })];
  if (interim.event) events.push(interim.event);
  state.currentDate = now;
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, events, transactions, options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    coach: clone(closed.coach),
    contract: clone(closed.contract),
    appointment: clone(appointment),
    interimAppointment: clone(interim.appointment),
    vacancy: clone(interim.vacancy),
    events: clone(events),
    financialTransactions: clone(transactions),
    penalty,
    duplicate: false,
  };
}

export function dismissCoach(roomValue, input = {}, options = {}) {
  return departCoach(roomValue, input, options, "dismissed");
}

export function resignCoach(roomValue, input = {}, options = {}) {
  return departCoach(roomValue, input, options, "resigned");
}

export function separateCoachByAgreement(roomValue, input = {}, options = {}) {
  return departCoach(roomValue, input, options, "mutual_agreement");
}

export function retireCoach(roomValue, input = {}, options = {}) {
  return departCoach(roomValue, input, options, "retired");
}

export function openCoachSuccession(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const coach = coachById(room, input.coachId);
  const appointment = activeAppointmentForCoach(state, coach.id);
  if (!appointment) {
    throw new CoachEmploymentError("Treinador sem vinculo ativo", "COACH_ACTIVE_APPOINTMENT_NOT_FOUND", 409);
  }
  const requestedClubId = canonicalClubId(room, input.clubId);
  if (requestedClubId && clubKey(requestedClubId) !== clubKey(appointment.clubId)) {
    throw new CoachEmploymentError("Treinador nao pertence ao clube", "COACH_CLUB_MISMATCH", 409);
  }
  const vacancy = openVacancyMutable(
    room,
    state,
    appointment.clubId,
    identifier(input.reason) || "planned_succession",
    now,
    `${id}:vacancy`,
  );
  vacancy.plannedDepartureAt = nullableTimestamp(input.effectiveAt);
  vacancy.departingCoachId = coach.id;
  vacancy.successionPlanned = true;
  const event = eventRecord("COACH_SUCCESSION_SEARCH_STARTED", id, now, {
    coachId: coach.id,
    clubId: appointment.clubId,
    vacancyId: vacancy.id,
    metadata: {
      reason: identifier(input.reason) || "planned_succession",
      effectiveAt: vacancy.plannedDepartureAt,
    },
  });
  appendNotification(state, {
    type: "COACH_SUCCESSION_SEARCH_STARTED",
    recipientId: coach.id,
    recipientRole: "coach",
    coachId: coach.id,
    clubId: appointment.clubId,
    vacancyId: vacancy.id,
    title: "Planejamento de sucessao iniciado",
    message: vacancy.plannedDepartureAt
      ? `O clube iniciou a busca para a transicao em ${vacancy.plannedDepartureAt}.`
      : "O clube iniciou a busca por um sucessor.",
  }, now, id);
  state.currentDate = now;
  emitCallbacks(room, [event], [], options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  assertCoachEmploymentIntegrity(room, now);
  return {
    room,
    coach: clone(coach),
    vacancy: clone(vacancy),
    events: [clone(event)],
    financialTransactions: [],
    duplicate: false,
  };
}

export function previewCoachResignation(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const coach = coachById(room, input.coachId);
  const appointment = activeAppointmentForCoach(state, coach.id);
  if (!appointment) return null;
  const contract = activeContractForCoach(state, coach.id);
  return clone(resignationPreview(room, state, coach, appointment, contract, input, now, options));
}
