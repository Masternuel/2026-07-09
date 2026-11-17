// Coach proposals, board decisions and contract renewals.
// Split from coachEmployment.mjs (audit Q-02); declarations are unchanged.
import { ACTIVE_PROPOSAL_STATUSES, CoachEmploymentError, GUARANTEE_STATUSES, MAX_MONEY, PROPOSAL_KINDS, activeAppointmentForCoach, activeContractForCoach, addDays, assertCoachEmploymentIntegrity, canonicalClubId, careerDate, clamp, clone, clubKey, coachById, deterministicId, ensureCoachEmploymentState, eventRecord, finite, identifier, integer, normalizeProposal, normalizedObjectives, nullableTimestamp, operationId, synchronizeCareerAndRetain } from "./state.mjs";
import { appendDecision, appendNotification, assertProposalVacancyOpen, availableClubFunds, closeCoachCompetingNegotiationsMutable, closeProposalSelectionMutable, coachRetirementBlocksMarket, contractGuaranteeTerms, duplicateResult, emitCallbacks, ensureClubCanFundProposal, ensureProposalCanComplete, guaranteesForProposal, markProcessed, performAppointment, performRenewalAgreementMutable, proposalTerms, refreshCoachMarketStatus, registerProposalGuarantees, staffPackageFromGuarantee } from "./shared.mjs";

export function createCoachProposal(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const coach = coachById(room, input.coachId);
  if (coach.status === "retired") throw new CoachEmploymentError("Treinador aposentado", "COACH_RETIRED", 409);
  if (coachRetirementBlocksMarket(room, coach.id) || coach.status === "retiring") {
    throw new CoachEmploymentError(
      "Treinador ja anunciou aposentadoria",
      "COACH_RETIREMENT_MARKET_BLOCK",
      409,
    );
  }
  const clubId = canonicalClubId(room, input.clubId ?? input.offeringClubId);
  if (!clubId) throw new CoachEmploymentError("Clube obrigatorio", "COACH_CLUB_REQUIRED", 400);
  const activeContract = activeContractForCoach(state, coach.id);
  const linkedVacancy = identifier(input.vacancyId)
    ? state.vacancies.find((candidate) => candidate.id === identifier(input.vacancyId))
    : state.vacancies.find((candidate) => (
      candidate.status === "open" && clubKey(candidate.clubId) === clubKey(clubId)
    ));
  if (identifier(input.vacancyId) && (!linkedVacancy || linkedVacancy.status !== "open")) {
    throw new CoachEmploymentError("Vaga encerrada", "COACH_VACANCY_CLOSED", 409);
  }
  const proposalKind = PROPOSAL_KINDS.has(identifier(input.kind ?? input.proposalType))
    ? identifier(input.kind ?? input.proposalType)
    : "hiring";
  const coachInitiatedRenewal = proposalKind === "renewal" && input.initiatedBy === "coach";
  const requestedTerms = coachInitiatedRenewal ? {
    wage: integer(input.wage ?? input.salary, integer(activeContract?.wage, 0, 0, MAX_MONEY), 0, MAX_MONEY),
    durationYears: integer(input.durationYears ?? input.contractYears, 2, 1, 10),
    terminationClause: integer(input.terminationClause, integer(activeContract?.terminationClause, 0, 0, MAX_MONEY), 0, MAX_MONEY),
    signingBonus: integer(input.signingBonus, 0, 0, MAX_MONEY),
    compensation: 0,
    transferBudget: input.transferBudget == null
      ? (activeContract?.transferBudgetCommitment ?? activeContract?.transferBudget) == null
        ? null
        : integer(activeContract.transferBudgetCommitment ?? activeContract.transferBudget, 0, 0, MAX_MONEY)
      : integer(input.transferBudget, 0, 0, MAX_MONEY),
    bonuses: input.bonuses && typeof input.bonuses === "object" && !Array.isArray(input.bonuses)
      ? clone(input.bonuses)
      : activeContract?.bonuses && typeof activeContract.bonuses === "object" ? clone(activeContract.bonuses) : {},
    objectives: Array.isArray(input.objectives ?? activeContract?.objectives)
      ? (input.objectives ?? activeContract.objectives).map(identifier).filter(Boolean).slice(0, 20)
      : [],
    specialClauses: (Array.isArray(input.specialClauses ?? input.clauses)
      ? input.specialClauses ?? input.clauses
      : Array.isArray(activeContract?.clauses) ? activeContract.clauses : [])
      .map(identifier).filter(Boolean).slice(0, 20),
    guaranteeIds: [],
    submittedAt: now,
    operationId: id,
  } : null;
  const proposal = normalizeProposal({
    ...input,
    id: deterministicId("coach-proposal", `${id}|${coach.id}|${clubId}`),
    coachId: coach.id,
    clubId,
    vacancyId: linkedVacancy?.id ?? null,
    applicationId: input.applicationId,
    interviewId: input.interviewId,
    kind: proposalKind,
    sourceContractId: input.sourceContractId ?? input.renewalOfContractId,
    compensation: proposalKind === "renewal" || proposalKind === "precontract"
      ? input.compensation ?? 0
      : input.compensation ?? activeContract?.terminationClause ?? 0,
    status: coachInitiatedRenewal ? "aguardando_resposta_diretoria" : "pending",
    pendingCounterproposal: requestedTerms,
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt ?? addDays(now, input.responseDays ?? 7),
    plannedStartDate: input.plannedStartDate ?? now,
    marketStage: coachInitiatedRenewal ? "club_review" : "coach_review",
    nextActionAt: input.nextActionAt ?? (coachInitiatedRenewal
      ? addDays(now, state.marketConfig.boardResponseDelayDays)
      : coach.managerType === "ai"
        ? addDays(now, state.marketConfig.coachResponseDelayDays)
        : now),
    lastActionAt: now,
    maxNegotiationRounds: input.maxNegotiationRounds ?? state.marketConfig.maxNegotiationRounds,
    bonuses: input.bonuses,
    availableBudget: input.availableBudget ?? availableClubFunds(room, clubId),
    boardExpectation: input.boardExpectation,
    clubSituation: input.clubSituation,
    message: input.message,
    operationId: id,
  });
  state.proposals.push(proposal);
  appendDecision(proposal, {
    action: coachInitiatedRenewal ? "renewal_requested" : proposal.kind === "renewal" ? "renewal_offer_submitted" : "offer_submitted",
    responsibleId: coachInitiatedRenewal ? coach.id : clubId,
    responsibleRole: coachInitiatedRenewal ? "candidate" : "board",
    previousStatus: null,
    newStatus: proposal.status,
    justification: input.reason ?? input.message,
    negotiatedValues: coachInitiatedRenewal ? requestedTerms : proposalTerms(proposal),
  }, now, `${id}:offer`);
  registerProposalGuarantees(state, proposal, input.guarantees, now, id, {
    status: "formalized",
    mandatory: false,
    blocksCompletion: false,
  });
  if (!coach.currentClubId) coach.status = "negotiating";
  const event = eventRecord("COACH_PROPOSAL_CREATED", id, now, {
    coachId: coach.id,
    clubId,
    relatedClubId: coach.currentClubId,
    proposalId: proposal.id,
    amount: proposal.compensation,
    metadata: { wage: proposal.wage, durationYears: proposal.durationYears, expiresAt: proposal.expiresAt },
  });
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, [event], [], options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return { room, proposal: clone(proposal), events: [clone(event)], financialTransactions: [], duplicate: false };
}

export function respondCoachProposal(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const proposal = state.proposals.find((candidate) => candidate.id === identifier(input.proposalId));
  const actorCoachId = identifier(input.coachId);
  if (!proposal || (actorCoachId && proposal.coachId !== actorCoachId)) {
    throw new CoachEmploymentError("Proposta nao encontrada", "COACH_PROPOSAL_NOT_FOUND", 404);
  }
  if (!ACTIVE_PROPOSAL_STATUSES.has(proposal.status)) {
    throw new CoachEmploymentError("Proposta encerrada", "COACH_PROPOSAL_CLOSED", 409);
  }
  if (proposal.expiresAt && new Date(proposal.expiresAt).getTime() <= new Date(now).getTime()) {
    throw new CoachEmploymentError("Proposta expirada", "COACH_PROPOSAL_EXPIRED", 409);
  }
  const action = identifier(input.action).toLocaleLowerCase("pt-BR");
  const coach = coachById(room, proposal.coachId);
  const events = [];
  let appointmentResult = null;
  if (action === "accept") {
    assertProposalVacancyOpen(state, proposal);
    ensureProposalCanComplete(room, state, proposal);
    ensureClubCanFundProposal(room, state, proposal);
    if (!["pending", "aprovada_diretoria"].includes(proposal.status)) {
      throw new CoachEmploymentError("Proposta ainda nao pode ser aceita", "COACH_PROPOSAL_NOT_ACCEPTABLE", 409);
    }
    const previousStatus = proposal.status;
    const guaranteeTerms = contractGuaranteeTerms(state, proposal);
    appointmentResult = proposal.kind === "renewal"
      ? performRenewalAgreementMutable(room, state, proposal, now, id, guaranteeTerms)
      : performAppointment(room, state, {
        coachId: proposal.coachId,
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
        objectives: proposal.objectives,
        guaranteeIds: guaranteeTerms.guaranteeIds,
        clauses: [...proposal.specialClauses, ...guaranteeTerms.clauses],
        staffPackageCommitments: guaranteeTerms.staffPackageCommitments,
        startDate: proposal.plannedStartDate,
        entryReason: proposal.kind === "precontract" ? "precontract" : "accepted_proposal",
        proposalId: proposal.id,
        vacancyId: proposal.vacancyId,
        applicationId: proposal.applicationId,
      }, now, id);
    proposal.status = "accepted";
    proposal.marketStage = "completed";
    proposal.respondedAt = now;
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    proposal.nextActionAt = null;
    proposal.decisionReason = identifier(input.reason) || "agreement_reached";
    proposal.pendingCounterproposal = null;
    appendDecision(proposal, {
      action: "accept",
      responsibleId: proposal.coachId,
      responsibleRole: "candidate",
      previousStatus,
      newStatus: proposal.status,
      negotiatedValues: proposalTerms(proposal),
      conditions: guaranteeTerms.guaranteeIds,
    }, now, id);
    events.push(...appointmentResult.events);
    closeCoachCompetingNegotiationsMutable(state, proposal, now, id, events);
    events.push(eventRecord("COACH_PROPOSAL_ACCEPTED", `${id}:accepted`, now, {
      coachId: proposal.coachId, clubId: proposal.clubId, proposalId: proposal.id,
      contractId: appointmentResult.contract?.id,
    }));
  } else if (["reject", "withdraw"].includes(action)) {
    const previousStatus = proposal.status;
    proposal.status = action === "withdraw" ? "withdrawn" : "rejected";
    proposal.marketStage = "closed";
    proposal.respondedAt = now;
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    proposal.nextActionAt = null;
    proposal.responseReason = identifier(input.reason) || null;
    proposal.decisionReason = proposal.responseReason || (action === "withdraw" ? "candidate_withdrew" : "candidate_rejected");
    proposal.pendingCounterproposal = null;
    appendDecision(proposal, {
      action,
      responsibleId: proposal.coachId,
      responsibleRole: "candidate",
      previousStatus,
      newStatus: proposal.status,
      justification: proposal.responseReason,
    }, now, id);
    closeProposalSelectionMutable(state, proposal, proposal.status, proposal.decisionReason, now, id);
    refreshCoachMarketStatus(state, coach);
    events.push(eventRecord(action === "withdraw" ? "COACH_PROPOSAL_WITHDRAWN" : "COACH_PROPOSAL_REJECTED", id, now, {
      coachId: proposal.coachId, clubId: proposal.clubId, proposalId: proposal.id,
      metadata: { reason: proposal.responseReason },
    }));
  } else if (["counter", "guarantee"].includes(action)) {
    if (!["pending", "aprovada_diretoria"].includes(proposal.status)) {
      throw new CoachEmploymentError("Contraproposta ja aguarda a diretoria", "COACH_COUNTERPROPOSAL_ALREADY_PENDING", 409);
    }
    assertProposalVacancyOpen(state, proposal);
    if (proposal.negotiationRound >= proposal.maxNegotiationRounds) {
      throw new CoachEmploymentError("Limite de rodadas da negociacao atingido", "COACH_NEGOTIATION_ROUND_LIMIT", 409);
    }
    const previousStatus = proposal.status;
    const guarantees = registerProposalGuarantees(
      state,
      proposal,
      input.guarantees ?? input.guarantee,
      now,
      id,
      { mandatory: true, blocksCompletion: true, status: "requested" },
    );
    proposal.status = "aguardando_resposta_diretoria";
    proposal.marketStage = "club_review";
    proposal.pendingCounterproposal = {
      ...proposalTerms(proposal, input),
      guaranteeIds: guarantees.map((guarantee) => guarantee.id),
      submittedAt: now,
      operationId: id,
    };
    proposal.negotiationRound += 1;
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    proposal.nextActionAt = addDays(now, state.marketConfig.boardResponseDelayDays);
    appendDecision(proposal, {
      action: "counter",
      responsibleId: proposal.coachId,
      responsibleRole: "candidate",
      previousStatus,
      newStatus: proposal.status,
      justification: input.reason,
      negotiatedValues: proposal.pendingCounterproposal,
      conditions: guarantees.map((guarantee) => guarantee.id),
    }, now, id);
    appendNotification(state, {
      type: "COACH_COUNTERPROPOSAL_AWAITING_BOARD",
      recipientId: proposal.clubId,
      recipientRole: "board",
      coachId: proposal.coachId,
      clubId: proposal.clubId,
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      title: "Contraproposta aguardando analise",
      message: "O candidato enviou novos valores ou condicoes.",
    }, now, id);
    events.push(eventRecord("COACH_PROPOSAL_COUNTERED", id, now, {
      coachId: proposal.coachId, clubId: proposal.clubId, proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      metadata: {
        ...proposalTerms(proposal.pendingCounterproposal),
        guaranteeIds: guarantees.map((guarantee) => guarantee.id),
        negotiationRound: proposal.negotiationRound,
        status: proposal.status,
      },
    }));
  } else if (action === "provide_information") {
    if (proposal.status !== "informacoes_solicitadas") {
      throw new CoachEmploymentError("A diretoria nao solicitou informacoes", "COACH_INFORMATION_NOT_REQUESTED", 409);
    }
    const answer = identifier(input.information ?? input.message);
    if (!answer) throw new CoachEmploymentError("Informe a resposta", "COACH_INFORMATION_REQUIRED", 400);
    const previousStatus = proposal.status;
    proposal.informationRequest = {
      ...(proposal.informationRequest ?? {}),
      answer,
      answeredAt: now,
    };
    proposal.status = "aguardando_resposta_diretoria";
    proposal.marketStage = "club_review";
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    proposal.nextActionAt = addDays(now, state.marketConfig.boardResponseDelayDays);
    appendDecision(proposal, {
      action: "provide_information",
      responsibleId: proposal.coachId,
      responsibleRole: "candidate",
      previousStatus,
      newStatus: proposal.status,
      justification: answer,
    }, now, id);
    appendNotification(state, {
      type: "COACH_INFORMATION_PROVIDED",
      recipientId: proposal.clubId,
      recipientRole: "board",
      coachId: proposal.coachId,
      clubId: proposal.clubId,
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      title: "Informacoes recebidas",
      message: "O candidato respondeu a solicitacao da diretoria.",
    }, now, id);
    events.push(eventRecord("COACH_PROPOSAL_INFORMATION_PROVIDED", id, now, {
      coachId: proposal.coachId, clubId: proposal.clubId, proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
    }));
  } else if (action === "more_time") {
    proposal.expiresAt = addDays(proposal.expiresAt ?? now, input.extraDays ?? 3);
    proposal.updatedAt = now;
    proposal.lastActionAt = now;
    appendDecision(proposal, {
      action: "more_time",
      responsibleId: proposal.coachId,
      responsibleRole: "candidate",
      previousStatus: proposal.status,
      newStatus: proposal.status,
      negotiatedValues: { expiresAt: proposal.expiresAt },
    }, now, id);
    events.push(eventRecord("COACH_PROPOSAL_EXTENDED", id, now, {
      coachId: proposal.coachId, clubId: proposal.clubId, proposalId: proposal.id,
      metadata: { expiresAt: proposal.expiresAt },
    }));
  } else {
    throw new CoachEmploymentError("Resposta de proposta invalida", "COACH_PROPOSAL_ACTION_INVALID", 400);
  }
  const transactions = appointmentResult?.transactions ?? [];
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, events, transactions, options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    proposal: clone(proposal),
    appointment: clone(appointmentResult?.appointment ?? null),
    contract: clone(appointmentResult?.contract ?? null),
    events: clone(events),
    financialTransactions: clone(transactions),
    duplicate: false,
  };
}

function resolveProposalGuarantees(state, proposal, resolutions, now, operationIdValue, responsible) {
  const byId = new Map((Array.isArray(resolutions) ? resolutions : []).map((resolution) => [
    identifier(resolution?.guaranteeId ?? resolution?.id),
    resolution,
  ]));
  const changed = [];
  for (const guarantee of guaranteesForProposal(state, proposal)) {
    const resolution = byId.get(guarantee.id);
    if (!resolution) continue;
    const nextStatus = GUARANTEE_STATUSES.has(resolution.status) ? resolution.status : guarantee.status;
    const previousStatus = guarantee.status;
    guarantee.status = nextStatus;
    guarantee.responsibleId = identifier(resolution.responsibleId) || guarantee.responsibleId;
    guarantee.responsibleRole = identifier(resolution.responsibleRole) || guarantee.responsibleRole;
    guarantee.dueAt = resolution.dueAt === undefined ? guarantee.dueAt : nullableTimestamp(resolution.dueAt);
    if (Array.isArray(resolution.effects)) guarantee.effects = clone(resolution.effects).slice(0, 20);
    guarantee.updatedAt = now;
    if (nextStatus === "formalized" && !guarantee.formalizedAt) guarantee.formalizedAt = now;
    if (["fulfilled", "waived", "breached"].includes(nextStatus)) guarantee.completedAt = now;
    appendDecision(guarantee, {
      action: `guarantee_${nextStatus}`,
      responsibleId: responsible.id,
      responsibleRole: responsible.role,
      previousStatus,
      newStatus: nextStatus,
      justification: resolution.justification,
      negotiatedValues: { dueAt: guarantee.dueAt, effects: guarantee.effects },
    }, now, `${operationIdValue}:guarantee:${guarantee.id}`);
    changed.push(guarantee);
  }
  return changed;
}

function applyGuaranteeEffectsToProposal(state, proposal) {
  for (const guarantee of guaranteesForProposal(state, proposal)) {
    if (!["formalized", "fulfilled"].includes(guarantee.status)) continue;
    for (const effect of guarantee.effects) {
      const type = identifier(effect?.type ?? effect?.kind);
      const amount = integer(effect?.amount ?? effect?.value, 0, 0, MAX_MONEY);
      if (type === "salary_adjustment" && amount > 0) proposal.wage = Math.min(20_000_000, amount);
      if (type === "signing_bonus" && amount > 0) proposal.signingBonus = amount;
      if (type === "termination_clause" && amount > 0) proposal.terminationClause = amount;
    }
  }
}

export function respondCoachBoardDecision(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const proposal = state.proposals.find((candidate) => candidate.id === identifier(input.proposalId));
  if (!proposal) throw new CoachEmploymentError("Proposta nao encontrada", "COACH_PROPOSAL_NOT_FOUND", 404);
  if (!["aguardando_resposta_diretoria", "informacoes_solicitadas"].includes(proposal.status)) {
    throw new CoachEmploymentError("Nao ha contraproposta pendente", "COACH_COUNTERPROPOSAL_NOT_PENDING", 409);
  }
  assertProposalVacancyOpen(state, proposal);
  if (proposal.expiresAt && new Date(proposal.expiresAt).getTime() <= new Date(now).getTime()) {
    throw new CoachEmploymentError("Proposta expirada", "COACH_PROPOSAL_EXPIRED", 409);
  }
  const action = identifier(input.action).toLocaleLowerCase("pt-BR");
  const responsible = {
    id: identifier(input.responsibleId) || `board:${proposal.clubId}`,
    role: identifier(input.responsibleRole) || "board",
  };
  const previousStatus = proposal.status;
  const events = [];
  const changedGuarantees = resolveProposalGuarantees(
    state,
    proposal,
    input.guaranteeResolutions,
    now,
    id,
    responsible,
  );

  if (action === "approve") {
    if (!proposal.pendingCounterproposal) {
      throw new CoachEmploymentError("Contraproposta sem termos", "COACH_COUNTERPROPOSAL_TERMS_MISSING", 409);
    }
    const approved = proposal.pendingCounterproposal;
    proposal.wage = approved.wage;
    proposal.durationYears = approved.durationYears;
    proposal.terminationClause = approved.terminationClause;
    proposal.signingBonus = approved.signingBonus;
    proposal.transferBudget = approved.transferBudget;
    proposal.objectives = normalizedObjectives(approved.objectives ?? proposal.objectives);
    proposal.specialClauses = (approved.specialClauses ?? proposal.specialClauses).map(identifier).filter(Boolean).slice(0, 20);
    proposal.bonuses = approved.bonuses && typeof approved.bonuses === "object" ? clone(approved.bonuses) : proposal.bonuses;
    proposal.status = "aprovada_diretoria";
    proposal.marketStage = "coach_review";
    proposal.nextActionAt = addDays(now, state.marketConfig.coachResponseDelayDays);
    proposal.pendingCounterproposal = null;
    proposal.informationRequest = null;
    applyGuaranteeEffectsToProposal(state, proposal);
  } else if (action === "reject") {
    proposal.status = "rejected";
    proposal.marketStage = "closed";
    proposal.nextActionAt = null;
    proposal.respondedAt = now;
    proposal.responseReason = identifier(input.justification) || "counterproposal_rejected";
    proposal.decisionReason = proposal.responseReason;
    proposal.pendingCounterproposal = null;
    closeProposalSelectionMutable(state, proposal, proposal.status, proposal.decisionReason, now, id);
    for (const guarantee of guaranteesForProposal(state, proposal)) {
      if (guarantee.status === "requested") {
        const guaranteePreviousStatus = guarantee.status;
        guarantee.status = "waived";
        guarantee.updatedAt = now;
        guarantee.completedAt = now;
        appendDecision(guarantee, {
          action: "guarantee_waived",
          responsibleId: responsible.id,
          responsibleRole: responsible.role,
          previousStatus: guaranteePreviousStatus,
          newStatus: guarantee.status,
          justification: proposal.responseReason,
          negotiatedValues: {
            dueAt: guarantee.dueAt,
            effects: guarantee.effects,
            staffPackage: staffPackageFromGuarantee(guarantee),
          },
        }, now, `${id}:guarantee:${guarantee.id}`);
        if (!changedGuarantees.some((candidate) => candidate.id === guarantee.id)) {
          changedGuarantees.push(guarantee);
        }
      }
    }
    const coach = coachById(room, proposal.coachId);
    refreshCoachMarketStatus(state, coach);
  } else if (action === "new_offer") {
    const terms = proposalTerms(proposal, input);
    Object.assign(proposal, terms);
    proposal.status = "pending";
    proposal.marketStage = "coach_review";
    proposal.negotiationRound = Math.min(proposal.maxNegotiationRounds, proposal.negotiationRound + 1);
    proposal.nextActionAt = addDays(now, state.marketConfig.coachResponseDelayDays);
    proposal.expiresAt = addDays(now, state.marketConfig.proposalValidityDays);
    proposal.pendingCounterproposal = null;
    proposal.informationRequest = null;
    applyGuaranteeEffectsToProposal(state, proposal);
  } else if (action === "request_information") {
    const prompt = identifier(input.informationRequest ?? input.message);
    if (!prompt) throw new CoachEmploymentError("Informe a solicitacao", "COACH_INFORMATION_REQUEST_REQUIRED", 400);
    proposal.status = "informacoes_solicitadas";
    proposal.marketStage = "coach_review";
    proposal.nextActionAt = null;
    proposal.informationRequest = {
      prompt,
      requestedAt: now,
      requestedBy: responsible.id,
      answer: null,
      answeredAt: null,
    };
  } else {
    throw new CoachEmploymentError("Decisao da diretoria invalida", "COACH_BOARD_DECISION_INVALID", 400);
  }

  proposal.updatedAt = now;
  proposal.lastActionAt = now;
  appendDecision(proposal, {
    action: `board_${action}`,
    responsibleId: responsible.id,
    responsibleRole: responsible.role,
    previousStatus,
    newStatus: proposal.status,
    justification: input.justification,
    negotiatedValues: {
      ...proposalTerms(proposal),
      boardDecisionContext: input.decisionContext && typeof input.decisionContext === "object"
        ? clone(input.decisionContext)
        : {},
    },
    conditions: changedGuarantees.map((guarantee) => guarantee.id),
  }, now, id);
  appendNotification(state, {
    type: `COACH_BOARD_${action.toLocaleUpperCase("en-US")}`,
    recipientId: proposal.coachId,
    recipientRole: "coach",
    coachId: proposal.coachId,
    clubId: proposal.clubId,
    proposalId: proposal.id,
    vacancyId: proposal.vacancyId,
    title: action === "approve" ? "Contraproposta aprovada" : action === "reject"
      ? "Contraproposta recusada" : action === "new_offer" ? "Nova proposta da diretoria" : "Diretoria solicita informacoes",
    message: identifier(input.justification) || "A diretoria respondeu formalmente a negociacao.",
  }, now, id);
  const linkedVacancy = proposal.vacancyId
    ? state.vacancies.find((vacancy) => vacancy.id === proposal.vacancyId)
    : null;
  if (identifier(linkedVacancy?.recruiterId)) {
    appendNotification(state, {
      type: "COACH_BOARD_RESPONSE_RECRUITER",
      recipientId: linkedVacancy.recruiterId,
      recipientRole: "recruiter",
      coachId: proposal.coachId,
      clubId: proposal.clubId,
      proposalId: proposal.id,
      vacancyId: proposal.vacancyId,
      title: "Diretoria respondeu a negociacao",
      message: identifier(input.justification) || "A diretoria registrou uma decisao formal.",
    }, now, `${id}:recruiter`);
  }
  events.push(eventRecord(`COACH_BOARD_${action.toLocaleUpperCase("en-US")}`, id, now, {
    coachId: proposal.coachId,
    clubId: proposal.clubId,
    proposalId: proposal.id,
    vacancyId: proposal.vacancyId,
    metadata: {
      responsibleId: responsible.id,
      responsibleRole: responsible.role,
      justification: identifier(input.justification) || null,
      previousStatus,
      newStatus: proposal.status,
      negotiatedValues: proposalTerms(proposal),
      guaranteeIds: changedGuarantees.map((guarantee) => guarantee.id),
      boardDecisionContext: input.decisionContext && typeof input.decisionContext === "object"
        ? clone(input.decisionContext)
        : {},
    },
  }));

  state.currentDate = now;
  assertCoachEmploymentIntegrity(room, now);
  emitCallbacks(room, events, [], options);
  markProcessed(state, id);
  synchronizeCareerAndRetain(room, state, now);
  return {
    room,
    proposal: clone(proposal),
    guarantees: clone(guaranteesForProposal(state, proposal)),
    events: clone(events),
    financialTransactions: [],
    duplicate: false,
  };
}

export function renewCoachContract(roomValue, input = {}, options = {}) {
  const now = careerDate(roomValue, options.now);
  const room = ensureCoachEmploymentState(roomValue, { now });
  const state = room.coachEmploymentState;
  const id = operationId(input);
  const duplicate = duplicateResult(room, id);
  if (duplicate) return duplicate;
  const coach = coachById(room, input.coachId);
  const appointment = activeAppointmentForCoach(state, coach.id);
  const previous = activeContractForCoach(state, coach.id);
  if (!appointment || !previous) throw new CoachEmploymentError("Contrato ativo nao encontrado", "COACH_ACTIVE_CONTRACT_NOT_FOUND", 409);
  const clubId = canonicalClubId(room, input.clubId ?? appointment.clubId);
  if (clubKey(clubId) !== clubKey(appointment.clubId)) {
    throw new CoachEmploymentError("Contrato pertence a outro clube", "COACH_CLUB_MISMATCH", 409);
  }
  const activeRenewal = state.proposals.find((proposal) => (
    proposal.kind === "renewal"
      && proposal.sourceContractId === previous.id
      && ACTIVE_PROPOSAL_STATUSES.has(proposal.status)
  ));
  if (activeRenewal) {
    throw new CoachEmploymentError("Renovacao ja esta em negociacao", "COACH_RENEWAL_ALREADY_ACTIVE", 409, {
      proposalId: activeRenewal.id,
    });
  }
  const outcome = createCoachProposal(room, {
    ...input,
    operationId: id,
    coachId: coach.id,
    clubId,
    kind: "renewal",
    initiatedBy: input.initiatedBy ?? (coach.managerType === "human" ? "coach" : "club"),
    sourceContractId: previous.id,
    wage: input.wage ?? input.salary ?? previous.wage,
    terminationClause: input.terminationClause ?? previous.terminationClause,
    signingBonus: input.signingBonus ?? input.renewalBonus,
    bonuses: input.bonuses ?? previous.bonuses,
    objectives: input.objectives ?? previous.objectives,
    responseDays: input.responseDays ?? state.marketConfig.proposalValidityDays,
    boardExpectation: input.boardExpectation ?? "Acordar continuidade do projeto esportivo",
    clubSituation: input.clubSituation ?? "Renovacao de contrato vigente",
    message: input.message ?? "Negociacao de renovacao iniciada.",
    reason: input.reason ?? "renewal_negotiation_opened",
  }, { ...options, now });
  return {
    ...outcome,
    coach: clone(coach),
    appointment: clone(appointment),
    contract: null,
    previousContract: clone(previous),
  };
}
