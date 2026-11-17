// Coach career use cases (audit Q-02): vacancies, interviews, proposals, board
// decisions, renewals, resignation and job search. RoomStore keeps the public
// methods and delegates here; storage, clock, AI and schedule helpers are injected.
import { buildCoachCareerSnapshot } from "../services/coachCareerSnapshot.mjs";
import { careerDateFor } from "../game/clubCareerSystem.mjs";
import {
  applyCoachInterviewGeneratedTurn,
  applyForCoachVacancy as applyForCoachVacancyOperation,
  ensureCoachEmploymentState,
  processCoachEmploymentDate,
  renewCoachContract as renewCoachContractOperation,
  resignCoach as resignCoachOperation,
  respondCoachBoardDecision as respondCoachBoardDecisionOperation,
  respondCoachInterview as respondCoachInterviewOperation,
  respondCoachProposal as respondCoachProposalOperation,
} from "../game/coachEmployment.mjs";
import { RoomError } from "./roomError.mjs";
import { clubKey } from "./roomKeys.mjs";

function coachInterviewDecision(room, coachId, interviewId, answers) {
  const interview = (room.coachEmploymentState?.interviews ?? [])
    .find((candidate) => candidate.id === interviewId && candidate.coachId === coachId);
  if (!interview) return { decision: "", compatibility: 0 };
  const byQuestion = new Map((answers ?? []).map((answer) => [
    answer.questionId,
    answer.answerId ?? answer.optionId ?? answer.value ?? answer.text,
  ]));
  const scores = (interview.questions ?? []).map((question) => {
    const answer = String(byQuestion.get(question.id) ?? "").trim();
    if (!answer) return 0;
    return question.preferredAnswer && answer === question.preferredAnswer ? 100 : 55;
  });
  const compatibility = scores.length
    ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
    : 50;
  return { decision: compatibility >= 68 ? "accept" : "reject", compatibility };
}

function expectedCoachSalary(room, coachId, clubId) {
  const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === coachId);
  const club = (room.competitionCatalog ?? []).flatMap((competition) => competition.clubs ?? [])
    .find((candidate) => clubKey(candidate.id ?? candidate.code) === clubKey(clubId));
  const reputation100 = (value, fallback = 45) => {
    const parsed = Number(value);
    const normalized = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(1, Math.min(100, normalized > 0 && normalized <= 20 ? normalized * 5 : normalized));
  };
  const coachReputation = reputation100(coach?.marketReputation ?? coach?.reputation);
  const clubReputation = reputation100(club?.reputation);
  const fallback = Math.round((25_000 + coachReputation * 1_750 + clubReputation * 1_250) / 1_000) * 1_000;
  const vacancy = (room.coachEmploymentState?.vacancies ?? []).find((candidate) => (
    candidate.status === "open" && clubKey(candidate.clubId) === clubKey(clubId)
  ));
  const salary = vacancy?.desiredProfile?.salary ?? {};
  const minimum = Math.max(1_000, Number(salary.minimum) || Math.round(fallback * 0.75));
  const ideal = Math.max(minimum, Number(salary.ideal) || fallback);
  const maximum = Math.max(ideal, Number(salary.maximum) || Math.round(fallback * 1.35));
  const expected = Math.max(0, Number(coach?.expectedSalary) || 0);
  const target = expected > 0 ? (ideal * 0.65) + (expected * 0.35) : ideal;
  return Math.round(Math.max(minimum, Math.min(maximum, target)) / 1_000) * 1_000;
}

function coachInterviewContext(room, coachId, interviewId) {
  const state = room.coachEmploymentState ?? {};
  const interview = (state.interviews ?? []).find((candidate) => (
    candidate.id === interviewId && candidate.coachId === coachId
  ));
  if (!interview) return null;
  const coach = (room.coachCareerState?.coaches ?? []).find((candidate) => candidate.id === coachId) ?? {};
  const application = (state.applications ?? []).find((candidate) => candidate.id === interview.applicationId) ?? null;
  const vacancy = (state.vacancies ?? []).find((candidate) => (
    candidate.id === (interview.vacancyId ?? application?.vacancyId)
  )) ?? null;
  const club = (room.competitionCatalog ?? []).flatMap((competition) => competition.clubs ?? [])
    .find((candidate) => clubKey(candidate.id ?? candidate.code) === clubKey(interview.clubId)) ?? {};
  const finance = (room.marketState?.finances ?? room.clubFinances ?? [])
    .find((candidate) => clubKey(candidate.clubId ?? candidate.id) === clubKey(interview.clubId)) ?? {};
  const morale = (room.clubMoraleStates ?? [])
    .find((candidate) => clubKey(candidate.clubId) === clubKey(interview.clubId)) ?? {};
  const playerStates = (room.playerStates ?? []).filter((player) => (
    clubKey(player.clubId ?? player.currentClubId) === clubKey(interview.clubId)
  ));
  const ratings = playerStates
    .map((player) => Number(player.overall ?? player.rating ?? player.currentAbility))
    .filter(Number.isFinite);
  const averageOverall = ratings.length
    ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10
    : null;
  const competingOffers = (state.proposals ?? []).filter((proposal) => (
    proposal.coachId === coachId
      && proposal.status && !["rejected", "withdrawn", "expired", "accepted"].includes(proposal.status)
  )).length;
  // prepared rooms already carry the synchronized permanent career ledger.
  // Reading it here avoids cloning and rebuilding the full save for every AI turn.
  const careerHistory = {
    summary: coach.careerHistorySummary ?? {},
    spells: Array.isArray(coach.assignments) ? coach.assignments : [],
    reputationHistory: Array.isArray(coach.careerReputationHistory)
      ? coach.careerReputationHistory
      : [],
    unemploymentPeriods: Array.isArray(coach.unemploymentPeriods)
      ? coach.unemploymentPeriods
      : [],
    negotiations: Array.isArray(coach.negotiationHistory)
      ? coach.negotiationHistory
      : [],
  };
  return {
    interviewId,
    season: room.currentSeason,
    seasonYear: room.seasonYear,
    club: {
      id: interview.clubId,
      name: club.name ?? club.shortName ?? interview.clubId,
      country: club.country ?? club.nation ?? null,
      division: club.divisionName ?? club.leagueName ?? vacancy?.desiredProfile?.divisionName ?? null,
      reputation: club.reputation ?? null,
      objectives: vacancy?.desiredProfile?.objectives ?? [],
      expectation: vacancy?.desiredProfile?.expectation ?? null,
      philosophy: vacancy?.desiredProfile?.style ?? vacancy?.desiredProfile?.philosophy ?? null,
      pressure: vacancy?.desiredProfile?.pressure ?? club.pressure ?? null,
      vacancyReason: vacancy?.reason ?? null,
      finances: {
        balance: Number(finance.balance ?? finance.cash ?? 0),
        transferBudget: Number(finance.transferBudget ?? vacancy?.desiredProfile?.transferBudget ?? 0),
        stability: finance.stability ?? (Number(finance.balance ?? finance.cash ?? 0) < 0 ? "crisis" : "stable"),
      },
      squad: {
        size: playerStates.length || Number(club.squadSize ?? 0),
        averageOverall,
        averageAge: club.averageAge ?? null,
        morale: morale.score ?? morale.morale ?? null,
        strengths: vacancy?.desiredProfile?.squadSummary?.strengths ?? [],
        weaknesses: vacancy?.desiredProfile?.squadSummary?.weaknesses ?? [],
      },
    },
    coach: {
      id: coachId,
      name: coach.name ?? coachId,
      reputation: coach.marketReputation ?? coach.reputation ?? null,
      professionalTrust: coach.professionalTrust ?? null,
      experienceYears: coach.experienceYears ?? null,
      license: coach.license ?? null,
      nationality: coach.nationality ?? null,
      languages: coach.languages ?? [],
      preferredFormation: coach.preferredFormation ?? null,
      style: coach.style ?? null,
      expectedSalary: coach.expectedSalary ?? null,
      achievements: coach.achievements ?? {},
      careerHistory: {
        summary: careerHistory?.summary ?? {},
        latestSpells: (careerHistory?.spells ?? []).slice(-5).reverse(),
        reputationTrend: (careerHistory?.reputationHistory ?? []).slice(-12),
        unemploymentPeriods: (careerHistory?.unemploymentPeriods ?? []).slice(-5).reverse(),
        targetClubNegotiations: (careerHistory?.negotiations ?? [])
          .filter((entry) => clubKey(entry?.clubId ?? entry?.club?.id) === clubKey(interview.clubId))
          .slice(-10)
          .reverse(),
      },
      recentAssignments: (coach.assignments ?? []).slice(-5),
      conductHistory: (coach.careerConductHistory ?? []).slice(-10),
      previousInterviewMemories: (coach.interviewMemories ?? []).slice(-8),
      competingOffers,
    },
    application: application ? {
      message: application.message ?? null,
      shortlistScore: application.shortlistScore ?? application.interestScore ?? null,
      candidateAssessment: application.candidateAssessment ?? null,
    } : null,
    desiredProfile: vacancy?.desiredProfile ?? null,
  };
}

// Private coach career reads use only the aggregates consumed by
// buildCoachCareerSnapshot. Composite aggregates are persisted one child per
// section, therefore their child paths must be explicit here. In particular,
// do not add careerState.players, completedMatches or completedFixtureIds:
// those collections grow for the whole save and are unrelated to this DTO.
const COACH_CAREER_SNAPSHOT_PATHS = Object.freeze([
  "competitionCatalog",
  "tournamentCatalog",
  "leagueFixtureSchedule",
  "leagueMatchResults",
  "tournamentFixtureSchedule",
  "competitionSeason",
  "competitionWinners",
  "tournamentWinners",
  "seasonHistory",
  "lastCompletedRound",
  "lineups",
  "matchReadiness",
  "clubMoraleStates",
  "seasonTotalRounds",
  "totalRounds",
  "seasonEndDate",
  "seasonEndsAt",
  "currentRound",
  "clubFinances",
  "careerState.currentRound",
  "careerState.seasonEndsAt",
  "marketState.finances",
  "marketState.registrations",
  "coachCareerState.coaches",
  "coachEmploymentState.version",
  "coachEmploymentState.currentDate",
  "coachEmploymentState.marketConfig",
  "coachEmploymentState.conductConfig",
  "coachEmploymentState.contracts",
  "coachEmploymentState.proposals",
  "coachEmploymentState.vacancies",
  "coachEmploymentState.applications",
  "coachEmploymentState.interviews",
  "coachEmploymentState.appointments",
  "coachEmploymentState.evaluations",
  "coachEmploymentState.jobSecurity",
  "coachEmploymentState.guarantees",
  "coachEmploymentState.notifications",
  "coachEmploymentState.processedOperationIds",
  "coachEmploymentState.careerHistoryVersion",
  "coachEmploymentState.careerHistoryUpdatedAt",
  "professionalLifecycleState.version",
  "professionalLifecycleState.legacyMigrationVersion",
  "professionalLifecycleState.currentDate",
  "professionalLifecycleState.config",
  "professionalLifecycleState.notices",
  "professionalLifecycleState.retirements",
  "professionalLifecycleState.mutualAgreements",
  "professionalLifecycleState.transitions",
  "professionalLifecycleState.preferredStaffByCoach",
  "professionalLifecycleState.timeline",
  "professionalLifecycleState.processedOperationIds",
  "professionalLeaveState.version",
  "professionalLeaveState.currentDate",
  "professionalLeaveState.leaves",
  "professionalLeaveState.timeline",
  "professionalLeaveState.processedOperationIds",
  "clubCareerState.currentDate",
  "clubCareerState.events",
  "clubCareerState.staffSchemaVersion",
  "clubCareerState.staffMembers",
  "clubCareerState.staffCandidates",
  "clubCareerState.staffContracts",
  "clubCareerState.staffHistory",
  "clubCareerState.staffEffectsByClub",
  "clubCareerState.processedStaffOperationIds",
  "clubCareerState.staffInitializedClubIds",
  "clubCareerState.clubFinances",
  "clubCareerState.financeProfiles",
  "clubCareerState.professionalLeaves",
  "clubCareerState.staffLeaves",
]);

function coachCareerProjectionNeedsLegacyHydration(room) {
  return !room?.coachEmploymentState
    || !Array.isArray(room?.coachCareerState?.coaches)
    || Number(room?.professionalLifecycleState?.legacyMigrationVersion ?? 0) < 1
    || !Array.isArray(room?.professionalLeaveState?.leaves);
}

export class CoachCareerService {
  #store;
  #persistence;
  #mutate;
  #now;
  #coachInterviewAi;
  #callbacks;
  #rebuildSchedule;

  constructor({ store, persistence, mutate, now, coachInterviewAi, coachEmploymentCallbacks, rebuildManagedSchedule }) {
    this.#store = store;
    this.#persistence = persistence;
    this.#mutate = mutate;
    this.#now = now;
    this.#coachInterviewAi = coachInterviewAi;
    this.#callbacks = coachEmploymentCallbacks;
    this.#rebuildSchedule = rebuildManagedSchedule;
  }

  async getCoachCareerSnapshot(code, managerId) {
    let room;
    if (typeof this.#persistence.getPaths === "function") {
      room = await this.#store.requireMembershipPaths(code, managerId, COACH_CAREER_SNAPSHOT_PATHS);
      // Older saves may still require legacy markers and catalog hydration.
      // Keep the established full migration path for those saves only.
      if (coachCareerProjectionNeedsLegacyHydration(room)) {
        room = await this.#store.requireMembership(code, managerId);
      }
    } else {
      room = await this.#store.requireMembership(code, managerId);
    }
    if (room.status !== "active") {
      throw new RoomError("Inicie a temporada para abrir a carreira", "COACH_CAREER_NOT_ACTIVE", 409);
    }
    return buildCoachCareerSnapshot(room, managerId, { now: careerDateFor(room, this.#now()) });
  }

  async respondCoachProposal(code, managerId, proposalId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      if (current.status !== "active") {
        throw new RoomError("Inicie a temporada para responder propostas", "COACH_CAREER_NOT_ACTIVE", 409);
      }
      const now = careerDateFor(current, this.#now());
      const action = ({ extend: "more_time", end: "withdraw" })[input.action]
        ?? input.action;
      const prepared = ensureCoachEmploymentState(current, { now });
      const beforeClubId = prepared.managers.find((manager) => manager.id === managerId)?.clubId ?? null;
      outcome = respondCoachProposalOperation(prepared, {
        coachId: managerId,
        proposalId,
        requestId: input.requestId,
        action,
        wage: input.salary,
        durationYears: input.contractYears,
        signingBonus: input.signingBonus,
        terminationClause: input.terminationClause,
        bonuses: input.bonuses,
        transferBudget: input.transferBudget,
        objectives: input.objectives,
        specialClauses: input.specialClauses,
        ...(["counter", "guarantee"].includes(input.action) && input.guarantee ? {
          guarantee: input.guarantee,
          guarantees: [{
            description: input.guarantee,
            responsibleId: input.guaranteeResponsible ?? current.ownerId,
            responsibleRole: "board",
            dueAt: input.guaranteeDeadline ?? null,
            mandatory: input.guaranteeRequired !== false,
            blocksCompletion: input.guaranteeRequired !== false,
          }],
        } : {}),
        ...(input.action === "provide_information" ? {
          information: input.information,
          message: input.information,
        } : {}),
      }, this.#callbacks(now));
      const next = outcome.room;
      const afterClubId = next.managers.find((manager) => manager.id === managerId)?.clubId ?? null;
      if (clubKey(beforeClubId) !== clubKey(afterClubId)) this.#rebuildSchedule(next);
      return next;
    });
    return {
      room,
      coachCareer: buildCoachCareerSnapshot(room, managerId, { now: careerDateFor(room, this.#now()) }),
    };
  }

  async respondCoachBoardDecision(code, managerId, proposalId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      if (current.ownerId !== managerId) {
        throw new RoomError("Somente o criador pode responder pela diretoria", "OWNER_REQUIRED", 403);
      }
      if (current.status !== "active") {
        throw new RoomError("Inicie a temporada para responder pela diretoria", "COACH_CAREER_NOT_ACTIVE", 409);
      }
      const now = careerDateFor(current, this.#now());
      const prepared = ensureCoachEmploymentState(current, { now });
      outcome = respondCoachBoardDecisionOperation(prepared, {
        proposalId,
        requestId: input.requestId,
        action: input.action,
        responsibleId: managerId,
        responsibleRole: "board",
        responsible: input.responsible,
          justification: input.justification,
          wage: input.salary,
          durationYears: input.contractYears,
          signingBonus: input.signingBonus,
          terminationClause: input.terminationClause,
          bonuses: input.bonuses,
          transferBudget: input.transferBudget,
          objectives: input.objectives,
          specialClauses: input.specialClauses,
          informationRequest: input.informationRequest,
        guaranteeResolutions: (input.guaranteeResolutions ?? []).map((resolution) => ({
          guaranteeId: resolution.guaranteeId,
          status: resolution.status,
          effects: resolution.effects,
          responsibleId: resolution.responsible ?? managerId,
          responsibleRole: "board",
          dueAt: resolution.deadline,
          description: resolution.description,
          justification: resolution.justification,
        })),
      }, this.#callbacks(now));
      if (outcome.appointment) this.#rebuildSchedule(outcome.room);
      return outcome.room;
    });
    return {
      room,
      coachCareer: buildCoachCareerSnapshot(room, managerId, { now: careerDateFor(room, this.#now()) }),
    };
  }

  async applyForCoachVacancy(code, managerId, vacancyId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      if (current.status !== "active") {
        throw new RoomError("Inicie a temporada para enviar candidatura", "COACH_CAREER_NOT_ACTIVE", 409);
      }
      const now = careerDateFor(current, this.#now());
      const prepared = ensureCoachEmploymentState(current, { now });
      outcome = applyForCoachVacancyOperation(prepared, {
        coachId: managerId,
        vacancyId,
        requestId: input.requestId,
        message: input.message,
      }, this.#callbacks(now));
      return outcome.room;
    });
    return {
      room,
      coachCareer: buildCoachCareerSnapshot(room, managerId, { now: careerDateFor(room, this.#now()) }),
    };
  }

  async respondCoachInterview(code, managerId, interviewId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      if (current.status !== "active") {
        throw new RoomError("Inicie a temporada para responder entrevistas", "COACH_CAREER_NOT_ACTIVE", 409);
      }
      const now = careerDateFor(current, this.#now());
      const prepared = ensureCoachEmploymentState(current, { now });
      const interview = prepared.coachEmploymentState.interviews.find(
        (candidate) => candidate.id === interviewId && candidate.coachId === managerId,
      );
      if (!interview) {
        throw new RoomError("Entrevista nao encontrada", "COACH_INTERVIEW_NOT_FOUND", 404);
      }
      const assessment = coachInterviewDecision(prepared, managerId, interviewId, input.answers);
      outcome = respondCoachInterviewOperation(prepared, {
        coachId: managerId,
        interviewId,
        requestId: input.requestId,
        answers: input.answers,
        decision: assessment.decision,
        wage: expectedCoachSalary(prepared, managerId, interview.clubId),
        durationYears: 2,
        terminationClause: expectedCoachSalary(prepared, managerId, interview.clubId) * 6,
      }, this.#callbacks(now));
      return outcome.room;
    });
    return {
      room,
      coachCareer: buildCoachCareerSnapshot(room, managerId, { now: careerDateFor(room, this.#now()) }),
    };
  }

  async startCoachInterview(code, managerId, interviewId, input) {
    const snapshot = await this.#store.requireMembership(code, managerId);
    if (snapshot.status !== "active") {
      throw new RoomError("Inicie a temporada para realizar entrevistas", "COACH_CAREER_NOT_ACTIVE", 409);
    }
    const previewNow = careerDateFor(snapshot, this.#now());
    const prepared = ensureCoachEmploymentState(snapshot, { now: previewNow });
    const interview = prepared.coachEmploymentState.interviews.find((candidate) => (
      candidate.id === interviewId && candidate.coachId === managerId
    ));
    if (!interview) throw new RoomError("Entrevista nao encontrada", "COACH_INTERVIEW_NOT_FOUND", 404);
    if ((interview.transcript ?? []).length > 0) {
      return {
        room: prepared,
        coachCareer: buildCoachCareerSnapshot(prepared, managerId, { now: previewNow }),
      };
    }
    const context = coachInterviewContext(prepared, managerId, interviewId);
    const generated = await this.#coachInterviewAi.generateTurn({
      phase: "start",
      interviewId,
      depth: input.depth,
      context,
      transcript: [],
    }, { uid: managerId });
    let outcome;
    const expectedRevision = Number(interview.revision ?? 0);
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      const now = careerDateFor(current, this.#now());
      const normalized = ensureCoachEmploymentState(current, { now });
      outcome = applyCoachInterviewGeneratedTurn(normalized, {
        phase: "start",
        coachId: managerId,
        interviewId,
        requestId: input.requestId,
        expectedRevision,
        depth: input.depth,
        contextSnapshot: context,
        generated,
      }, this.#callbacks(now));
      return outcome.room;
    });
    return {
      room,
      coachCareer: buildCoachCareerSnapshot(room, managerId, { now: careerDateFor(room, this.#now()) }),
    };
  }

  async answerCoachInterviewTurn(code, managerId, interviewId, input) {
    const snapshot = await this.#store.requireMembership(code, managerId);
    if (snapshot.status !== "active") {
      throw new RoomError("Inicie a temporada para realizar entrevistas", "COACH_CAREER_NOT_ACTIVE", 409);
    }
    const previewNow = careerDateFor(snapshot, this.#now());
    const prepared = ensureCoachEmploymentState(snapshot, { now: previewNow });
    const interview = prepared.coachEmploymentState.interviews.find((candidate) => (
      candidate.id === interviewId && candidate.coachId === managerId
    ));
    if (!interview) throw new RoomError("Entrevista nao encontrada", "COACH_INTERVIEW_NOT_FOUND", 404);
    if (!(interview.transcript ?? []).length || !interview.currentQuestionId) {
      throw new RoomError("Inicie a entrevista antes de responder", "COACH_INTERVIEW_NOT_STARTED", 409);
    }
    const expectedRevision = input.expectedRevision ?? Number(interview.revision ?? 0);
    const expectedQuestionId = input.currentQuestionId ?? interview.currentQuestionId;
    const context = interview.contextSnapshot ?? coachInterviewContext(prepared, managerId, interviewId);
    const generated = await this.#coachInterviewAi.generateTurn({
      phase: "turn",
      interviewId,
      depth: interview.depth ?? "standard",
      context,
      transcript: interview.transcript ?? [],
      candidateMessage: input.message,
    }, { uid: managerId });
    let outcome;
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      const now = careerDateFor(current, this.#now());
      const normalized = ensureCoachEmploymentState(current, { now });
      outcome = applyCoachInterviewGeneratedTurn(normalized, {
        phase: "answer",
        coachId: managerId,
        interviewId,
        requestId: input.requestId,
        expectedRevision,
        expectedQuestionId,
        candidateMessage: input.message,
        generated,
      }, this.#callbacks(now));
      return outcome.room;
    });
    return {
      room,
      coachCareer: buildCoachCareerSnapshot(room, managerId, { now: careerDateFor(room, this.#now()) }),
    };
  }

  async renewCoachContract(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      if (current.status !== "active") {
        throw new RoomError("Inicie a temporada para renovar o contrato", "COACH_CAREER_NOT_ACTIVE", 409);
      }
      const now = careerDateFor(current, this.#now());
      const prepared = ensureCoachEmploymentState(current, { now });
      const activeContract = prepared.coachEmploymentState.contracts.find(
        (contract) => contract.coachId === managerId && contract.status === "active",
      );
      if (!activeContract) {
        throw new RoomError("Contrato ativo nao encontrado", "COACH_ACTIVE_CONTRACT_NOT_FOUND", 409);
      }
      const requestedWage = input.salary ?? activeContract.wage;
      const activeRenewal = prepared.coachEmploymentState.proposals.find((proposal) => (
        proposal.kind === "renewal"
          && proposal.sourceContractId === activeContract.id
          && !["accepted", "rejected", "expired", "withdrawn", "encerrado_vaga_preenchida"].includes(proposal.status)
      ));
      if (activeRenewal) {
        throw new RoomError("Ja existe uma renovacao em negociacao", "COACH_RENEWAL_ALREADY_ACTIVE", 409, {
          proposalId: activeRenewal.id,
        });
      }
      outcome = renewCoachContractOperation(prepared, {
        coachId: managerId,
        clubId: activeContract.clubId,
        requestId: input.requestId,
        kind: "renewal",
        initiatedBy: "coach",
        sourceContractId: activeContract.id,
        durationYears: input.years,
        wage: requestedWage,
        terminationClause: input.terminationClause ?? activeContract.terminationClause,
        signingBonus: input.signingBonus,
        bonuses: input.bonuses ?? activeContract.bonuses,
        transferBudget: input.transferBudget,
        objectives: input.objectives ?? activeContract.objectives,
        specialClauses: input.specialClauses,
        responseDays: prepared.coachEmploymentState.marketConfig?.proposalValidityDays ?? 10,
        boardExpectation: "Renovar o projeto esportivo sem romper o vinculo atual",
        clubSituation: "Contrato vigente em fase de renovacao",
        message: "Pedido de renovacao aberto para negociacao.",
        reason: "renewal_requested_by_coach",
      }, this.#callbacks(now));
      return outcome.room;
    });
    return {
      room,
      coachCareer: buildCoachCareerSnapshot(room, managerId, { now: careerDateFor(room, this.#now()) }),
    };
  }

  async resignCoach(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      if (current.status !== "active") {
        throw new RoomError("Inicie a temporada para encerrar o vinculo", "COACH_CAREER_NOT_ACTIVE", 409);
      }
      const now = careerDateFor(current, this.#now());
      const prepared = ensureCoachEmploymentState(current, { now });
      const activeContract = prepared.coachEmploymentState.contracts.find(
        (contract) => contract.coachId === managerId && contract.status === "active",
      );
      outcome = resignCoachOperation(prepared, {
        coachId: managerId,
        requestId: input.requestId,
        reasonCode: input.reasonCode,
        reason: input.reason,
        compensation: activeContract?.terminationClause ?? 0,
      }, this.#callbacks(now));
      this.#rebuildSchedule(outcome.room);
      return outcome.room;
    });
    return {
      room,
      coachCareer: buildCoachCareerSnapshot(room, managerId, { now: careerDateFor(room, this.#now()) }),
    };
  }

  async setCoachJobSearch(code, managerId, input) {
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      if (current.status !== "active") {
        throw new RoomError("Inicie a temporada para procurar emprego", "COACH_CAREER_NOT_ACTIVE", 409);
      }
      const now = careerDateFor(current, this.#now());
      const next = ensureCoachEmploymentState(current, { now });
      next.coachEmploymentState.jobSearchByCoachId = {
        ...(next.coachEmploymentState.jobSearchByCoachId ?? {}),
        [managerId]: {
          active: input.active !== false,
          updatedAt: now,
          requestId: input.requestId,
        },
      };
      const progressed = processCoachEmploymentDate(next, now, {
        ...this.#callbacks(now),
        minimumVacancyDays: 7,
      });
      return progressed.room;
    });
    return {
      room,
      coachCareer: buildCoachCareerSnapshot(room, managerId, { now: careerDateFor(room, this.#now()) }),
    };
  }
}
