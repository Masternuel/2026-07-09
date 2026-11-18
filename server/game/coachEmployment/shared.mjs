// Helpers shared by more than one coach employment workflow.
// Split from coachEmployment.mjs (audit Q-02); declarations are unchanged.
import { evaluateCoachCandidate, normalizeCoachReputation100 } from "../coachCandidateScoring.mjs";
import { activeCoachMarketRestriction, calculateCoachResignationConsequences, coachCareerTrustSummary, inferCoachResignationReason, normalizeCoachConductConfig } from "../coachCareerConduct.mjs";
import { ACTIVE_PROPOSAL_STATUSES, CoachEmploymentError, DAY_MS, MAX_MONEY, RETENTION, activeAppointmentForClub, activeAppointmentForCoach, activeContractForCoach, activeProfessionalLifecycleRecord, addDays, appendCareerAssignment, appointmentRecord, canonicalClubId, catalogClubs, clamp, clone, closeAppointmentMutable, clubKey, coachById, completedRound, contractTerms, createInterimMutable, deterministicId, eventRecord, financeRecord, finite, identifier, integer, limitedInterviewText, normalizeAppointmentStatistics, normalizeCoachAuditEntries, normalizeCoachInterviewMemories, normalizeGuarantee, normalizeInterviewEvaluation, normalizeInterviewMetrics, normalizeInterviewRelationshipImpact, normalizeNotification, normalizedObjectives, nullableTimestamp, setHumanControl, timestamp } from "./state.mjs";

const ACTIVE_APPLICATION_STATUSES = new Set(["submitted", "shortlisted", "interview", "interview_completed", "offered", "accepted"]);

const ACTIVE_INTERVIEW_STATUSES = new Set(["pending", "completed", "accepted"]);

export function coachRetirementBlocksMarket(room, coachId) {
  return Boolean(activeProfessionalLifecycleRecord(room, "retirements", coachId));
}

export function coachConductConfig(state, options = {}) {
  return normalizeCoachConductConfig({
    ...(state?.conductConfig ?? {}),
    ...(options?.conductConfig && typeof options.conductConfig === "object" ? options.conductConfig : {}),
  });
}

function seasonProgressRatio(room) {
  const currentRound = completedRound(room);
  const schedule = Array.isArray(room?.leagueFixtureSchedule) ? room.leagueFixtureSchedule : [];
  const totalRounds = schedule.reduce((maximum, fixture) => (
    Math.max(maximum, integer(fixture?.round, 0, 0, 100))
  ), integer(room?.totalRounds ?? room?.seasonTotalRounds, 0, 0, 100));
  return totalRounds > 0 ? clamp(currentRound / totalRounds, 0, 1) : 0.5;
}

function resignationJustCauseEvidence(room, state, coach, appointment, reasonCode) {
  const finance = (room?.marketState?.finances ?? []).find((entry) => (
    clubKey(entry?.clubId) === clubKey(appointment.clubId)
  ));
  const morale = (room?.clubMoraleStates ?? []).find((entry) => (
    clubKey(entry?.clubId) === clubKey(appointment.clubId)
  ));
  const breachedGuarantees = state.guarantees.filter((guarantee) => (
    guarantee.coachId === coach.id
      && clubKey(guarantee.clubId) === clubKey(appointment.clubId)
      && ["overdue", "breached"].includes(guarantee.status)
  ));
  const unpaidWages = finite(finance?.unpaidWages ?? finance?.overduePayroll ?? finance?.latePayrollMonths, 0) > 0;
  const financialCrisis = Number.isFinite(Number(finance?.balance)) && Number(finance.balance) < 0;
  const toxicEnvironment = Number.isFinite(Number(morale?.score)) && Number(morale.score) <= 25;
  const boardTrust = Number(coach.boardConfidence ?? coach.boardRelationship ?? coach.satisfaction);
  const boardBreach = breachedGuarantees.length > 0 || (Number.isFinite(boardTrust) && boardTrust <= 10);
  const verified = (
    (reasonCode === "unpaid_wages" && unpaidWages)
    || (reasonCode === "persistent_financial_crisis" && financialCrisis)
    || (reasonCode === "broken_promises" && breachedGuarantees.length > 0)
    || (reasonCode === "toxic_environment" && toxicEnvironment)
    || (reasonCode === "board_breach" && boardBreach)
  );
  return {
    verified,
    codes: [
      ...(unpaidWages ? ["unpaid_wages"] : []),
      ...(financialCrisis ? ["financial_crisis"] : []),
      ...(breachedGuarantees.length ? ["breached_guarantees"] : []),
      ...(toxicEnvironment ? ["toxic_environment"] : []),
      ...(boardBreach ? ["board_breach"] : []),
    ],
    guaranteeIds: breachedGuarantees.map((guarantee) => guarantee.id),
  };
}

export function appendCoachConductEntry(coach, entry) {
  const normalized = normalizeCoachAuditEntries([entry], 1)[0];
  if (!normalized) return null;
  coach.careerConductHistory = [
    ...(coach.careerConductHistory ?? []).filter((candidate) => candidate.id !== normalized.id),
    normalized,
  ].slice(-500);
  if (normalized.reputationDelta !== 0) {
    coach.reputationHistory = [
      ...(coach.reputationHistory ?? []).filter((candidate) => candidate.id !== normalized.id),
      normalized,
    ].slice(-300);
  }
  return normalized;
}

export function applyCoachReputationChangeMutable(coach, input) {
  const requestedDelta = integer(input.delta, 0, -100, 100);
  const requestedTrustDelta = integer(input.trustDelta, requestedDelta, -100, 100);
  const before = normalizeCoachReputation100(coach.reputation ?? coach.marketReputation, 50);
  const marketBefore = normalizeCoachReputation100(coach.marketReputation ?? coach.reputation, before);
  const trustBefore = clamp(finite(coach.professionalTrust, 80), 0, 100);
  const after = clamp(before + requestedDelta, 0, 100);
  const trustAfter = clamp(trustBefore + requestedTrustDelta, 0, 100);
  const delta = Math.round(after - before);
  const trustDelta = Math.round(trustAfter - trustBefore);
  coach.reputation = after;
  coach.marketReputation = clamp(marketBefore + requestedDelta, 0, 100);
  coach.professionalTrust = trustAfter;
  return appendCoachConductEntry(coach, {
    id: deterministicId("coach-conduct", `${input.operationId}|${input.type}|${coach.id}`),
    type: input.type,
    occurredAt: input.occurredAt,
    clubId: input.clubId,
    reasonCode: input.reasonCode,
    reasonLabel: input.reasonLabel,
    reputationDelta: delta,
    reputationBefore: before,
    reputationAfter: after,
    trustDelta,
    restrictionEndsAt: input.restrictionEndsAt,
    operationId: input.operationId,
    metadata: input.metadata && typeof input.metadata === "object" ? clone(input.metadata) : {},
  });
}

export function resignationPreview(room, state, coach, appointment, contract, input, now, options = {}) {
  const reasonCode = inferCoachResignationReason(input?.reasonCode, input?.reason);
  const evidence = resignationJustCauseEvidence(room, state, coach, appointment, reasonCode);
  const baseCost = integer(input?.compensation ?? contract?.terminationClause, 0, 0, MAX_MONEY);
  const initial = calculateCoachResignationConsequences({
    coach,
    appointment,
    contract,
    now,
    reasonCode,
    reason: input?.reason,
    seasonProgress: seasonProgressRatio(room),
    justCauseEvidence: evidence.verified,
    financialCost: baseCost,
  }, coachConductConfig(state, options));
  const financialCost = initial.justCauseVerified ? Math.round(baseCost * 0.15) : baseCost;
  return {
    ...initial,
    financialCost,
    evidenceCodes: evidence.codes,
    evidenceGuaranteeIds: evidence.guaranteeIds,
  };
}

function applyVoluntaryResignationConsequencesMutable(room, state, coach, appointment, contract, input, now, operationIdValue, options = {}) {
  const preview = resignationPreview(room, state, coach, appointment, contract, input, now, options);
  const record = applyCoachReputationChangeMutable(coach, {
    delta: preview.reputationDelta,
    trustDelta: preview.trustDelta,
    type: "voluntary_resignation",
    occurredAt: now,
    clubId: appointment.clubId,
    reasonCode: preview.reasonCode,
    reasonLabel: preview.reasonLabel,
    restrictionEndsAt: preview.restrictionEndsAt,
    operationId: operationIdValue,
    metadata: {
      justCauseVerified: preview.justCauseVerified,
      inactivityDays: preview.inactivityDays,
      financialCost: preview.financialCost,
      pendingProjectPenalty: preview.pendingProjectPenalty,
      midSeasonPenalty: preview.midSeasonPenalty,
      previousResignations: preview.previousResignations,
      evidenceCodes: preview.evidenceCodes,
    },
  });
  const consequences = {
    ...preview,
    reputationDelta: record?.reputationDelta ?? preview.reputationDelta,
    trustDelta: record?.trustDelta ?? preview.trustDelta,
  };
  coach.marketRestriction = {
    type: "voluntary_resignation",
    startsAt: consequences.restrictionStartsAt,
    endsAt: consequences.restrictionEndsAt,
    reasonCode: consequences.reasonCode,
    reasonLabel: consequences.reasonLabel,
    justCauseVerified: consequences.justCauseVerified,
    signingBlocked: true,
    inactivityDays: consequences.inactivityDays,
    reputationDelta: consequences.reputationDelta,
    trustDelta: consequences.trustDelta,
    operationId: operationIdValue,
    completedAt: null,
  };
  coach.resignationHistory = [...(coach.resignationHistory ?? []).filter((entry) => entry.id !== record.id), record].slice(-100);
  return consequences;
}

export function assertCoachCanSign(coach, now) {
  if (["retired", "retiring"].includes(coach?.status)) {
    throw new CoachEmploymentError(
      "Treinador com aposentadoria confirmada nao pode assinar",
      "COACH_RETIREMENT_MARKET_BLOCK",
      409,
    );
  }
  const restriction = activeCoachMarketRestriction(coach, now);
  if (!restriction || restriction.signingBlocked === false) return;
  throw new CoachEmploymentError(
    `Treinador impedido de assinar ate ${restriction.endsAt}`,
    "COACH_MARKET_RESTRICTION_ACTIVE",
    409,
    {
      endsAt: restriction.endsAt,
      remainingDays: restriction.remainingDays,
      canInterview: true,
      canSign: false,
      reasonCode: restriction.reasonCode,
    },
  );
}

export function proposalTerms(proposal, override = {}) {
  return {
    wage: integer(override.wage ?? proposal?.wage, 0, 0, 20_000_000),
    durationYears: integer(override.durationYears ?? proposal?.durationYears, 2, 1, 10),
    terminationClause: integer(override.terminationClause ?? proposal?.terminationClause, 0, 0, MAX_MONEY),
    signingBonus: integer(override.signingBonus ?? proposal?.signingBonus, 0, 0, MAX_MONEY),
    compensation: integer(override.compensation ?? proposal?.compensation, 0, 0, MAX_MONEY),
    transferBudget: override.transferBudget == null
      ? proposal?.transferBudget == null ? null : integer(proposal.transferBudget, 0, 0, MAX_MONEY)
      : integer(override.transferBudget, 0, 0, MAX_MONEY),
    autonomyDelta: Math.round(clamp(finite(override.autonomyDelta ?? proposal?.autonomyDelta), -20, 20) * 10) / 10,
    objectiveDifficultyDelta: Math.round(clamp(finite(
      override.objectiveDifficultyDelta ?? proposal?.objectiveDifficultyDelta,
    ), -15, 15) * 10) / 10,
    objectives: normalizedObjectives(override.objectives ?? proposal?.objectives),
    specialClauses: (Array.isArray(override.specialClauses ?? override.clauses)
      ? override.specialClauses ?? override.clauses
      : Array.isArray(proposal?.specialClauses) ? proposal.specialClauses : [])
      .map(identifier).filter(Boolean).slice(0, 20),
    bonuses: override.bonuses && typeof override.bonuses === "object"
      ? clone(override.bonuses)
      : proposal?.bonuses && typeof proposal.bonuses === "object" ? clone(proposal.bonuses) : {},
  };
}

export function appendDecision(record, input, now, operationIdValue) {
  const previousStatus = identifier(input.previousStatus ?? record.status) || null;
  const newStatus = identifier(input.newStatus ?? record.status) || null;
  const decision = {
    id: deterministicId("coach-decision", `${operationIdValue}|${record.id}|${input.action}`),
    action: identifier(input.action) || "status_change",
    responsibleId: identifier(input.responsibleId) || "system",
    responsibleRole: identifier(input.responsibleRole) || "system",
    decidedAt: now,
    justification: identifier(input.justification) || null,
    previousStatus,
    newStatus,
    negotiatedValues: input.negotiatedValues && typeof input.negotiatedValues === "object"
      ? clone(input.negotiatedValues)
      : {},
    conditions: Array.isArray(input.conditions) ? clone(input.conditions).slice(0, 30) : [],
    operationId: operationIdValue,
  };
  record.decisionHistory = [...(record.decisionHistory ?? []).filter((entry) => entry.id !== decision.id), decision].slice(-100);
  if (Object.prototype.hasOwnProperty.call(record, "history")) {
    record.history = clone(record.decisionHistory);
  }
  return decision;
}

export function appendNotification(state, input, now, operationIdValue) {
  const notification = normalizeNotification({
    ...input,
    id: identifier(input.id) || deterministicId(
      "coach-notification",
      `${operationIdValue}|${input.type}|${input.recipientRole}|${input.recipientId ?? ""}|${input.guaranteeId ?? ""}`,
    ),
    createdAt: now,
    operationId: operationIdValue,
  });
  if (!notification) return null;
  const existing = state.notifications.find((entry) => entry.id === notification.id);
  if (existing) return existing;
  state.notifications.push(notification);
  return notification;
}

export function guaranteesForProposal(state, proposal) {
  const ids = new Set(proposal?.guaranteeIds ?? []);
  return state.guarantees.filter((guarantee) => guarantee.proposalId === proposal?.id || ids.has(guarantee.id));
}

export function isStaffPackageGuarantee(guarantee) {
  const kind = identifier(guarantee?.kind ?? guarantee?.category).toLocaleLowerCase("en-US");
  return kind === "staff_package" || (guarantee?.effects ?? []).some((effect) => (
    identifier(effect?.type ?? effect?.kind).toLocaleLowerCase("en-US") === "staff_package"
  ));
}

export function staffPackageFromGuarantee(guarantee) {
  if (!guarantee || !isStaffPackageGuarantee(guarantee)) return null;
  if (guarantee.staffPackage && typeof guarantee.staffPackage === "object") {
    return clone(guarantee.staffPackage);
  }
  const effect = (guarantee.effects ?? []).find((candidate) => (
    identifier(candidate?.type ?? candidate?.kind).toLocaleLowerCase("en-US") === "staff_package"
  ));
  if (!effect) return null;
  if (effect.staffPackage && typeof effect.staffPackage === "object") return clone(effect.staffPackage);
  return clone(effect);
}

export function preferredPersonalStaffPackage(room, proposal, now) {
  const coach = (room?.coachCareerState?.coaches ?? []).find((candidate) => (
    identifier(candidate?.id) === identifier(proposal?.coachId)
  ));
  if (!coach || coach.managerType === "human") return null;
  const preferred = room?.professionalLifecycleState?.preferredStaffByCoach?.[coach.id];
  if (!Array.isArray(preferred) || preferred.length === 0) return null;
  const professionals = [
    ...(room?.clubCareerState?.staffMembers ?? []),
    ...(room?.clubCareerState?.staffCandidates ?? []),
  ];
  const contracts = room?.clubCareerState?.staffContracts ?? [];
  const seen = new Set();
  const members = [];
  for (const entry of preferred) {
    const affiliationType = identifier(entry?.affiliationType ?? entry?.linkType)
      .toLocaleLowerCase("en-US");
    if (!["personal_team", "personal_staff"].includes(affiliationType)) continue;
    const staffId = identifier(entry?.staffId ?? entry?.professionalId);
    if (!staffId || seen.has(staffId)) continue;
    seen.add(staffId);
    const professional = professionals.find((candidate) => identifier(candidate?.id) === staffId) ?? null;
    if (professional?.clubId && clubKey(professional.clubId) === clubKey(proposal.clubId)) continue;
    const activeContract = contracts.find((contract) => (
      identifier(contract?.staffId ?? contract?.professionalId) === staffId
        && contract?.status === "active"
        && (!contract.endDate || new Date(contract.endDate).getTime() > new Date(now).getTime())
    )) ?? null;
    const monthlyCost = integer(
      entry?.estimatedMonthlyCost
        ?? entry?.monthlyCost
        ?? activeContract?.wage
        ?? professional?.salary
        ?? professional?.wage,
      0,
      0,
      10_000_000,
    );
    const signingBonus = integer(entry?.signingBonus, monthlyCost, 0, MAX_MONEY);
    const buyout = professional?.clubId && clubKey(professional.clubId) !== clubKey(proposal.clubId)
      ? integer(
        entry?.buyout
          ?? activeContract?.terminationClause
          ?? activeContract?.releaseClause
          ?? activeContract?.compensation,
        0,
        0,
        MAX_MONEY,
      )
      : 0;
    const firstYearCost = Math.min(MAX_MONEY, monthlyCost * 12 + signingBonus + buyout);
    members.push({
      staffId,
      name: identifier(professional?.name ?? entry?.name) || staffId,
      role: identifier(entry?.role ?? professional?.role) || null,
      affiliationType: "personal_team",
      sourceClubId: identifier(professional?.clubId) || null,
      available: entry?.available !== false,
      recruitable: professional?.status !== "retired",
      monthlyCost,
      wage: monthlyCost,
      signingBonus,
      buyout,
      firstYearCost,
    });
  }
  if (members.length === 0) return null;
  const monthlyCost = members.reduce(
    (total, member) => Math.min(MAX_MONEY, total + member.monthlyCost),
    0,
  );
  const firstYearCost = members.reduce(
    (total, member) => Math.min(MAX_MONEY, total + member.firstYearCost),
    0,
  );
  const expectedHiringBy = addDays(proposal?.plannedStartDate ?? now, 30);
  return {
    version: 1,
    kind: "staff_package",
    coachId: coach.id,
    clubId: proposal.clubId,
    requiredByCoach: true,
    requestedAt: now,
    expectedHiringBy,
    staffIds: members.map((member) => member.staffId),
    headcount: members.length,
    monthlyCost,
    firstYearCost,
    members,
  };
}

function staffPackageCovers(packageValue, requiredPackage) {
  if (!packageValue || !requiredPackage) return false;
  const coveredIds = new Set((packageValue.staffIds ?? packageValue.members?.map((member) => member?.staffId) ?? [])
    .map(identifier).filter(Boolean));
  return requiredPackage.staffIds.every((staffId) => coveredIds.has(staffId));
}

export function requiredStaffPackageGuarantee(state, proposal, requiredPackage, allowedStatuses = null) {
  return guaranteesForProposal(state, proposal).find((guarantee) => (
    isStaffPackageGuarantee(guarantee)
      && (!allowedStatuses || allowedStatuses.includes(guarantee.status))
      && staffPackageCovers(staffPackageFromGuarantee(guarantee), requiredPackage)
  )) ?? null;
}

function ensureRequiredStaffPackageApproved(room, state, proposal) {
  const requiredPackage = preferredPersonalStaffPackage(
    room,
    proposal,
    proposal?.updatedAt ?? state.currentDate ?? new Date().toISOString(),
  );
  if (!requiredPackage) return null;
  const approved = requiredStaffPackageGuarantee(
    state,
    proposal,
    requiredPackage,
    ["formalized", "fulfilled"],
  );
  if (approved) return approved;
  const requested = requiredStaffPackageGuarantee(state, proposal, requiredPackage);
  throw new CoachEmploymentError(
    requested
      ? "Pacote da comissao pessoal ainda nao foi aprovado pela diretoria"
      : "Treinador exige garantia para contratar sua comissao pessoal",
    requested
      ? "COACH_STAFF_PACKAGE_NOT_APPROVED"
      : "COACH_STAFF_PACKAGE_GUARANTEE_REQUIRED",
    409,
    {
      proposalId: proposal.id,
      guaranteeId: requested?.id ?? null,
      staffIds: requiredPackage.staffIds,
      monthlyCost: requiredPackage.monthlyCost,
      firstYearCost: requiredPackage.firstYearCost,
    },
  );
}

export function refreshCoachMarketStatus(state, coach) {
  if (["notice", "retiring", "retired"].includes(coach.status)) return;
  if (coach.currentClubId) {
    const appointment = activeAppointmentForCoach(state, coach.id);
    coach.status = appointment?.role === "interim" ? "interim" : "employed";
    return;
  }
  coach.status = state.proposals.some((proposal) => (
    proposal.coachId === coach.id && ACTIVE_PROPOSAL_STATUSES.has(proposal.status)
  )) ? "negotiating" : "unemployed";
}

function unresolvedMandatoryGuarantees(state, proposal) {
  return guaranteesForProposal(state, proposal).filter((guarantee) => (
    guarantee.mandatory
      && guarantee.blocksCompletion
      && !["formalized", "fulfilled", "waived"].includes(guarantee.status)
  ));
}

export function ensureProposalCanComplete(room, state, proposal) {
  if (proposal.status === "aguardando_resposta_diretoria") {
    throw new CoachEmploymentError(
      "Contraproposta aguarda resposta da diretoria",
      "COACH_COUNTERPROPOSAL_AWAITING_BOARD",
      409,
      { proposalId: proposal.id },
    );
  }
  if (proposal.status === "informacoes_solicitadas") {
    throw new CoachEmploymentError(
      "A diretoria aguarda informacoes adicionais",
      "COACH_PROPOSAL_INFORMATION_REQUIRED",
      409,
      { proposalId: proposal.id },
    );
  }
  ensureRequiredStaffPackageApproved(room, state, proposal);
  const unresolved = unresolvedMandatoryGuarantees(state, proposal);
  if (unresolved.length > 0) {
    throw new CoachEmploymentError(
      "Garantia obrigatoria ainda nao foi formalizada",
      "COACH_GUARANTEE_BLOCKS_COMPLETION",
      409,
      { proposalId: proposal.id, guaranteeIds: unresolved.map((guarantee) => guarantee.id) },
    );
  }
  const scheduledCoachConflict = state.appointments.find((appointment) => (
    appointment.status === "scheduled"
      && appointment.coachId === proposal.coachId
      && appointment.proposalId !== proposal.id
  ));
  if (scheduledCoachConflict) {
    throw new CoachEmploymentError(
      "Treinador ja possui compromisso futuro",
      "COACH_SCHEDULED_APPOINTMENT_CONFLICT",
      409,
      { proposalId: proposal.id, appointmentId: scheduledCoachConflict.id },
    );
  }
  const scheduledClubConflict = state.appointments.find((appointment) => (
    appointment.status === "scheduled"
      && clubKey(appointment.clubId) === clubKey(proposal.clubId)
      && appointment.proposalId !== proposal.id
  ));
  if (scheduledClubConflict) {
    throw new CoachEmploymentError(
      "Clube ja possui treinador agendado",
      "CLUB_SCHEDULED_APPOINTMENT_CONFLICT",
      409,
      { proposalId: proposal.id, appointmentId: scheduledClubConflict.id },
    );
  }
}

export function ensureClubCanFundProposal(room, state, proposal) {
  const funds = availableClubFunds(room, proposal.clubId);
  if (funds == null) return;
  const upfrontCost = integer(proposal.compensation, 0, 0, MAX_MONEY)
    + integer(proposal.signingBonus, 0, 0, MAX_MONEY);
  const salaryCommitment = salarySolvencyCostForTerms(proposal.wage, proposal.durationYears);
  const staffPackageFirstYearCost = guaranteesForProposal(state, proposal)
    .filter((guarantee) => ["formalized", "fulfilled"].includes(guarantee.status))
    .reduce((total, guarantee) => Math.min(
      MAX_MONEY,
      total + integer(staffPackageFromGuarantee(guarantee)?.firstYearCost, 0, 0, MAX_MONEY),
    ), 0);
  const required = Math.min(
    MAX_MONEY,
    upfrontCost + salaryCommitment + staffPackageFirstYearCost,
  );
  if (funds < required) {
    throw new CoachEmploymentError(
      "Clube nao possui saldo para concluir o acordo",
      "COACH_PROPOSAL_BUDGET_CHANGED",
      409,
      {
        proposalId: proposal.id,
        available: funds,
        required,
        upfrontCost,
        salaryCommitment,
        staffPackageFirstYearCost,
      },
    );
  }
}

export function assertProposalVacancyOpen(state, proposal) {
  if (!proposal.vacancyId) return null;
  const vacancy = state.vacancies.find((candidate) => candidate.id === proposal.vacancyId);
  if (!vacancy) throw new CoachEmploymentError("Vaga nao encontrada", "COACH_VACANCY_NOT_FOUND", 404);
  if (vacancy.status !== "open") {
    throw new CoachEmploymentError("Vaga encerrada", "COACH_VACANCY_CLOSED", 409, {
      vacancyId: vacancy.id,
      status: vacancy.status,
    });
  }
  return vacancy;
}

export function registerProposalGuarantees(state, proposal, values, now, operationIdValue, defaults = {}) {
  const source = (Array.isArray(values) ? values : values == null ? [] : [values]).slice(0, 20);
  const created = [];
  for (const [index, entry] of source.entries()) {
    const raw = entry && typeof entry === "object" ? entry : { description: entry };
    const description = identifier(raw.description ?? raw.text ?? raw.label);
    if (!description) continue;
    const guarantee = normalizeGuarantee({
      ...raw,
      id: identifier(raw.id) || deterministicId("coach-guarantee", `${operationIdValue}|${proposal.id}|${index}|${description}`),
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      applicationId: proposal.applicationId,
      coachId: proposal.coachId,
      clubId: proposal.clubId,
      responsibleId: raw.responsibleId ?? defaults.responsibleId ?? proposal.clubId,
      responsibleRole: raw.responsibleRole ?? defaults.responsibleRole ?? "board",
      dueAt: raw.dueAt ?? defaults.dueAt,
      status: raw.status ?? defaults.status ?? "requested",
      mandatory: raw.mandatory ?? defaults.mandatory ?? true,
      blocksCompletion: raw.blocksCompletion ?? defaults.blocksCompletion ?? true,
      effects: raw.effects ?? defaults.effects ?? [],
      createdAt: raw.createdAt ?? now,
      updatedAt: now,
      operationId: operationIdValue,
    });
    if (!guarantee) continue;
    const existing = state.guarantees.find((candidate) => candidate.id === guarantee.id);
    if (!existing) state.guarantees.push(guarantee);
    const resolved = existing ?? guarantee;
    if (!proposal.guaranteeIds.includes(resolved.id)) proposal.guaranteeIds.push(resolved.id);
    created.push(resolved);
  }
  return created;
}

export function contractGuaranteeTerms(state, proposal) {
  const guarantees = guaranteesForProposal(state, proposal).filter((guarantee) => (
    ["formalized", "fulfilled"].includes(guarantee.status)
  ));
  const clauses = guarantees.flatMap((guarantee) => guarantee.effects.flatMap((effect) => {
    if (effect?.type !== "contract_clause" && effect?.kind !== "contract_clause") return [];
    return [{
      guaranteeId: guarantee.id,
      description: identifier(effect.description ?? effect.clause) || guarantee.description,
      mandatory: guarantee.mandatory,
    }];
  }));
  const staffPackageCommitments = guarantees.flatMap((guarantee) => {
    const staffPackage = staffPackageFromGuarantee(guarantee);
    if (!staffPackage) return [];
    return [{
      guaranteeId: guarantee.id,
      status: guarantee.status,
      dueAt: guarantee.dueAt ?? staffPackage.expectedHiringBy ?? null,
      action: "hire_coach_staff_package",
      ...staffPackage,
    }];
  });
  return {
    guaranteeIds: guarantees.map((guarantee) => guarantee.id),
    clauses,
    staffPackageCommitments,
  };
}

export function emitCallbacks(room, events, transactions, options) {
  for (const transaction of transactions) {
    if (transaction.amount <= 0) continue;
    if (transaction.direction === "income") options.credit?.(room, clone(transaction));
    else options.debit?.(room, clone(transaction));
  }
  for (const event of events) options.recordEvent?.(room, clone(event));
}

export function hasProcessed(state, id) {
  return state.processedOperationIds.includes(id);
}

export function markProcessed(state, ...ids) {
  state.processedOperationIds = [...new Set([
    ...state.processedOperationIds,
    ...ids.map(identifier).filter(Boolean),
  ])].slice(-RETENTION.processedOperationIds);
}

export function duplicateResult(room, id) {
  const state = room.coachEmploymentState;
  if (!hasProcessed(state, id)) return null;
  const find = (field) => state[field]?.find((entry) => entry.operationId === id) ?? null;
  return {
    room,
    duplicate: true,
    operationId: id,
    contract: clone(find("contracts")),
    proposal: clone(find("proposals")),
    vacancy: clone(find("vacancies")),
    application: clone(find("applications")),
    interview: clone(find("interviews")),
    appointment: clone(find("appointments")),
    evaluation: clone(find("evaluations")),
    guarantee: clone(find("guarantees")),
    notification: clone(find("notifications")),
    events: [],
    financialTransactions: [],
  };
}

function fillVacancyMutable(room, state, input, now, operationIdValue, events = []) {
  const clubId = canonicalClubId(room, input.clubId);
  const explicitVacancyId = identifier(input.vacancyId);
  const selectedProposalId = identifier(input.proposalId);
  const selectedApplicationId = identifier(input.applicationId);
  const coachId = identifier(input.coachId);
  const matching = state.vacancies.filter((vacancy) => (
    (explicitVacancyId ? vacancy.id === explicitVacancyId : clubKey(vacancy.clubId) === clubKey(clubId))
      && ["open", "filled"].includes(vacancy.status)
  ));
  if (explicitVacancyId && matching.length === 0) {
    throw new CoachEmploymentError("Vaga nao encontrada", "COACH_VACANCY_NOT_FOUND", 404, { vacancyId: explicitVacancyId });
  }

  for (const vacancy of matching) {
    if (vacancy.status === "filled") {
      if (vacancy.appointedCoachId !== coachId) {
        throw new CoachEmploymentError("Vaga ja preenchida", "COACH_VACANCY_ALREADY_FILLED", 409, {
          vacancyId: vacancy.id,
          appointedCoachId: vacancy.appointedCoachId,
        });
      }
      continue;
    }
    vacancy.status = "filled";
    vacancy.marketStage = "completed";
    vacancy.lastMarketActionAt = now;
    vacancy.filledAt = now;
    vacancy.appointedCoachId = coachId;
    vacancy.filledProposalId = selectedProposalId || null;
    const inferredApplication = state.applications.find((application) => (
      application.vacancyId === vacancy.id && application.coachId === coachId
    ));
    vacancy.filledApplicationId = selectedApplicationId || inferredApplication?.id || null;
    vacancy.closureOperationId = operationIdValue;

    for (const application of state.applications.filter((candidate) => candidate.vacancyId === vacancy.id)) {
      const hired = application.id === vacancy.filledApplicationId
        || (!vacancy.filledApplicationId && application.coachId === coachId);
      if (hired) {
        if (application.status !== "contratado") {
          const previousStatus = application.status;
          application.status = "contratado";
          application.updatedAt = now;
          application.closedAt = now;
          application.closedReason = "candidate_hired";
          application.closedBy = operationIdValue;
          appendDecision(application, {
            action: "candidate_hired",
            responsibleId: "system",
            responsibleRole: "system",
            previousStatus,
            newStatus: application.status,
            justification: "Vaga preenchida pelo candidato contratado",
          }, now, `${operationIdValue}:application:${application.id}`);
        }
      } else if (ACTIVE_APPLICATION_STATUSES.has(application.status)) {
        const previousStatus = application.status;
        application.status = "encerrado_vaga_preenchida";
        application.updatedAt = now;
        application.closedAt = now;
        application.closedReason = "vacancy_filled";
        application.closedBy = operationIdValue;
        appendDecision(application, {
          action: "vacancy_filled",
          responsibleId: "system",
          responsibleRole: "system",
          previousStatus,
          newStatus: application.status,
          justification: "Processo encerrado automaticamente porque a vaga foi preenchida",
        }, now, `${operationIdValue}:application:${application.id}`);
        appendNotification(state, {
          type: "COACH_APPLICATION_CLOSED_VACANCY_FILLED",
          recipientId: application.coachId,
          recipientRole: "coach",
          coachId: application.coachId,
          clubId: vacancy.clubId,
          vacancyId: vacancy.id,
          applicationId: application.id,
          title: "Processo seletivo encerrado",
          message: "A vaga foi preenchida por outro candidato.",
        }, now, `${operationIdValue}:application:${application.id}`);
      }
    }

    const applicationIds = new Set(state.applications
      .filter((application) => application.vacancyId === vacancy.id)
      .map((application) => application.id));
    for (const interview of state.interviews.filter((candidate) => (
      candidate.vacancyId === vacancy.id || applicationIds.has(candidate.applicationId)
    ))) {
      const hired = interview.coachId === coachId
        && (!vacancy.filledApplicationId || interview.applicationId === vacancy.filledApplicationId);
      if (hired) {
        if (interview.status !== "contratado") {
          const previousStatus = interview.status;
          interview.status = "contratado";
          interview.closedAt = now;
          interview.closedReason = "candidate_hired";
          interview.closedBy = operationIdValue;
          appendDecision(interview, {
            action: "candidate_hired", responsibleId: "system", responsibleRole: "system",
            previousStatus, newStatus: interview.status,
          }, now, `${operationIdValue}:interview:${interview.id}`);
        }
      } else if (ACTIVE_INTERVIEW_STATUSES.has(interview.status)) {
        const previousStatus = interview.status;
        interview.status = "encerrado_vaga_preenchida";
        interview.closedAt = now;
        interview.closedReason = "vacancy_filled";
        interview.closedBy = operationIdValue;
        appendDecision(interview, {
          action: "vacancy_filled", responsibleId: "system", responsibleRole: "system",
          previousStatus, newStatus: interview.status,
        }, now, `${operationIdValue}:interview:${interview.id}`);
      }
    }

    for (const proposal of state.proposals.filter((candidate) => (
      candidate.id !== selectedProposalId
        && (candidate.vacancyId === vacancy.id
          || (!candidate.vacancyId && clubKey(candidate.clubId) === clubKey(vacancy.clubId)))
    ))) {
      if (!ACTIVE_PROPOSAL_STATUSES.has(proposal.status)) continue;
      const previousStatus = proposal.status;
      proposal.status = "encerrado_vaga_preenchida";
      proposal.updatedAt = now;
      proposal.respondedAt = now;
      proposal.closedAt = now;
      proposal.closedReason = "vacancy_filled";
      proposal.closedBy = operationIdValue;
      proposal.pendingCounterproposal = null;
      appendDecision(proposal, {
        action: "vacancy_filled", responsibleId: "system", responsibleRole: "system",
        previousStatus, newStatus: proposal.status,
        justification: "Negociacao encerrada porque a vaga foi preenchida",
      }, now, `${operationIdValue}:proposal:${proposal.id}`);
      const candidateAlreadyNotified = state.applications.some((application) => (
        application.vacancyId === vacancy.id && application.coachId === proposal.coachId
      ));
      if (!candidateAlreadyNotified) {
        appendNotification(state, {
          type: "COACH_PROPOSAL_CLOSED_VACANCY_FILLED",
          recipientId: proposal.coachId,
          recipientRole: "coach",
          coachId: proposal.coachId,
          clubId: vacancy.clubId,
          proposalId: proposal.id,
          vacancyId: vacancy.id,
          title: "Negociacao encerrada",
          message: "A vaga foi preenchida por outro candidato.",
        }, now, `${operationIdValue}:proposal:${proposal.id}`);
      }
    }

    appendNotification(state, {
      type: "COACH_VACANCY_FILLED",
      recipientId: identifier(vacancy.recruiterId) || vacancy.clubId,
      recipientRole: identifier(vacancy.recruiterId) ? "recruiter" : "board",
      coachId,
      clubId: vacancy.clubId,
      vacancyId: vacancy.id,
      applicationId: vacancy.filledApplicationId,
      title: "Vaga preenchida",
      message: "Os demais processos seletivos foram encerrados automaticamente.",
    }, now, `${operationIdValue}:vacancy:${vacancy.id}`);
    events.push(eventRecord("COACH_VACANCY_FILLED", `${operationIdValue}:vacancy:${vacancy.id}`, now, {
      coachId,
      clubId: vacancy.clubId,
      proposalId: selectedProposalId,
      vacancyId: vacancy.id,
      metadata: { applicationId: vacancy.filledApplicationId },
    }));
  }
  return matching;
}

function appointmentFinancials(state, coach, targetClubId, input, now, id) {
  const sourceAppointment = activeAppointmentForCoach(state, coach.id);
  const sourceContract = sourceAppointment ? activeContractForCoach(state, coach.id) : null;
  const sourceClubId = sourceAppointment?.clubId ?? null;
  const compensation = sourceClubId && clubKey(sourceClubId) !== clubKey(targetClubId)
    ? integer(input?.compensation ?? sourceContract?.terminationClause, 0, 0, MAX_MONEY)
    : 0;
  const signingBonus = integer(input?.signingBonus, 0, 0, MAX_MONEY);
  const transactions = [];
  if (compensation + signingBonus > 0) transactions.push(financeRecord("expense", "coach_hiring", id, now, {
    id: `${id}:buyer`,
    clubId: targetClubId,
    relatedClubId: sourceClubId,
    coachId: coach.id,
    amount: compensation + signingBonus,
    description: `Contratacao de ${coach.name}`,
    metadata: { compensation, signingBonus },
  }));
  if (sourceClubId && compensation > 0) transactions.push(financeRecord("income", "coach_compensation", id, now, {
    id: `${id}:seller`,
    clubId: sourceClubId,
    relatedClubId: targetClubId,
    coachId: coach.id,
    amount: compensation,
    description: `Multa pela saida de ${coach.name}`,
  }));
  return { sourceAppointment, sourceContract, sourceClubId, compensation, signingBonus, transactions };
}

export function performImmediateAppointment(room, state, input, now, id) {
  const coach = coachById(room, input.coachId);
  if (coach.status === "retired") throw new CoachEmploymentError("Treinador aposentado", "COACH_RETIRED", 409);
  const clubId = canonicalClubId(room, input.clubId);
  if (!clubId) throw new CoachEmploymentError("Clube obrigatorio", "COACH_CLUB_REQUIRED", 400);
  const activeAtTarget = activeAppointmentForClub(state, clubId);
  if (activeAtTarget?.coachId === coach.id && activeAtTarget.role === (input.role ?? "head_coach")) {
    throw new CoachEmploymentError("Treinador ja ocupa o cargo", "COACH_ALREADY_AT_CLUB", 409);
  }

  const finance = appointmentFinancials(state, coach, clubId, input, now, id);
  const events = [];
  const transactions = [...finance.transactions];
  if (activeAtTarget && activeAtTarget.coachId !== coach.id) {
    const targetContract = activeContractForCoach(state, activeAtTarget.coachId);
    const targetPenalty = activeAtTarget.role === "interim"
      ? 0
      : integer(targetContract?.terminationClause, 0, 0, MAX_MONEY);
    const previous = closeAppointmentMutable(room, state, activeAtTarget, now, "replaced_by_appointment", "dismissed");
    if (targetPenalty > 0) transactions.push(financeRecord("expense", "coach_termination", id, now, {
      id: `${id}:target-termination`, clubId, coachId: previous.coach.id, amount: targetPenalty,
      description: `Rescisao de ${previous.coach.name}`,
    }));
    events.push(eventRecord("COACH_REPLACED", `${id}:replaced`, now, {
      coachId: previous.coach.id, clubId, contractId: previous.contract?.id, amount: targetPenalty,
      relatedClubId: clubId, metadata: { replacementCoachId: coach.id },
    }));
  }

  if (finance.sourceAppointment && clubKey(finance.sourceClubId) !== clubKey(clubId)) {
    closeAppointmentMutable(room, state, finance.sourceAppointment, now, "coach_transfer", "unemployed");
    const interim = createInterimMutable(
      room,
      state,
      finance.sourceClubId,
      "coach_transfer",
      now,
      `${id}:source`,
      { payBonus: true },
    );
    if (interim.event) events.push(interim.event);
    transactions.push(...interim.transactions);
  }

  const role = input.role === "interim" ? "interim" : "head_coach";
  const contract = contractTerms(room, coach, clubId, input, now, id, role);
  const appointment = appointmentRecord(room, coach.id, clubId, contract.id, input, now, id, role);
  state.contracts.push(contract);
  state.appointments.push(appointment);
  coach.currentClubId = clubId;
  coach.status = role === "interim" ? "interim" : "employed";
  appendCareerAssignment(coach, appointment);
  setHumanControl(room, coach.id, clubId);
  fillVacancyMutable(room, state, {
    clubId,
    coachId: coach.id,
    vacancyId: input.vacancyId,
    proposalId: input.proposalId,
    applicationId: input.applicationId,
  }, now, id, events);
  events.push(eventRecord(role === "interim" ? "COACH_INTERIM_APPOINTED" : "COACH_APPOINTED", id, now, {
    coachId: coach.id,
    clubId,
    relatedClubId: finance.sourceClubId,
    contractId: contract.id,
    amount: finance.compensation + finance.signingBonus,
    metadata: {
      entryReason: appointment.entryReason,
      wage: contract.wage,
      endDate: contract.endDate,
      compensation: finance.compensation,
      signingBonus: finance.signingBonus,
      objectives: clone(contract.objectives),
      staffPackageCommitments: clone(contract.staffPackageCommitments),
    },
  }));
  return { coach, contract, appointment, events, transactions, compensation: finance.compensation };
}

function scheduleAppointmentMutable(room, state, input, now, id) {
  const coach = coachById(room, input.coachId);
  const clubId = canonicalClubId(room, input.clubId);
  const coachConflict = state.appointments.find((appointment) => (
    appointment.status === "scheduled" && appointment.coachId === coach.id
  ));
  const clubConflict = state.appointments.find((appointment) => (
    appointment.status === "scheduled" && clubKey(appointment.clubId) === clubKey(clubId)
  ));
  if (coachConflict || clubConflict) {
    throw new CoachEmploymentError("Compromisso futuro conflitante", "COACH_SCHEDULED_APPOINTMENT_CONFLICT", 409, {
      coachId: coach.id,
      clubId,
      appointmentId: coachConflict?.id ?? clubConflict?.id,
    });
  }
  const startDate = timestamp(input.startDate);
  const role = input.role === "interim" ? "interim" : "head_coach";
  const contract = contractTerms(room, coach, clubId, { ...input, status: "scheduled", startDate }, now, id, role);
  const appointment = appointmentRecord(room, coach.id, clubId, contract.id, {
    ...input,
    status: "scheduled",
    startDate,
    expectedStartAt: startDate,
  }, now, id, role);
  state.contracts.push(contract);
  state.appointments.push(appointment);
  if (!coach.currentClubId) coach.status = "awaiting_start";
  const events = [eventRecord("COACH_APPOINTMENT_SCHEDULED", id, now, {
    coachId: coach.id, clubId, contractId: contract.id, metadata: { startDate },
  })];
  fillVacancyMutable(room, state, {
    clubId,
    coachId: coach.id,
    vacancyId: input.vacancyId,
    proposalId: input.proposalId,
    applicationId: input.applicationId,
  }, now, id, events);
  return { coach, contract, appointment, events, transactions: [] };
}

export function performAppointment(room, state, input, now, id) {
  assertCoachCanSign(coachById(room, input?.coachId), now);
  const startDate = nullableTimestamp(input?.startDate);
  return startDate && new Date(startDate).getTime() > new Date(now).getTime()
    ? scheduleAppointmentMutable(room, state, { ...input, startDate }, now, id)
    : performImmediateAppointment(room, state, input, now, id);
}

function closeRenewalNegotiationsForResignationMutable(state, coachId, contractId, now, operationIdValue) {
  for (const proposal of state.proposals.filter((candidate) => (
    candidate.coachId === coachId
      && candidate.kind === "renewal"
      && (!contractId || candidate.sourceContractId === contractId)
      && ACTIVE_PROPOSAL_STATUSES.has(candidate.status)
  ))) {
    const previousStatus = proposal.status;
    proposal.status = "withdrawn";
    proposal.marketStage = "closed";
    proposal.respondedAt = now;
    proposal.updatedAt = now;
    proposal.nextActionAt = null;
    proposal.pendingCounterproposal = null;
    proposal.responseReason = "coach_resigned_during_renewal";
    proposal.decisionReason = proposal.responseReason;
    appendDecision(proposal, {
      action: "withdraw_after_resignation",
      responsibleId: coachId,
      responsibleRole: "candidate",
      previousStatus,
      newStatus: proposal.status,
      justification: "Pedido de demissao encerrou a negociacao de renovacao",
    }, now, `${operationIdValue}:renewal:${proposal.id}`);
  }
}

export function resignCoachMutable(room, state, input, now, operationIdValue, options = {}) {
  const coach = coachById(room, input.coachId);
  const appointment = activeAppointmentForCoach(state, coach.id);
  if (!appointment) throw new CoachEmploymentError("Treinador sem vinculo ativo", "COACH_ACTIVE_APPOINTMENT_NOT_FOUND", 409);
  const requestedClubId = canonicalClubId(room, input.clubId);
  if (requestedClubId && clubKey(requestedClubId) !== clubKey(appointment.clubId)) {
    throw new CoachEmploymentError("Treinador nao pertence ao clube", "COACH_CLUB_MISMATCH", 409);
  }
  const contract = activeContractForCoach(state, coach.id);
  const consequences = applyVoluntaryResignationConsequencesMutable(
    room,
    state,
    coach,
    appointment,
    contract,
    input,
    now,
    operationIdValue,
    options,
  );
  closeRenewalNegotiationsForResignationMutable(state, coach.id, contract?.id, now, operationIdValue);
  const closed = closeAppointmentMutable(room, state, appointment, now, consequences.reasonCode, "resigned");
  const interim = createInterimMutable(
    room,
    state,
    appointment.clubId,
    consequences.reasonCode,
    now,
    operationIdValue,
    { payBonus: true },
  );
  const transactions = consequences.financialCost > 0 ? [financeRecord(
    "income",
    "coach_resignation_compensation",
    operationIdValue,
    now,
    {
      clubId: appointment.clubId,
      coachId: coach.id,
      amount: consequences.financialCost,
      description: `Compensacao pela saida de ${coach.name}`,
      metadata: { justCauseVerified: consequences.justCauseVerified },
    },
  )] : [];
  transactions.push(...interim.transactions);
  const events = [eventRecord("COACH_RESIGNED", operationIdValue, now, {
    coachId: coach.id,
    clubId: appointment.clubId,
    contractId: contract?.id,
    vacancyId: interim.vacancy?.id,
    amount: consequences.financialCost,
    metadata: {
      reason: consequences.reasonCode,
      reasonLabel: consequences.reasonLabel,
      justCauseVerified: consequences.justCauseVerified,
      reputationDelta: consequences.reputationDelta,
      trustDelta: consequences.trustDelta,
      inactivityDays: consequences.inactivityDays,
      restrictionEndsAt: consequences.restrictionEndsAt,
      pendingProjectPenalty: consequences.pendingProjectPenalty,
      evidenceCodes: consequences.evidenceCodes,
    },
  })];
  if (interim.event) events.push(interim.event);
  appendNotification(state, {
    type: "COACH_RESIGNATION_CONSEQUENCES",
    recipientId: coach.id,
    recipientRole: "coach",
    coachId: coach.id,
    clubId: appointment.clubId,
    title: "Consequencias da saida",
    message: `Reputacao ${consequences.reputationDelta}; assinatura bloqueada por ${consequences.inactivityDays} dia(s).`,
  }, now, operationIdValue);
  return {
    coach: closed.coach,
    contract: closed.contract,
    appointment,
    interimAppointment: interim.appointment,
    vacancy: interim.vacancy,
    events,
    transactions,
    penalty: consequences.financialCost,
    consequences,
  };
}

export function closeProposalSelectionMutable(state, proposal, outcome, reason, now, operationIdValue) {
  const application = state.applications.find((candidate) => candidate.id === proposal.applicationId);
  if (application && ACTIVE_APPLICATION_STATUSES.has(application.status)) {
    const previousStatus = application.status;
    application.status = outcome === "withdrawn" ? "withdrawn" : "rejected";
    application.updatedAt = now;
    application.closedAt = now;
    application.closedReason = reason;
    application.closedBy = operationIdValue;
    application.responseReason = reason;
    appendDecision(application, {
      action: outcome === "withdrawn" ? "candidate_withdrew" : "proposal_closed",
      responsibleId: proposal.coachId,
      responsibleRole: outcome === "withdrawn" ? "candidate" : "system",
      previousStatus,
      newStatus: application.status,
      justification: reason,
    }, now, `${operationIdValue}:application`);
  }
  const interview = state.interviews.find((candidate) => candidate.id === proposal.interviewId);
  if (interview && ACTIVE_INTERVIEW_STATUSES.has(interview.status)) {
    const previousStatus = interview.status;
    interview.status = "rejected";
    interview.closedAt = now;
    interview.closedReason = reason;
    interview.closedBy = operationIdValue;
    appendDecision(interview, {
      action: "proposal_closed",
      responsibleId: "system",
      responsibleRole: "system",
      previousStatus,
      newStatus: interview.status,
      justification: reason,
    }, now, `${operationIdValue}:interview`);
  }
}

export function closeCoachCompetingNegotiationsMutable(state, winner, now, operationIdValue, events) {
  const reason = winner.kind === "renewal" ? "coach_renewed_contract" : "coach_signed_elsewhere";
  for (const proposal of state.proposals) {
    if (proposal.id === winner.id || proposal.coachId !== winner.coachId || !ACTIVE_PROPOSAL_STATUSES.has(proposal.status)) continue;
    const previousStatus = proposal.status;
    proposal.status = "withdrawn";
    proposal.marketStage = "closed";
    proposal.respondedAt = now;
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    proposal.nextActionAt = null;
    proposal.responseReason = reason;
    proposal.decisionReason = reason;
    proposal.closedAt = now;
    proposal.closedReason = reason;
    proposal.closedBy = operationIdValue;
    proposal.pendingCounterproposal = null;
    appendDecision(proposal, {
      action: "competing_offer_closed",
      responsibleId: "system",
      responsibleRole: "system",
      previousStatus,
      newStatus: proposal.status,
      justification: reason,
    }, now, `${operationIdValue}:competing:${proposal.id}`);
    appendNotification(state, {
      type: "COACH_COMPETING_NEGOTIATION_CLOSED",
      recipientId: proposal.clubId,
      recipientRole: "board",
      coachId: proposal.coachId,
      clubId: proposal.clubId,
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      title: "Negociacao concorrente encerrada",
      message: winner.kind === "renewal"
        ? "O treinador renovou com o clube atual."
        : "O treinador chegou a acordo com outro clube.",
    }, now, `${operationIdValue}:competing:${proposal.id}`);
    events.push(eventRecord("COACH_COMPETING_PROPOSAL_CLOSED", `${operationIdValue}:competing:${proposal.id}`, now, {
      coachId: proposal.coachId,
      clubId: proposal.clubId,
      relatedClubId: winner.clubId,
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      metadata: { reason, winningProposalId: winner.id },
    }));
  }

  for (const application of state.applications) {
    if (application.coachId !== winner.coachId || !ACTIVE_APPLICATION_STATUSES.has(application.status)) continue;
    if (application.id === winner.applicationId) continue;
    const previousStatus = application.status;
    application.status = "withdrawn";
    application.updatedAt = now;
    application.closedAt = now;
    application.closedReason = reason;
    application.closedBy = operationIdValue;
    appendDecision(application, {
      action: "competing_offer_closed",
      responsibleId: "system",
      responsibleRole: "system",
      previousStatus,
      newStatus: application.status,
      justification: reason,
    }, now, `${operationIdValue}:competing:application:${application.id}`);
  }
  for (const interview of state.interviews) {
    if (interview.coachId !== winner.coachId || !ACTIVE_INTERVIEW_STATUSES.has(interview.status)) continue;
    if (interview.id === winner.interviewId) continue;
    const previousStatus = interview.status;
    interview.status = "rejected";
    interview.closedAt = now;
    interview.closedReason = reason;
    interview.closedBy = operationIdValue;
    appendDecision(interview, {
      action: "competing_offer_closed",
      responsibleId: "system",
      responsibleRole: "system",
      previousStatus,
      newStatus: interview.status,
      justification: reason,
    }, now, `${operationIdValue}:competing:interview:${interview.id}`);
  }
}

export function performRenewalAgreementMutable(room, state, proposal, now, operationIdValue, guaranteeTerms) {
  const coach = coachById(room, proposal.coachId);
  const appointment = activeAppointmentForCoach(state, coach.id);
  const previous = activeContractForCoach(state, coach.id);
  if (!appointment || !previous || clubKey(appointment.clubId) !== clubKey(proposal.clubId)) {
    throw new CoachEmploymentError("Contrato de renovacao nao esta mais ativo", "COACH_RENEWAL_CONTRACT_CHANGED", 409);
  }
  if (proposal.sourceContractId && previous.id !== proposal.sourceContractId) {
    throw new CoachEmploymentError("Contrato original da renovacao foi alterado", "COACH_RENEWAL_SOURCE_CHANGED", 409);
  }
  previous.status = "replaced";
  previous.endedAt = now;
  previous.endReason = "renewed_after_negotiation";
  const contract = contractTerms(room, coach, proposal.clubId, {
    wage: proposal.wage,
    durationYears: proposal.durationYears,
    terminationClause: proposal.terminationClause ?? previous.terminationClause,
    signingBonus: proposal.signingBonus,
    transferBudget: proposal.transferBudget,
    autonomyLevel: clamp(finite(previous.autonomyLevel, 50) + finite(proposal.autonomyDelta), 0, 100),
    objectiveDifficultyAdjustment: proposal.objectiveDifficultyDelta,
    sourceInterviewId: proposal.interviewId,
    bonuses: proposal.bonuses,
    guaranteeIds: guaranteeTerms.guaranteeIds,
    clauses: [...proposal.specialClauses, ...guaranteeTerms.clauses],
    staffPackageCommitments: guaranteeTerms.staffPackageCommitments,
    objectives: proposal.objectives.length ? proposal.objectives : previous.objectives,
    renewalOption: previous.renewalOption,
    renewalCount: previous.renewalCount + 1,
  }, now, operationIdValue, appointment.role);
  state.contracts.push(contract);
  appointment.contractId = contract.id;
  const transactions = proposal.signingBonus > 0 ? [financeRecord("expense", "coach_contract_renewal", operationIdValue, now, {
    clubId: proposal.clubId,
    coachId: coach.id,
    amount: proposal.signingBonus,
    description: `Renovacao negociada de ${coach.name}`,
  })] : [];
  const events = [eventRecord("COACH_CONTRACT_RENEWED", operationIdValue, now, {
    coachId: coach.id,
    clubId: proposal.clubId,
    contractId: contract.id,
    proposalId: proposal.id,
    amount: proposal.signingBonus,
    metadata: {
      source: "negotiated_coach_market",
      previousContractId: previous.id,
      wage: contract.wage,
      endDate: contract.endDate,
      negotiationRound: proposal.negotiationRound,
    },
  })];
  return { coach, appointment, contract, previousContract: previous, transactions, events };
}

export function applyInterviewRelationshipMutable(coach, interview, now, operationIdValue) {
  if (interview.effectsAppliedAt) return;
  const impact = normalizeInterviewRelationshipImpact(interview.relationshipImpact);
  const metrics = normalizeInterviewMetrics(interview.evaluation?.metrics ?? interview.cumulativeMetrics);
  const relationships = Array.isArray(coach.clubRelationships) ? coach.clubRelationships : [];
  const current = relationships.find((entry) => clubKey(entry?.clubId) === clubKey(interview.clubId)) ?? {};
  const boardDelta = clamp(impact.boardConfidenceDelta + ((metrics.boardConfidence - 50) * 0.08), -20, 20);
  const credibilityDelta = clamp(impact.credibilityDelta + ((metrics.credibility - 50) * 0.05), -20, 20);
  const relationship = {
    ...clone(current),
    clubId: interview.clubId,
    boardConfidence: Math.round(clamp(finite(current.boardConfidence, 50) + boardDelta, 0, 100) * 10) / 10,
    credibility: Math.round(clamp(finite(current.credibility, 50) + credibilityDelta, 0, 100) * 10) / 10,
    strategicAlignment: Math.round(clamp(
      finite(current.strategicAlignment, 50) + impact.strategicAlignmentDelta + ((metrics.clubCompatibility - 50) * 0.06),
      0,
      100,
    ) * 10) / 10,
    culturalCompatibility: Math.round(clamp(
      finite(current.culturalCompatibility, 50) + impact.culturalCompatibilityDelta + ((metrics.culturalFit - 50) * 0.06),
      0,
      100,
    ) * 10) / 10,
    perceivedRisk: Math.round(clamp(
      finite(current.perceivedRisk, 50) + impact.perceivedRiskDelta + ((metrics.perceivedRisk - 50) * 0.06),
      0,
      100,
    ) * 10) / 10,
    expectedTenure: Math.round(clamp(
      finite(current.expectedTenure, 50) + impact.expectedTenureDelta + ((metrics.longTermPotential - 50) * 0.06),
      0,
      100,
    ) * 10) / 10,
    interviewId: interview.id,
    updatedAt: now,
  };
  coach.clubRelationships = [
    ...relationships.filter((entry) => clubKey(entry?.clubId) !== clubKey(interview.clubId)),
    relationship,
  ].slice(-50);
  coach.credibility = Math.round(clamp(finite(coach.credibility, 50) + credibilityDelta, 0, 100) * 10) / 10;
  if (!coach.currentClubId || clubKey(coach.currentClubId) === clubKey(interview.clubId)) {
    coach.boardConfidence = relationship.boardConfidence;
    coach.boardRelationship = relationship.strategicAlignment;
  }

  const evaluation = normalizeInterviewEvaluation(interview.evaluation, now, interview.compatibilityScore ?? 50);
  const commitments = [
    ...(interview.negotiationEffects?.objectives ?? []),
    ...(interview.negotiationEffects?.specialClauses ?? []),
    ...(interview.transcript ?? [])
      .filter((entry) => entry.role === "coach" && /\b(vou|pretendo|compromet|prioriz|garant)/iu.test(entry.text))
      .map((entry) => entry.text),
  ].map((entry) => limitedInterviewText(entry, 240)).filter(Boolean).slice(0, 20);
  const contradictions = [
    ...(evaluation?.risks ?? []).filter((entry) => /contradi|inconsist|diverg/iu.test(entry)),
    ...(interview.transcript ?? [])
      .filter((entry) => entry.role === "board" && /contradi|inconsist|diferen.ca/iu.test(entry.text))
      .map((entry) => entry.text),
  ].map((entry) => limitedInterviewText(entry, 240)).filter(Boolean).slice(0, 20);
  const memory = normalizeCoachInterviewMemories([{
    id: deterministicId("coach-interview-memory", `${coach.id}|${interview.id}`),
    interviewId: interview.id,
    clubId: interview.clubId,
    summary: interview.memorySummary ?? evaluation?.summary,
    commitments,
    contradictions,
    questions: (interview.transcript ?? [])
      .filter((entry) => entry.role === "board" && entry.topic !== "closing")
      .map((entry) => entry.text),
    evaluation,
    recommendation: evaluation?.recommendation,
    occurredAt: now,
    operationId: operationIdValue,
  }], 1)[0];
  if (memory) {
    coach.interviewMemories = [
      ...(coach.interviewMemories ?? []).filter((entry) => entry.interviewId !== interview.id),
      memory,
    ].slice(-100);
  }
  interview.effectsAppliedAt = now;
  interview.effectsAppliedOperationId = operationIdValue;
}

export function fixturesAndResults(room) {
  const fixtures = new Map((Array.isArray(room?.leagueFixtureSchedule) ? room.leagueFixtureSchedule : [])
    .map((fixture) => [identifier(fixture?.leagueFixtureId), fixture]));
  return (Array.isArray(room?.leagueMatchResults) ? room.leagueMatchResults : []).flatMap((result) => {
    const fixture = fixtures.get(identifier(result?.leagueFixtureId));
    const score = Array.isArray(result?.score) ? result.score.map((value) => integer(value, 0, 0, 50)) : null;
    return fixture && score?.length >= 2 ? [{ fixture, result, score }] : [];
  });
}

export function leagueForClub(room, clubId) {
  return (room?.competitionCatalog ?? []).find((competition) => (
    (competition?.clubs ?? []).some((club) => clubKey(club?.id ?? club?.code) === clubKey(clubId))
  )) ?? null;
}

export function appointmentStatistics(room, appointment, now) {
  const league = leagueForClub(room, appointment.clubId);
  const startRound = integer(appointment.startedRound, 1, 1);
  const endRound = appointment.status === "active"
    ? Number.MAX_SAFE_INTEGER
    : integer(appointment.endedRound, completedRound(room), 0);
  const relevant = fixturesAndResults(room).filter(({ fixture }) => (
    clubKey(fixture?.leagueId) === clubKey(league?.id)
      && integer(fixture?.round, 0) >= startRound
      && integer(fixture?.round, 0) <= endRound
      && [fixture.homeClubId, fixture.awayClubId].some((clubId) => clubKey(clubId) === clubKey(appointment.clubId))
  ));
  const statistics = relevant.reduce((summary, { fixture, score }) => {
    const home = clubKey(fixture.homeClubId) === clubKey(appointment.clubId);
    const own = home ? score[0] : score[1];
    const rival = home ? score[1] : score[0];
    summary.games += 1;
    summary.goalsFor += own;
    summary.goalsAgainst += rival;
    if (own > rival) {
      summary.wins += 1;
      summary.points += 3;
    } else if (own === rival) {
      summary.draws += 1;
      summary.points += 1;
    } else summary.losses += 1;
    return summary;
  }, {
    games: 0,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
  });
  return normalizeAppointmentStatistics({
    ...statistics,
    pointsPerGame: statistics.games > 0 ? statistics.points / statistics.games : 0,
    updatedAt: now,
  });
}

export function careerHistoryMarketSignals(room, state, coach, now = state?.currentDate) {
  // ensureCoachEmploymentState synchronizes this permanent ledger before any
  // market operation. Read it directly here: rebuilding a cloned full room for
  // every candidate made shortlist scans quadratic in save size.
  const spells = Array.isArray(coach?.assignments) ? coach.assignments : [];
  const reputation = Array.isArray(coach?.careerReputationHistory)
    ? coach.careerReputationHistory
    : [];
  const history = {
    version: coach?.careerHistoryVersion ?? null,
    updatedAt: coach?.careerHistoryUpdatedAt ?? now ?? null,
    coachId: coach?.id ?? null,
    summary: coach?.careerHistorySummary ?? {},
    assignments: spells,
    spells,
    matches: Array.isArray(coach?.careerMatchHistory) ? coach.careerMatchHistory : [],
    timeline: Array.isArray(coach?.careerTimeline) ? coach.careerTimeline : [],
    negotiations: Array.isArray(coach?.negotiationHistory) ? coach.negotiationHistory : [],
    reputationHistory: reputation,
    unemploymentPeriods: Array.isArray(coach?.unemploymentPeriods) ? coach.unemploymentPeriods : [],
  };
  const summary = history?.summary ?? {};
  const matches = Math.max(0, finite(summary.matches, 0));
  const pointsPerGame = matches > 0 ? finite(summary.pointsPerGame, 0) : null;
  const titles = Math.max(0, finite(summary.titles, 0));
  const renewals = Math.max(0, finite(summary.renewals, 0));
  const resignations = Math.max(0, finite(summary.resignations, 0));
  const dismissals = Math.max(0, finite(summary.dismissals, 0));
  const relegations = Math.max(0, finite(summary.relegations, 0));
  const completedContracts = spells.filter((spell) => (
    ["contract_expired", "contract_completed", "natural_end"].includes(identifier(spell?.exitReason))
  )).length;
  const longSpells = spells.filter((spell) => finite(spell?.durationDays, 0) >= 365).length;
  const performance = matches >= 5
    ? clamp(((pointsPerGame - 1.35) * 12) + Math.min(8, titles * 1.5), -8, 14)
    : Math.min(5, titles * 1.5);
  const reliability = clamp(
    (completedContracts * 2)
      + (renewals * 1.5)
      + Math.min(4, longSpells)
      - (resignations * 3.5)
      - (dismissals * 1.5),
    -14,
    10,
  );
  const risk = clamp(
    35
      + (resignations * 12)
      + (dismissals * 7)
      + (relegations * 4)
      - (completedContracts * 4)
      - (Math.min(4, longSpells) * 3),
    0,
    100,
  );
  const orderedReputation = [...reputation]
    .filter((entry) => Number.isFinite(Number(entry?.reputationAfter ?? entry?.value)))
    .sort((left, right) => String(left?.occurredAt ?? left?.date ?? "")
      .localeCompare(String(right?.occurredAt ?? right?.date ?? "")));
  const firstReputation = orderedReputation[0];
  const lastReputation = orderedReputation.at(-1);
  const reputationTrend = firstReputation && lastReputation
    ? clamp(
      finite(lastReputation.reputationAfter ?? lastReputation.value, 0)
        - finite(firstReputation.reputationAfter ?? firstReputation.value, 0),
      -20,
      20,
    )
    : 0;
  return {
    history,
    matches,
    pointsPerGame,
    titles,
    renewals,
    resignations,
    dismissals,
    completedContracts,
    longSpells,
    performance: Math.round(performance * 10) / 10,
    reliability: Math.round(reliability * 10) / 10,
    reputationTrend: Math.round(reputationTrend * 10) / 10,
    risk: Math.round(risk * 10) / 10,
    marketAdjustment: Math.round(clamp(performance + reliability + reputationTrend * 0.15, -24, 18) * 10) / 10,
    salaryMultiplier: clamp(
      1
        + Math.max(0, performance) * 0.012
        + Math.min(10, titles) * 0.01
        - Math.max(0, risk - 60) * 0.002,
      0.85,
      1.25,
    ),
    durationDelta: risk >= 65 ? -1 : risk <= 30 && longSpells > 0 ? 1 : 0,
  };
}

export function coachMarketAssessment(room, state, coach, vacancy, now, config = state.marketConfig) {
  const assessment = evaluateCoachCandidate(room, state, coach, vacancy, now, {
    selectionWeights: config?.selectionWeights,
    activeSearch: state.jobSearchByCoachId?.[coach.id]?.active === true,
  });
  const trust = coachCareerTrustSummary(coach);
  const activeRestriction = activeCoachMarketRestriction(coach, now);
  const historySignals = careerHistoryMarketSignals(room, state, coach, now);
  const conductAdjustment = clamp(
    ((trust.score - 80) * 0.18) - (activeRestriction ? 2 : 0),
    -25,
    6,
  );
  const totalAdjustment = conductAdjustment + historySignals.marketAdjustment;
  return {
    ...assessment,
    score: Math.round(clamp(assessment.score + totalAdjustment, 0, 100) * 100) / 100,
    careerHistory: {
      summary: clone(historySignals.history?.summary ?? {}),
      risk: historySignals.risk,
      performance: historySignals.performance,
      reliability: historySignals.reliability,
      reputationTrend: historySignals.reputationTrend,
      evidence: {
        matches: historySignals.matches,
        titles: historySignals.titles,
        completedContracts: historySignals.completedContracts,
        longSpells: historySignals.longSpells,
        resignations: historySignals.resignations,
        dismissals: historySignals.dismissals,
      },
    },
    factors: [
      ...assessment.factors,
      {
        code: "career_reliability",
        label: "Confianca profissional",
        weight: 0,
        rawScore: trust.score,
        weightedScore: Math.round(conductAdjustment * 100) / 100,
        detail: `${trust.label}; ${trust.voluntaryExitCount} saida(s) voluntaria(s)`,
      },
      {
        code: "career_history",
        label: "Historico profissional",
        weight: 0,
        rawScore: Math.round(clamp(50 + historySignals.marketAdjustment * 2, 0, 100) * 100) / 100,
        weightedScore: historySignals.marketAdjustment,
        detail: `${historySignals.matches} jogo(s); ${historySignals.titles} titulo(s); risco ${historySignals.risk}/100`,
      },
    ],
  };
}

export function coachEligibleForVacancy(room, state, coach, vacancy, now, config) {
  if (["retired", "retiring", "on_leave"].includes(coach.status)
    || coachRetirementBlocksMarket(room, coach.id)) return false;
  const vacancyOpenedAt = new Date(vacancy.openedAt ?? 0).getTime();
  const recentDeparture = [...(coach.assignments ?? [])].reverse().find((assignment) => (
    clubKey(assignment.clubId) === clubKey(vacancy.clubId)
      && assignment.exitReason
      && Number.isFinite(new Date(assignment.endedAt ?? 0).getTime())
      && new Date(assignment.endedAt ?? 0).getTime() >= vacancyOpenedAt - (180 * DAY_MS)
  ));
  if (recentDeparture) return false;
  if (clubKey(coach.currentClubId) === clubKey(vacancy.clubId)) return false;
  if (coach.currentClubId) {
    const activeContract = activeContractForCoach(state, coach.id);
    const remainingDays = activeContract?.endDate
      ? Math.ceil((new Date(activeContract.endDate).getTime() - new Date(now).getTime()) / DAY_MS)
      : Number.POSITIVE_INFINITY;
    const contractAvailable = remainingDays > 0 && remainingDays <= config.preContractWindowDays
      ? true
      : clubCanAffordCoachRelease(room, state, coach, vacancy.clubId);
    if (!contractAvailable) return false;
  }
  return coachMarketAssessment(room, state, coach, vacancy, now, config).eligible;
}

export function availableClubFunds(room, clubId) {
  const finance = (room?.marketState?.finances ?? []).find((entry) => (
    clubKey(entry?.clubId) === clubKey(clubId)
  ));
  if (!finance || !Number.isFinite(Number(finance.balance))) return null;
  return Math.max(0, Number(finance.balance) - Math.max(0, finite(finance.committed, 0)));
}

function salarySolvencyCostForTerms(wage, durationYears) {
  const monthlyWage = integer(wage, 0, 0, 20_000_000);
  const months = Math.min(12, integer(durationYears, 2, 1, 10) * 12);
  return Math.min(MAX_MONEY, monthlyWage * months);
}

function clubCanAffordCoachRelease(room, state, coach, targetClubId) {
  if (!coach.currentClubId || clubKey(coach.currentClubId) === clubKey(targetClubId)) return true;
  const funds = availableClubFunds(room, targetClubId);
  if (funds == null) return true;
  const contract = activeContractForCoach(state, coach.id);
  return funds >= integer(contract?.terminationClause, 0, 0, MAX_MONEY);
}

export function coachOfferWage(room, coach, clubId, desiredProfile = null, state = null, now = null) {
  const club = catalogClubs(room).get(clubKey(clubId));
  const coachReputation = normalizeCoachReputation100(coach?.reputation, 45);
  const clubReputation = normalizeCoachReputation100(club?.reputation, 45);
  const fallback = Math.round((25_000 + coachReputation * 1_750 + clubReputation * 1_250) / 1_000) * 1_000;
  const salary = desiredProfile?.salary ?? {};
  const minimum = Math.max(1_000, integer(salary.minimum, Math.round(fallback * 0.75), 1_000, MAX_MONEY));
  const ideal = integer(salary.ideal, fallback, minimum, MAX_MONEY);
  const maximum = integer(salary.maximum, Math.round(fallback * 1.35), ideal, MAX_MONEY);
  const expected = integer(coach?.expectedSalary, ideal, 0, MAX_MONEY);
  const careerMultiplier = state
    ? careerHistoryMarketSignals(room, state, coach, now ?? state.currentDate).salaryMultiplier
    : 1;
  return Math.round(clamp(
    ((ideal * 0.65) + (expected * 0.35)) * careerMultiplier,
    minimum,
    maximum,
  ) / 1_000) * 1_000;
}
