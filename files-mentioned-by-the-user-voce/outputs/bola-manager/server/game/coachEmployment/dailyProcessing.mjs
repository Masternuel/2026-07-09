// Daily coach employment processing (processCoachEmploymentDate).
// Split from coachEmployment.mjs (audit Q-02); declarations are unchanged.
import { evaluateCoachJobSecurity } from "../coachJobSecurity.mjs";
import { normalizeCoachReputation100 } from "../coachCandidateScoring.mjs";
import { activeCoachMarketRestriction, coachCareerTrustSummary, coachRecoveryDelta } from "../coachCareerConduct.mjs";
import { ACTIVE_PROPOSAL_STATUSES, DAY_MS, MAX_MONEY, activeAppointmentForCoach, activeContractForCoach, addDays, assertCoachEmploymentIntegrity, careerDate, catalogClubs, clamp, clone, closeAppointmentMutable, clubKey, coachById, completedRound, createInterimMutable, deterministicId, ensureCoachEmploymentState, eventRecord, financeRecord, finite, hashText, identifier, integer, interimBonusTransactionMutable, interviewDepthLimits, limitedInterviewText, normalizeApplication, normalizeEvaluation, normalizeInterview, normalizeInterviewEvaluation, normalizeInterviewMetrics, normalizeInterviewNegotiationEffects, normalizeInterviewRelationshipImpact, normalizeProposal, normalizedMarketConfig, normalizedObjectives, seasonNumber, synchronizeCareerAndRetain } from "./state.mjs";
import { appendCoachConductEntry, appendDecision, appendNotification, applyCoachReputationChangeMutable, applyInterviewRelationshipMutable, appointmentStatistics, assertProposalVacancyOpen, availableClubFunds, careerHistoryMarketSignals, closeCoachCompetingNegotiationsMutable, closeProposalSelectionMutable, coachConductConfig, coachEligibleForVacancy, coachMarketAssessment, coachOfferWage, contractGuaranteeTerms, emitCallbacks, ensureClubCanFundProposal, ensureProposalCanComplete, fixturesAndResults, guaranteesForProposal, hasProcessed, isStaffPackageGuarantee, leagueForClub, markProcessed, performAppointment, performImmediateAppointment, performRenewalAgreementMutable, preferredPersonalStaffPackage, proposalTerms, refreshCoachMarketStatus, registerProposalGuarantees, requiredStaffPackageGuarantee, resignCoachMutable, staffPackageFromGuarantee } from "./shared.mjs";
import { respondCoachBoardDecision } from "./proposals.mjs";

function applyCoachRecoveryMutable(state, coach, input, now, events, processed, options = {}) {
  const operationIdValue = identifier(input.operationId);
  if (!operationIdValue || hasProcessed(state, operationIdValue)) return null;
  const delta = coachRecoveryDelta(input.kind, input, coachConductConfig(state, options));
  if (delta <= 0) return null;
  const entry = applyCoachReputationChangeMutable(coach, {
    delta,
    trustDelta: Math.max(1, delta),
    type: input.kind,
    occurredAt: now,
    clubId: input.clubId,
    reasonCode: input.reasonCode ?? input.kind,
    reasonLabel: input.reasonLabel,
    operationId: operationIdValue,
    metadata: input.metadata,
  });
  events.push(eventRecord("COACH_REPUTATION_RECOVERED", operationIdValue, now, {
    coachId: coach.id,
    clubId: input.clubId,
    metadata: {
      source: input.kind,
      reputationDelta: entry?.reputationDelta ?? delta,
      reputationAfter: entry?.reputationAfter,
    },
  }));
  processed.push(operationIdValue);
  return entry;
}

function processCoachConductProgressMutable(room, state, now, options, events, processed) {
  for (const coach of room.coachCareerState?.coaches ?? []) {
    const restriction = coach.marketRestriction;
    if (restriction?.type === "voluntary_resignation"
      && !restriction.completedAt
      && new Date(restriction.endsAt ?? 0).getTime() <= new Date(now).getTime()) {
      const id = `coach-market-restriction-complete:${coach.id}:${restriction.endsAt}`;
      if (!hasProcessed(state, id)) {
        restriction.completedAt = now;
        restriction.signingBlocked = false;
        appendCoachConductEntry(coach, {
          id: deterministicId("coach-conduct", id),
          type: "market_restriction_completed",
          occurredAt: now,
          reasonCode: restriction.reasonCode,
          reasonLabel: "Periodo de inatividade concluido",
          restrictionEndsAt: restriction.endsAt,
          operationId: id,
        });
        appendNotification(state, {
          type: "COACH_MARKET_RESTRICTION_COMPLETED",
          recipientId: coach.id,
          recipientRole: "coach",
          coachId: coach.id,
          title: "Liberado para assinar",
          message: "Periodo obrigatorio sem clube concluido.",
        }, now, id);
        events.push(eventRecord("COACH_MARKET_RESTRICTION_COMPLETED", id, now, {
          coachId: coach.id,
          metadata: { restrictionEndsAt: restriction.endsAt },
        }));
        processed.push(id);
      }
    }
  }

  for (const appointment of state.appointments.filter((candidate) => (
    candidate.status === "active" && candidate.role === "head_coach"
  ))) {
    const startedAt = new Date(appointment.startedAt ?? appointment.appointedAt ?? now).getTime();
    const fullYears = Number.isFinite(startedAt)
      ? Math.min(10, Math.floor((new Date(now).getTime() - startedAt) / (365 * DAY_MS)))
      : 0;
    const coach = coachById(room, appointment.coachId);
    for (let year = 1; year <= fullYears; year += 1) {
      applyCoachRecoveryMutable(state, coach, {
        kind: "long_tenure",
        operationId: `coach-long-tenure:${appointment.id}:year-${year}`,
        clubId: appointment.clubId,
        reasonLabel: `${year} ano(s) de estabilidade profissional`,
        metadata: { appointmentId: appointment.id, completedYears: year },
      }, now, events, processed, options);
    }
  }

  const titleWinners = [];
  const seenTitles = new Set();
  const addTitleWinner = (winner, source, sourceSeason, index) => {
    const competitionId = identifier(winner?.tournamentId ?? winner?.competitionId ?? winner?.id) || `title-${index}`;
    const clubId = identifier(winner?.clubId ?? winner?.winnerClubId);
    const titleKey = `${sourceSeason}:${competitionId}:${clubId}`;
    if (!clubId || seenTitles.has(titleKey)) return;
    seenTitles.add(titleKey);
    titleWinners.push({ winner, source, sourceSeason, index, competitionId, clubId });
  };
  for (const [index, winner] of (room?.competitionSeason?.winners ?? []).entries()) {
    addTitleWinner(winner, "current", seasonNumber(room), index);
  }
  for (const [seasonIndex, season] of (room?.seasonHistory ?? []).entries()) {
    for (const [index, winner] of (season?.tournamentWinners ?? []).entries()) {
      addTitleWinner(winner, "archive", integer(season?.seasonNumber, seasonIndex + 1, 1), index);
    }
  }
  for (const [index, winner] of [
    ...(room?.competitionWinners ?? []),
    ...(room?.tournamentWinners ?? []),
  ].entries()) {
    addTitleWinner(winner, "legacy", integer(winner?.season, seasonNumber(room), 1), index);
  }

  for (const { winner, source, sourceSeason, index, competitionId, clubId } of titleWinners) {
    let coachId = identifier(winner?.coachId ?? winner?.managerId);
    if (!coachId && source === "current") {
      coachId = state.appointments
        .filter((appointment) => (
          appointment.role === "head_coach"
            && appointment.status === "active"
            && clubKey(appointment.clubId) === clubKey(clubId)
        ))
        .sort((left, right) => String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? "")))[0]?.coachId;
    }
    const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === coachId);
    if (!coach) continue;
    const winnerId = identifier(winner?.id)
      || `${competitionId}:${sourceSeason}:${clubId}:${index}`;
    applyCoachRecoveryMutable(state, coach, {
      kind: "title_won",
      operationId: `coach-title-recovery:${coach.id}:${winnerId}`,
      clubId,
      reasonLabel: "Titulo conquistado",
      metadata: { winnerId, competitionId, seasonNumber: sourceSeason, source },
    }, now, events, processed, options);
  }
}

function registerRequiredStaffPackageGuarantee(room, state, proposal, now, operationIdValue) {
  const staffPackage = preferredPersonalStaffPackage(room, proposal, now);
  if (!staffPackage) return { staffPackage: null, guarantee: null };
  const existing = requiredStaffPackageGuarantee(state, proposal, staffPackage);
  if (existing) return { staffPackage, guarantee: existing };
  const guarantee = registerProposalGuarantees(state, proposal, [{
    kind: "staff_package",
    category: "staff_package",
    description: `Contratar a comissao pessoal de ${staffPackage.headcount} profissional(is)`,
    staffPackage,
    dueAt: staffPackage.expectedHiringBy,
    mandatory: true,
    blocksCompletion: true,
    effects: [{
      type: "staff_package",
      action: "hire_coach_staff_package",
      coachId: staffPackage.coachId,
      clubId: staffPackage.clubId,
      staffIds: staffPackage.staffIds,
      members: staffPackage.members,
      monthlyCost: staffPackage.monthlyCost,
      firstYearCost: staffPackage.firstYearCost,
      maximumFirstYearCost: staffPackage.firstYearCost,
      expectedHiringBy: staffPackage.expectedHiringBy,
      staffPackage,
    }],
  }], now, operationIdValue, {
    status: "requested",
    mandatory: true,
    blocksCompletion: true,
    dueAt: staffPackage.expectedHiringBy,
  })[0] ?? null;
  return { staffPackage, guarantee };
}

function standingsFor(room, league) {
  const clubs = (league?.clubs ?? []).map((club) => identifier(club?.id ?? club?.code)).filter(Boolean);
  const rows = new Map(clubs.map((clubId) => [clubKey(clubId), {
    clubId, played: 0, points: 0, goalDifference: 0,
  }]));
  for (const { fixture, score } of fixturesAndResults(room)) {
    if (clubKey(fixture?.leagueId) !== clubKey(league?.id)) continue;
    const home = rows.get(clubKey(fixture.homeClubId));
    const away = rows.get(clubKey(fixture.awayClubId));
    if (!home || !away) continue;
    home.played += 1;
    away.played += 1;
    home.goalDifference += score[0] - score[1];
    away.goalDifference += score[1] - score[0];
    if (score[0] > score[1]) home.points += 3;
    else if (score[1] > score[0]) away.points += 3;
    else { home.points += 1; away.points += 1; }
  }
  return [...rows.values()].sort((left, right) => (
    right.points - left.points
      || right.goalDifference - left.goalDifference
      || left.clubId.localeCompare(right.clubId, "pt-BR")
  ));
}

function expectationFor(room, clubId, league, contract) {
  const clubs = [...(league?.clubs ?? [])].sort((left, right) => finite(right?.reputation) - finite(left?.reputation));
  const reputationRank = Math.max(1, clubs.findIndex((club) => clubKey(club?.id ?? club?.code) === clubKey(clubId)) + 1);
  const targetObjective = (contract?.objectives ?? []).find((objective) => (
    ["position", "league_position", "finish_position"].includes(identifier(objective?.type ?? objective?.id))
      && Number.isFinite(Number(objective?.target))
  ));
  const expectedPosition = targetObjective ? integer(targetObjective.target, reputationRank, 1) : reputationRank;
  const ratio = expectedPosition / Math.max(1, clubs.length);
  return {
    expectedPosition,
    expectedPointsPerGame: ratio <= 0.25 ? 1.9 : ratio <= 0.65 ? 1.4 : 1.05,
  };
}

function evaluateAppointment(room, state, appointment, now, minimumGames, id, { jobSecurityOwned = false } = {}) {
  const league = leagueForClub(room, appointment.clubId);
  const rows = standingsFor(room, league);
  const rowIndex = rows.findIndex((row) => clubKey(row.clubId) === clubKey(appointment.clubId));
  const row = rows[rowIndex] ?? { played: 0, points: 0 };
  const relevant = fixturesAndResults(room).filter(({ fixture }) => (
    clubKey(fixture?.leagueId) === clubKey(league?.id)
      && integer(fixture?.round, 0) >= integer(appointment.startedRound, 1)
      && [fixture.homeClubId, fixture.awayClubId].some((clubId) => clubKey(clubId) === clubKey(appointment.clubId))
  ));
  const statistics = appointmentStatistics(room, appointment, now);
  appointment.statistics = statistics;
  const { games, points } = statistics;
  const contract = activeContractForCoach(state, appointment.coachId);
  const expectation = expectationFor(room, appointment.clubId, league, contract);
  const position = rowIndex >= 0 ? rowIndex + 1 : null;
  return evaluateCoachJobSecurity({
    room,
    employmentState: state,
    appointment,
    contract,
    league,
    standings: rows,
    relevantMatches: relevant,
    statistics,
    expectation,
    position,
    now,
    seasonNumber: seasonNumber(room),
    round: completedRound(room),
    minimumGames,
    evaluationId: id,
    jobSecurityOwned,
  });
}

function latestCoachEvaluation(state, coachId) {
  return state.evaluations
    .filter((evaluation) => evaluation.coachId === coachId)
    .sort((left, right) => String(right.evaluatedAt ?? "").localeCompare(String(left.evaluatedAt ?? "")))[0] ?? null;
}

function marketProposalTiming(state, coach, now, config) {
  const contract = activeContractForCoach(state, coach.id);
  if (!contract?.endDate) return { kind: "hiring", plannedStartDate: now, compensation: contract?.terminationClause ?? 0 };
  const remainingDays = Math.ceil((new Date(contract.endDate).getTime() - new Date(now).getTime()) / DAY_MS);
  if (remainingDays > 0 && remainingDays <= config.preContractWindowDays) {
    return { kind: "precontract", plannedStartDate: contract.endDate, compensation: 0 };
  }
  return { kind: "hiring", plannedStartDate: now, compensation: contract.terminationClause ?? 0 };
}

function vacancyAgeDays(vacancy, now) {
  const opened = new Date(vacancy.openedAt ?? now).getTime();
  return Math.max(0, Math.floor((new Date(now).getTime() - opened) / DAY_MS));
}

function activeCoachProposal(state, clubId, coachId = null) {
  return state.proposals.find((proposal) => (
    clubKey(proposal.clubId) === clubKey(clubId)
      && (!coachId || proposal.coachId === coachId)
      && ACTIVE_PROPOSAL_STATUSES.has(proposal.status)
  )) ?? null;
}

function createDeterministicHumanInvitation(room, state, vacancy, now, events, processed) {
  const candidates = (room.coachCareerState?.coaches ?? [])
    .filter((coach) => {
      if (coach.managerType !== "human" || coach.status === "retired") return false;
      if (clubKey(coach.currentClubId) === clubKey(vacancy.clubId)) return false;
      if (!coachEligibleForVacancy(room, state, coach, vacancy, now, state.marketConfig)) return false;
      const search = state.jobSearchByCoachId?.[coach.id]?.active === true;
      const latest = state.evaluations
        .filter((evaluation) => evaluation.coachId === coach.id)
        .sort((left, right) => String(right.evaluatedAt ?? "").localeCompare(String(left.evaluatedAt ?? "")))[0];
      return search || (latest?.minimumGamesMet && latest.score >= 78);
    })
    .map((coach) => ({
      coach,
      assessment: coachMarketAssessment(room, state, coach, vacancy, now, state.marketConfig),
    }))
    .filter(({ assessment }) => (
      assessment.eligible && assessment.score >= state.marketConfig.minimumCandidateScore
    ))
    .sort((left, right) => right.assessment.score - left.assessment.score
      || left.coach.id.localeCompare(right.coach.id, "pt-BR"));
  const selected = candidates[0];
  if (!selected) return null;
  const { coach, assessment } = selected;
  if (state.applications.some((application) => (
    application.vacancyId === vacancy.id
      && application.coachId === coach.id
  ))) return null;
  if (activeCoachProposal(state, vacancy.clubId, coach.id)) return null;
  const id = `coach-invitation:s${seasonNumber(room)}:r${completedRound(room)}:${vacancy.id}:${coach.id}`;
  if (hasProcessed(state, id)) return null;
  const application = normalizeApplication({
    id: deterministicId("coach-application", `${vacancy.id}|${coach.id}`),
    vacancyId: vacancy.id,
    clubId: vacancy.clubId,
    coachId: coach.id,
    status: "submitted",
    submittedAt: now,
    updatedAt: now,
    interestScore: assessment.score,
    shortlistScore: assessment.score,
    candidateAssessment: assessment,
    operationId: id,
  });
  state.applications.push(application);
  vacancy.shortlistCoachIds = [...new Set([...vacancy.shortlistCoachIds, coach.id])].slice(0, 20);
  appendDecision(application, {
    action: "candidate_invited_to_process",
    responsibleId: vacancy.clubId,
    responsibleRole: "board",
    previousStatus: null,
    newStatus: application.status,
    justification: `Clube convidou candidato com compatibilidade ${assessment.score}/100`,
    negotiatedValues: {
      score: assessment.score,
      profileVersion: assessment.profileVersion,
    },
  }, now, id);
  events.push(eventRecord("COACH_CANDIDATE_INVITED", id, now, {
    coachId: coach.id,
    clubId: vacancy.clubId,
    relatedClubId: coach.currentClubId,
    vacancyId: vacancy.id,
    metadata: {
      source: "ai_job_market_invitation",
      applicationId: application.id,
      shortlistScore: assessment.score,
      profileVersion: assessment.profileVersion,
    },
  }));
  processed.push(id);
  return application;
}

function coachMarketConfig(state, options = {}) {
  return normalizedMarketConfig({
    ...state.marketConfig,
    ...(options.coachMarketConfig && typeof options.coachMarketConfig === "object" ? options.coachMarketConfig : {}),
    ...(options.minimumVacancyDays != null ? { searchDelayDays: options.minimumVacancyDays } : {}),
    ...(options.aiRenewalWindowDays != null ? { renewalWindowDays: options.aiRenewalWindowDays } : {}),
    ...(options.aiRenewalMinimumScore != null ? { renewalMinimumScore: options.aiRenewalMinimumScore } : {}),
    ...(options.boardResponseDelayDays != null ? { boardResponseDelayDays: options.boardResponseDelayDays } : {}),
  });
}

function proposalForApplication(state, applicationId) {
  return state.proposals.find((proposal) => proposal.applicationId === applicationId) ?? null;
}

function interviewForApplication(state, applicationId) {
  return state.interviews.find((interview) => interview.applicationId === applicationId) ?? null;
}

function contextualAiInterviewQuestions(vacancy, application, coach, depth = "standard") {
  const profile = vacancy?.desiredProfile ?? {};
  const clubId = identifier(vacancy?.clubId) || "clube";
  const preferredStyle = identifier(profile.style ?? profile.playingStyle) || "modelo de jogo do clube";
  const preferredFormation = identifier(profile.preferredFormation ?? profile.formation) || "estrutura adaptavel";
  const objectives = normalizedObjectives(profile.objectives);
  const firstObjective = objectives[0]?.title ?? "os objetivos esportivos da temporada";
  const risks = (application?.candidateAssessment?.hardBlockers ?? [])
    .map((entry) => limitedInterviewText(entry?.label ?? entry?.code, 120))
    .filter(Boolean);
  const pool = [
    { topic: "objectives", prompt: `Qual plano pratico voce adotaria para cumprir ${firstObjective}?` },
    { topic: "tactics", prompt: `Como conciliaria ${preferredFormation} e ${preferredStyle} com o elenco atual?` },
    { topic: "squad", prompt: "Quais setores do elenco avaliaria primeiro e como corrigiria os desequilibrios encontrados?" },
    { topic: "leadership", prompt: `Como construiria confianca com diretoria e jogadores ao assumir o ${clubId}?` },
    { topic: "youth", prompt: "Que criterios usaria para promover jovens sem comprometer os resultados imediatos?" },
    { topic: "finance", prompt: "Como equilibraria ambicao esportiva, salarios e orcamento de transferencias?" },
    { topic: "pressure", prompt: `Como reagiria a uma sequencia ruim dentro das expectativas definidas para o ${clubId}?` },
    { topic: "adaptation", prompt: "Como pretende adaptar sua metodologia ao pais, idioma e cultura do clube?" },
    ...(risks.length ? [{
      topic: "risk",
      prompt: `Nossa analise apontou esta preocupacao: ${risks[0]}. Como pretende resolve-la?`,
    }] : []),
  ];
  const preferredAnswers = {
    objectives: "measurable_plan",
    tactics: "adaptable",
    squad: "evidence_based",
    leadership: "clear_accountability",
    youth: "develop",
    finance: "responsible",
    pressure: "balanced",
    adaptation: "learn_and_adapt",
    risk: "specific_mitigation",
  };
  const limits = interviewDepthLimits(depth);
  const desiredCount = Math.min(pool.length, Math.max(limits.minimum, depth === "deep" ? 7 : depth === "quick" ? 3 : 5));
  const seed = `${vacancy?.id}|${coach?.id}|${application?.candidateAssessment?.score ?? 50}`;
  return pool
    .map((question) => ({ question, order: hashText(`${seed}|${question.topic}`) }))
    .sort((left, right) => left.order - right.order || left.question.topic.localeCompare(right.question.topic, "pt-BR"))
    .slice(0, desiredCount)
    .map(({ question }, index) => ({
      id: deterministicId("coach-interview-question", `${seed}|${index}|${question.topic}`),
      topic: question.topic,
      prompt: question.prompt,
      preferredAnswer: preferredAnswers[question.topic] ?? "balanced",
    }));
}

function createAiInterviewMutable(state, vacancy, application, coach, now, config, events, processed) {
  const existing = interviewForApplication(state, application.id);
  if (existing) return existing;
  const id = `coach-ai-interview:${vacancy.id}:${coach.id}`;
  const profileQuestions = Array.isArray(vacancy.desiredProfile?.interviewQuestions)
    ? vacancy.desiredProfile.interviewQuestions
    : [];
  const contextSnapshot = {
    vacancy: {
      id: vacancy.id,
      clubId: vacancy.clubId,
      reason: vacancy.reason ?? null,
      desiredProfile: clone(vacancy.desiredProfile ?? {}),
    },
    candidate: {
      coachId: coach.id,
      reputation: finite(coach.reputation ?? coach.marketReputation, 50),
      professionalTrust: finite(coach.professionalTrust, 80),
      preferredFormation: identifier(coach.preferredFormation) || null,
      style: identifier(coach.style ?? coach.playingStyle) || null,
      experienceYears: finite(coach.experienceYears),
      achievements: clone(coach.achievements ?? {}),
      previousInterviewMemories: clone((coach.interviewMemories ?? []).slice(-10)),
    },
    candidateAssessment: clone(application.candidateAssessment ?? null),
  };
  const depth = "standard";
  const questions = profileQuestions.length > 0
    ? profileQuestions
    : contextualAiInterviewQuestions(vacancy, application, coach, depth);
  const interview = normalizeInterview({
    id: deterministicId("coach-interview", id),
    applicationId: application.id,
    vacancyId: vacancy.id,
    coachId: coach.id,
    clubId: vacancy.clubId,
    status: "pending",
    scheduledAt: now,
    expiresAt: addDays(now, Math.max(3, config.interviewDelayDays + 3)),
    mode: coach.managerType === "human" ? "generative" : "fallback",
    source: coach.managerType === "human" ? null : "fallback",
    depth,
    contextSnapshot,
    contextHash: hashText(JSON.stringify(contextSnapshot)).toString(36),
    questions,
    operationId: id,
  });
  state.interviews.push(interview);
  application.status = "interview";
  application.updatedAt = now;
  appendDecision(application, {
    action: "interview_scheduled",
    responsibleId: vacancy.clubId,
    responsibleRole: "board",
    previousStatus: "shortlisted",
    newStatus: application.status,
    justification: "Entrevista incluida no processo seletivo",
  }, now, id);
  events.push(eventRecord("COACH_INTERVIEW_SCHEDULED", id, now, {
    coachId: coach.id,
    clubId: vacancy.clubId,
    vacancyId: vacancy.id,
    metadata: { applicationId: application.id, interviewId: interview.id },
  }));
  processed.push(id);
  return interview;
}

function createAiMarketProposalMutable(room, state, vacancy, application, coach, interview, now, config, events, processed) {
  const existing = proposalForApplication(state, application.id);
  if (existing) return existing;
  const id = `coach-ai-offer:${vacancy.id}:${coach.id}`;
  if (hasProcessed(state, id)) return null;
  const careerSignals = careerHistoryMarketSignals(room, state, coach, now);
  const baseWage = coachOfferWage(room, coach, vacancy.clubId, vacancy.desiredProfile, state, now);
  const wageVariation = ((hashText(`${id}|wage`) % 11) - 4) / 100;
  const salaryRange = vacancy.desiredProfile?.salary ?? {};
  const interviewEffects = normalizeInterviewNegotiationEffects(interview?.negotiationEffects);
  const wage = Math.round(clamp(
    baseWage * (1 + wageVariation) * (interviewEffects?.salaryMultiplier ?? 1),
    integer(salaryRange.minimum, 1_000, 1_000, MAX_MONEY),
    integer(salaryRange.maximum, MAX_MONEY, 1_000, MAX_MONEY),
  ) / 1_000) * 1_000;
  const currentContract = activeContractForCoach(state, coach.id);
  const timing = marketProposalTiming(state, coach, now, config);
  const durationYears = integer(
    2
      + (hashText(`${id}|duration`) % 2)
      + (interviewEffects?.durationYearsDelta ?? 0)
      + careerSignals.durationDelta,
    2,
    1,
    5,
  );
  const signingBonus = Math.round((
    wage
      * (1 + (hashText(`${id}|bonus`) % 3))
      * (interviewEffects?.signingBonusMultiplier ?? 1)
  ) / 1_000) * 1_000;
  const availableBudget = availableClubFunds(room, vacancy.clubId);
  const profileTransferBudget = vacancy.desiredProfile?.availableBudget;
  const transferBudget = profileTransferBudget == null
    ? null
    : integer(
      finite(profileTransferBudget) * (interviewEffects?.transferBudgetMultiplier ?? 1),
      0,
      0,
      availableBudget == null ? MAX_MONEY : Math.min(MAX_MONEY, availableBudget),
    );
  const proposal = normalizeProposal({
    id: deterministicId("coach-proposal", id),
    coachId: coach.id,
    clubId: vacancy.clubId,
    vacancyId: vacancy.id,
    applicationId: application.id,
    interviewId: interview?.id,
    kind: timing.kind,
    wage,
    durationYears,
    terminationClause: integer(
      wage * (6 + (hashText(`${id}|clause`) % 7)) * (interviewEffects?.terminationClauseMultiplier ?? 1),
      wage * 6,
      0,
      Math.min(MAX_MONEY, wage * 24),
    ),
    signingBonus,
    compensation: timing.compensation,
    bonuses: {
      title: Math.round((wage * 2) / 1_000) * 1_000,
      objective: Math.round(wage / 1_000) * 1_000,
      ...(interviewEffects ? {
        performance: Math.round((wage * interviewEffects.performanceBonusMultiplier) / 1_000) * 1_000,
      } : {}),
    },
    transferBudget,
    objectives: [
      ...(vacancy.desiredProfile?.objectives ?? []),
      ...(interviewEffects?.objectives ?? []),
    ],
    specialClauses: interviewEffects?.specialClauses ?? [],
    interviewEvaluation: clone(interview?.evaluation ?? null),
    interviewRelationshipImpact: clone(interview?.relationshipImpact ?? null),
    interviewNegotiationEffects: clone(interviewEffects),
    interviewCompatibility: interview?.compatibilityScore ?? null,
    autonomyDelta: interviewEffects?.autonomyDelta ?? 0,
    priorityDelta: interviewEffects?.priorityDelta ?? 0,
    objectiveDifficultyDelta: interviewEffects?.objectiveDifficultyDelta ?? 0,
    status: "pending",
    marketStage: "coach_review",
    createdAt: now,
    updatedAt: now,
    lastActionAt: now,
    nextActionAt: addDays(now, config.coachResponseDelayDays),
    expiresAt: addDays(now, config.proposalValidityDays),
    plannedStartDate: timing.plannedStartDate,
    maxNegotiationRounds: config.maxNegotiationRounds,
    availableBudget,
    boardExpectation: identifier(vacancy.desiredProfile?.expectation) || "Cumprir objetivos esportivos e financeiros",
    clubSituation: identifier(vacancy.reason) || "Vaga aberta",
    message: "Proposta formal criada apos analise do perfil do treinador.",
    careerRisk: careerSignals.risk,
    careerHistoryAssessment: {
      performance: careerSignals.performance,
      reliability: careerSignals.reliability,
      reputationTrend: careerSignals.reputationTrend,
      risk: careerSignals.risk,
      evidence: {
        matches: careerSignals.matches,
        titles: careerSignals.titles,
        completedContracts: careerSignals.completedContracts,
        resignations: careerSignals.resignations,
        dismissals: careerSignals.dismissals,
      },
    },
    operationId: id,
  });
  appendDecision(proposal, {
    action: "offer_submitted",
    responsibleId: vacancy.clubId,
    responsibleRole: "board",
    previousStatus: null,
    newStatus: proposal.status,
    justification: interview ? "Proposta enviada apos entrevista" : "Proposta enviada apos analise da lista de candidatos",
    negotiatedValues: proposalTerms(proposal),
  }, now, `${id}:offer`);
  state.proposals.push(proposal);
  application.status = "offered";
  application.updatedAt = now;
  appendDecision(application, {
    action: "offer_submitted",
    responsibleId: vacancy.clubId,
    responsibleRole: "board",
    previousStatus: interview ? "interview_completed" : "shortlisted",
    newStatus: application.status,
    justification: "Candidato avancou para negociacao contratual",
  }, now, `${id}:application`);
  if (!coach.currentClubId) coach.status = "negotiating";
  events.push(eventRecord("COACH_PROPOSAL_CREATED", id, now, {
    coachId: coach.id,
    clubId: vacancy.clubId,
    relatedClubId: coach.currentClubId,
    proposalId: proposal.id,
    vacancyId: vacancy.id,
    metadata: {
      source: "dynamic_ai_coach_market",
      applicationId: application.id,
      interviewId: interview?.id ?? null,
      expiresAt: proposal.expiresAt,
    },
  }));
  processed.push(id);
  return proposal;
}

function deterministicAiInterviewAnswer(question, coach) {
  const formation = identifier(coach.preferredFormation) || "uma estrutura adaptavel";
  const style = identifier(coach.style ?? coach.playingStyle) || "equilibrio entre os momentos do jogo";
  const answersByTopic = {
    objectives: `Vou transformar as metas em etapas mensuraveis, cobrando evolucao sem abandonar o projeto de longo prazo.`,
    youth: `Jovens terao minutos por merito, plano individual e apoio de atletas experientes.`,
    finance: `Trabalharei dentro do orcamento, priorizando reforcos que resolvam necessidades reais do elenco.`,
    tactics: `Partirei do ${formation}, com ${style}, mas ajustarei o plano aos jogadores e ao adversario.`,
    leadership: `Definirei regras claras, conversa direta e responsabilidade compartilhada no vestiario.`,
    pressure: `Assumo a pressao como parte do cargo e protejo o elenco sem fugir da responsabilidade.`,
  };
  return answersByTopic[identifier(question?.topic).toLocaleLowerCase("en-US")]
    ?? `Quero entender o contexto, alinhar expectativas com a diretoria e executar um plano coerente com o elenco.`;
}

function resolveAiInterviewsMutable(room, state, now, config, events, processed) {
  for (const interview of state.interviews) {
    if (interview.status !== "pending") continue;
    const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === interview.coachId);
    if (!coach || coach.managerType === "human") continue;
    const dueAt = addDays(interview.scheduledAt ?? now, config.interviewDelayDays);
    if (new Date(dueAt).getTime() > new Date(now).getTime()) continue;
    const id = `coach-ai-interview-response:${interview.id}`;
    if (hasProcessed(state, id)) continue;
    const vacancy = state.vacancies.find((candidate) => candidate.id === interview.vacancyId);
    const application = state.applications.find((candidate) => candidate.id === interview.applicationId);
    const assessment = application?.candidateAssessment
      ?? (vacancy ? coachMarketAssessment(room, state, coach, vacancy, now, config) : null);
    const selectionScore = finite(assessment?.score, 50);
    const communicationScore = clamp(
      normalizeCoachReputation100(
        coach.communication ?? coach.motivation ?? coach.mentality,
        55,
      )
        + ((hashText(`${id}|compatibility`) % 7) - 3),
      0,
      100,
    );
    interview.compatibilityScore = Math.round(clamp(
      (selectionScore * 0.7) + (communicationScore * 0.3),
      0,
      100,
    ));
    interview.selectionScore = selectionScore;
    interview.answerCompatibilityScore = communicationScore;
    interview.mode = "fallback";
    interview.source = "fallback";
    interview.model = null;
    interview.answers = interview.questions.map((question) => ({
      questionId: question.id,
      text: deterministicAiInterviewAnswer(question, coach),
      source: "ai_coach_profile",
    }));
    interview.transcript = interview.questions.flatMap((question, index) => {
      const turn = index + 1;
      const questionMessageId = deterministicId("coach-interview-message", `${id}|${question.id}|board`);
      return [{
        id: questionMessageId,
        role: "board",
        text: question.prompt,
        topic: question.topic,
        questionId: null,
        createdAt: now,
        turn,
        analysis: null,
        operationId: id,
      }, {
        id: deterministicId("coach-interview-message", `${id}|${question.id}|coach`),
        role: "coach",
        text: deterministicAiInterviewAnswer(question, coach),
        topic: question.topic,
        questionId: questionMessageId,
        createdAt: now,
        turn,
        analysis: null,
        operationId: id,
      }];
    }).slice(-80);
    interview.turnCount = interview.questions.length;
    interview.currentQuestionId = null;
    interview.revision += 1;
    interview.cumulativeMetrics = normalizeInterviewMetrics({
      boardConfidence: interview.compatibilityScore,
      clubCompatibility: selectionScore,
      squadCompatibility: finite(assessment?.factors?.find((factor) => factor.code === "squadCompatibility")?.rawScore, selectionScore),
      leadership: communicationScore,
      tacticalVision: normalizeCoachReputation100(coach.tacticalKnowledge ?? coach.tactics, communicationScore),
      financialAlignment: finite(assessment?.factors?.find((factor) => factor.code === "salary")?.rawScore, selectionScore),
      longTermPotential: normalizeCoachReputation100(coach.potential ?? coach.reputation, selectionScore),
      culturalFit: finite(assessment?.factors?.find((factor) => factor.code === "countryKnowledge")?.rawScore, selectionScore),
      credibility: normalizeCoachReputation100(coach.professionalTrust ?? coach.reputation, communicationScore),
      perceivedRisk: 100 - interview.compatibilityScore,
    }, interview.compatibilityScore);
    interview.evaluation = normalizeInterviewEvaluation({
      overallScore: interview.compatibilityScore,
      metrics: interview.cumulativeMetrics,
      strengths: interview.compatibilityScore >= 70 ? ["Perfil coerente com o projeto", "Comunicacao segura"] : [],
      risks: interview.compatibilityScore < 55 ? ["Compatibilidade abaixo do esperado pela diretoria"] : [],
      recommendation: interview.compatibilityScore >= 70
        ? "hire"
        : interview.compatibilityScore >= 45 ? "hire_with_reservations" : "reject",
      summary: `Entrevista simulada pelo perfil do treinador: ${interview.compatibilityScore}/100.`,
      generatedAt: now,
    }, now, interview.compatibilityScore);
    interview.relationshipImpact = normalizeInterviewRelationshipImpact({
      boardConfidenceDelta: clamp((interview.compatibilityScore - 50) * 0.12, -8, 8),
      credibilityDelta: clamp((communicationScore - 50) * 0.08, -5, 5),
      strategicAlignmentDelta: clamp((selectionScore - 50) * 0.08, -5, 5),
      culturalCompatibilityDelta: 0,
      perceivedRiskDelta: clamp((50 - interview.compatibilityScore) * 0.08, -5, 5),
      expectedTenureDelta: interview.compatibilityScore >= 70 ? 3 : 0,
    });
    interview.negotiationEffects = normalizeInterviewNegotiationEffects({
      salaryMultiplier: 1 + clamp((interview.compatibilityScore - 60) / 500, -0.08, 0.08),
      durationYearsDelta: interview.compatibilityScore >= 78 ? 1 : 0,
      signingBonusMultiplier: interview.compatibilityScore >= 72 ? 1.15 : 1,
      performanceBonusMultiplier: 1,
      terminationClauseMultiplier: 1,
      transferBudgetMultiplier: interview.compatibilityScore >= 75 ? 1.05 : 1,
      autonomyDelta: clamp((interview.compatibilityScore - 55) / 5, -8, 8),
      priorityDelta: clamp((interview.compatibilityScore - 60) / 4, -12, 12),
      objectiveDifficultyDelta: clamp((interview.compatibilityScore - 60) / 6, -8, 8),
      terminateNegotiation: interview.compatibilityScore < 45,
    });
    if (application && interview.negotiationEffects?.priorityDelta) {
      application.interestScore = Math.round(clamp(
        finite(application.interestScore, selectionScore) + interview.negotiationEffects.priorityDelta,
        0,
        100,
      ) * 10) / 10;
      application.shortlistScore = Math.round(clamp(
        finite(application.shortlistScore, selectionScore) + interview.negotiationEffects.priorityDelta,
        0,
        100,
      ) * 10) / 10;
    }
    interview.memorySummary = interview.evaluation.summary;
    interview.completedAt = now;
    interview.status = interview.compatibilityScore >= 45 ? "accepted" : "rejected";
    applyInterviewRelationshipMutable(coach, interview, now, id);
    appendDecision(interview, {
      action: interview.status === "accepted" ? "interview_passed" : "interview_failed",
      responsibleId: vacancy?.clubId ?? interview.clubId,
      responsibleRole: "board",
      previousStatus: "pending",
      newStatus: interview.status,
      justification: `Compatibilidade ${interview.compatibilityScore}/100`,
      negotiatedValues: { compatibilityScore: interview.compatibilityScore },
    }, now, id);
    if (application) {
      application.status = interview.status === "accepted" ? "interview_completed" : "rejected";
      application.updatedAt = now;
      application.responseReason = interview.status === "accepted" ? "interview_passed" : "interview_incompatible";
    }
    events.push(eventRecord("COACH_INTERVIEW_COMPLETED", id, now, {
      coachId: interview.coachId,
      clubId: interview.clubId,
      vacancyId: interview.vacancyId,
      metadata: { interviewId: interview.id, compatibilityScore: interview.compatibilityScore, outcome: interview.status },
    }));
    processed.push(id);
  }
}

function progressOpenCoachVacancy(room, state, vacancy, now, options, events, processed) {
  if (vacancy.status !== "open") return;
  const config = coachMarketConfig(state, options);
  if (vacancy.closesAt && new Date(vacancy.closesAt).getTime() <= new Date(now).getTime()) {
    const previousDeadline = vacancy.closesAt;
    const id = `coach-vacancy-search-extended:${vacancy.id}:${previousDeadline}`;
    vacancy.closesAt = addDays(now, Math.max(7, config.proposalValidityDays));
    vacancy.lastMarketActionAt = now;
    appendDecision(vacancy, {
      action: "search_deadline_extended",
      responsibleId: vacancy.clubId,
      responsibleRole: "board",
      previousStatus: vacancy.status,
      newStatus: vacancy.status,
      justification: "Busca continua porque nenhum acordo foi concluido",
      negotiatedValues: { previousDeadline, deadline: vacancy.closesAt },
    }, now, id);
    events.push(eventRecord("COACH_VACANCY_SEARCH_EXTENDED", id, now, {
      clubId: vacancy.clubId,
      vacancyId: vacancy.id,
      metadata: { previousDeadline, deadline: vacancy.closesAt },
    }));
    processed.push(id);
  }
  createDeterministicHumanInvitation(room, state, vacancy, now, events, processed);
  if (vacancyAgeDays(vacancy, now) < config.searchDelayDays) return;

  let applications = state.applications.filter((application) => application.vacancyId === vacancy.id);
  const activeApplicationExists = applications.some((application) => (
    ["shortlisted", "interview", "interview_completed", "offered", "accepted"].includes(application.status)
  ));
  const activeOfferExists = state.proposals.some((proposal) => (
    proposal.vacancyId === vacancy.id && ACTIVE_PROPOSAL_STATUSES.has(proposal.status)
  ));
  const submittedApplications = applications.filter((application) => application.status === "submitted");
  if ((!activeApplicationExists && !activeOfferExists) || submittedApplications.length > 0) {
    const submittedByCoach = new Map(submittedApplications.map((application) => [application.coachId, application]));
    const existingByCoach = new Map(applications.map((application) => [application.coachId, application]));
    const previouslyConsidered = new Set(applications
      .filter((application) => application.status !== "submitted")
      .map((application) => application.coachId));
    const discoverAiCandidates = !activeApplicationExists && !activeOfferExists;
    const aiCandidates = discoverAiCandidates
      ? (room.coachCareerState?.coaches ?? [])
        .filter((coach) => (
          coach.managerType !== "human"
          && coach.status !== "retired"
          && !coach.id.startsWith("interim-coach:")
          && !previouslyConsidered.has(coach.id)
          && !submittedByCoach.has(coach.id)
          && coachEligibleForVacancy(room, state, coach, vacancy, now, config)
        ))
      : [];
    const submittedCandidates = submittedApplications.flatMap((application) => {
      const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === application.coachId);
      return coach ? [coach] : [];
    });
    const activeCandidates = applications
      .filter((application) => (
        application.status !== "submitted"
          && ["shortlisted", "interview", "interview_completed", "offered", "accepted"].includes(application.status)
      ))
      .flatMap((application) => {
        const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === application.coachId);
        return coach ? [coach] : [];
      });
    const assessedCandidates = [...new Map([...activeCandidates, ...submittedCandidates, ...aiCandidates]
      .map((coach) => [coach.id, coach])).values()]
      .map((coach) => ({
        coach,
        assessment: coachMarketAssessment(room, state, coach, vacancy, now, config),
      }))
      .sort((left, right) => right.assessment.score - left.assessment.score
        || left.coach.id.localeCompare(right.coach.id, "pt-BR"));
    const candidates = assessedCandidates
      .filter(({ assessment }) => (
        assessment.eligible && assessment.score >= config.minimumCandidateScore
      ))
      .slice(0, config.shortlistSize);
    const selectedCoachIds = new Set(candidates.map(({ coach }) => coach.id));

    for (const application of submittedApplications) {
      const candidate = assessedCandidates.find(({ coach }) => coach.id === application.coachId);
      if (candidate) {
        application.candidateAssessment = clone(candidate.assessment);
        application.interestScore = candidate.assessment.score;
        application.shortlistScore = candidate.assessment.score;
      }
      if (selectedCoachIds.has(application.coachId)) continue;
      const previousStatus = application.status;
      application.status = "rejected";
      application.updatedAt = now;
      application.closedAt = now;
      application.closedReason = candidate?.assessment?.eligible === false
        ? "mandatory_requirements_not_met"
        : "lower_ranked_candidate";
      application.responseReason = application.closedReason;
      appendDecision(application, {
        action: "candidate_not_shortlisted",
        responsibleId: vacancy.clubId,
        responsibleRole: "board",
        previousStatus,
        newStatus: application.status,
        justification: candidate?.assessment?.eligible === false
          ? `Requisitos obrigatorios nao atendidos: ${candidate.assessment.hardBlockers
              .map((blocker) => identifier(blocker?.label ?? blocker?.code ?? blocker))
              .filter(Boolean)
              .join(", ")}`
          : "Outros candidatos apresentaram maior compatibilidade com a vaga",
        negotiatedValues: {
          score: candidate?.assessment?.score ?? 0,
          hardBlockers: candidate?.assessment?.hardBlockers ?? [],
        },
      }, now, `coach-selection-rejected:${vacancy.id}:${application.coachId}:${now}`);
    }

    for (const { coach, assessment } of candidates) {
      const existingApplication = existingByCoach.get(coach.id);
      if (existingApplication && existingApplication.status !== "submitted") continue;
      const id = `coach-ai-shortlist:${vacancy.id}:${coach.id}`;
      const application = submittedByCoach.get(coach.id) ?? normalizeApplication({
          id: deterministicId("coach-application", `${vacancy.id}|${coach.id}`),
          vacancyId: vacancy.id,
          clubId: vacancy.clubId,
          coachId: coach.id,
          status: "submitted",
          submittedAt: now,
          updatedAt: now,
          operationId: id,
        });
      const previousStatus = application.status;
      application.status = "shortlisted";
      application.updatedAt = now;
      application.interestScore = assessment.score;
      application.shortlistScore = assessment.score;
      application.candidateAssessment = clone(assessment);
      if (!submittedByCoach.has(coach.id)) state.applications.push(application);
      appendDecision(application, {
        action: "candidate_shortlisted",
        responsibleId: vacancy.clubId,
        responsibleRole: "board",
        previousStatus,
        newStatus: application.status,
        justification: `Compatibilidade ponderada ${assessment.score}/100`,
        negotiatedValues: {
          score: assessment.score,
          profileVersion: assessment.profileVersion,
          factors: assessment.factors.map((factor) => ({
            code: factor.code,
            weightedScore: factor.weightedScore,
          })),
        },
      }, now, id);
      vacancy.shortlistCoachIds = [...new Set([...vacancy.shortlistCoachIds, coach.id])].slice(0, 20);
      events.push(eventRecord("COACH_CANDIDATE_SHORTLISTED", id, now, {
        coachId: coach.id,
        clubId: vacancy.clubId,
        vacancyId: vacancy.id,
        metadata: {
          applicationId: application.id,
          shortlistScore: assessment.score,
          profileVersion: assessment.profileVersion,
          factorCodes: assessment.factors.map((factor) => factor.code),
        },
      }));
      processed.push(id);
    }
    vacancy.searchStartedAt = vacancy.searchStartedAt ?? now;
    vacancy.lastMarketActionAt = now;
    vacancy.marketStage = candidates.length ? "interest" : "closed";
    applications = state.applications.filter((application) => application.vacancyId === vacancy.id);
  }

  const activeOffers = () => state.proposals.filter((proposal) => (
    proposal.vacancyId === vacancy.id && ACTIVE_PROPOSAL_STATUSES.has(proposal.status)
  )).length;
  for (const application of [...applications]
    .sort((left, right) => right.shortlistScore - left.shortlistScore || left.id.localeCompare(right.id, "pt-BR"))) {
    if (activeOffers() >= config.simultaneousOffersPerVacancy) break;
    if (!["shortlisted", "interview_completed"].includes(application.status)) continue;
    const coach = coachById(room, application.coachId);
    const interview = interviewForApplication(state, application.id);
    if (application.status === "shortlisted" && !interview) {
      const interviewRoll = hashText(`${vacancy.id}|${coach.id}|interview`) % 100;
      if (interviewRoll < config.interviewChance) {
        createAiInterviewMutable(state, vacancy, application, coach, now, config, events, processed);
        vacancy.marketStage = "interview";
        vacancy.lastMarketActionAt = now;
        continue;
      }
    }
    if (interview && interview.status !== "accepted") continue;
    createAiMarketProposalMutable(room, state, vacancy, application, coach, interview, now, config, events, processed);
    vacancy.marketStage = "coach_review";
    vacancy.lastMarketActionAt = now;
  }
}

function activeTenureEvaluations(state, appointment) {
  const startedAt = new Date(appointment.startedAt ?? appointment.appointedAt ?? 0).getTime();
  const uniqueRounds = new Map();
  for (const evaluation of state.evaluations) {
    if (evaluation.coachId !== appointment.coachId
      || clubKey(evaluation.clubId) !== clubKey(appointment.clubId)
      || evaluation.minimumGamesMet !== true) continue;
    const evaluatedAt = new Date(evaluation.evaluatedAt ?? 0).getTime();
    if (Number.isFinite(startedAt) && evaluatedAt < startedAt) continue;
    uniqueRounds.set(`${evaluation.seasonNumber}:${evaluation.round}`, evaluation);
  }
  return [...uniqueRounds.values()].sort((left, right) => (
    String(left.evaluatedAt ?? "").localeCompare(String(right.evaluatedAt ?? ""))
      || left.id.localeCompare(right.id, "pt-BR")
  ));
}

function averageEvaluationScore(evaluations) {
  if (!evaluations.length) return 0;
  return evaluations.reduce((total, evaluation) => total + finite(evaluation.score, 0), 0) / evaluations.length;
}

function aiRenewalDecision(room, state, coach, appointment, contract, now, options) {
  if (coach.id.startsWith("interim-coach:")) return null;
  if (appointment.role !== "head_coach" || contract.role !== "head_coach" || !contract.endDate) return null;
  const remainingDays = Math.ceil((new Date(contract.endDate).getTime() - new Date(now).getTime()) / DAY_MS);
  const config = coachMarketConfig(state, options);
  const renewalWindowDays = config.renewalWindowDays;
  if (remainingDays <= 0 || remainingDays > renewalWindowDays) return null;
  if (state.proposals.some((proposal) => (
    proposal.kind === "renewal"
      && proposal.sourceContractId === contract.id
      && !["rejected", "expired", "withdrawn", "encerrado_vaga_preenchida"].includes(proposal.status)
  ))) return null;

  const evaluations = activeTenureEvaluations(state, appointment).slice(-2);
  const minimumScore = config.renewalMinimumScore;
  const latest = evaluations.at(-1);
  const averageScore = averageEvaluationScore(evaluations);
  const enoughEvidence = evaluations.length >= 2
    ? averageScore >= minimumScore
    : evaluations.length === 1 && latest.score >= minimumScore + 10;
  if (!latest || latest.recommendation !== "retain" || latest.score < minimumScore || !enoughEvidence) return null;

  const reserveMonths = integer(options.aiRenewalReserveMonths, 3, 0, 12);
  const available = availableClubFunds(room, appointment.clubId);
  if (available != null && available < contract.wage * reserveMonths) return null;
  return {
    averageScore,
    evidenceEvaluationIds: evaluations.map((evaluation) => evaluation.id),
    durationYears: averageScore >= 75 ? 2 : 1,
    wageIncreaseRate: averageScore >= 80 ? 0.08 : 0.05,
  };
}

function processAiContractRenewals(room, state, now, options, events, processed) {
  if (options.autoRenewAI === false) return;
  for (const appointment of state.appointments.filter((candidate) => (
    candidate.status === "active" && candidate.role === "head_coach"
  ))) {
    const coach = coachById(room, appointment.coachId);
    const previous = activeContractForCoach(state, coach.id);
    if (!previous) continue;
    const decision = aiRenewalDecision(room, state, coach, appointment, previous, now, options);
    if (!decision) continue;
    const id = `coach-ai-renewal-offer:${previous.id}`;
    if (hasProcessed(state, id)) continue;
    const wage = Math.max(1_000, Math.round((previous.wage * (1 + decision.wageIncreaseRate)) / 1_000) * 1_000);
    const config = coachMarketConfig(state, options);
    const proposal = normalizeProposal({
      id: deterministicId("coach-proposal", id),
      coachId: coach.id,
      clubId: appointment.clubId,
      kind: "renewal",
      sourceContractId: previous.id,
      wage,
      durationYears: decision.durationYears,
      terminationClause: Math.max(previous.terminationClause, wage * 6),
      bonuses: previous.bonuses,
      objectives: previous.objectives,
      status: "pending",
      marketStage: "coach_review",
      createdAt: now,
      updatedAt: now,
      lastActionAt: now,
      nextActionAt: addDays(now, config.coachResponseDelayDays),
      expiresAt: addDays(now, config.proposalValidityDays),
      plannedStartDate: now,
      maxNegotiationRounds: config.maxNegotiationRounds,
      availableBudget: availableClubFunds(room, appointment.clubId),
      boardExpectation: "Continuidade do trabalho e cumprimento dos objetivos",
      clubSituation: "Renovacao antes do fim do contrato",
      message: "O clube deseja renovar o vinculo.",
      operationId: id,
    });
    appendDecision(proposal, {
      action: "renewal_offer_submitted",
      responsibleId: appointment.clubId,
      responsibleRole: "board",
      previousStatus: null,
      newStatus: proposal.status,
      justification: "Renovacao proposta com base em desempenho persistido",
      negotiatedValues: proposalTerms(proposal),
      conditions: decision.evidenceEvaluationIds,
    }, now, `${id}:offer`);
    state.proposals.push(proposal);
    events.push(eventRecord("COACH_RENEWAL_NEGOTIATION_OPENED", id, now, {
      coachId: coach.id,
      clubId: appointment.clubId,
      contractId: previous.id,
      proposalId: proposal.id,
      metadata: {
        source: "dynamic_ai_coach_market",
        wage: proposal.wage,
        durationYears: proposal.durationYears,
        averageScore: Math.round(decision.averageScore),
        evidenceEvaluationIds: decision.evidenceEvaluationIds,
      },
    }));
    processed.push(id);
  }
}

function coachProposalDecision(room, state, coach, proposal, now = state.currentDate) {
  const clubs = catalogClubs(room);
  const targetClub = clubs.get(clubKey(proposal.clubId)) ?? {};
  const currentClub = coach.currentClubId ? clubs.get(clubKey(coach.currentClubId)) ?? {} : {};
  const careerSignals = careerHistoryMarketSignals(room, state, coach, now);
  const targetReputation = normalizeCoachReputation100(targetClub.reputation, 45);
  const currentReputation = coach.currentClubId
    ? normalizeCoachReputation100(currentClub.reputation, 45)
    : 35;
  const currentContract = activeContractForCoach(state, coach.id);
  const expectedWage = proposal.kind === "renewal"
    ? Math.max(
      1_000,
      finite(coach.expectedSalary, 0),
      finite(currentContract?.wage, 0),
    )
    : Math.max(
      1_000,
      finite(coach.expectedSalary, 0),
      finite(currentContract?.wage, 0),
      coachOfferWage(
        room,
        coach,
        proposal.clubId,
        state.vacancies.find((vacancy) => vacancy.id === proposal.vacancyId)?.desiredProfile,
        state,
        now,
      ),
    );
  const available = availableClubFunds(room, proposal.clubId);
  const latest = latestCoachEvaluation(state, coach.id);
  const targetLeague = leagueForClub(room, proposal.clubId);
  const sourceLeague = coach.currentClubId ? leagueForClub(room, coach.currentClubId) : null;
  const targetCountry = identifier(targetClub.country ?? targetLeague?.country);
  const coachCountry = identifier(coach.nationality ?? coach.country);
  const factors = [];
  const add = (code, label, value, detail = null) => factors.push({
    id: code,
    code,
    label,
    value: Math.round(value * 10) / 10,
    detail,
  });

  const variableBonuses = Object.values(proposal.bonuses ?? {}).reduce((total, value) => total + Math.max(0, finite(value, 0)), 0);
  const monthlyBonusValue = (proposal.signingBonus + variableBonuses) / Math.max(12, proposal.durationYears * 12);
  const salaryRatio = (proposal.wage + monthlyBonusValue) / expectedWage;
  add("salary", "Salario e bonus", clamp((salaryRatio - 1) * 48, -22, 22), `${Math.round(salaryRatio * 100)}% da expectativa`);
  add("club_reputation", "Reputacao do clube", clamp((targetReputation - currentReputation) * 0.38, -18, 20));
  const targetTier = finite(targetLeague?.divisionOrder ?? targetLeague?.tier ?? targetLeague?.level, 1);
  const sourceTier = finite(sourceLeague?.divisionOrder ?? sourceLeague?.tier ?? sourceLeague?.level, targetTier);
  add("division", "Nivel da divisao", clamp((sourceTier - targetTier) * 4, -8, 8));
  const squadStrength = normalizeCoachReputation100(
    targetClub.squadStrength ?? targetClub.overall ?? targetClub.reputation,
    targetReputation,
  );
  add("squad", "Qualidade do elenco", clamp((squadStrength - 50) * 0.12, -7, 8));
  const financeImpact = available == null
    ? 0
    : available >= proposal.wage * 24 ? 6 : available >= proposal.wage * 12 ? 2 : -10;
  add("financial_stability", "Estabilidade financeira", financeImpact, available == null ? "Nao divulgada" : `${Math.round(available / Math.max(1, proposal.wage))} salarios em caixa`);
  if (proposal.transferBudget != null) {
    const budgetRatio = available == null ? 1 : proposal.transferBudget / Math.max(1, available);
    add("transfer_budget", "Orcamento para transferencias", budgetRatio >= 0.35 ? 5 : budgetRatio >= 0.15 ? 2 : -4);
  }
  add("title_chance", "Chance de titulos", clamp((targetReputation - 55) * 0.1, -5, 6));
  const projectImpact = clamp((proposal.durationYears - 2) * 2, -2, 6) + Math.min(4, proposal.objectives.length);
  add("long_term_project", "Projeto de longo prazo", projectImpact);
  add("location", "Localizacao", coachCountry && targetCountry
    ? (clubKey(coachCountry) === clubKey(targetCountry) ? 4 : -2)
    : 0);
  const ambition = clamp(
    finite(coach.ambition, normalizeCoachReputation100(coach.reputation, 50)),
    0,
    100,
  );
  add("ambition", "Ambicao profissional", clamp((targetReputation - ambition) * 0.12, -7, 7));
  const formerSpell = (
    careerSignals.history?.spells
      ?? careerSignals.history?.assignments
      ?? []
  ).find((spell) => (
    clubKey(spell?.clubId ?? spell?.club?.id) === clubKey(proposal.clubId) && spell?.exitReason
  ));
  const formerExitReason = identifier(formerSpell?.exitReason);
  const relationshipImpact = !formerSpell
    ? 1
    : ["contract_expired", "contract_completed", "natural_end"].includes(formerExitReason)
      ? 4
      : ["coach_resignation", "resigned", "voluntary_resignation"].includes(formerExitReason)
        ? -10
        : formerExitReason.includes("dismiss") || formerExitReason.includes("replaced")
          ? -5
          : -2;
  add(
    "relationship",
    "Relacionamento anterior",
    relationshipImpact,
    formerSpell ? `Ultima saida: ${formerExitReason || "nao informada"}` : "Sem passagem anterior",
  );
  add(
    "career_performance",
    "Desempenho da carreira",
    clamp(careerSignals.performance * 0.55, -5, 8),
    `${careerSignals.matches} jogo(s); ${careerSignals.titles} titulo(s)`,
  );
  add(
    "career_reliability",
    "Estabilidade profissional",
    clamp(careerSignals.reliability * 0.6, -8, 6),
    `Risco profissional ${careerSignals.risk}/100`,
  );
  add(
    "reputation_trend",
    "Evolucao da reputacao",
    clamp(careerSignals.reputationTrend * 0.2, -4, 4),
  );
  if (proposal.interviewCompatibility != null) {
    add("interview", "Compatibilidade na entrevista", clamp((proposal.interviewCompatibility - 50) * 0.22, -11, 11));
  }
  if (proposal.kind === "renewal") {
    const continuity = latest?.minimumGamesMet
      ? clamp((latest.score - 50) * 0.25, -12, 12)
      : 1;
    add("continuity", "Continuidade e resultados", continuity);
    const morale = (room?.clubMoraleStates ?? []).find((entry) => clubKey(entry?.clubId) === clubKey(proposal.clubId));
    if (Number.isFinite(Number(morale?.score))) {
      add("internal_environment", "Ambiente interno", clamp((Number(morale.score) - 50) * 0.12, -7, 7));
    }
    const satisfaction = Number(coach.satisfaction ?? coach.boardConfidence ?? coach.boardRelationship);
    if (Number.isFinite(satisfaction)) {
      add("coach_satisfaction", "Satisfacao com o projeto", clamp((satisfaction - 50) * 0.16, -9, 8));
    }
    const breachedPromises = state.guarantees.filter((guarantee) => (
      guarantee.coachId === coach.id
        && clubKey(guarantee.clubId) === clubKey(proposal.clubId)
        && ["overdue", "breached"].includes(guarantee.status)
    )).length;
    if (breachedPromises > 0) add("broken_promises", "Promessas pendentes", -Math.min(18, breachedPromises * 6));
    const competingCount = state.proposals.filter((candidate) => (
      candidate.coachId === coach.id
        && candidate.id !== proposal.id
        && ACTIVE_PROPOSAL_STATUSES.has(candidate.status)
    )).length;
    if (competingCount > 0) add("external_interest", "Ofertas externas", -Math.min(8, competingCount * 3));
  } else if (coach.currentClubId && latest?.minimumGamesMet && latest.score >= 70) {
    add("current_stability", "Estabilidade no clube atual", -7);
  }
  const score = Math.round(clamp(50 + factors.reduce((total, factor) => total + factor.value, 0), 0, 100));
  return { score, factors, expectedWage };
}

function rejectAiCoachProposalMutable(room, state, proposal, coach, now, operationIdValue, reason, assessment, events, outcome = "rejected") {
  const previousStatus = proposal.status;
  proposal.status = outcome === "withdrawn" ? "withdrawn" : "rejected";
  proposal.marketStage = "closed";
  proposal.respondedAt = now;
  proposal.updatedAt = now;
  proposal.lastActionAt = now;
  proposal.nextActionAt = null;
  proposal.responseReason = reason;
  proposal.decisionReason = reason;
  proposal.decisionScore = assessment.score;
  proposal.decisionFactors = assessment.factors;
  appendDecision(proposal, {
    action: proposal.status === "withdrawn" ? "withdraw" : "reject",
    responsibleId: coach.id,
    responsibleRole: "candidate",
    previousStatus,
    newStatus: proposal.status,
    justification: reason,
    negotiatedValues: proposalTerms(proposal),
  }, now, operationIdValue);
  closeProposalSelectionMutable(state, proposal, proposal.status, reason, now, operationIdValue);
  refreshCoachMarketStatus(state, coach);
  events.push(eventRecord(proposal.status === "withdrawn" ? "COACH_PROPOSAL_WITHDRAWN" : "COACH_PROPOSAL_REJECTED", operationIdValue, now, {
    coachId: coach.id,
    clubId: proposal.clubId,
    proposalId: proposal.id,
    vacancyId: proposal.vacancyId,
    metadata: { reason, decisionScore: assessment.score, source: "dynamic_ai_coach_market" },
  }));
}

function counterAiCoachProposalMutable(room, state, proposal, coach, now, operationIdValue, assessment, config, events) {
  const previousStatus = proposal.status;
  const concessionRate = clamp(proposal.negotiationRound * 0.025, 0, 0.12);
  const expected = Math.max(proposal.wage * 1.02, assessment.expectedWage * (1 - concessionRate));
  const staffDemand = registerRequiredStaffPackageGuarantee(
    room,
    state,
    proposal,
    now,
    `${operationIdValue}:staff-package`,
  );
  const packageOnlyCounter = Boolean(staffDemand.guarantee)
    && assessment.score >= config.acceptanceScore;
  const requestedWage = packageOnlyCounter
    ? proposal.wage
    : Math.min(
      20_000_000,
      Math.round(Math.max(expected, proposal.wage * (1.02 + (hashText(`${proposal.id}|counter`) % 5) / 100)) / 1_000) * 1_000,
    );
  const requestedBonus = packageOnlyCounter
    ? proposal.signingBonus
    : Math.max(proposal.signingBonus, Math.round(requestedWage / 1_000) * 1_000);
  const guaranteeIds = staffDemand.guarantee ? [staffDemand.guarantee.id] : [];
  proposal.status = "aguardando_resposta_diretoria";
  proposal.marketStage = "club_review";
  proposal.pendingCounterproposal = {
    ...proposalTerms(proposal, {
      wage: requestedWage,
      durationYears: Math.max(2, proposal.durationYears),
      signingBonus: requestedBonus,
    }),
    guaranteeIds,
    submittedAt: now,
    operationId: operationIdValue,
  };
  proposal.negotiationRound += 1;
  proposal.updatedAt = now;
  proposal.lastActionAt = now;
  proposal.nextActionAt = addDays(now, config.boardResponseDelayDays);
  proposal.decisionScore = assessment.score;
  proposal.decisionFactors = assessment.factors;
  proposal.decisionReason = staffDemand.guarantee
    ? "required_personal_staff_package"
    : "conditions_need_improvement";
  appendDecision(proposal, {
    action: "counter",
    responsibleId: coach.id,
    responsibleRole: "candidate",
    previousStatus,
    newStatus: proposal.status,
    justification: staffDemand.guarantee
      ? "Treinador exige a contratacao de sua comissao pessoal"
      : "Treinador solicita melhores condicoes",
    negotiatedValues: proposal.pendingCounterproposal,
    conditions: guaranteeIds,
  }, now, operationIdValue);
  events.push(eventRecord("COACH_PROPOSAL_COUNTERED", operationIdValue, now, {
    coachId: coach.id,
    clubId: proposal.clubId,
    proposalId: proposal.id,
    vacancyId: proposal.vacancyId,
    metadata: {
      source: "dynamic_ai_coach_market",
      wage: requestedWage,
      signingBonus: requestedBonus,
      negotiationRound: proposal.negotiationRound,
      decisionScore: assessment.score,
      concessionRate,
      guaranteeIds,
      staffPackage: staffDemand.staffPackage ? {
        staffIds: staffDemand.staffPackage.staffIds,
        headcount: staffDemand.staffPackage.headcount,
        monthlyCost: staffDemand.staffPackage.monthlyCost,
        firstYearCost: staffDemand.staffPackage.firstYearCost,
        expectedHiringBy: staffDemand.staffPackage.expectedHiringBy,
      } : null,
    },
  }));
}

function acceptAiCoachProposalMutable(room, state, proposal, coach, now, operationIdValue, assessment, events, transactions) {
  assertProposalVacancyOpen(state, proposal);
  ensureProposalCanComplete(room, state, proposal);
  ensureClubCanFundProposal(room, state, proposal);
  const previousStatus = proposal.status;
  const guaranteeTerms = contractGuaranteeTerms(state, proposal);
  const outcome = proposal.kind === "renewal"
    ? performRenewalAgreementMutable(room, state, proposal, now, operationIdValue, guaranteeTerms)
    : performAppointment(room, state, {
      coachId: coach.id,
      clubId: proposal.clubId,
      role: proposal.role,
      wage: proposal.wage,
      durationYears: proposal.durationYears,
      terminationClause: proposal.terminationClause,
      signingBonus: proposal.signingBonus,
      compensation: proposal.compensation,
      transferBudget: proposal.transferBudget,
      autonomyLevel: clamp(50 + finite(proposal.autonomyDelta), 0, 100),
      objectiveDifficultyAdjustment: proposal.objectiveDifficultyDelta,
      sourceInterviewId: proposal.interviewId,
      bonuses: proposal.bonuses,
      guaranteeIds: guaranteeTerms.guaranteeIds,
      clauses: [...proposal.specialClauses, ...guaranteeTerms.clauses],
      staffPackageCommitments: guaranteeTerms.staffPackageCommitments,
      objectives: proposal.objectives,
      startDate: proposal.plannedStartDate,
      entryReason: proposal.kind === "precontract" ? "precontract" : "accepted_market_proposal",
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      applicationId: proposal.applicationId,
    }, now, operationIdValue);
  proposal.status = "accepted";
  proposal.marketStage = "completed";
  proposal.respondedAt = now;
  proposal.updatedAt = now;
  proposal.lastActionAt = now;
  proposal.nextActionAt = null;
  proposal.pendingCounterproposal = null;
  proposal.decisionScore = assessment.score;
  proposal.decisionFactors = assessment.factors;
  proposal.decisionReason = proposal.kind === "renewal" ? "renewal_best_project" : "best_available_offer";
  appendDecision(proposal, {
    action: "accept",
    responsibleId: coach.id,
    responsibleRole: "candidate",
    previousStatus,
    newStatus: proposal.status,
    justification: proposal.decisionReason,
    negotiatedValues: proposalTerms(proposal),
    conditions: guaranteeTerms.guaranteeIds,
  }, now, operationIdValue);
  events.push(...outcome.events);
  transactions.push(...outcome.transactions);
  closeCoachCompetingNegotiationsMutable(state, proposal, now, operationIdValue, events);
  events.push(eventRecord("COACH_PROPOSAL_ACCEPTED", `${operationIdValue}:accepted`, now, {
    coachId: coach.id,
    clubId: proposal.clubId,
    proposalId: proposal.id,
    contractId: outcome.contract?.id,
    vacancyId: proposal.vacancyId,
    metadata: {
      decisionScore: assessment.score,
      source: "dynamic_ai_coach_market",
      staffPackageCommitments: guaranteeTerms.staffPackageCommitments,
    },
  }));
}

function processAiCoachNegotiationsMutable(room, state, now, options, events, transactions, processed) {
  const config = coachMarketConfig(state, options);
  const grouped = new Map();
  for (const proposal of state.proposals) {
    if (!["pending", "aprovada_diretoria"].includes(proposal.status)) continue;
    const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === proposal.coachId);
    if (!coach || coach.managerType === "human") continue;
    const list = grouped.get(coach.id) ?? [];
    list.push(proposal);
    grouped.set(coach.id, list);
  }

  for (const [coachId, proposals] of grouped) {
    const coach = coachById(room, coachId);
    const liveProposals = proposals.filter((proposal) => {
      if (!["pending", "aprovada_diretoria"].includes(proposal.status)) return false;
      if (!proposal.vacancyId) return true;
      return state.vacancies.some((vacancy) => vacancy.id === proposal.vacancyId && vacancy.status === "open");
    });
    const ranked = liveProposals.map((proposal) => ({
      proposal,
      assessment: coachProposalDecision(room, state, coach, proposal, now),
    })).sort((left, right) => right.assessment.score - left.assessment.score
      || left.proposal.id.localeCompare(right.proposal.id, "pt-BR"));
    for (const { proposal, assessment } of ranked) {
      proposal.decisionScore = assessment.score;
      proposal.decisionFactors = assessment.factors;
      proposal.competingProposalIds = ranked
        .filter((candidate) => candidate.proposal.id !== proposal.id)
        .map((candidate) => candidate.proposal.id);
    }

    const best = ranked[0];
    if (!best) continue;
    const proposal = best.proposal;
    const assessment = best.assessment;
    const dueAt = proposal.nextActionAt ?? addDays(proposal.updatedAt ?? proposal.createdAt ?? now, config.coachResponseDelayDays);
    if (new Date(dueAt).getTime() > new Date(now).getTime()) continue;
    const marketRestriction = activeCoachMarketRestriction(coach, now);
    if (marketRestriction && marketRestriction.signingBlocked !== false) {
      const restrictionId = `coach-signing-deferred:${proposal.id}:${marketRestriction.endsAt}`;
      proposal.nextActionAt = marketRestriction.endsAt;
      proposal.decisionReason = "market_restriction_active";
      if (!hasProcessed(state, restrictionId)) {
        appendDecision(proposal, {
          action: "signing_deferred",
          responsibleId: "system",
          responsibleRole: "system",
          previousStatus: proposal.status,
          newStatus: proposal.status,
          justification: `Assinatura bloqueada ate ${marketRestriction.endsAt}`,
          negotiatedValues: { restrictionEndsAt: marketRestriction.endsAt },
        }, now, restrictionId);
        events.push(eventRecord("COACH_SIGNING_DEFERRED", restrictionId, now, {
          coachId: coach.id,
          clubId: proposal.clubId,
          proposalId: proposal.id,
          metadata: { restrictionEndsAt: marketRestriction.endsAt },
        }));
        processed.push(restrictionId);
      }
      continue;
    }
    const id = `coach-ai-response:${proposal.id}:round-${proposal.negotiationRound}`;
    if (hasProcessed(state, id)) continue;
    const expiresSoon = proposal.expiresAt
      && new Date(proposal.expiresAt).getTime() - new Date(now).getTime() <= DAY_MS;
    const requiredStaffPackage = preferredPersonalStaffPackage(room, proposal, now);
    const approvedStaffPackage = requiredStaffPackage
      ? requiredStaffPackageGuarantee(
        state,
        proposal,
        requiredStaffPackage,
        ["formalized", "fulfilled"],
      )
      : null;
    const staffPackageNeedsBoardApproval = Boolean(requiredStaffPackage && !approvedStaffPackage);
    const coachWouldNegotiate = assessment.score >= config.counterScore
      || (expiresSoon && assessment.score >= config.counterScore - 5);
    if (
      staffPackageNeedsBoardApproval
      && coachWouldNegotiate
      && proposal.negotiationRound < proposal.maxNegotiationRounds
    ) {
      counterAiCoachProposalMutable(room, state, proposal, coach, now, id, assessment, config, events);
    } else if (staffPackageNeedsBoardApproval) {
      rejectAiCoachProposalMutable(
        room,
        state,
        proposal,
        coach,
        now,
        id,
        proposal.negotiationRound >= proposal.maxNegotiationRounds
          ? "required_staff_package_not_approved"
          : "project_below_expectations",
        assessment,
        events,
      );
    } else if (assessment.score >= config.acceptanceScore || (expiresSoon && assessment.score >= config.counterScore + 5)) {
      try {
        acceptAiCoachProposalMutable(room, state, proposal, coach, now, id, assessment, events, transactions);
      } catch (error) {
        if (error?.code !== "COACH_PROPOSAL_BUDGET_CHANGED") throw error;
        rejectAiCoachProposalMutable(
          room,
          state,
          proposal,
          coach,
          now,
          id,
          "club_budget_no_longer_available",
          assessment,
          events,
        );
      }
    } else if (assessment.score >= config.counterScore && proposal.negotiationRound < proposal.maxNegotiationRounds) {
      counterAiCoachProposalMutable(room, state, proposal, coach, now, id, assessment, config, events);
    } else {
      const withdrew = proposal.negotiationRound > 0
        && hashText(`${proposal.id}|${proposal.negotiationRound}|withdraw`) % 4 === 0;
      const reason = withdrew
        ? "coach_withdrew_after_failed_negotiation"
        : proposal.negotiationRound >= proposal.maxNegotiationRounds
          ? "negotiation_round_limit_without_agreement"
          : "project_below_expectations";
      rejectAiCoachProposalMutable(
        room,
        state,
        proposal,
        coach,
        now,
        id,
        reason,
        assessment,
        events,
        withdrew ? "withdrawn" : "rejected",
      );
    }
    processed.push(id);

    for (const alternative of ranked.slice(1)) {
      if (!ACTIVE_PROPOSAL_STATUSES.has(alternative.proposal.status)) continue;
      alternative.proposal.nextActionAt = addDays(now, 1);
      alternative.proposal.decisionReason = "comparing_competing_offers";
    }
  }
}

function aiResignationDecision(room, state, coach, appointment, now, options) {
  if (coach.managerType === "human" || coach.id.startsWith("interim-coach:") || appointment.role !== "head_coach") return null;
  const contract = activeContractForCoach(state, coach.id);
  if (!contract || (contract.endDate && new Date(contract.endDate).getTime() <= new Date(now).getTime())) return null;
  const requiredEvaluations = integer(options.aiResignationEvidenceCount, 3, 3, 8);
  const evaluations = activeTenureEvaluations(state, appointment).slice(-requiredEvaluations);
  if (evaluations.length < requiredEvaluations) return null;
  const averageScore = averageEvaluationScore(evaluations);
  const hasFactorThroughout = (code) => evaluations.every((evaluation) => (
    evaluation.factors.some((factor) => factor?.code === code && finite(factor?.impact, 0) < 0)
  ));
  const morale = (room?.clubMoraleStates ?? []).find((entry) => (
    clubKey(entry?.clubId) === clubKey(appointment.clubId)
  ));
  const finance = (room?.marketState?.finances ?? []).find((entry) => (
    clubKey(entry?.clubId) === clubKey(appointment.clubId)
  ));
  const boardTrust = Number(coach.boardConfidence ?? coach.boardRelationship ?? coach.satisfaction);

  let reason = null;
  if (Number.isFinite(Number(morale?.score))
    && Number(morale.score) <= 20
    && averageScore <= 55
    && hasFactorThroughout("squad_unrest")) {
    reason = "prolonged_squad_unrest";
  } else if (Number.isFinite(Number(finance?.balance))
    && Number(finance.balance) < 0
    && averageScore <= 45
    && hasFactorThroughout("financial_pressure")) {
    reason = "persistent_financial_crisis";
  } else if (Number.isFinite(boardTrust)
    && boardTrust <= 15
    && averageScore <= 40
    && evaluations.every((evaluation) => ["review", "dismiss"].includes(evaluation.recommendation))) {
    reason = "prolonged_board_conflict";
  }
  return reason ? {
    reason,
    averageScore,
    evidenceEvaluationIds: evaluations.map((evaluation) => evaluation.id),
    moraleScore: Number.isFinite(Number(morale?.score)) ? Number(morale.score) : null,
    financeBalance: Number.isFinite(Number(finance?.balance)) ? Number(finance.balance) : null,
    boardTrust: Number.isFinite(boardTrust) ? boardTrust : null,
  } : null;
}

function processAiVoluntaryResignations(room, state, now, options, events, transactions, processed) {
  if (options.autoResignAI === false) return;
  for (const appointment of state.appointments.filter((candidate) => (
    candidate.status === "active" && candidate.role === "head_coach"
  ))) {
    const coach = coachById(room, appointment.coachId);
    const decision = aiResignationDecision(room, state, coach, appointment, now, options);
    if (!decision) continue;
    const lastEvidenceId = decision.evidenceEvaluationIds.at(-1);
    const id = `coach-ai-resign:${coach.id}:${lastEvidenceId}`;
    if (hasProcessed(state, id)) continue;
    const contract = activeContractForCoach(state, coach.id);
    const outcome = resignCoachMutable(room, state, {
      coachId: coach.id,
      clubId: appointment.clubId,
      reasonCode: decision.reason,
      reason: decision.reason,
      compensation: contract?.terminationClause ?? 0,
    }, now, id, options);
    const resignationEvent = outcome.events.find((event) => event.type === "COACH_RESIGNED");
    if (resignationEvent) resignationEvent.payload = {
      ...resignationEvent.payload,
      source: "autonomous_ai_lifecycle",
      averageScore: Math.round(decision.averageScore),
      evidenceEvaluationIds: decision.evidenceEvaluationIds,
      moraleScore: decision.moraleScore,
      financeBalance: decision.financeBalance,
      boardTrust: decision.boardTrust,
    };
    events.push(...outcome.events);
    transactions.push(...outcome.transactions);
    processed.push(id);
  }
}

function automaticBoardDecisionInput(room, state, proposal, now, options) {
  if (proposal.status !== "aguardando_resposta_diretoria" || !proposal.pendingCounterproposal) return null;
  const delayDays = coachMarketConfig(state, options).boardResponseDelayDays;
  const updatedAt = new Date(proposal.updatedAt ?? proposal.createdAt ?? now).getTime();
  if (new Date(now).getTime() - updatedAt < delayDays * DAY_MS) return null;
  const requested = proposal.pendingCounterproposal;
  const available = availableClubFunds(room, proposal.clubId);
  const requestedGuarantees = guaranteesForProposal(state, proposal)
    .filter((guarantee) => guarantee.status === "requested");
  const staffPackageGuarantees = requestedGuarantees.filter(isStaffPackageGuarantee);
  const staffPackages = staffPackageGuarantees.map((guarantee) => ({
    guarantee,
    staffPackage: staffPackageFromGuarantee(guarantee),
  })).filter((entry) => entry.staffPackage);
  const staffPackageFirstYearCost = staffPackages.reduce(
    (total, entry) => Math.min(
      MAX_MONEY,
      total + integer(entry.staffPackage.firstYearCost, 0, 0, MAX_MONEY),
    ),
    0,
  );
  const staffPackageMonthlyCost = staffPackages.reduce(
    (total, entry) => Math.min(
      MAX_MONEY,
      total + integer(entry.staffPackage.monthlyCost, 0, 0, MAX_MONEY),
    ),
    0,
  );
  const unavailableStaffIds = [...new Set(staffPackages.flatMap(({ staffPackage }) => (
    (staffPackage.members ?? [])
      .filter((member) => member?.recruitable === false)
      .map((member) => identifier(member?.staffId))
      .filter(Boolean)
  )))];
  const requiredReserve = integer(proposal.compensation, 0, 0, MAX_MONEY)
    + integer(requested.signingBonus, 0, 0, MAX_MONEY)
    + integer(requested.wage, proposal.wage, 0, MAX_MONEY) * 3
    + staffPackageFirstYearCost;
  const decisionContext = {
    availableFunds: available,
    requiredReserve,
    coachCompensation: integer(proposal.compensation, 0, 0, MAX_MONEY),
    coachSigningBonus: integer(requested.signingBonus, 0, 0, MAX_MONEY),
    coachThreeMonthReserve: integer(requested.wage, proposal.wage, 0, MAX_MONEY) * 3,
    staffPackageGuaranteeIds: staffPackageGuarantees.map((guarantee) => guarantee.id),
    staffPackageHeadcount: staffPackages.reduce(
      (total, entry) => total + integer(entry.staffPackage.headcount, 0, 0, 100),
      0,
    ),
    staffPackageMonthlyCost,
    staffPackageFirstYearCost,
    unavailableStaffIds,
  };
  if (unavailableStaffIds.length > 0) {
    return {
      action: "reject",
      guaranteeResolutions: [],
      justification: "A diretoria recusou profissionais indisponiveis na comissao solicitada",
      decisionContext,
    };
  }
  if (available != null && available < requiredReserve) {
    return {
      action: "reject",
      guaranteeResolutions: [],
      justification: staffPackageFirstYearCost > 0
        ? "O pacote da comissao e as condicoes do treinador excedem o caixa disponivel"
        : "Condicoes excedem o orcamento disponivel",
      decisionContext,
    };
  }
  if (available != null && requested.transferBudget != null && requested.transferBudget > available) {
    return {
      action: "reject",
      guaranteeResolutions: [],
      justification: "Orcamento de transferencias solicitado excede a capacidade do clube",
      decisionContext,
    };
  }
  const sourceContract = proposal.kind === "renewal"
    ? state.contracts.find((contract) => contract.id === proposal.sourceContractId)
    : null;
  const baselineWage = Math.max(1, integer(sourceContract?.wage ?? proposal.wage, proposal.wage, 1, MAX_MONEY));
  const wageRatio = requested.wage / baselineWage;
  const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === proposal.coachId);
  const latest = latestCoachEvaluation(state, proposal.coachId);
  const performanceScore = latest?.minimumGamesMet ? latest.score : 50;
  const trustScore = coachCareerTrustSummary(coach).score;
  const acceptableIncrease = clamp(1.05 + Math.max(0, performanceScore - 50) / 200 + Math.max(0, trustScore - 70) / 300, 1.05, 1.4);
  const guaranteeResolutions = requestedGuarantees
    .map((guarantee) => ({
      guaranteeId: guarantee.id,
      status: "formalized",
      responsibleId: guarantee.responsibleId || proposal.clubId,
      responsibleRole: guarantee.responsibleRole || "board",
      dueAt: guarantee.dueAt
        ?? staffPackageFromGuarantee(guarantee)?.expectedHiringBy
        ?? addDays(now, 90),
      effects: guarantee.effects.length > 0 ? guarantee.effects : [{
        type: "contract_clause",
        description: guarantee.description,
      }],
      justification: isStaffPackageGuarantee(guarantee)
        ? `Pacote da comissao formalizado; custo estimado no primeiro ano: ${integer(
          staffPackageFromGuarantee(guarantee)?.firstYearCost,
          0,
          0,
          MAX_MONEY,
        )}`
        : "Garantia formalizada pela diretoria",
    }));
  if (wageRatio <= acceptableIncrease && requested.durationYears <= 5) {
    return {
      action: "approve",
      guaranteeResolutions,
      justification: `Condicoes aprovadas: desempenho ${Math.round(performanceScore)}/100 e confianca ${Math.round(trustScore)}/100`,
      decisionContext,
    };
  }
  if (wageRatio <= acceptableIncrease + 0.25) {
    return {
      action: "new_offer",
      wage: Math.round(((baselineWage * acceptableIncrease + requested.wage) / 2) / 1_000) * 1_000,
      durationYears: Math.min(requested.durationYears, 4),
      transferBudget: requested.transferBudget == null || available == null
        ? requested.transferBudget
        : Math.min(requested.transferBudget, Math.round(available * 0.7)),
      objectives: requested.objectives,
      specialClauses: requested.specialClauses,
      guaranteeResolutions,
      justification: `Diretoria ajusta pedido de ${Math.round((wageRatio - 1) * 100)}% sobre contrato atual`,
      decisionContext,
    };
  }
  return {
    action: "reject",
    guaranteeResolutions: [],
    justification: "Condicoes fora da politica financeira do clube",
    decisionContext,
  };
}

function processActiveInterimsMutable(room, state, now, options, events, transactions, processed) {
  const extensionDays = integer(options.interimExtensionDays, 30, 7, 180);
  const currentTime = new Date(now).getTime();
  for (const appointment of state.appointments.filter((candidate) => (
    candidate.status === "active" && candidate.role === "interim"
  ))) {
    const bonus = interimBonusTransactionMutable(appointment, now);
    if (bonus) {
      transactions.push(bonus);
      events.push(eventRecord("COACH_INTERIM_BONUS_PAID", bonus.operationId, now, {
        coachId: appointment.coachId,
        clubId: appointment.clubId,
        contractId: appointment.contractId,
        amount: bonus.amount,
        metadata: { appointmentId: appointment.id, sourceStaffId: appointment.sourceStaffId },
      }));
      processed.push(bonus.operationId);
    }

    if (!appointment.expectedEndAt || new Date(appointment.expectedEndAt).getTime() > currentTime) continue;
    const vacancy = state.vacancies.find((candidate) => (
      candidate.status === "open" && clubKey(candidate.clubId) === clubKey(appointment.clubId)
    ));
    if (!vacancy) continue;
    const previousExpectedEndAt = appointment.expectedEndAt;
    const id = `coach-interim-extension:${appointment.id}:${previousExpectedEndAt}`;
    if (hasProcessed(state, id)) continue;
    const extensionBase = new Date(Math.max(currentTime, new Date(previousExpectedEndAt).getTime())).toISOString();
    appointment.initialExpectedEndAt = appointment.initialExpectedEndAt ?? previousExpectedEndAt;
    appointment.expectedEndAt = addDays(extensionBase, extensionDays);
    appointment.extensionCount = integer(appointment.extensionCount, 0, 0, 100) + 1;
    appointment.extensionHistory = [
      ...(Array.isArray(appointment.extensionHistory) ? appointment.extensionHistory : []),
      {
        operationId: id,
        previousExpectedEndAt,
        expectedEndAt: appointment.expectedEndAt,
        extendedAt: now,
        reason: "vacancy_still_open",
      },
    ].slice(-100);
    appointment.statistics = appointmentStatistics(room, appointment, now);
    appendNotification(state, {
      type: "COACH_INTERIM_EXTENDED",
      recipientId: appointment.clubId,
      recipientRole: "board",
      coachId: appointment.coachId,
      clubId: appointment.clubId,
      vacancyId: vacancy.id,
      title: "Interinidade prorrogada",
      message: `A vaga segue aberta. Interinidade prorrogada por ${extensionDays} dia(s).`,
    }, now, id);
    events.push(eventRecord("COACH_INTERIM_EXTENDED", id, now, {
      coachId: appointment.coachId,
      clubId: appointment.clubId,
      contractId: appointment.contractId,
      vacancyId: vacancy.id,
      metadata: {
        appointmentId: appointment.id,
        previousExpectedEndAt,
        expectedEndAt: appointment.expectedEndAt,
        extensionDays,
        extensionCount: appointment.extensionCount,
        authorityLevel: appointment.authorityLevel,
        canBeConfirmed: appointment.canBeConfirmed,
        statistics: clone(appointment.statistics),
      },
    }));
    processed.push(id);
  }
}

export function processCoachEmploymentDate(roomValue, asOf = new Date(), options = {}) {
  const now = careerDate(roomValue, asOf);
  let room = ensureCoachEmploymentState(roomValue, { now });
  const events = [];
  const transactions = [];
  const processed = [];

  if (options.conductOnly !== true && options.autoRespondBoard !== false) {
    for (const proposal of [...room.coachEmploymentState.proposals]) {
      const decision = automaticBoardDecisionInput(room, room.coachEmploymentState, proposal, now, options);
      if (!decision) continue;
      const boardOperationId = `coach-board-auto:${proposal.id}:round-${proposal.negotiationRound}`;
      if (hasProcessed(room.coachEmploymentState, boardOperationId)) continue;
      const outcome = respondCoachBoardDecision(room, {
        operationId: boardOperationId,
        proposalId: proposal.id,
        responsibleId: `board:${proposal.clubId}`,
        responsibleRole: "board",
        ...decision,
      }, { now });
      room = outcome.room;
      events.push(...outcome.events);
      processed.push(boardOperationId);
    }
  }
  const state = room.coachEmploymentState;
  state.marketConfig = coachMarketConfig(state, options);
  state.conductConfig = coachConductConfig(state, options);
  processCoachConductProgressMutable(room, state, now, options, events, processed);

  if (options.conductOnly === true) {
    state.currentDate = now;
    assertCoachEmploymentIntegrity(room, now);
    emitCallbacks(room, events, transactions, options);
    markProcessed(state, ...processed);
    synchronizeCareerAndRetain(room, state, now);
    return {
      room,
      events: clone(events),
      financialTransactions: [],
      evaluations: [],
      processedOperationIds: clone(processed),
      duplicate: processed.length === 0,
    };
  }

  processActiveInterimsMutable(room, state, now, options, events, transactions, processed);

  // Interviews are resolved before expiration so a response due on the same
  // career date is not discarded by the generic expiry pass below.
  resolveAiInterviewsMutable(room, state, now, state.marketConfig, events, processed);

  for (const proposal of state.proposals) {
    if (!ACTIVE_PROPOSAL_STATUSES.has(proposal.status) || !proposal.expiresAt) continue;
    if (new Date(proposal.expiresAt).getTime() > new Date(now).getTime()) continue;
    const id = `coach-proposal-expire:${proposal.id}`;
    if (hasProcessed(state, id)) continue;
    const previousStatus = proposal.status;
    proposal.status = "expired";
    proposal.marketStage = "closed";
    proposal.respondedAt = now;
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    proposal.nextActionAt = null;
    proposal.decisionReason = "proposal_deadline_expired";
    appendDecision(proposal, {
      action: "expire",
      responsibleId: "system",
      responsibleRole: "system",
      previousStatus,
      newStatus: proposal.status,
      justification: "Prazo da proposta encerrado sem acordo",
      negotiatedValues: proposalTerms(proposal),
    }, now, id);
    closeProposalSelectionMutable(state, proposal, proposal.status, proposal.decisionReason, now, id);
    const coach = coachById(room, proposal.coachId);
    refreshCoachMarketStatus(state, coach);
    events.push(eventRecord("COACH_PROPOSAL_EXPIRED", id, now, {
      coachId: proposal.coachId, clubId: proposal.clubId, proposalId: proposal.id,
    }));
    processed.push(id);
  }

  for (const guarantee of state.guarantees) {
    if (!guarantee.dueAt || ["fulfilled", "waived", "breached"].includes(guarantee.status)) continue;
    const remainingDays = Math.ceil((new Date(guarantee.dueAt).getTime() - new Date(now).getTime()) / DAY_MS);
    if (remainingDays >= 0 && remainingDays <= 7) {
      const id = `coach-guarantee-due:${guarantee.id}:${guarantee.dueAt}`;
      if (!hasProcessed(state, id)) {
        appendNotification(state, {
          type: "COACH_GUARANTEE_DUE_SOON",
          recipientId: guarantee.responsibleId,
          recipientRole: guarantee.responsibleRole,
          coachId: guarantee.coachId,
          clubId: guarantee.clubId,
          proposalId: guarantee.proposalId,
          vacancyId: guarantee.vacancyId,
          guaranteeId: guarantee.id,
          title: "Garantia proxima do vencimento",
          message: `Prazo em ${remainingDays} dia(s): ${guarantee.description}`,
        }, now, id);
        events.push(eventRecord("COACH_GUARANTEE_DUE_SOON", id, now, {
          coachId: guarantee.coachId,
          clubId: guarantee.clubId,
          proposalId: guarantee.proposalId,
          vacancyId: guarantee.vacancyId,
          metadata: { guaranteeId: guarantee.id, dueAt: guarantee.dueAt, remainingDays },
        }));
        processed.push(id);
      }
    } else if (remainingDays < 0 && guarantee.status !== "overdue") {
      const id = `coach-guarantee-overdue:${guarantee.id}:${guarantee.dueAt}`;
      if (!hasProcessed(state, id)) {
        const previousStatus = guarantee.status;
        guarantee.status = "overdue";
        guarantee.updatedAt = now;
        appendDecision(guarantee, {
          action: "deadline_overdue",
          responsibleId: "system",
          responsibleRole: "system",
          previousStatus,
          newStatus: guarantee.status,
          justification: "Prazo da garantia vencido",
        }, now, id);
        appendNotification(state, {
          type: "COACH_GUARANTEE_OVERDUE",
          recipientId: guarantee.responsibleId,
          recipientRole: guarantee.responsibleRole,
          coachId: guarantee.coachId,
          clubId: guarantee.clubId,
          proposalId: guarantee.proposalId,
          vacancyId: guarantee.vacancyId,
          guaranteeId: guarantee.id,
          title: "Garantia vencida",
          message: guarantee.description,
        }, now, id);
        events.push(eventRecord("COACH_GUARANTEE_OVERDUE", id, now, {
          coachId: guarantee.coachId,
          clubId: guarantee.clubId,
          proposalId: guarantee.proposalId,
          vacancyId: guarantee.vacancyId,
          metadata: { guaranteeId: guarantee.id, dueAt: guarantee.dueAt },
        }));
        processed.push(id);
      }
    }
  }

  for (const interview of state.interviews) {
    if (interview.status !== "pending" || !interview.expiresAt) continue;
    if (new Date(interview.expiresAt).getTime() > new Date(now).getTime()) continue;
    const id = `coach-interview-expire:${interview.id}`;
    if (hasProcessed(state, id)) continue;
    interview.status = "expired";
    interview.closedAt = now;
    interview.closedReason = "interview_deadline_expired";
    interview.closedBy = id;
    appendDecision(interview, {
      action: "expire",
      responsibleId: "system",
      responsibleRole: "system",
      previousStatus: "pending",
      newStatus: interview.status,
      justification: "Prazo da entrevista encerrado sem resposta",
    }, now, id);
    const application = state.applications.find((candidate) => candidate.id === interview.applicationId);
    if (application) application.status = "rejected";
    events.push(eventRecord("COACH_INTERVIEW_EXPIRED", id, now, {
      coachId: interview.coachId, clubId: interview.clubId,
      metadata: { interviewId: interview.id },
    }));
    processed.push(id);
  }

  for (const scheduled of state.appointments.filter((appointment) => appointment.status === "scheduled")) {
    const start = scheduled.expectedStartAt ?? scheduled.startedAt;
    if (!start || new Date(start).getTime() > new Date(now).getTime()) continue;
    const id = `coach-appointment-activate:${scheduled.id}`;
    if (hasProcessed(state, id)) continue;
    const scheduledContract = state.contracts.find((contract) => contract.id === scheduled.contractId);
    scheduled.status = "activated";
    if (scheduledContract) {
      scheduledContract.status = "replaced";
      scheduledContract.endedAt = now;
      scheduledContract.endReason = "scheduled_contract_activated";
    }
    const result = performImmediateAppointment(room, state, {
      coachId: scheduled.coachId,
      clubId: scheduled.clubId,
      proposalId: scheduled.proposalId,
      vacancyId: scheduled.vacancyId,
      applicationId: scheduled.applicationId,
      role: scheduled.role,
      wage: scheduledContract?.wage,
      endDate: scheduledContract?.endDate,
      terminationClause: scheduledContract?.terminationClause,
      signingBonus: scheduledContract?.signingBonus,
      compensation: scheduled.entryReason === "precontract" ? 0 : scheduledContract?.compensation,
      objectives: scheduledContract?.objectives,
      startDate: now,
      entryReason: scheduled.entryReason,
    }, now, id);
    events.push(...result.events);
    transactions.push(...result.transactions);
    processed.push(id);
  }

  processAiVoluntaryResignations(room, state, now, options, events, transactions, processed);
  processAiContractRenewals(room, state, now, options, events, processed);

  for (const contract of state.contracts.filter((candidate) => candidate.status === "active" && candidate.endDate)) {
    if (new Date(contract.endDate).getTime() > new Date(now).getTime()) continue;
    const id = `coach-contract-expire:${contract.id}`;
    if (hasProcessed(state, id)) continue;
    const appointment = activeAppointmentForCoach(state, contract.coachId);
    if (appointment) {
      const coach = coachById(room, contract.coachId);
      applyCoachRecoveryMutable(state, coach, {
        kind: "contract_completed",
        operationId: `${id}:reputation-recovery`,
        clubId: contract.clubId,
        reasonLabel: "Contrato cumprido ate o fim",
        metadata: { contractId: contract.id },
      }, now, events, processed, options);
      closeAppointmentMutable(room, state, appointment, now, "contract_expired", "unemployed");
      const interim = createInterimMutable(
        room,
        state,
        contract.clubId,
        "contract_expired",
        now,
        id,
        { payBonus: true },
      );
      events.push(eventRecord("COACH_CONTRACT_EXPIRED", id, now, {
        coachId: coach.id, clubId: contract.clubId, contractId: contract.id, vacancyId: interim.vacancy?.id,
      }));
      if (interim.event) events.push(interim.event);
      transactions.push(...interim.transactions);
    } else {
      contract.status = "expired";
      contract.endedAt = now;
      contract.endReason = "contract_expired";
    }
    processed.push(id);
  }

  const minimumGames = integer(options.minimumGames, 5, 1, 30);
  const round = completedRound(room);
  // After the first evaluation, state.jobSecurity is the previous evaluation's own result.
  let jobSecurityOwned = false;
  for (const appointment of state.appointments.filter((candidate) => candidate.status === "active")) {
    const id = `coach-evaluation:s${seasonNumber(room)}:r${round}:${appointment.id}`;
    if (state.evaluations.some((evaluation) => evaluation.id === id)) continue;
    const securityOutcome = evaluateAppointment(room, state, appointment, now, minimumGames, id, { jobSecurityOwned });
    jobSecurityOwned = true;
    const evaluation = normalizeEvaluation(securityOutcome.evaluation);
    state.jobSecurity = securityOutcome.jobSecurityState;
    state.evaluations.push(evaluation);
    events.push(eventRecord(appointment.role === "interim" ? "COACH_INTERIM_EVALUATED" : "COACH_EVALUATED", id, now, {
      coachId: appointment.coachId,
      clubId: appointment.clubId,
      metadata: {
        appointmentId: appointment.id,
        role: appointment.role,
        score: evaluation.score,
        securityLevel: evaluation.securityLevel,
        recommendation: evaluation.recommendation,
        games: evaluation.games,
      },
    }));
    processed.push(id);
    for (const action of securityOutcome.actions ?? []) {
      if (hasProcessed(state, action.operationId)) continue;
      appendNotification(state, {
        type: action.type,
        recipientId: appointment.coachId,
        recipientRole: "coach",
        coachId: appointment.coachId,
        clubId: appointment.clubId,
        title: action.title,
        message: action.message,
      }, now, action.operationId);
      events.push(eventRecord(action.type, action.operationId, now, {
        coachId: appointment.coachId,
        clubId: appointment.clubId,
        metadata: {
          appointmentId: appointment.id,
          evaluationId: evaluation.id,
          ultimatumId: action.ultimatumId ?? null,
          meetingId: action.meetingId ?? null,
          score: evaluation.score,
          securityLevel: evaluation.securityLevel,
        },
      }));
      processed.push(action.operationId);
    }

    const coach = coachById(room, appointment.coachId);
    if (appointment.role === "interim") continue;
    const recoveryInterval = coachConductConfig(state, options).evaluationRecoveryIntervalRounds;
    if (evaluation.minimumGamesMet && evaluation.round > 0 && evaluation.round % recoveryInterval === 0) {
      applyCoachRecoveryMutable(state, coach, {
        kind: "evaluation",
        operationId: `${id}:reputation-recovery`,
        clubId: appointment.clubId,
        score: evaluation.score,
        reasonLabel: "Recuperacao por desempenho consistente",
        metadata: { evaluationId: evaluation.id, score: evaluation.score },
      }, now, events, processed, options);
    }
    const previousPoor = state.evaluations
      .filter((candidate) => candidate.coachId === coach.id && candidate.id !== id && candidate.minimumGamesMet)
      .slice(-1)[0];
    const dismissalEnabled = coach.managerType === "human"
      ? options.autoDismissHuman !== false
      : options.autoDismissAI !== false;
    const autoDismiss = dismissalEnabled
      && (
        evaluation.ultimatumOutcome === "failed"
        || (
          (evaluation.recommendation === "dismiss" || evaluation.score < 25)
          && previousPoor?.score < 25
        )
      );
    if (autoDismiss) {
      const dismissalId = `${id}:auto-dismiss`;
      const contract = activeContractForCoach(state, coach.id);
      const penalty = integer(contract?.terminationClause, 0, 0, MAX_MONEY);
      closeAppointmentMutable(room, state, appointment, now, "performance_dismissal", "dismissed");
      const interim = createInterimMutable(
        room,
        state,
        appointment.clubId,
        "performance_dismissal",
        now,
        dismissalId,
        { payBonus: true },
      );
      if (penalty > 0) transactions.push(financeRecord("expense", "coach_termination", dismissalId, now, {
        clubId: appointment.clubId, coachId: coach.id, amount: penalty,
      }));
      events.push(eventRecord("COACH_DISMISSED", dismissalId, now, {
        coachId: coach.id, clubId: appointment.clubId, contractId: contract?.id,
        vacancyId: interim.vacancy?.id, amount: penalty,
        metadata: { reason: "performance_dismissal", evaluationId: evaluation.id },
      }));
      if (interim.event) events.push(interim.event);
      transactions.push(...interim.transactions);
      processed.push(dismissalId);
    }
  }

  for (const vacancy of state.vacancies.filter((candidate) => candidate.status === "open")) {
    progressOpenCoachVacancy(room, state, vacancy, now, options, events, processed);
  }
  processAiCoachNegotiationsMutable(room, state, now, options, events, transactions, processed);

  state.currentDate = now;
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, events, transactions, options);
  markProcessed(state, ...processed);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    events: clone(events),
    financialTransactions: clone(transactions),
    evaluations: clone(state.evaluations.filter((evaluation) => processed.includes(evaluation.id))),
    processedOperationIds: clone(processed),
    duplicate: processed.length === 0,
  };
}
