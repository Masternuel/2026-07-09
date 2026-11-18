// Vacancy applications and interviews (including AI interview turns).
// Split from coachEmployment.mjs (audit Q-02); declarations are unchanged.
import { CoachEmploymentError, INTERVIEW_DEPTHS, INTERVIEW_METRIC_KEYS, MAX_MONEY, activeProfessionalLifecycleRecord, addDays, assertCoachEmploymentIntegrity, careerDate, clamp, clone, coachById, deterministicId, ensureCoachEmploymentState, eventRecord, finite, hashText, identifier, integer, interviewCompatibility, interviewDepthLimits, limitedInterviewText, normalizeApplication, normalizeInterviewEvaluation, normalizeInterviewMetrics, normalizeInterviewNegotiationEffects, normalizeInterviewRelationshipImpact, normalizeInterviewTurnAnalysis, normalizeProposal, operationId, synchronizeCareerAndRetain } from "./state.mjs";
import { appendDecision, applyInterviewRelationshipMutable, availableClubFunds, coachEligibleForVacancy, coachMarketAssessment, coachOfferWage, duplicateResult, emitCallbacks, hasProcessed, markProcessed } from "./shared.mjs";

const MIN_INTERVIEW_COMPATIBILITY = 45;

function assertCoachMayInterviewDuringNotice(room, coachId) {
  const notice = activeProfessionalLifecycleRecord(room, "notices", coachId);
  if (notice?.interviewAllowed === false) {
    throw new CoachEmploymentError(
      "O aviso previo atual nao permite entrevistas com outros clubes",
      "COACH_NOTICE_INTERVIEW_FORBIDDEN",
      409,
      { coachId: identifier(coachId), noticeId: notice.id },
    );
  }
}

export function applyForCoachVacancy(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const vacancy = state.vacancies.find((candidate) => candidate.id === identifier(input.vacancyId));
  if (!vacancy) throw new CoachEmploymentError("Vaga nao encontrada", "COACH_VACANCY_NOT_FOUND", 404);
  if (vacancy.status !== "open") throw new CoachEmploymentError("Vaga encerrada", "COACH_VACANCY_CLOSED", 409);
  if (vacancy.closesAt && new Date(vacancy.closesAt).getTime() <= new Date(now).getTime()) {
    throw new CoachEmploymentError("Vaga expirada", "COACH_VACANCY_EXPIRED", 409);
  }
  const coach = coachById(room, input.coachId);
  assertCoachMayInterviewDuringNotice(room, coach.id);
  if (state.applications.some((application) => (
    application.vacancyId === vacancy.id && application.coachId === coach.id
      && !["rejected", "withdrawn"].includes(application.status)
  ))) throw new CoachEmploymentError("Candidatura ja existe", "COACH_APPLICATION_DUPLICATE", 409);
  const assessment = coachMarketAssessment(room, state, coach, vacancy, now, state.marketConfig);
  if (!assessment.eligible) {
    throw new CoachEmploymentError(
      "Perfil nao atende aos requisitos obrigatorios da vaga",
      "COACH_VACANCY_REQUIREMENTS_NOT_MET",
      409,
      { hardBlockers: assessment.hardBlockers, score: assessment.score },
    );
  }
  if (!coachEligibleForVacancy(room, state, coach, vacancy, now, state.marketConfig)) {
    throw new CoachEmploymentError(
      "Treinador indisponivel para esta vaga",
      "COACH_VACANCY_CANDIDATE_UNAVAILABLE",
      409,
      { coachId: coach.id, vacancyId: vacancy.id },
    );
  }
  const application = normalizeApplication({
    id: deterministicId("coach-application", `${id}|${vacancy.id}|${coach.id}`),
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
  appendDecision(application, {
    action: "candidate_scored",
    responsibleId: vacancy.clubId,
    responsibleRole: "board",
    previousStatus: null,
    newStatus: application.status,
    justification: `Compatibilidade calculada em ${assessment.score}/100`,
    negotiatedValues: {
      score: assessment.score,
      eligible: assessment.eligible,
      profileVersion: assessment.profileVersion,
    },
  }, now, `${id}:assessment`);
  const event = eventRecord("COACH_APPLICATION_SUBMITTED", id, now, {
    coachId: coach.id, clubId: vacancy.clubId, vacancyId: vacancy.id,
    metadata: {
      applicationId: application.id,
      shortlistScore: assessment.score,
      profileVersion: assessment.profileVersion,
      hardBlockers: assessment.hardBlockers,
    },
  });
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, [event], [], options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return { room, application: clone(application), interview: null, events: [clone(event)], duplicate: false };
}

function generatedInterviewDecision(evaluation, compatibilityScore) {
  const recommendation = identifier(evaluation?.recommendation);
  if (recommendation === "reject") return "reject";
  if (recommendation === "observe") return "complete";
  if (["hire", "hire_with_reservations", "negotiate"].includes(recommendation)) return "accept";
  return compatibilityScore >= MIN_INTERVIEW_COMPATIBILITY ? "accept" : "reject";
}

function mergeInterviewRelationshipImpact(currentValue, nextValue) {
  const current = normalizeInterviewRelationshipImpact(currentValue);
  const next = normalizeInterviewRelationshipImpact(nextValue);
  return Object.fromEntries(Object.keys(current).map((key) => [
    key,
    Math.round(clamp(current[key] + next[key], -20, 20) * 10) / 10,
  ]));
}

function interviewAdjustedProposalTerms(room, vacancy, interview, input, suggestedWage) {
  const salary = vacancy?.desiredProfile?.salary ?? {};
  const minimumWage = Math.max(1_000, integer(salary.minimum, suggestedWage, 1_000, MAX_MONEY));
  const maximumWage = integer(salary.maximum, suggestedWage, minimumWage, MAX_MONEY);
  const effects = normalizeInterviewNegotiationEffects(
    input.negotiationEffects ?? interview.negotiationEffects,
  );
  const baseWage = finite(input.wage, suggestedWage);
  const wage = integer(
    effects ? baseWage * effects.salaryMultiplier : baseWage,
    suggestedWage,
    minimumWage,
    maximumWage,
  );
  const baseDuration = integer(input.durationYears, 2, 1, 5);
  const durationYears = integer(baseDuration + (effects?.durationYearsDelta ?? 0), baseDuration, 1, 5);
  const baseTerminationClause = finite(input.terminationClause, wage * 6);
  const terminationClause = integer(
    effects ? baseTerminationClause * effects.terminationClauseMultiplier : baseTerminationClause,
    wage * 6,
    0,
    Math.min(MAX_MONEY, wage * 24),
  );
  const baseSigningBonus = input.signingBonus == null ? wage : finite(input.signingBonus, wage);
  const signingBonus = effects
    ? integer(baseSigningBonus * effects.signingBonusMultiplier, 0, 0, MAX_MONEY)
    : integer(input.signingBonus, 0, 0, MAX_MONEY);
  const performanceBonus = effects
    ? integer(wage * effects.performanceBonusMultiplier, 0, 0, MAX_MONEY)
    : integer(input.bonuses?.performance, 0, 0, MAX_MONEY);
  const available = availableClubFunds(room, interview.clubId);
  const profileBudget = vacancy?.desiredProfile?.availableBudget;
  const baseTransferBudget = input.transferBudget ?? profileBudget;
  const adjustedTransferBudget = baseTransferBudget == null
    ? null
    : integer(
      finite(baseTransferBudget) * (effects?.transferBudgetMultiplier ?? 1),
      0,
      0,
      available == null ? MAX_MONEY : Math.min(MAX_MONEY, available),
    );
  const objectives = [
    ...(vacancy?.desiredProfile?.objectives?.length ? vacancy.desiredProfile.objectives : input.objectives ?? []),
    ...(effects?.objectives ?? []),
  ];
  return {
    wage,
    durationYears,
    terminationClause,
    signingBonus,
    transferBudget: adjustedTransferBudget,
    bonuses: {
      ...(input.bonuses && typeof input.bonuses === "object" ? clone(input.bonuses) : {}),
      ...(performanceBonus > 0 ? { performance: performanceBonus } : {}),
    },
    objectives,
    specialClauses: effects?.specialClauses ?? input.specialClauses ?? [],
    effects,
  };
}

export function respondCoachInterview(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const interview = state.interviews.find((candidate) => candidate.id === identifier(input.interviewId));
  const actorCoachId = identifier(input.coachId);
  if (!interview || (actorCoachId && interview.coachId !== actorCoachId)) {
    throw new CoachEmploymentError("Entrevista nao encontrada", "COACH_INTERVIEW_NOT_FOUND", 404);
  }
  assertCoachMayInterviewDuringNotice(room, interview.coachId);
  if (interview.status !== "pending") throw new CoachEmploymentError("Entrevista encerrada", "COACH_INTERVIEW_CLOSED", 409);
  if (interview.expiresAt && new Date(interview.expiresAt).getTime() <= new Date(now).getTime()) {
    throw new CoachEmploymentError("Entrevista expirada", "COACH_INTERVIEW_EXPIRED", 409);
  }
  interview.answers = clone(Array.isArray(input.answers) ? input.answers : []);
  const application = state.applications.find((candidate) => candidate.id === interview.applicationId) ?? null;
  const legacyAnswerCompatibility = interviewCompatibility(interview, interview.answers);
  const trustedAssessment = normalizeInterviewEvaluation(
    input.assessment,
    now,
    legacyAnswerCompatibility,
  );
  const answerCompatibility = trustedAssessment?.overallScore ?? legacyAnswerCompatibility;
  const selectionCompatibility = finite(application?.candidateAssessment?.score, answerCompatibility);
  interview.compatibilityScore = Math.round(clamp(
    trustedAssessment
      ? (selectionCompatibility * 0.3) + (answerCompatibility * 0.7)
      : (selectionCompatibility * 0.7) + (answerCompatibility * 0.3),
    0,
    100,
  ));
  interview.selectionScore = selectionCompatibility;
  interview.answerCompatibilityScore = answerCompatibility;
  if (trustedAssessment) {
    interview.evaluation = trustedAssessment;
    interview.cumulativeMetrics = normalizeInterviewMetrics(trustedAssessment.metrics, answerCompatibility);
    interview.relationshipImpact = normalizeInterviewRelationshipImpact(
      input.relationshipImpact ?? interview.relationshipImpact,
    );
    interview.negotiationEffects = normalizeInterviewNegotiationEffects(
      input.negotiationEffects ?? interview.negotiationEffects,
    );
    interview.memorySummary = limitedInterviewText(
      input.memorySummary ?? interview.memorySummary ?? trustedAssessment.summary,
      2_000,
    ) || null;
    if (application && interview.negotiationEffects?.priorityDelta) {
      application.interestScore = Math.round(clamp(
        finite(application.interestScore, selectionCompatibility) + interview.negotiationEffects.priorityDelta,
        0,
        100,
      ) * 10) / 10;
      application.shortlistScore = Math.round(clamp(
        finite(application.shortlistScore, selectionCompatibility) + interview.negotiationEffects.priorityDelta,
        0,
        100,
      ) * 10) / 10;
    }
  }
  interview.completedAt = now;
  const requestedDecision = identifier(input.decision).toLocaleLowerCase("pt-BR");
  const decision = interview.negotiationEffects?.terminateNegotiation
    ? "reject"
    : requestedDecision || generatedInterviewDecision(trustedAssessment, interview.compatibilityScore);
  const interviewPassed = interview.compatibilityScore >= MIN_INTERVIEW_COMPATIBILITY;
  const coach = coachById(room, interview.coachId);
  applyInterviewRelationshipMutable(coach, interview, now, id);
  let proposal = null;
  if (decision === "accept" && interviewPassed) {
    interview.status = "accepted";
    if (application) application.status = "accepted";
    const vacancy = state.vacancies.find((candidate) => (
      candidate.id === (application?.vacancyId ?? interview.vacancyId)
    )) ?? null;
    const suggestedWage = coachOfferWage(
      room,
      coach,
      interview.clubId,
      vacancy?.desiredProfile,
      state,
      now,
    );
    const terms = interviewAdjustedProposalTerms(room, vacancy, interview, input, suggestedWage);
    proposal = normalizeProposal({
      id: deterministicId("coach-proposal", `${id}|interview|${interview.id}`),
      coachId: interview.coachId,
      clubId: interview.clubId,
      vacancyId: application?.vacancyId ?? interview.vacancyId,
      applicationId: application?.id ?? interview.applicationId,
      interviewId: interview.id,
      wage: terms.wage,
      durationYears: terms.durationYears,
      terminationClause: terms.terminationClause,
      signingBonus: terms.signingBonus,
      transferBudget: terms.transferBudget,
      bonuses: terms.bonuses,
      objectives: terms.objectives,
      specialClauses: terms.specialClauses,
      interviewEvaluation: clone(interview.evaluation),
      interviewRelationshipImpact: clone(interview.relationshipImpact),
      interviewNegotiationEffects: clone(interview.negotiationEffects),
      interviewCompatibility: interview.compatibilityScore,
      autonomyDelta: interview.negotiationEffects?.autonomyDelta ?? 0,
      priorityDelta: interview.negotiationEffects?.priorityDelta ?? 0,
      objectiveDifficultyDelta: interview.negotiationEffects?.objectiveDifficultyDelta ?? 0,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt: input.proposalExpiresAt ?? addDays(now, 7),
      plannedStartDate: input.plannedStartDate ?? now,
      availableBudget: availableClubFunds(room, interview.clubId),
      boardExpectation: vacancy?.desiredProfile?.expectation,
      clubSituation: vacancy?.reason,
      maxNegotiationRounds: state.marketConfig.maxNegotiationRounds,
      operationId: id,
    });
    state.proposals.push(proposal);
    if (!coach.currentClubId) coach.status = "negotiating";
  } else if (decision === "reject" || decision === "accept") {
    interview.status = "rejected";
    if (application) {
      application.status = "rejected";
      application.responseReason = decision === "accept"
        ? "interview_incompatible"
        : "candidate_rejected_interview";
    }
  } else {
    interview.status = "completed";
    if (application) application.status = "interview_completed";
  }
  if (application) application.updatedAt = now;
  appendDecision(interview, {
    action: proposal ? "interview_passed" : interview.status === "rejected" ? "interview_failed" : "interview_observed",
    responsibleId: interview.clubId,
    responsibleRole: "board",
    previousStatus: "pending",
    newStatus: interview.status,
    justification: trustedAssessment?.summary ?? `Compatibilidade ${interview.compatibilityScore}/100`,
    negotiatedValues: {
      compatibilityScore: interview.compatibilityScore,
      recommendation: trustedAssessment?.recommendation ?? null,
      negotiationEffects: clone(interview.negotiationEffects),
    },
  }, now, `${id}:interview`);
  const event = eventRecord(
    proposal ? "COACH_INTERVIEW_ACCEPTED" : interview.status === "rejected" ? "COACH_INTERVIEW_REJECTED" : "COACH_INTERVIEW_COMPLETED",
    id,
    now,
    {
      coachId: interview.coachId,
      clubId: interview.clubId,
      proposalId: proposal?.id,
      metadata: {
        interviewId: interview.id,
        compatibilityScore: interview.compatibilityScore,
        recommendation: interview.evaluation?.recommendation ?? null,
      },
    },
  );
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, [event], [], options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    interview: clone(interview),
    application: clone(application),
    proposal: clone(proposal),
    events: [clone(event)],
    duplicate: false,
  };
}

function updateInterviewCumulativeMetrics(interview, rawAnalysis, completedTurns) {
  if (!rawAnalysis || typeof rawAnalysis !== "object" || Array.isArray(rawAnalysis)) return;
  const current = normalizeInterviewMetrics(interview.cumulativeMetrics);
  const previousTurns = Math.max(0, completedTurns - 1);
  const rawMetrics = rawAnalysis.metrics && typeof rawAnalysis.metrics === "object"
    ? rawAnalysis.metrics
    : {
      clubCompatibility: rawAnalysis.strategicAlignment,
      longTermPotential: rawAnalysis.expectedTenure,
      culturalFit: rawAnalysis.culturalFit,
      perceivedRisk: rawAnalysis.perceivedRisk,
    };
  for (const metric of INTERVIEW_METRIC_KEYS) {
    if (!Number.isFinite(Number(rawMetrics[metric]))) continue;
    const next = clamp(Number(rawMetrics[metric]), 0, 100);
    current[metric] = Math.round(((current[metric] * previousTurns + next) / Math.max(1, completedTurns)) * 10) / 10;
  }
  if (Number.isFinite(Number(rawAnalysis.confidenceDelta))) {
    current.boardConfidence = Math.round(clamp(
      current.boardConfidence + Number(rawAnalysis.confidenceDelta),
      0,
      100,
    ) * 10) / 10;
  }
  if (Number.isFinite(Number(rawAnalysis.credibilityDelta))) {
    current.credibility = Math.round(clamp(
      current.credibility + Number(rawAnalysis.credibilityDelta),
      0,
      100,
    ) * 10) / 10;
  }
  interview.cumulativeMetrics = current;
}

function fallbackInterviewEvaluation(interview, now) {
  const metrics = normalizeInterviewMetrics(interview.cumulativeMetrics);
  const positiveKeys = INTERVIEW_METRIC_KEYS.filter((metric) => metric !== "perceivedRisk");
  const total = positiveKeys.reduce((sum, metric) => sum + metrics[metric], 100 - metrics.perceivedRisk);
  const overallScore = Math.round((total / (positiveKeys.length + 1)) * 10) / 10;
  return normalizeInterviewEvaluation({
    overallScore,
    metrics,
    strengths: positiveKeys
      .filter((metric) => metrics[metric] >= 70)
      .slice(0, 4)
      .map((metric) => metric),
    risks: metrics.perceivedRisk >= 60 ? ["Risco percebido acima do desejado pela diretoria"] : [],
    recommendation: overallScore >= 72 ? "hire" : overallScore >= 55 ? "hire_with_reservations" : "reject",
    summary: interview.memorySummary ?? `Entrevista concluida com avaliacao ${Math.round(overallScore)}/100.`,
    generatedAt: now,
  }, now, overallScore);
}

/**
 * Persists one trusted, server-generated interview turn. Gemini/network work
 * must happen before this pure domain operation; revision/question checks make
 * the later transaction safe against duplicated or stale responses.
 */
export function applyCoachInterviewGeneratedTurn(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const interviewId = identifier(input.interviewId);
  const interview = state.interviews.find((candidate) => candidate.id === interviewId);
  const actorCoachId = identifier(input.coachId);
  if (!interview || (actorCoachId && interview.coachId !== actorCoachId)) {
    throw new CoachEmploymentError("Entrevista nao encontrada", "COACH_INTERVIEW_NOT_FOUND", 404);
  }
  if (hasProcessed(state, id)) {
    const application = state.applications.find((candidate) => candidate.id === interview.applicationId) ?? null;
    const proposal = state.proposals.find((candidate) => candidate.interviewId === interview.id) ?? null;
    return {
      room,
      interview: clone(interview),
      application: clone(application),
      proposal: clone(proposal),
      events: [],
      duplicate: true,
    };
  }
  if (interview.status !== "pending") {
    throw new CoachEmploymentError("Entrevista encerrada", "COACH_INTERVIEW_CLOSED", 409);
  }
  if (interview.expiresAt && new Date(interview.expiresAt).getTime() <= new Date(now).getTime()) {
    throw new CoachEmploymentError("Entrevista expirada", "COACH_INTERVIEW_EXPIRED", 409);
  }
  if (!Number.isInteger(Number(input.expectedRevision)) || Number(input.expectedRevision) !== interview.revision) {
    throw new CoachEmploymentError(
      "Entrevista foi atualizada em outra sessao",
      "COACH_INTERVIEW_REVISION_CONFLICT",
      409,
      { expectedRevision: input.expectedRevision, currentRevision: interview.revision },
    );
  }
  const expectedQuestionId = identifier(input.expectedQuestionId) || null;
  if (expectedQuestionId !== interview.currentQuestionId) {
    throw new CoachEmploymentError(
      "Pergunta atual da entrevista foi alterada",
      "COACH_INTERVIEW_QUESTION_CONFLICT",
      409,
      { expectedQuestionId, currentQuestionId: interview.currentQuestionId },
    );
  }
  const phase = identifier(input.phase).toLocaleLowerCase("en-US");
  if (!['start', 'answer'].includes(phase)) {
    throw new CoachEmploymentError("Fase da entrevista invalida", "COACH_INTERVIEW_PHASE_INVALID", 400);
  }
  if (phase === "start" && (interview.currentQuestionId || interview.transcript.length > 0)) {
    throw new CoachEmploymentError("Entrevista ja iniciada", "COACH_INTERVIEW_ALREADY_STARTED", 409);
  }
  if (phase === "answer" && !interview.currentQuestionId) {
    throw new CoachEmploymentError("Entrevista ainda nao possui pergunta ativa", "COACH_INTERVIEW_QUESTION_REQUIRED", 409);
  }
  const candidateMessage = limitedInterviewText(input.candidateMessage, 2_000);
  if (phase === "answer" && !candidateMessage) {
    throw new CoachEmploymentError("Resposta do treinador e obrigatoria", "COACH_INTERVIEW_ANSWER_REQUIRED", 400);
  }
  const generated = input.generated && typeof input.generated === "object" && !Array.isArray(input.generated)
    ? input.generated
    : null;
  const boardMessage = limitedInterviewText(generated?.message, 2_000);
  if (!generated || !boardMessage) {
    throw new CoachEmploymentError("Resposta gerada invalida", "COACH_INTERVIEW_GENERATED_TURN_INVALID", 400);
  }
  const generatedSource = identifier(generated.source).toLocaleLowerCase("en-US");
  if (!["gemini", "fallback"].includes(generatedSource)) {
    throw new CoachEmploymentError("Fonte da entrevista invalida", "COACH_INTERVIEW_SOURCE_INVALID", 400);
  }

  if (phase === "start") {
    interview.questions = [];
    const requestedDepth = identifier(input.depth).toLocaleLowerCase("en-US");
    interview.depth = INTERVIEW_DEPTHS.has(requestedDepth) ? requestedDepth : interview.depth;
    const limits = interviewDepthLimits(interview.depth);
    interview.minTurns = limits.minimum;
    interview.maxTurns = limits.maximum;
    if (input.contextSnapshot && typeof input.contextSnapshot === "object" && !Array.isArray(input.contextSnapshot)) {
      interview.contextSnapshot = clone(input.contextSnapshot);
      interview.contextHash = hashText(JSON.stringify(interview.contextSnapshot)).toString(36);
    }
  }
  if (phase === "answer") {
    interview.turnCount += 1;
    interview.transcript.push({
      id: deterministicId("coach-interview-message", `${id}|candidate`),
      role: "coach",
      text: candidateMessage,
      topic: limitedInterviewText(generated.topic, 80) || "general",
      questionId: interview.currentQuestionId,
      createdAt: now,
      turn: interview.turnCount,
      analysis: null,
      operationId: id,
    });
    interview.answers.push({
      questionId: interview.currentQuestionId,
      text: candidateMessage,
      source: "coach",
    });
    updateInterviewCumulativeMetrics(interview, generated.turnAnalysis, interview.turnCount);
    const normalizedTurnAnalysis = normalizeInterviewTurnAnalysis(generated.turnAnalysis);
    interview.relationshipImpact = mergeInterviewRelationshipImpact(
      interview.relationshipImpact,
      normalizedTurnAnalysis?.relationshipImpact ?? generated.relationshipImpact,
    );
  }

  const canEnd = interview.turnCount >= interview.minTurns;
  const negotiationTerminated = Boolean(generated.negotiationEffects?.terminateNegotiation);
  const shouldEnd = negotiationTerminated || (Boolean(generated.shouldEnd) && canEnd);
  const boardMessageId = deterministicId("coach-interview-message", `${id}|board`);
  const turnAnalysis = normalizeInterviewTurnAnalysis(generated.turnAnalysis);
  interview.transcript.push({
    id: boardMessageId,
    role: "board",
    text: boardMessage,
    topic: limitedInterviewText(generated.topic, 80) || "general",
    questionId: null,
    createdAt: now,
    turn: Math.max(1, interview.turnCount + (phase === "start" ? 1 : 0)),
    analysis: turnAnalysis,
    operationId: id,
  });
  interview.transcript = interview.transcript.slice(-80);
  interview.currentQuestionId = shouldEnd ? null : boardMessageId;
  if (!shouldEnd) {
    interview.questions = [...interview.questions, {
      id: boardMessageId,
      topic: limitedInterviewText(generated.topic, 80) || "general",
      prompt: boardMessage,
      preferredAnswer: null,
    }].slice(-20);
  }
  interview.mode = generatedSource === "gemini" ? "generative" : "fallback";
  interview.source = generatedSource;
  interview.model = limitedInterviewText(generated.model, 120) || null;
  interview.negotiationEffects = normalizeInterviewNegotiationEffects(
    generated.negotiationEffects ?? interview.negotiationEffects,
  );
  interview.memorySummary = limitedInterviewText(
    generated.memorySummary ?? interview.memorySummary,
    2_000,
  ) || null;
  interview.revision += 1;
  interview.updatedAt = now;
  appendDecision(interview, {
    action: shouldEnd ? "generated_interview_completed" : phase === "start" ? "generated_interview_started" : "generated_interview_turn",
    responsibleId: interview.clubId,
    responsibleRole: "board",
    previousStatus: interview.status,
    newStatus: interview.status,
    justification: shouldEnd ? "Controlador encerrou a entrevista" : `Turno ${interview.turnCount}`,
    negotiatedValues: {
      revision: interview.revision,
      turnCount: interview.turnCount,
      source: interview.source,
      topic: limitedInterviewText(generated.topic, 80) || "general",
    },
  }, now, `${id}:turn`);
  const progressEvent = eventRecord(
    phase === "start" ? "COACH_INTERVIEW_STARTED" : "COACH_INTERVIEW_TURN_RECORDED",
    `${id}:progress`,
    now,
    {
      coachId: interview.coachId,
      clubId: interview.clubId,
      vacancyId: interview.vacancyId,
      metadata: {
        interviewId: interview.id,
        revision: interview.revision,
        turnCount: interview.turnCount,
        source: interview.source,
        completed: shouldEnd,
      },
    },
  );

  if (!shouldEnd) {
    assertCoachEmploymentIntegrity(room, now);
    emitCallbacks(room, [progressEvent], [], options);
    markProcessed(state, id);
    synchronizeCareerAndRetain(room, state, now);
    return {
      room,
      interview: clone(interview),
      application: clone(state.applications.find((candidate) => candidate.id === interview.applicationId) ?? null),
      proposal: null,
      events: [clone(progressEvent)],
      duplicate: false,
    };
  }

  const generatedEvaluation = generated.evaluation && typeof generated.evaluation === "object"
    ? {
      ...clone(generated.evaluation),
      metrics: {
        ...normalizeInterviewMetrics(interview.cumulativeMetrics),
        ...(generated.evaluation.metrics && typeof generated.evaluation.metrics === "object"
          ? clone(generated.evaluation.metrics)
          : {}),
        ...Object.fromEntries(INTERVIEW_METRIC_KEYS.flatMap((metric) => (
          Number.isFinite(Number(generated.evaluation[metric]))
            ? [[metric, Number(generated.evaluation[metric])]]
            : []
        ))),
      },
    }
    : null;
  const evaluation = normalizeInterviewEvaluation(
    generatedEvaluation,
    now,
    interview.compatibilityScore ?? 50,
  ) ?? fallbackInterviewEvaluation(interview, now);
  const decision = negotiationTerminated
    ? "reject"
    : generatedInterviewDecision(evaluation, evaluation.overallScore);
  const answers = interview.transcript.filter((entry) => entry.role === "coach").map((entry) => ({
    questionId: entry.questionId,
    text: entry.text,
    source: interview.source,
  }));
  emitCallbacks(room, [progressEvent], [], options);
  const completed = respondCoachInterview(room, {
    operationId: id,
    coachId: interview.coachId,
    interviewId: interview.id,
    answers,
    decision: decision === "complete" ? "" : decision,
    assessment: evaluation,
    relationshipImpact: interview.relationshipImpact,
    negotiationEffects: interview.negotiationEffects,
    memorySummary: interview.memorySummary,
    proposalExpiresAt: input.proposalExpiresAt,
    plannedStartDate: input.plannedStartDate,
  }, options);
  return {
    ...completed,
    events: [clone(progressEvent), ...(completed.events ?? [])],
  };
}
