import {
  coachEmploymentSnapshot,
  ensureCoachEmploymentState,
  previewCoachResignation,
} from "../game/coachEmployment.mjs";
import {
  activeCoachMarketRestriction,
  coachCareerTrustSummary,
  COACH_RESIGNATION_REASONS,
} from "../game/coachCareerConduct.mjs";
import { buildCoachCareerHistorySummary } from "../game/coachCareerHistory.mjs";
import { selectCoachCareerAlerts } from "../game/centralSelectors.mjs";
import { professionalLifecycleSnapshot } from "../game/professionalLifecycle.mjs";
import { professionalLeaveSnapshot } from "../game/professionalLeave.mjs";

function text(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function key(value) {
  return text(value).toLocaleLowerCase("pt-BR");
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function date(value) {
  if (value == null || value === "") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function firstText(...values) {
  for (const value of values) {
    const result = text(value);
    if (result) return result;
  }
  return "";
}

function aliases(...values) {
  return new Set(values.map(key).filter(Boolean));
}

function catalogEntries(room) {
  return [
    ...list(room?.competitionCatalog).flatMap((competition) => (
      list(competition?.clubs).map((club) => ({ club, competition }))
    )),
    ...list(room?.tournamentCatalog).flatMap((competition) => (
      list(competition?.participants).map((club) => ({ club, competition }))
    )),
  ];
}

function clubResolver(room) {
  const entries = catalogEntries(room);
  return (clubId) => {
    const target = key(clubId);
    const entry = entries.find(({ club }) => aliases(club?.id, club?.code, club?.name).has(target));
    const club = entry?.club ?? {};
    const competition = entry?.competition ?? {};
    const id = firstText(club?.id, clubId);
    const name = firstText(club?.name, id, clubId, "Clube não informado");
    return {
      id,
      name,
      code: firstText(club?.code, club?.abbreviation, name.slice(0, 3).toLocaleUpperCase("pt-BR")),
      country: firstText(club?.country, club?.countryName, competition?.country, competition?.countryName) || null,
      competition: firstText(club?.divisionName, competition?.name, competition?.shortName) || null,
      reputation: number(club?.reputation),
      crestImageUrl: firstText(club?.crestImageUrl, club?.logoUrl, club?.imageUrl) || null,
      primaryColor: firstText(club?.primaryColor, club?.color, list(club?.colors)[0]) || null,
    };
  };
}

function objectiveDto(value, index) {
  const status = text(value?.status);
  const normalizedStatus = status === "active" ? "pending" : status;
  return {
    id: firstText(value?.id, `objective-${index + 1}`),
    label: firstText(value?.label, value?.title, value?.name, `Objetivo ${index + 1}`),
    description: firstText(value?.description) || null,
    competition: firstText(value?.competition, value?.competitionName) || null,
    target: value?.target == null ? null : text(value.target),
    progress: number(value?.progress),
    status: ["pending", "on_track", "completed", "failed"].includes(normalizedStatus)
      ? normalizedStatus
      : "pending",
    weight: number(value?.weight),
    difficultyAdjustment: number(value?.difficultyAdjustment),
  };
}

function stringList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([name, amount]) => {
    if (amount == null || amount === false || amount === "") return [];
    return [`${name}: ${text(amount) || "sim"}`];
  });
}

function labelList(value) {
  return list(value).flatMap((entry) => {
    if (typeof entry === "string" || typeof entry === "number") {
      const label = text(entry);
      return label ? [label] : [];
    }
    const label = firstText(entry?.description, entry?.label, entry?.clause, entry?.text, entry?.type);
    return label ? [label] : [];
  });
}

const BONUS_LABELS = Object.freeze({
  signingBonus: "B\u00f4nus de assinatura",
  winBonus: "B\u00f4nus por vit\u00f3ria",
  titleBonus: "B\u00f4nus por t\u00edtulo",
  promotionBonus: "B\u00f4nus por acesso",
  objectiveBonus: "B\u00f4nus por objetivo",
  loyaltyBonus: "B\u00f4nus de perman\u00eancia",
});

function bonusTerms(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([name, amount]) => {
    if (amount == null || amount === false || amount === "") return [];
    const label = BONUS_LABELS[name]
      ?? name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
    return [`${label}: ${text(amount) || "sim"}`];
  });
}

function proposalDecisionFactorDto(value, index) {
  const source = value && typeof value === "object" ? value : {};
  return {
    id: firstText(source.id, source.code, `factor-${index + 1}`),
    code: firstText(source.code, "general"),
    label: firstText(source.label, source.code, `Fator ${index + 1}`),
    value: number(source.value ?? source.impact) ?? 0,
    detail: firstText(source.detail, source.description) || null,
  };
}

function guaranteeEffectDto(value) {
  if (typeof value === "string") return {
    id: null,
    type: "contract_clause",
    label: text(value),
    description: text(value),
    value: null,
    amount: null,
    required: false,
    applied: false,
  };
  const source = value && typeof value === "object" ? value : {};
  const type = firstText(source.type, source.kind, "contract_clause");
  const description = firstText(source.description, source.label) || null;
  const amount = number(source.amount ?? source.value);
  return {
    id: firstText(source.id) || null,
    type,
    label: firstText(source.label, source.description, type),
    description,
    value: amount,
    amount,
    required: Boolean(source.required ?? source.blocking),
    applied: Boolean(source.applied ?? source.completed ?? source.active),
  };
}

function guaranteeDto(value, index, proposalId) {
  const source = typeof value === "string" ? { description: value } : value && typeof value === "object" ? value : {};
  return {
    id: firstText(source.id, `${proposalId || "proposal"}:guarantee:${index + 1}`),
    proposalId: firstText(source.proposalId, proposalId) || null,
    vacancyId: firstText(source.vacancyId) || null,
    applicationId: firstText(source.applicationId) || null,
    description: firstText(source.description, source.label, source.text, typeof value === "string" ? value : "Garantia negociada"),
    responsible: firstText(source.responsible, source.responsibleName, source.responsibleId, source.responsibleRole) || null,
    responsibleId: firstText(source.responsibleId) || null,
    responsibleName: firstText(source.responsibleName, source.responsible) || null,
    responsibleRole: firstText(source.responsibleRole) || null,
    deadline: date(source.deadline ?? source.dueAt),
    dueAt: date(source.dueAt ?? source.deadline),
    status: firstText(source.status, "requested"),
    required: source.required !== false && source.mandatory !== false,
    blocksCompletion: source.blocksCompletion !== false,
    formalizedAt: date(source.formalizedAt),
    fulfilledAt: date(source.fulfilledAt ?? source.completedAt),
    effects: list(source.effects).map(guaranteeEffectDto),
    createdAt: date(source.createdAt),
    updatedAt: date(source.updatedAt ?? source.createdAt),
  };
}

function decisionTermsDto(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    salary: number(source.wage ?? source.salary),
    durationMonths: number(source.durationMonths)
      ?? ((number(source.durationYears) ?? 0) > 0 ? number(source.durationYears) * 12 : null),
    releaseClause: number(source.terminationClause ?? source.releaseClause),
    signingBonus: number(source.signingBonus),
    transferBudget: number(source.transferBudget ?? source.transferBudgetCommitment),
    sportingTargets: list(source.objectives).map((objective) => firstText(objective?.title, objective?.label, objective)).filter(Boolean),
    specialClauses: stringList(source.specialClauses ?? source.clauses),
  };
}

  function decisionDto(value, index, proposalId) {
    const source = value && typeof value === "object" ? value : {};
    const responsibleId = firstText(source.responsibleId, source.actorId) || null;
    const responsibleName = firstText(source.responsible, source.responsibleName, source.actorName) || null;
    const responsibleRole = firstText(source.responsibleRole, source.actorRole) || null;
    const decidedAt = date(source.decidedAt ?? source.createdAt ?? source.occurredAt);
    return {
      id: firstText(source.id, `${proposalId || "proposal"}:decision:${index + 1}`),
      action: firstText(source.action, source.decision, source.type, "updated"),
      responsible: firstText(responsibleName, responsibleId, responsibleRole, "Sistema"),
      responsibleId,
      responsibleRole,
      actorId: responsibleId,
      actorName: responsibleName,
      actorRole: responsibleRole,
      decidedAt,
      createdAt: decidedAt,
    justification: firstText(source.justification, source.reason) || null,
    previousStatus: firstText(source.previousStatus, source.fromStatus) || null,
    newStatus: firstText(source.newStatus, source.toStatus, source.status) || null,
    terms: decisionTermsDto(source.negotiatedValues ?? source.terms ?? source),
    conditions: list(source.conditions).map((condition) => (
      typeof condition === "string" ? condition : firstText(condition?.description, condition?.label)
    )).filter(Boolean),
    guaranteeResolutions: list(source.guaranteeResolutions).map((resolution, resolutionIndex) => ({
      ...guaranteeDto(resolution, resolutionIndex, proposalId),
      guaranteeId: firstText(resolution?.guaranteeId, resolution?.id) || null,
    })),
  };
}

  function informationRequestDto(value) {
  if (!value) return null;
  const source = typeof value === "string" ? { message: value } : value && typeof value === "object" ? value : {};
    const question = firstText(source.question, source.prompt, source.message, source.description, source.request) || null;
    return {
      id: firstText(source.id, "information-request"),
      question,
      message: question,
      requestedAt: date(source.requestedAt ?? source.createdAt),
      requestedBy: firstText(source.requestedBy, source.responsible, source.responsibleRole, "Diretoria"),
      response: firstText(source.response, source.information, source.answer) || null,
    respondedAt: date(source.respondedAt ?? source.answeredAt),
    status: firstText(source.status, source.response || source.answer ? "answered" : "pending"),
  };
}

  function proposalAvailableActions(proposal) {
  const explicit = stringList(proposal.availableActions ?? proposal.candidateAvailableActions);
  if (explicit.length > 0) return explicit;
  const status = key(proposal.status);
  if (status === "pending") return ["accept", "reject", "counter", "extend", "guarantee", "end"];
  if (status === "aprovada_diretoria") return ["accept", "reject", "end"];
  if (status === "informacoes_solicitadas") return ["provide_information", "end"];
  if (status === "countered" || status === "aguardando_resposta_diretoria") return ["end"];
    return [];
  }

  function proposalBoardAvailableActions(proposal) {
    const explicit = stringList(proposal.boardAvailableActions);
    if (explicit.length > 0) return explicit;
    return ["aguardando_resposta_diretoria", "informacoes_solicitadas"].includes(key(proposal.status))
      ? ["approve", "reject", "new_offer", "request_information"]
      : [];
  }

function contractDto(contract, resolveClub) {
  if (!contract) return null;
  return {
    id: text(contract.id),
    coachId: text(contract.coachId),
    clubId: text(contract.clubId),
    club: resolveClub(contract.clubId),
    role: text(contract.role) || "head_coach",
    status: contract.status === "replaced" ? "superseded" : text(contract.status) || "active",
    salary: number(contract.wage ?? contract.salary),
    durationMonths: number(contract.durationMonths)
      ?? (number(contract.durationYears) == null ? null : number(contract.durationYears) * 12),
    startDate: date(contract.startDate),
    endDate: date(contract.endDate),
    releaseClause: number(contract.terminationClause ?? contract.releaseClause),
    transferBudget: number(contract.transferBudgetCommitment ?? contract.transferBudget),
    autonomyLevel: number(contract.autonomyLevel),
    objectiveDifficultyAdjustment: number(contract.objectiveDifficultyAdjustment),
    bonuses: bonusTerms(contract.bonuses),
    guarantees: stringList(contract.guarantees),
    sportingTargets: list(contract.objectives)
      .map((objective) => firstText(objective?.title, objective?.label, objective?.description, objective))
      .filter(Boolean),
    specialClauses: labelList(contract.clauses),
    objectives: list(contract.objectives).map(objectiveDto),
    renewalOption: Boolean(contract.renewalOption),
    sourceInterviewId: firstText(contract.sourceInterviewId, contract.interviewId) || null,
    terminationReason: firstText(contract.terminationReason, contract.endReason) || null,
    createdAt: date(contract.createdAt ?? contract.signedAt),
    updatedAt: date(contract.updatedAt ?? contract.endedAt ?? contract.signedAt),
  };
}

  function proposalDto(proposal, resolveClub, room) {
  const club = resolveClub(proposal.clubId ?? proposal.offeringClubId);
  const finance = list(room?.marketState?.finances).find((entry) => key(entry?.clubId) === key(club.id));
  const guaranteeIds = new Set(list(proposal.guaranteeIds).map(text).filter(Boolean));
  const guarantees = list(room?.coachEmploymentState?.guarantees).filter((guarantee) => (
    text(guarantee?.proposalId) === text(proposal.id) || guaranteeIds.has(text(guarantee?.id))
  ));
    const guaranteeDtos = (guarantees.length > 0 ? guarantees : list(proposal.guarantees))
      .map((guarantee, index) => guaranteeDto(guarantee, index, proposal.id));
    return {
      id: text(proposal.id),
      vacancyId: firstText(proposal.vacancyId) || null,
      interviewId: firstText(proposal.interviewId) || null,
      kind: firstText(proposal.kind, proposal.proposalType, proposal.sourceContractId ? "renewal" : "hiring"),
      sourceContractId: firstText(proposal.sourceContractId, proposal.renewalOfContractId) || null,
      guaranteeIds: [...new Set([
        ...list(proposal.guaranteeIds).map(text).filter(Boolean),
        ...guaranteeDtos.map((guarantee) => guarantee.id).filter(Boolean),
      ])],
      club,
    role: text(proposal.role) || "head_coach",
    status: text(proposal.status) || "pending",
    terms: {
      salary: number(proposal.wage ?? proposal.salary),
      durationMonths: number(proposal.durationMonths)
        ?? ((number(proposal.durationYears) ?? 0) > 0 ? number(proposal.durationYears) * 12 : null),
      startDate: date(proposal.plannedStartDate ?? proposal.startDate),
      endDate: date(proposal.endDate),
      releaseClause: number(proposal.terminationClause ?? proposal.releaseClause),
      transferBudget: number(proposal.transferBudget),
      bonuses: bonusTerms(proposal.bonuses),
      sportingTargets: list(proposal.objectives).map((objective) => firstText(objective?.title, objective?.label, objective)).filter(Boolean),
      specialClauses: stringList(proposal.specialClauses),
        guarantees: guaranteeDtos,
      },
      guarantees: guaranteeDtos,
    objectives: list(proposal.objectives).map(objectiveDto),
    availableBudget: number(proposal.availableBudget ?? proposal.budget ?? finance?.balance),
    boardExpectation: firstText(proposal.boardExpectation, proposal.expectation) || null,
    clubSituation: firstText(proposal.clubSituation) || null,
    deadline: date(proposal.deadline ?? proposal.expiresAt),
    proposedStartDate: date(proposal.proposedStartDate ?? proposal.plannedStartDate ?? proposal.startDate),
    compensationToCurrentClub: number(proposal.compensationToCurrentClub ?? proposal.compensation),
    message: firstText(proposal.message) || null,
    canNegotiate: proposal.canNegotiate !== false,
      canRequestMoreTime: proposal.canRequestMoreTime !== false,
      availableActions: proposalAvailableActions(proposal),
      boardAvailableActions: proposalBoardAvailableActions(proposal),
    negotiationRound: Math.max(0, Math.trunc(number(proposal.negotiationRound) ?? 0)),
    marketStage: firstText(proposal.marketStage, "coach_review"),
    nextActionAt: date(proposal.nextActionAt),
    lastActionAt: date(proposal.lastActionAt ?? proposal.updatedAt ?? proposal.createdAt),
    maxNegotiationRounds: Math.max(1, Math.trunc(number(proposal.maxNegotiationRounds) ?? 4)),
    interviewCompatibility: number(proposal.interviewCompatibility),
    autonomyDelta: number(proposal.autonomyDelta) ?? 0,
    priorityDelta: number(proposal.priorityDelta) ?? 0,
    objectiveDifficultyDelta: number(proposal.objectiveDifficultyDelta) ?? 0,
    decisionScore: number(proposal.decisionScore),
    decisionReason: firstText(proposal.decisionReason, proposal.responseReason) || null,
    decisionFactors: list(proposal.decisionFactors).map(proposalDecisionFactorDto),
    competingOfferCount: new Set(list(proposal.competingProposalIds).map(text).filter(Boolean)).size,
    decisionHistory: list(proposal.decisionHistory ?? proposal.history)
      .map((decision, index) => decisionDto(decision, index, proposal.id)),
    informationRequest: informationRequestDto(proposal.informationRequest),
    createdAt: date(proposal.createdAt),
    updatedAt: date(proposal.updatedAt ?? proposal.createdAt),
  };
}

function publicProfileSection(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(allowedKeys.flatMap((field) => (
    Object.prototype.hasOwnProperty.call(value, field) ? [[field, structuredClone(value[field])]] : []
  )));
}

function publicDesiredProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    ...publicProfileSection(value, [
      "version", "revision", "tier", "strictness", "objective", "availableBudget",
      "squadSummary", "reason", "generatedAt",
    ]),
    license: publicProfileSection(value.license, ["minimum", "allowEquivalent", "acceptedEquivalent"]),
    experience: publicProfileSection(value.experience, [
      "minimumYears", "youthYears", "professionalYears", "internationalYears", "currentDivisionYears",
    ]),
    geography: publicProfileSection(value.geography, [
      "country", "preferredNationality", "acceptedNationalities", "requiredLanguage",
      "acceptedLanguages", "regionalExperiencePreferred",
    ]),
    salary: publicProfileSection(value.salary, ["minimum", "ideal", "maximum", "flexibility"]),
    achievements: publicProfileSection(value.achievements, [
      "minimumNationalTitles", "minimumCups", "minimumContinentalTitles", "minimumPromotions",
      "prioritizeYouthDevelopment", "prioritizeLeagueSurvival",
    ]),
    playingStyle: publicProfileSection(value.playingStyle, [
      "preferred", "accepted", "preferredFormation", "acceptedFormations", "trainingIntensity", "youthUsage",
    ]),
    squad: publicProfileSection(value.squad, [
      "playerCount", "averageAge", "averageOverall", "averagePotential", "youngTalentCount", "youthShare",
      "predominantFormation", "attackingScore", "defendingScore", "paceScore", "possessionScore", "rebuilding",
    ]),
    countryKnowledge: publicProfileSection(value.countryKnowledge, ["minimum", "priorWorkPreferred", "languageRequired"]),
    weights: publicProfileSection(value.weights, [
      "license", "experience", "recentPerformance", "reputation", "achievements", "salary",
      "playingStyle", "squadCompatibility", "countryKnowledge", "adaptability", "availability",
    ]),
  };
}

function candidateAssessmentDto(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const blockers = list(value.hardBlockers).flatMap((blocker, index) => {
    if (typeof blocker === "string" || typeof blocker === "number") {
      const label = text(blocker);
      return label ? [{ code: `blocker-${index + 1}`, label, detail: null }] : [];
    }
    if (!blocker || typeof blocker !== "object") return [];
    const code = firstText(blocker.code, blocker.id, `blocker-${index + 1}`);
    return [{
      code,
      label: firstText(blocker.label, blocker.message, blocker.code, `Impedimento ${index + 1}`),
      detail: firstText(blocker.detail, blocker.description) || null,
    }];
  });
  const factors = list(value.factors).flatMap((factor, index) => {
    if (!factor || typeof factor !== "object") return [];
    const code = firstText(factor.code, factor.id, `factor-${index + 1}`);
    return [{
      code,
      label: firstText(factor.label, factor.name, factor.code, `Critério ${index + 1}`),
      weight: number(factor.weight) ?? 0,
      rawScore: number(factor.rawScore ?? factor.score ?? factor.value) ?? 0,
      weightedScore: number(factor.weightedScore ?? factor.contribution ?? factor.impact) ?? 0,
      detail: firstText(factor.detail, factor.description) || null,
    }];
  });
  const score = number(value.score ?? value.totalScore ?? value.compatibility);
  if (score == null && factors.length === 0 && blockers.length === 0 && typeof value.eligible !== "boolean") return null;
  return {
    eligible: typeof value.eligible === "boolean" ? value.eligible : blockers.length === 0,
    score: Math.max(0, Math.min(100, score ?? 0)),
    factors,
    hardBlockers: blockers,
    profileVersion: number(value.profileVersion ?? value.version),
    evaluatedAt: date(value.evaluatedAt ?? value.assessedAt ?? value.updatedAt),
  };
}
function applicationDto(application, resolveClub) {
  return {
    id: text(application.id),
    vacancyId: text(application.vacancyId),
    club: resolveClub(application.clubId),
    status: text(application.status) || "submitted",
    message: firstText(application.message) || null,
    submittedAt: date(application.submittedAt ?? application.createdAt),
    updatedAt: date(application.updatedAt ?? application.submittedAt),
    feedback: firstText(application.feedback, application.responseReason) || null,
    closedAt: date(application.closedAt),
    closureReason: firstText(application.closureReason, application.closedReason, application.responseReason) || null,
    closedBy: firstText(application.closedBy, application.closedByName) || null,
    candidateAssessment: candidateAssessmentDto(application.candidateAssessment ?? application.assessment ?? application.scoreBreakdown),
    hired: application.status === "accepted" || application.status === "contratado",
  };
}

const INTERVIEW_OPTIONS = Object.freeze({
  objectives: Object.freeze([
    { id: "balanced", label: "Equilibrar resultado imediato e construção do projeto" },
    { id: "ambitious", label: "Priorizar metas esportivas mais ambiciosas" },
    { id: "gradual", label: "Trabalhar com evolução gradual e sustentável" },
  ]),
  youth: Object.freeze([
    { id: "develop", label: "Desenvolver jovens com oportunidades planejadas" },
    { id: "immediate", label: "Usar jovens somente quando estiverem prontos" },
    { id: "cautious", label: "Priorizar atletas experientes no curto prazo" },
  ]),
  finance: Object.freeze([
    { id: "responsible", label: "Respeitar orçamento e sustentabilidade do clube" },
    { id: "aggressive", label: "Investir forte para acelerar resultados" },
    { id: "flexible", label: "Adaptar gastos às oportunidades do mercado" },
  ]),
  tactics: Object.freeze([
    { id: "adaptable", label: "Adaptar o plano ao elenco e ao adversário" },
    { id: "identity", label: "Manter uma identidade tática consistente" },
    { id: "pragmatic", label: "Priorizar eficiência e resultado" },
  ]),
});

function interviewQuestionOptions(question) {
  const explicit = list(question?.options);
  if (explicit.length > 0) return explicit.map((option, optionIndex) => ({
    id: firstText(option?.id, `option-${optionIndex + 1}`),
    label: firstText(option?.label, option?.text, `Opção ${optionIndex + 1}`),
  }));
  const topic = key(question?.topic);
  const defaults = INTERVIEW_OPTIONS[topic];
  const preferred = text(question?.preferredAnswer);
  if (defaults) {
    const options = defaults.map((option) => ({ ...option }));
    if (preferred && !options.some((option) => option.id === preferred)) {
      options.push({ id: preferred, label: "Apresentar plano alinhado ao projeto" });
    }
    return options;
  }
  return preferred ? [
    { id: preferred, label: "Apresentar plano alinhado ao projeto" },
    { id: "alternative", label: "Propor uma abordagem alternativa" },
    { id: "evaluate", label: "Avaliar o cenário antes de definir" },
  ] : [];
}

function interviewDto(interview, resolveClub, applicationById) {
  const application = applicationById.get(text(interview.applicationId));
  const status = interview.status === "pending" ? "awaiting_answers" : text(interview.status) || "scheduled";
  const rawMetrics = interview.evaluation?.metrics && typeof interview.evaluation.metrics === "object"
    ? interview.evaluation.metrics
    : interview.evaluation ?? {};
  const evaluation = interview.evaluation && typeof interview.evaluation === "object"
    ? {
      overallScore: number(interview.evaluation.overallScore ?? interview.evaluation.overall),
      metrics: {
        boardConfidence: number(rawMetrics.boardConfidence),
        clubCompatibility: number(rawMetrics.clubCompatibility),
        squadCompatibility: number(rawMetrics.squadCompatibility),
        leadership: number(rawMetrics.leadership),
        tacticalVision: number(rawMetrics.tacticalVision),
        financialAlignment: number(rawMetrics.financialAlignment),
        longTermPotential: number(rawMetrics.longTermPotential),
        culturalFit: number(rawMetrics.culturalFit),
        credibility: number(rawMetrics.credibility),
        perceivedRisk: number(rawMetrics.perceivedRisk),
      },
      strengths: stringList(interview.evaluation.strengths).slice(0, 8),
      risks: stringList(interview.evaluation.risks).slice(0, 8),
      recommendation: firstText(interview.evaluation.recommendation) || null,
      summary: firstText(interview.evaluation.summary) || null,
      generatedAt: date(interview.evaluation.generatedAt ?? interview.completedAt),
    }
    : null;
  return {
    id: text(interview.id),
    vacancyId: firstText(interview.vacancyId, application?.vacancyId) || null,
    proposalId: firstText(interview.proposalId) || null,
    club: resolveClub(interview.clubId),
    status,
    scheduledAt: date(interview.scheduledAt),
    deadline: date(interview.deadline ?? interview.expiresAt),
    questions: list(interview.questions).map((question, index) => {
      const options = interviewQuestionOptions(question);
      return {
        id: firstText(question?.id, `question-${index + 1}`),
        prompt: firstText(question?.prompt, question?.question, `Pergunta ${index + 1}`),
        helpText: firstText(question?.helpText) || null,
        type: options.length > 0 ? "choice" : "text",
        options,
      };
    }),
    answers: list(interview.answers).flatMap((answer) => {
      const questionId = text(answer?.questionId);
      if (!questionId) return [];
      return [{
        questionId,
        ...(firstText(answer?.optionId, answer?.answerId) ? { optionId: firstText(answer?.optionId, answer?.answerId) } : {}),
        ...(firstText(answer?.text) ? { text: firstText(answer.text) } : {}),
      }];
    }),
    mode: ["dynamic", "generative", "fallback"].includes(interview.mode)
      ? interview.mode === "fallback" ? "fallback" : "generative"
      : list(interview.transcript).length > 0 ? "generative" : "legacy",
    depth: ["quick", "standard", "deep"].includes(interview.depth) ? interview.depth : "standard",
    source: ["gemini", "fallback", "legacy"].includes(interview.source) ? interview.source : null,
    transcript: list(interview.transcript).flatMap((message, index) => {
      const content = firstText(message?.text, message?.content, message?.message);
      const role = message?.role === "coach" ? "coach" : message?.role === "board" ? "board" : null;
      if (!content || !role) return [];
      return [{
        id: firstText(message?.id, `interview-message-${index + 1}`),
        questionId: firstText(message?.questionId) || null,
        role,
        text: content,
        topic: firstText(message?.topic) || null,
        createdAt: date(message?.createdAt),
        turn: number(message?.turn ?? message?.turnNumber) ?? index + 1,
      }];
    }),
    currentQuestionId: firstText(interview.currentQuestionId) || null,
    turnCount: number(interview.turnCount) ?? 0,
    minTurns: number(interview.minTurns) ?? 0,
    maxTurns: number(interview.maxTurns) ?? 0,
    revision: number(interview.revision) ?? 0,
    memorySummary: firstText(interview.memorySummary) || null,
    evaluation,
    relationshipImpact: interview.relationshipImpact && typeof interview.relationshipImpact === "object"
      ? {
        boardConfidenceDelta: number(interview.relationshipImpact.boardConfidenceDelta ?? interview.relationshipImpact.confidence) ?? 0,
        credibilityDelta: number(interview.relationshipImpact.credibilityDelta ?? interview.relationshipImpact.credibility) ?? 0,
        strategicAlignmentDelta: number(interview.relationshipImpact.strategicAlignmentDelta ?? interview.relationshipImpact.strategicAlignment) ?? 0,
        culturalCompatibilityDelta: number(interview.relationshipImpact.culturalCompatibilityDelta ?? interview.relationshipImpact.culturalFit) ?? 0,
        perceivedRiskDelta: number(interview.relationshipImpact.perceivedRiskDelta ?? interview.relationshipImpact.perceivedRisk) ?? 0,
        expectedTenureDelta: number(interview.relationshipImpact.expectedTenureDelta ?? interview.relationshipImpact.expectedTenure) ?? 0,
      }
      : null,
    negotiationEffects: interview.negotiationEffects && typeof interview.negotiationEffects === "object"
      ? {
        salaryMultiplier: number(interview.negotiationEffects.salaryMultiplier),
        durationYearsDelta: number(
          interview.negotiationEffects.durationYearsDelta
            ?? interview.negotiationEffects.contractYearsDelta
            ?? interview.negotiationEffects.durationYears,
        ),
        signingBonusMultiplier: number(
          interview.negotiationEffects.signingBonusMultiplier
            ?? interview.negotiationEffects.bonusMultiplier,
        ),
        transferBudgetMultiplier: number(interview.negotiationEffects.transferBudgetMultiplier),
        performanceBonusMultiplier: number(interview.negotiationEffects.performanceBonusMultiplier ?? interview.negotiationEffects.bonusMultiplier),
        terminationClauseMultiplier: number(interview.negotiationEffects.terminationClauseMultiplier) ?? 1,
        autonomyDelta: number(interview.negotiationEffects.autonomyDelta) ?? 0,
        priorityDelta: number(interview.negotiationEffects.priorityDelta) ?? 0,
        objectiveDifficultyDelta: number(interview.negotiationEffects.objectiveDifficultyDelta) ?? 0,
        terminateNegotiation: Boolean(interview.negotiationEffects.terminateNegotiation),
        objectives: stringList(interview.negotiationEffects.objectives).slice(0, 12),
        specialClauses: stringList(interview.negotiationEffects.specialClauses ?? interview.negotiationEffects.clauses).slice(0, 12),
      }
      : null,
    compatibility: number(interview.compatibility ?? interview.compatibilityScore),
    outcome: firstText(interview.outcome) || null,
    updatedAt: date(interview.updatedAt ?? interview.completedAt ?? interview.scheduledAt),
  };
}

function assignmentTitleDto(value, index) {
  if (typeof value === "string" || typeof value === "number") return text(value);
  const source = value && typeof value === "object" ? value : {};
  return {
    id: firstText(source.id, `title-${index + 1}`),
    name: firstText(source.name, source.title, source.competitionName, `Título ${index + 1}`),
    competitionId: firstText(source.competitionId) || null,
    competitionName: firstText(source.competitionName, source.competition) || null,
    type: firstText(source.type, source.kind) || null,
    seasonNumber: number(source.seasonNumber ?? source.season),
    seasonYear: number(source.seasonYear ?? source.year),
    wonAt: date(source.wonAt ?? source.occurredAt ?? source.completedAt),
  };
}

function assignmentContractDto(value, index) {
  const source = value && typeof value === "object" ? value : {};
  return {
    id: firstText(source.id, `contract-${index + 1}`),
    startDate: date(source.startDate ?? source.startedAt),
    endDate: date(source.endDate ?? source.endedAt),
    endedAt: date(source.endedAt),
    status: firstText(source.status) || null,
    salary: number(source.salary ?? source.wage),
    signingBonus: number(source.signingBonus),
    releaseClause: number(source.releaseClause ?? source.terminationClause),
    durationDays: number(source.durationDays),
    durationMonths: number(source.durationMonths)
      ?? (number(source.durationYears) == null ? null : number(source.durationYears) * 12),
    renewalCount: number(source.renewalCount),
    endReason: firstText(source.endReason, source.exitReason) || null,
    clauses: labelList(source.clauses ?? source.specialClauses),
  };
}

function assignmentRenewalDto(value, index) {
  const source = value && typeof value === "object" ? value : {};
  return {
    id: firstText(source.id, `renewal-${index + 1}`),
    occurredAt: date(source.occurredAt ?? source.renewedAt ?? source.createdAt),
    previousContractId: firstText(source.previousContractId, source.replacedContractId) || null,
    contractId: firstText(source.contractId, source.newContractId) || null,
    previousSalary: number(source.previousSalary),
    salary: number(source.salary ?? source.wage),
    signingBonus: number(source.signingBonus),
    previousEndDate: date(source.previousEndDate),
    endDate: date(source.endDate),
    durationMonths: number(source.durationMonths)
      ?? (number(source.durationYears) == null ? null : number(source.durationYears) * 12),
  };
}

function assignmentAchievementDto(value, index) {
  if (typeof value === "string" || typeof value === "number") {
    return {
      id: `achievement-${index + 1}`,
      type: "achievement",
      title: text(value),
      description: null,
      occurredAt: null,
      seasonNumber: null,
    };
  }
  const source = value && typeof value === "object" ? value : {};
  return {
    id: firstText(source.id, `achievement-${index + 1}`),
    type: firstText(source.type, source.kind, "achievement"),
    title: firstText(source.title, source.name, source.label, `Conquista ${index + 1}`),
    description: firstText(source.description) || null,
    occurredAt: date(source.occurredAt ?? source.completedAt ?? source.wonAt),
    seasonNumber: number(source.seasonNumber ?? source.season),
  };
}

function assignmentAchievementsDto(value) {
  if (Array.isArray(value)) return value.map(assignmentAchievementDto);
  const source = value && typeof value === "object" ? value : {};
  return [
    ...list(source.titleEntries).map(assignmentAchievementDto),
    ...((number(source.promotions) ?? 0) > 0 ? [{
      id: "assignment-promotions",
      type: "promotion",
      title: `${number(source.promotions)} promoções`,
      description: null,
      occurredAt: null,
      seasonNumber: null,
    }] : []),
    ...((number(source.relegations) ?? 0) > 0 ? [{
      id: "assignment-relegations",
      type: "relegation",
      title: `${number(source.relegations)} rebaixamentos`,
      description: null,
      occurredAt: null,
      seasonNumber: null,
    }] : []),
  ];
}

function developmentEntryLabels(values) {
  return list(values).map((entry) => (
    typeof entry === "string" || typeof entry === "number"
      ? text(entry)
      : firstText(entry?.playerName, entry?.name, entry?.label, entry?.playerId)
  )).filter(Boolean);
}

function assignmentDevelopmentDto(value) {
  const source = value && typeof value === "object" ? value : {};
  const signingEntries = list(source.signings);
  const saleEntries = list(source.sales);
  const squadValueStart = number(source.squadValueStart ?? source.initialSquadValue);
  const squadValueEnd = number(source.squadValueEnd ?? source.finalSquadValue);
  return {
    youthPromoted: number(source.youthPromoted) ?? 0,
    youthPlayerIds: list(source.youthPlayerIds).map(text).filter(Boolean),
    signings: number(source.signings) ?? signingEntries.length,
    sales: number(source.sales) ?? saleEntries.length,
    signingEntries,
    saleEntries,
    importantSignings: developmentEntryLabels(source.importantSignings ?? signingEntries),
    importantSales: developmentEntryLabels(source.importantSales ?? saleEntries),
    squadValueStart,
    squadValueEnd,
    squadValueChange: number(source.squadValueChange)
      ?? (squadValueStart == null || squadValueEnd == null ? null : squadValueEnd - squadValueStart),
  };
}

function assignmentDto(assignment, index, resolveClub) {
  const endedAt = date(assignment.endedAt);
  const club = resolveClub(assignment.clubId);
  return {
    id: firstText(assignment.id, `assignment-${index + 1}`),
    clubId: firstText(assignment.clubId, club.id) || null,
    club,
    country: firstText(assignment.country, assignment.countryName, club.country) || null,
    division: firstText(
      assignment.division,
      assignment.divisionName,
      assignment.competition,
      assignment.competitionName,
      club.competition,
    ) || null,
    role: text(assignment.role) || "head_coach",
    status: endedAt ? "unemployed" : assignment.role === "interim" ? "interim" : "employed",
    startedSeason: number(assignment.startedSeason),
    startedRound: number(assignment.startedRound),
    startedAt: date(assignment.startedAt),
    endedSeason: number(assignment.endedSeason),
    endedRound: number(assignment.endedRound),
    endedAt,
    durationDays: number(assignment.durationDays),
    durationMonths: number(assignment.durationMonths),
    entryReason: firstText(assignment.entryReason) || null,
    exitReason: firstText(assignment.exitReason) || null,
    matches: number(assignment.matches),
    wins: number(assignment.wins),
    draws: number(assignment.draws),
    losses: number(assignment.losses),
    goalsFor: number(assignment.goalsFor),
    goalsAgainst: number(assignment.goalsAgainst),
    goalDifference: number(assignment.goalDifference),
    points: number(assignment.points),
    pointsPerGame: number(assignment.pointsPerGame),
    winRate: number(assignment.winRate),
    longestWinningStreak: number(assignment.longestWinningStreak ?? assignment.maxWinningStreak),
    longestWinlessStreak: number(assignment.longestWinlessStreak ?? assignment.maxWinlessStreak),
    reputationStart: number(assignment.reputationStart ?? assignment.initialReputation),
    reputationEnd: number(assignment.reputationEnd ?? assignment.finalReputation),
    initialSalary: number(assignment.initialSalary ?? assignment.salaryStart),
    finalSalary: number(assignment.finalSalary ?? assignment.salaryEnd),
    contractIds: list(assignment.contractIds).map(text).filter(Boolean),
    contracts: list(assignment.contracts).map(assignmentContractDto),
    renewals: list(assignment.renewals).map(assignmentRenewalDto),
    titles: list(assignment.titles).map(assignmentTitleDto),
    achievements: assignmentAchievementsDto(assignment.achievements),
    development: assignmentDevelopmentDto(assignment.development),
  };
}

const SECURITY_LEVELS = Object.freeze({
  very_secure: "very_safe",
  secure: "safe",
  under_review: "under_observation",
  dismissal_risk: "at_risk",
  dismissal_imminent: "imminent",
});

const SECURITY_LABELS = Object.freeze({
  untouchable: "Intocável",
  very_safe: "Muito seguro",
  safe: "Seguro",
  stable: "Estável",
  under_observation: "Sob observação",
  pressured: "Pressionado",
  very_pressured: "Muito pressionado",
  at_risk: "Em risco",
  imminent: "Demissão iminente",
});

const FACTOR_LABELS = Object.freeze({
  initial_board_trust: "Confiança inicial da diretoria",
  squad_resources_below_expectation: "Elenco abaixo da expectativa institucional",
  squad_resources_above_expectation: "Elenco forte aumenta a cobrança",
  coach_reputation_trust: "Prestígio sustenta confiança",
  coach_reputation_pressure: "Prestígio ainda em construção",
  board_objectives_met: "Objetivos da diretoria cumpridos",
  board_objectives_failed: "Objetivos da diretoria não cumpridos",
  established_tenure: "Trabalho consolidado",
  strong_past_campaigns: "Campanhas anteriores fortes",
  weak_past_campaigns: "Campanhas anteriores fracas",
  career_titles: "Títulos conquistados",
  cup_eliminations: "Eliminação em competição eliminatória",
  results_above_expectation: "Resultados acima da expectativa",
  results_below_expectation: "Resultados abaixo da expectativa",
  position_above_expectation: "Posição acima da expectativa",
  position_below_expectation: "Posição abaixo da expectativa",
  poor_recent_run: "Sequência recente ruim",
  squad_support: "Apoio do elenco",
  squad_unrest: "Insatisfação do elenco",
  financial_pressure: "Pressão financeira",
  insufficient_matches: "Amostra de jogos insuficiente",
});

function securityDto(evaluation, securityState = null) {
  if (!evaluation) return null;
  const level = SECURITY_LEVELS[text(evaluation.securityLevel ?? evaluation.level)]
    ?? text(evaluation.securityLevel ?? evaluation.level)
    ?? "stable";
  const board = evaluation?.boardSupport && typeof evaluation.boardSupport === "object"
    ? evaluation.boardSupport
    : null;
  const activeUltimatums = list(securityState?.ultimatums)
    .filter((entry) => (
      entry?.status === "active"
        && (!evaluation.appointmentId || text(entry?.appointmentId) === text(evaluation.appointmentId))
    ))
    .map((entry) => {
      const target = Math.max(1, number(entry?.objective?.target) ?? 1);
      const progress = Math.max(0, number(entry?.progress) ?? 0);
      return {
        id: text(entry.id),
        status: firstText(entry.status, "active"),
        title: firstText(entry.title, "Ultimato da diretoria"),
        objective: firstText(entry?.objective?.label, entry?.objective?.type, "Recuperar o desempenho"),
        deadlineRound: number(entry.deadlineRound),
        progress: Math.min(100, Math.round((progress / target) * 100)),
        consequence: firstText(entry.consequence, "O vinculo sera reavaliado."),
      };
    });
  const recentHistory = list(securityState?.history)
    .filter((entry) => (
      (!evaluation.appointmentId || text(entry?.appointmentId) === text(evaluation.appointmentId))
        && (!evaluation.coachId || text(entry?.coachId) === text(evaluation.coachId))
    ))
    .sort((left, right) => String(right?.occurredAt ?? "").localeCompare(String(left?.occurredAt ?? "")))
    .slice(0, 8)
    .map((entry) => ({
      id: text(entry.id),
      occurredAt: date(entry.occurredAt),
      previousLevel: SECURITY_LEVELS[text(entry.previousLevel)] ?? (firstText(entry.previousLevel) || null),
      newLevel: SECURITY_LEVELS[text(entry.newLevel)] ?? firstText(entry.newLevel, level),
      previousScore: number(entry.previousScore),
      newScore: number(entry.newScore) ?? number(evaluation.score) ?? 50,
      decision: firstText(entry.decision, "Reavaliacao da diretoria"),
    }));
  return {
    score: number(evaluation.score) ?? 50,
    level,
    label: firstText(evaluation.securityLabel, SECURITY_LABELS[level], evaluation.label, level),
    updatedAt: date(evaluation.updatedAt ?? evaluation.evaluatedAt),
    factors: list(evaluation.factors).map((factor, index) => {
      const impact = number(factor?.impact) ?? 0;
      const code = firstText(factor?.code, factor?.id, `factor-${index + 1}`);
      return {
        id: code,
        label: firstText(factor?.label, FACTOR_LABELS[code], code),
        detail: firstText(factor?.detail) || null,
        impact,
        tone: impact > 0 ? "positive" : impact < 0 ? "negative" : "neutral",
      };
    }),
    trend: evaluation?.trend && typeof evaluation.trend === "object" ? {
      direction: ["rising", "falling"].includes(text(evaluation.trend.direction))
        ? text(evaluation.trend.direction)
        : "stable",
      delta: number(evaluation.trend.delta) ?? 0,
      label: firstText(evaluation.trend.label, "Estavel"),
    } : null,
    fanSupport: evaluation?.fanSupport && typeof evaluation.fanSupport === "object" ? {
      value: number(evaluation.fanSupport.value) ?? 50,
      state: firstText(evaluation.fanSupport.state, "moderate"),
      label: firstText(evaluation.fanSupport.label, "Apoio moderado"),
      trend: ["rising", "falling"].includes(text(evaluation.fanSupport.trend))
        ? text(evaluation.fanSupport.trend)
        : "stable",
    } : null,
    boardSupport: board ? {
      publicValue: number(board.publicValue) ?? 50,
      publicState: firstText(board.publicState, "moderate"),
      publicLabel: firstText(board.publicLabel, "Confianca moderada"),
      privateEstimate: board.privateEstimate && typeof board.privateEstimate === "object" ? {
        min: number(board.privateEstimate.min) ?? 0,
        max: number(board.privateEstimate.max) ?? 100,
        label: firstText(board.privateEstimate.label, "Estimativa interna"),
        source: firstText(board.privateEstimate.source, "Sinais publicos"),
      } : null,
    } : null,
    classics: evaluation?.classics && typeof evaluation.classics === "object"
      ? {
        played: number(evaluation.classics.played) ?? 0,
        wins: number(evaluation.classics.wins) ?? 0,
        draws: number(evaluation.classics.draws) ?? 0,
        losses: number(evaluation.classics.losses) ?? 0,
        winlessStreak: number(evaluation.classics.winlessStreak) ?? 0,
        heavyLosses: number(evaluation.classics.heavyLosses) ?? 0,
        eliminations: number(evaluation.classics.eliminations) ?? 0,
        impact: number(evaluation.classics.impact) ?? 0,
      }
      : null,
    relegation: evaluation?.relegation && typeof evaluation.relegation === "object"
      ? {
        risk: number(evaluation.relegation.risk) ?? 0,
        state: firstText(evaluation.relegation.state, "safe"),
        label: firstText(evaluation.relegation.label, "Fora de risco"),
        inZone: Boolean(evaluation.relegation.inZone),
        consecutiveRounds: number(evaluation.relegation.consecutiveRounds) ?? 0,
        confirmed: Boolean(evaluation.relegation.confirmed),
        survivalSecured: Boolean(evaluation.relegation.survivalSecured),
      }
      : null,
    accumulatedCredit: evaluation?.accumulatedCredit && typeof evaluation.accumulatedCredit === "object"
      ? {
        value: number(evaluation.accumulatedCredit.value) ?? 0,
        label: firstText(evaluation.accumulatedCredit.label, "Pouco credito"),
        delta: number(evaluation.accumulatedCredit.delta) ?? 0,
      }
      : null,
    dimensions: list(evaluation?.dimensions).map((entry, index) => ({
      id: firstText(entry?.id, `dimension-${index + 1}`),
      label: firstText(entry?.label, "Dimensao avaliada"),
      value: number(entry?.value) ?? 50,
      weight: number(entry?.weight) ?? 0,
      trend: ["rising", "falling"].includes(text(entry?.trend)) ? text(entry.trend) : "stable",
      justification: firstText(entry?.justification) || null,
      updatedAt: date(entry?.updatedAt),
    })),
    activeUltimatums,
    recentHistory,
  };
}

function initialSecurityDto(activeAppointment) {
  if (!activeAppointment) return null;
  return securityDto({
    score: 55,
    securityLevel: "stable",
    evaluatedAt: activeAppointment.startedAt ?? activeAppointment.appointedAt,
    factors: [{
      code: "initial_board_trust",
      impact: 0,
      detail: "Avaliação inicial; os resultados oficiais ainda formarão a amostra da diretoria.",
    }],
  });
}

function vacancyDto(vacancy, application, resolveClub, room, coach) {
  const club = resolveClub(vacancy.clubId);
  const finance = list(room?.marketState?.finances).find((entry) => key(entry?.clubId) === key(club.id));
  const balance = number(finance?.balance);
  const reputationGap = Math.abs((club.reputation ?? 50) - (number(coach?.marketReputation ?? coach?.reputation) ?? 50));
  return {
    id: text(vacancy.id),
    club,
    status: text(vacancy.status) || "open",
    marketStage: firstText(vacancy.marketStage, "interest"),
    shortlistCount: new Set(list(vacancy.shortlistCoachIds).map(text).filter(Boolean)).size,
    searchStartedAt: date(vacancy.searchStartedAt ?? vacancy.openedAt),
    lastMarketActionAt: date(vacancy.lastMarketActionAt),
    competition: firstText(vacancy.competition, club.competition) || null,
    country: firstText(vacancy.country, club.country) || null,
    financialSituation: firstText(vacancy.financialSituation)
      || (balance == null ? null : balance < 0 ? "Em dificuldade" : balance < 20_000_000 ? "Controlada" : "Estável"),
    currentPosition: firstText(vacancy.currentPosition) || null,
    objective: firstText(vacancy.objective, vacancy.desiredProfile?.objective) || null,
    availableBudget: number(vacancy.availableBudget ?? vacancy.budget ?? vacancy.desiredProfile?.availableBudget ?? balance),
    squadSummary: firstText(vacancy.squadSummary, vacancy.desiredProfile?.squadSummary) || null,
    reason: firstText(vacancy.reason) || null,
    deadline: date(vacancy.deadline ?? vacancy.applicationDeadline ?? vacancy.closesAt),
    interestLevel: number(vacancy.interestLevel ?? vacancy.interest) ?? Math.max(0, Math.round(100 - reputationGap * 4)),
    desiredProfile: publicDesiredProfile(vacancy.desiredProfile),
    applicationId: application?.id ?? null,
    createdAt: date(vacancy.createdAt ?? vacancy.openedAt),
  };
}

function latestEvaluation(evaluations, clubId) {
  return [...evaluations]
    .filter((evaluation) => !clubId || key(evaluation.clubId) === key(clubId))
    .sort((left, right) => (
      String(right.evaluatedAt ?? "").localeCompare(String(left.evaluatedAt ?? ""))
        || (number(right.seasonNumber) ?? 0) - (number(left.seasonNumber) ?? 0)
        || (number(right.round) ?? 0) - (number(left.round) ?? 0)
    ))[0] ?? null;
}

function coachCareerStatus(room, coachId, coach, activeAppointment) {
  const activeLeave = list(room?.professionalLeaveState?.leaves).find((leave) => (
    leave?.professionalType === "coach"
      && text(leave?.professionalId) === coachId
      && leave?.status === "active"
  ));
  if (activeLeave) return "on_leave";
  if (activeAppointment) return activeAppointment.role === "interim" ? "interim" : "employed";
  const current = text(coach?.status) || "unemployed";
  if (current !== "unemployed") return current;
  const terminalEvents = new Map([
    ["COACH_RESIGNED", "resigned"],
    ["COACH_DISMISSED", "dismissed"],
    ["COACH_BECAME_UNEMPLOYED", "unemployed"],
    ["COACH_CONTRACT_EXPIRED", "unemployed"],
  ]);
  const latest = list(room?.clubCareerState?.events)
    .filter((event) => (
      terminalEvents.has(text(event?.type))
        && (text(event?.coachId) === coachId || list(event?.coachIds).map(text).includes(coachId))
    ))
    .sort((left, right) => (
      String(right.occurredAt ?? "").localeCompare(String(left.occurredAt ?? ""))
        || String(right.id ?? "").localeCompare(String(left.id ?? ""))
    ))[0];
  return terminalEvents.get(text(latest?.type)) ?? current;
}

function assignmentDtos(assignments, resolveClub) {
  const seen = new Set();
  return list(assignments).flatMap((assignment, index) => {
    const dto = assignmentDto(assignment, index, resolveClub);
    const identity = [
      key(dto.club.id),
      dto.role,
      dto.startedAt ?? "",
      dto.endedAt ?? "",
      dto.entryReason ?? "",
      dto.exitReason ?? "",
    ].join("|");
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [dto];
  });
}

function careerHistoryEntryDto(value, resolveClub, coachId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entryCoachId = firstText(value.coachId);
  if (entryCoachId && entryCoachId !== coachId) return null;
  const clubId = firstText(value.clubId) || null;
  const fromClubId = firstText(value.fromClubId, value.previousClubId, value.sellerClubId) || null;
  const toClubId = firstText(value.toClubId, value.nextClubId, value.buyerClubId) || null;
  return {
    ...value,
    ...(clubId ? { clubId, club: resolveClub(clubId) } : {}),
    ...(fromClubId ? { fromClubId, fromClub: resolveClub(fromClubId) } : {}),
    ...(toClubId ? { toClubId, toClub: resolveClub(toClubId) } : {}),
  };
}

function careerHistoryOccurredAt(value, dateFields) {
  return dateFields.map((field) => date(value?.[field])).find(Boolean) ?? "";
}

function careerHistoryListDto(
  values,
  resolveClub,
  coachId,
  dateFields = ["occurredAt", "createdAt", "completedAt", "startedAt", "date"],
) {
  return list(values)
    .map((entry) => careerHistoryEntryDto(entry, resolveClub, coachId))
    .filter(Boolean)
    .sort((left, right) => (
      careerHistoryOccurredAt(right, dateFields).localeCompare(careerHistoryOccurredAt(left, dateFields))
      || String(left.id ?? "").localeCompare(String(right.id ?? ""), "pt-BR")
    ));
}

function careerAchievementsDto(value, resolveClub, coachId) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const combined = Array.isArray(value)
    ? value
    : [
        ...list(source?.titles),
        ...list(source?.promotions),
        ...list(source?.relegations),
        ...((number(source?.youthPromoted) ?? 0) > 0 ? [{
          id: "career-youth-promoted",
          type: "youth_development",
          title: `${number(source.youthPromoted)} jovens promovidos`,
          value: number(source.youthPromoted),
        }] : []),
      ];
  const unique = new Map();
  for (const [index, entry] of combined.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const identity = firstText(
      entry.id,
      `${entry.type ?? entry.kind ?? "achievement"}:${entry.title ?? entry.name ?? index}`,
    );
    if (!unique.has(identity)) unique.set(identity, { ...entry, id: identity });
  }
  return careerHistoryListDto([...unique.values()], resolveClub, coachId, [
    "wonAt", "occurredAt", "completedAt", "createdAt", "date",
  ]);
}

function careerHistoryDto(value, resolveClub, coachId, fallbackDate) {
  const source = value && typeof value === "object" ? value : {};
  const summarySource = source.summary && typeof source.summary === "object" ? source.summary : {};
  const clubs = number(summarySource.clubs ?? summarySource.clubsManaged) ?? 0;
  const countries = number(summarySource.countries ?? summarySource.countriesWorked) ?? 0;
  const acceptedProposals = number(
    summarySource.acceptedProposals ?? summarySource.proposalsAccepted,
  ) ?? 0;
  const rejectedProposals = number(
    summarySource.rejectedProposals ?? summarySource.proposalsRejected,
  ) ?? 0;
  return {
    coachId,
    generatedAt: date(source.generatedAt ?? source.updatedAt ?? fallbackDate),
    summary: {
      ...summarySource,
      clubs,
      clubsManaged: clubs,
      countries,
      countriesWorked: countries,
      proposalsAccepted: acceptedProposals,
      acceptedProposals,
      proposalsRejected: rejectedProposals,
      rejectedProposals,
    },
    timeline: careerHistoryListDto(source.timeline, resolveClub, coachId),
    spells: assignmentDtos(source.spells ?? source.assignments, resolveClub)
      .sort((left, right) => (
        String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? ""))
        || String(left.id ?? "").localeCompare(String(right.id ?? ""), "pt-BR")
      )),
    negotiations: careerHistoryListDto(
      source.negotiations ?? source.negotiationHistory,
      resolveClub,
      coachId,
    ),
    reputationHistory: careerHistoryListDto(source.reputationHistory, resolveClub, coachId),
    achievements: careerAchievementsDto(
      source.achievementEntries ?? source.achievements,
      resolveClub,
      coachId,
    ),
    financialHistory: careerHistoryListDto(source.financialHistory, resolveClub, coachId),
    unemploymentPeriods: careerHistoryListDto(source.unemploymentPeriods, resolveClub, coachId),
  };
}

function alertDto(alert) {
  return {
    id: text(alert.id),
    kind: firstText(alert.kind, alert.type, "career"),
    title: firstText(alert.title, "Atualização da carreira"),
    message: firstText(alert.message, alert.body, "Há uma nova atualização na sua carreira."),
    createdAt: date(alert.createdAt),
    read: Boolean(alert.read),
    tone: ["neutral", "positive", "warning", "danger", "info"].includes(alert.tone)
      ? alert.tone
      : "neutral",
  };
}

function marketRestrictionDto(coach, asOf, proposals) {
  const restriction = activeCoachMarketRestriction(coach, asOf);
  const persisted = coach?.marketRestriction;
  if (!restriction && !persisted) return null;
  const source = restriction ?? persisted;
  const startsAt = date(source.startsAt);
  const endsAt = date(source.endsAt);
  const offersReceived = list(proposals).filter((proposal) => {
    const createdAt = new Date(proposal?.createdAt ?? 0).getTime();
    return Number.isFinite(createdAt)
      && (!startsAt || createdAt >= new Date(startsAt).getTime())
      && (!endsAt || createdAt <= new Date(endsAt).getTime());
  }).length;
  return {
    active: Boolean(restriction),
    type: "voluntary_resignation",
    startsAt,
    endsAt,
    remainingDays: restriction?.remainingDays ?? 0,
    canInterview: true,
    canSign: !restriction || source.signingBlocked === false,
    reasonCode: firstText(source.reasonCode, "coach_resignation"),
    reasonLabel: firstText(source.reasonLabel, "Pedido de demissão"),
    justCauseVerified: Boolean(source.justCauseVerified),
    offersReceived,
  };
}

function coachConductEntryDto(entry, resolveClub) {
  return {
    id: text(entry?.id),
    type: firstText(entry?.type, "career_event"),
    occurredAt: date(entry?.occurredAt),
    club: entry?.clubId ? resolveClub(entry.clubId) : null,
    reasonCode: firstText(entry?.reasonCode) || null,
    reasonLabel: firstText(entry?.reasonLabel) || null,
    reputationDelta: number(entry?.reputationDelta) ?? 0,
    reputationBefore: number(entry?.reputationBefore),
    reputationAfter: number(entry?.reputationAfter),
    trustDelta: number(entry?.trustDelta) ?? 0,
    restrictionEndsAt: date(entry?.restrictionEndsAt),
  };
}

function resignationBoardReaction(preview) {
  if (preview?.justCauseVerified) return "Justa causa comprovada reduz as penalidades.";
  if (preview?.justCauseRequested) return "Justa causa não comprovada; aplicam-se as penalidades integrais.";
  return "Saída voluntária reduz confiança e interesse do mercado.";
}

function resignationPreviewFields(preview) {
  return {
    financialCost: number(preview?.financialCost),
    reputationDelta: number(preview?.reputationDelta),
    trustDelta: number(preview?.trustDelta),
    likelyUnemployedDays: number(preview?.inactivityDays),
    inactivityDays: number(preview?.inactivityDays),
    restrictionEndsAt: date(preview?.restrictionEndsAt),
    justCauseVerified: Boolean(preview?.justCauseVerified),
    pendingProjectPenalty: Boolean(preview?.pendingProjectPenalty),
    boardReaction: resignationBoardReaction(preview),
    pendingObjectives: stringList(preview?.pendingObjectives),
  };
}

function resignationPreviewDto(preview, reasonPreviews = []) {
  if (!preview) return null;
  const previewsByReason = new Map(list(reasonPreviews)
    .map((candidate) => [firstText(candidate?.reasonCode), candidate])
    .filter(([code]) => code));
  return {
    ...resignationPreviewFields(preview),
    reasonCode: firstText(preview.reasonCode, "coach_resignation"),
    reasonLabel: firstText(preview.reasonLabel, "Pedido de demissão"),
    reasonOptions: Object.entries(COACH_RESIGNATION_REASONS)
      .filter(([code]) => code !== "coach_resignation")
      .map(([code, value]) => {
        const reasonPreview = previewsByReason.get(code);
        return {
          code,
          label: firstText(reasonPreview?.reasonLabel, value.label, code),
          justCause: Boolean(value.justCause),
          ...resignationPreviewFields(reasonPreview),
        };
      }),
  };
}

function lifecycleStatus(value, kind) {
  const status = key(value);
  if (kind === "notice") {
    if (status === "ended_early") return "completed";
    return ["active", "completed", "cancelled"].includes(status) ? status : "active";
  }
  if (kind === "retirement") {
    if (status === "effective") return "completed";
    if (status === "scheduled") return "active";
    return status === "cancelled" ? "cancelled" : "active";
  }
  if (kind === "agreement") {
    if (status === "awaiting_signatures") return "accepted";
    if (status === "executed") return "completed";
    if (status === "expired") return "cancelled";
    return [
      "proposed", "countered", "accepted", "signed", "completed", "cancelled", "rejected",
    ].includes(status) ? status : "proposed";
  }
  if (status === "ended" || status === "effective" || status === "executed") return "completed";
  return ["active", "completed", "cancelled"].includes(status) ? status : "active";
}

function lifecycleNoticeDto(value) {
  const terminalAt = date(value?.endedAt);
  const expectedEndAt = date(value?.expectedEndDate);
  const compensation = number(value?.compensation?.compensation ?? value?.compensation);
  return {
    id: text(value?.id),
    kind: "notice",
    professionalType: "coach",
    professionalId: text(value?.professionalId),
    clubId: firstText(value?.clubId) || null,
    status: lifecycleStatus(value?.status, "notice"),
    initiatedBy: value?.initiatedBy === "professional" ? "coach" : firstText(value?.initiatedBy, "system"),
    reason: firstText(value?.endReason, value?.reason) || null,
    createdAt: date(value?.communicatedAt ?? value?.startDate),
    updatedAt: date(value?.updatedAt),
    effectiveAt: terminalAt ?? expectedEndAt,
    completedAt: terminalAt,
    compensation,
    startsAt: date(value?.startDate ?? value?.communicatedAt),
    endsAt: terminalAt ?? expectedEndAt,
    durationDays: number(value?.durationDays),
    earlyExitAllowed: value?.earlyExitAllowed !== false,
    metadata: {
      interviewAllowed: value?.interviewAllowed !== false,
      longTermDecisionApprovalRequired: value?.longTermDecisionApprovalRequired !== false,
      successorSearchId: firstText(value?.successorSearchId) || null,
      substituteCoachId: firstText(value?.substituteCoachId) || null,
      expectedEndAt,
    },
  };
}

function lifecycleRetirementType(value) {
  const kindValue = key(value).replaceAll("-", "_");
  if (kindValue === "end_season") return "end_of_season";
  if (kindValue === "end_contract") return "end_of_contract";
  if (kindValue === "immediate") return "immediate";
  return "scheduled";
}

function lifecycleRetirementDto(value) {
  const status = lifecycleStatus(value?.status, "retirement");
  const retirementAt = date(value?.effectiveAt);
  const completedAt = status === "completed"
    ? date(value?.effectiveDate ?? value?.updatedAt ?? value?.effectiveAt)
    : null;
  return {
    id: text(value?.id),
    kind: "retirement",
    professionalType: "coach",
    professionalId: text(value?.professionalId),
    clubId: firstText(value?.clubId) || null,
    status,
    initiatedBy: "coach",
    reason: firstText(value?.reason) || null,
    createdAt: date(value?.announcedAt),
    updatedAt: date(value?.updatedAt),
    effectiveAt: retirementAt,
    completedAt,
    compensation: null,
    announcedAt: date(value?.announcedAt),
    retirementAt,
    retirementType: lifecycleRetirementType(value?.kind ?? value?.retirementType),
    canCancel: status === "active",
    canPostpone: status === "active",
    metadata: {
      postponementCount: number(value?.postponementCount) ?? 0,
      previousEffectiveDates: list(value?.previousEffectiveDates).map(date).filter(Boolean),
      decisionFactors: value?.decisionFactors && typeof value.decisionFactors === "object"
        ? structuredClone(value.decisionFactors)
        : {},
      successorSearchId: firstText(value?.successorSearchId) || null,
    },
  };
}

function lifecycleAgreementDto(value) {
  const terms = value?.terms && typeof value.terms === "object"
    ? structuredClone(value.terms)
    : {};
  const status = lifecycleStatus(value?.status, "agreement");
  const completedAt = date(value?.executedAt ?? value?.rejectedAt);
  return {
    id: text(value?.id),
    kind: "mutual_agreement",
    professionalType: "coach",
    professionalId: text(value?.professionalId),
    clubId: firstText(value?.clubId) || null,
    status,
    initiatedBy: value?.proposedBy === "professional" ? "coach" : firstText(value?.proposedBy, "club"),
    reason: firstText(value?.reason) || null,
    createdAt: date(value?.proposedAt),
    updatedAt: date(value?.updatedAt),
    effectiveAt: date(value?.departureDate),
    completedAt,
    compensation: number(terms.compensation),
    negotiationRound: number(value?.negotiationRound) ?? 1,
    proposedBy: value?.proposedBy === "professional" ? "coach" : firstText(value?.proposedBy, "club"),
    proposedExitAt: date(value?.departureDate),
    confidentiality: Boolean(terms.confidentiality),
    benefitsUntil: date(terms.benefitsThrough),
    terms,
    metadata: {
      expiresAt: date(value?.expiresAt),
      nextResponder: firstText(value?.nextResponder) || null,
      signatures: value?.signatures && typeof value.signatures === "object"
        ? structuredClone(value.signatures)
        : {},
      decisionHistory: list(value?.decisionHistory).map((entry) => structuredClone(entry)),
    },
  };
}

function lifecycleLeaveDto(value) {
  const status = value?.status === "ended_early"
    ? "completed"
    : value?.status === "scheduled"
      ? "active"
      : lifecycleStatus(value?.status, "leave");
  const completedAt = date(value?.endedAt ?? value?.cancelledAt);
  return {
    id: text(value?.id),
    kind: "leave",
    professionalType: "coach",
    professionalId: text(value?.professionalId),
    clubId: firstText(value?.clubId) || null,
    status,
    initiatedBy: value?.initiatedBy === "professional"
      ? "coach"
      : firstText(value?.initiatedBy, "system"),
    reason: firstText(value?.endReason, value?.reason) || null,
    createdAt: date(value?.requestedAt),
    updatedAt: completedAt ?? date(value?.activatedAt ?? value?.requestedAt),
    effectiveAt: date(value?.expectedEndAt),
    completedAt,
    compensation: null,
    startsAt: date(value?.startsAt),
    endsAt: completedAt ?? date(value?.expectedEndAt),
    expectedEndAt: date(value?.expectedEndAt),
    leaveStatus: firstText(value?.status, "scheduled"),
    actingStaffId: firstText(value?.actingStaffId) || null,
    contractRemainsActive: value?.contractRemainsActive !== false,
    payment: value?.payment && typeof value.payment === "object"
      ? structuredClone(value.payment)
      : null,
    metadata: {
      internalStatus: firstText(value?.status) || null,
      activatedAt: date(value?.activatedAt),
      contractId: firstText(value?.contractId) || null,
      interimAssignmentId: firstText(value?.interimAssignmentId) || null,
      actingStaffId: firstText(value?.actingStaffId) || null,
      ...(value?.metadata && typeof value.metadata === "object"
        ? structuredClone(value.metadata)
        : {}),
    },
  };
}

function transitionTitle(type) {
  const labels = {
    assistant_or_emergency_interim_started: "Comando interino iniciado",
    staff_followed_departing_coach: "Comiss\u00e3o acompanhou treinador",
    staff_retained_by_club: "Comiss\u00e3o mantida pelo clube",
    successor_search_opened: "Busca por sucessor iniciada",
  };
  return labels[type] ?? firstText(type)
    .replaceAll("_", " ")
    .replace(/^./u, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

function lifecycleTransitionDto(value, coachId) {
  const endedAt = date(value?.endedAt);
  const type = firstText(value?.type, "transition");
  return {
    id: text(value?.id),
    kind: type,
    professionalType: "coach",
    professionalId: firstText(value?.coachId, coachId),
    clubId: firstText(value?.clubId) || null,
    status: lifecycleStatus(endedAt ? "completed" : value?.status, "transition"),
    initiatedBy: "system",
    reason: firstText(value?.metadata?.reason) || null,
    createdAt: date(value?.startedAt),
    updatedAt: endedAt ?? date(value?.startedAt),
    effectiveAt: date(value?.expectedEndAt ?? value?.startedAt),
    completedAt: endedAt,
    compensation: number(value?.metadata?.compensation),
    startsAt: date(value?.startedAt),
    endsAt: endedAt ?? date(value?.expectedEndAt),
    title: transitionTitle(type),
    description: firstText(value?.metadata?.description, value?.metadata?.reason) || null,
    metadata: value?.metadata && typeof value.metadata === "object"
      ? structuredClone(value.metadata)
      : {},
  };
}

function preferredStaffDto(room, coachId, entries) {
  const members = [
    ...list(room?.clubCareerState?.staffMembers),
    ...list(room?.clubCareerState?.staffCandidates),
    ...list(room?.staffMembers),
    ...list(room?.staffCandidates),
  ];
  const contracts = list(room?.clubCareerState?.staffContracts);
  return list(entries).map((entry) => {
    const staffId = firstText(entry?.staffId, entry?.professionalId);
    const member = members.find((candidate) => text(candidate?.id) === staffId) ?? {};
    const contract = contracts.find((candidate) => (
      text(candidate?.staffId) === staffId && candidate?.status === "active"
    )) ?? {};
    const availability = member?.availability && typeof member.availability === "object"
      ? firstText(member.availability.status)
      : firstText(member?.availability);
    const affiliationType = firstText(
      member?.affiliationType,
      entry?.affiliationType,
      "personal_team",
    );
    return {
      staffId,
      name: firstText(member?.name, entry?.name, staffId),
      role: firstText(member?.role, entry?.role, "staff"),
      roleLabel: firstText(member?.roleLabel, entry?.roleLabel) || null,
      affinity: number(entry?.affinity ?? member?.affinity),
      availability: availability || firstText(member?.status, entry?.available === false ? "unavailable" : "available"),
      estimatedCost: number(entry?.estimatedMonthlyCost ?? member?.salary ?? contract?.wage),
      affiliationType: affiliationType === "personal_staff" ? "personal_team" : affiliationType,
      linkedCoachId: firstText(member?.linkedCoachId, entry?.linkedCoachId, coachId) || null,
    };
  }).filter(({ staffId }) => Boolean(staffId));
}

function lifecycleDto(room, coachId, now) {
  const snapshot = professionalLifecycleSnapshot(room, {
    professionalType: "coach",
    professionalId: coachId,
    now,
  });
  const leaveSnapshot = professionalLeaveSnapshot(room, {
    professionalType: "coach",
    professionalId: coachId,
    now,
  });
  return {
    notices: list(snapshot.notices).map(lifecycleNoticeDto),
    retirements: list(snapshot.retirements).map(lifecycleRetirementDto),
    mutualAgreements: list(snapshot.mutualAgreements).map(lifecycleAgreementDto),
    leaves: list(leaveSnapshot.leaves).map(lifecycleLeaveDto),
    transitions: list(snapshot.transitions).map((transition) => lifecycleTransitionDto(transition, coachId)),
    preferredStaff: preferredStaffDto(room, coachId, snapshot.preferredStaffByCoach?.[coachId]),
  };
}

/**
 * DTO privado da carreira do manager. Nunca retorna registros de contrato,
 * proposta, candidatura ou entrevista pertencentes a outro treinador.
 */
export function buildCoachCareerSnapshot(roomValue, managerId, options = {}) {
  const coachId = text(managerId);
  if (!coachId) throw new TypeError("managerId é obrigatório");
  const room = ensureCoachEmploymentState(roomValue, { now: options.now });
  const scoped = coachEmploymentSnapshot(room, { coachId, now: options.now });
  const resolveClub = clubResolver(room);
  const manager = list(room.managers).find((candidate) => text(candidate?.id) === coachId) ?? null;
  const coachSource = scoped.coaches.find((candidate) => text(candidate?.id) === coachId) ?? {
    id: coachId,
    name: firstText(manager?.name, "Treinador"),
    status: "unemployed",
    currentClubId: null,
    assignments: [],
  };
  const contracts = scoped.contracts.map((contract) => contractDto(contract, resolveClub)).filter(Boolean);
  const activeAppointment = scoped.appointments.find((appointment) => appointment.status === "active") ?? null;
  const activeContract = activeAppointment
    ? contracts.find((contract) => contract.id === activeAppointment.contractId)
      ?? contracts.find((contract) => contract.status === "active" && key(contract.clubId) === key(activeAppointment.clubId))
      ?? null
    : null;
  const activeClubId = activeAppointment?.clubId ?? coachSource.currentClubId ?? manager?.clubId ?? null;
  const applications = scoped.applications.map((application) => applicationDto(application, resolveClub));
  const applicationByVacancy = new Map(applications.map((application) => [application.vacancyId, application]));
  const applicationById = new Map(applications.map((application) => [application.id, application]));
  const vacancies = scoped.vacancies
    .filter((vacancy) => vacancy.status === "open")
    .map((vacancy) => vacancyDto(vacancy, applicationByVacancy.get(vacancy.id), resolveClub, room, coachSource));
  const marketRestriction = marketRestrictionDto(coachSource, options.now ?? scoped.currentDate, scoped.proposals);
  const proposals = scoped.proposals.map((proposal) => {
    const dto = proposalDto(proposal, resolveClub, room);
    if (marketRestriction?.active && dto.availableActions.includes("accept")) {
      dto.availableActions = dto.availableActions.filter((action) => action !== "accept");
    }
    return dto;
  });
  const interestedClubs = [...new Map(proposals
    .filter((proposal) => [
      "pending", "countered", "aguardando_resposta_diretoria",
      "aprovada_diretoria", "informacoes_solicitadas",
    ].includes(proposal.status))
    .map((proposal) => [key(proposal.club.id), proposal.club])).values()];
  const currentEvaluation = latestEvaluation(scoped.evaluations, activeClubId);
  const coachStatus = coachCareerStatus(room, coachId, coachSource, activeAppointment);
  const titleCount = Array.isArray(coachSource.titles) ? coachSource.titles.length : number(coachSource.titles) ?? 0;
  const activeObjectives = activeContract?.objectives ?? [];
  const resignationReasonPreviews = activeAppointment
    ? Object.keys(COACH_RESIGNATION_REASONS)
      .filter((reasonCode) => reasonCode !== "coach_resignation")
      .map((reasonCode) => previewCoachResignation(room, { coachId, reasonCode }, { now: options.now }))
      .filter(Boolean)
    : [];
  const resignationEstimate = resignationReasonPreviews.find((preview) => preview.reasonCode === "personal_reasons")
    ?? resignationReasonPreviews[0]
    ?? null;
  const activeEmployment = activeAppointment ? {
    id: text(activeAppointment.id),
    coachId,
    clubId: text(activeAppointment.clubId),
    club: resolveClub(activeAppointment.clubId),
    role: text(activeAppointment.role) || "head_coach",
    status: coachStatus === "on_leave"
      ? "on_leave"
      : activeAppointment.role === "interim" ? "interim" : "employed",
    hiredAt: date(activeAppointment.appointedAt),
    startsAt: date(activeAppointment.startedAt ?? activeAppointment.expectedStartAt),
    endsAt: activeContract?.endDate ?? null,
    entryReason: firstText(activeAppointment.entryReason) || null,
    exitReason: firstText(activeAppointment.exitReason) || null,
    contractId: activeContract?.id ?? (firstText(activeAppointment.contractId) || null),
    contract: activeContract,
    objectives: activeObjectives,
    resignationConsequences: resignationPreviewDto(resignationEstimate, resignationReasonPreviews),
  } : null;
  const alerts = selectCoachCareerAlerts(room, activeClubId ?? "", coachId, { asOf: options.now })
    .map(alertDto);
  const careerHistory = careerHistoryDto(
    buildCoachCareerHistorySummary(
      room,
      scoped,
      coachId,
      options.now ?? scoped.currentDate,
    ),
    resolveClub,
    coachId,
    options.now ?? scoped.currentDate,
  );
  const lifecycle = lifecycleDto(room, coachId, options.now ?? scoped.currentDate);

  return {
    coach: {
      id: coachId,
      name: firstText(coachSource.name, manager?.name, "Treinador"),
      nationality: firstText(coachSource.nationality) || null,
      avatarImageUrl: firstText(coachSource.avatarImageUrl, coachSource.avatarUrl) || null,
      license: firstText(coachSource.license) || null,
      preferredFormation: firstText(coachSource.preferredFormation) || null,
      style: firstText(coachSource.style) || null,
      reputation: number(coachSource.reputation) ?? 0,
      marketReputation: number(coachSource.marketReputation ?? coachSource.reputation) ?? 0,
      expectedSalary: number(coachSource.expectedSalary ?? activeContract?.salary),
      winRate: number(coachSource.winRate),
      titles: Math.max(0, Math.trunc(titleCount)),
      status: coachStatus,
      currentClubId: activeClubId ? text(activeClubId) : null,
      interestedClubs,
    },
    activeEmployment,
    lifecycle,
    marketRestriction,
    careerTrust: coachCareerTrustSummary(coachSource),
    careerAudit: list(coachSource.careerConductHistory)
      .map((entry) => coachConductEntryDto(entry, resolveClub))
      .filter((entry) => entry.id)
      .sort((left, right) => String(right.occurredAt ?? "").localeCompare(String(left.occurredAt ?? ""))),
    reputationHistory: list(coachSource.reputationHistory)
      .map((entry) => coachConductEntryDto(entry, resolveClub))
      .filter((entry) => entry.id)
      .sort((left, right) => String(right.occurredAt ?? "").localeCompare(String(left.occurredAt ?? ""))),
    careerHistory,
    jobSecurity: securityDto(currentEvaluation, scoped.jobSecurity) ?? initialSecurityDto(activeAppointment),
    assignments: assignmentDtos(coachSource.assignments, resolveClub),
    contracts,
    proposals,
    vacancies,
    applications,
    interviews: scoped.interviews.map((interview) => interviewDto(interview, resolveClub, applicationById)),
    news: alerts,
    updatedAt: date(scoped.currentDate ?? room.updatedAt ?? room.startedAt ?? room.createdAt),
  };
}
