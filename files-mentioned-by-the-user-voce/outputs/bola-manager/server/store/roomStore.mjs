import { randomInt, randomUUID } from "node:crypto";
import { applyScoutingAction, scoutingClub, scoutingError, scoutingNeedsPlayer, scoutingPlayer, scoutingSnapshot, SCOUTING_READ_PATHS, SCOUTING_WRITE_PATHS } from "../game/scouting.mjs";
import { buildClubTacticalStudy, startTacticalStudy, studyKnowledge, tacticalStudyContext, TACTICAL_STUDY_PATHS } from "../game/clubTacticalStudy.mjs";
import { assertHistoryId, assertMatchHistoryCapacity, enqueueMatchHistory, flushMatchHistory, historyPage, historyPageOptions, initializeMatchHistory, MATCH_HISTORY_PATHS } from "./matchHistory.mjs";
import {
  createLeagueFixtureSchedule,
  createFixtureSchedule,
  createUnifiedFixtureSchedule,
  coordinateRoomFixtureCalendar,
  ensureFixtureSchedule,
  FIXTURE_SCHEDULE_VERSION,
  fixtureIdsEqual,
  hydrateLeagueFixture,
  hydrateCompetitionFixture,
  seasonCalendarStart,
} from "../game/fixtures.mjs";
import { aiFixturesBeforeNextManaged, pendingManagedFixtures } from "../game/officialCalendar.mjs";
import { runRecordedAiMarketTick, publishAiMarketTick, publishAiMarketCommitFailure } from "../game/aiMarketTick.mjs";
import { roomCreationOperation, roomCreationError } from "./roomCreationOperation.mjs";
import { careerHasNextSeason, ensureCareerState } from "../game/career.mjs";
import {
  applyCoachInterviewGeneratedTurn,
  applyForCoachVacancy as applyForCoachVacancyOperation,
  confirmInterimCoach,
  ensureCoachEmploymentState,
  processCoachEmploymentDate,
  renewCoachContract as renewCoachContractOperation,
  resignCoach as resignCoachOperation,
  respondCoachBoardDecision as respondCoachBoardDecisionOperation,
  respondCoachInterview as respondCoachInterviewOperation,
  respondCoachProposal as respondCoachProposalOperation,
} from "../game/coachEmployment.mjs";
import { fulfillCoachStaffPackageCommitments } from "../game/coachStaffPackageFulfillment.mjs";
import { createCoachInterviewAiService } from "../services/coachInterviewAi.mjs";
import { buildCoachCareerSnapshot } from "../services/coachCareerSnapshot.mjs";
import {
  createCompetitionSeason,
  recordCompetitionSeasonResult,
} from "../game/competitionEngine.mjs";
import {
  applyTrainingCycle,
  generateYouthIntake,
  normalizeCareerPlayer,
  normalizeTrainingPlans,
  processCareerSeasonTransition,
  promoteYouthPlayer,
  resolveContractCycle,
} from "../game/playerCareerEngine.mjs";
import { transitionLeagueDivisions } from "../game/leagueSeasonTransition.mjs";
import {
  buildLeagueRankingTimeline,
  compactLeagueRankingTimeline,
} from "../game/rankingTimeline.mjs";
import {
  simulateAiFixture,
  validateAiFixtureRosterCoverage,
} from "../game/aiMatchSimulation.mjs";
import { calculateTeamCohesion } from "../game/teamCohesion.mjs";
import {
  applyMatchPlayerProgression,
} from "../game/playerProgression.mjs";
import {
  advanceMarketLoans,
  cancelListing as cancelMarketListing,
  createListing as createMarketListing,
  createOffer as createMarketOffer,
  ensureMarketState,
  exerciseLoanOption as exerciseMarketLoanOption,
  marketSnapshot,
  placeBid as placeMarketBid,
  processScheduledTransfers,
  reconcileMarketCareerState,
  registrationForPlayer as marketRegistrationForPlayer,
  respondOffer as respondMarketOffer,
  returnLoansForSeason,
  runAiTransferTick,
  settleExpiredMarket,
} from "../game/market.mjs";
import { listRoomPlayers } from "../game/roomRoster.mjs";
import {
  basePlayerMoraleScore,
  clampMoraleScore,
  clampPlayerMoraleDelta,
  resolvePressConferenceAnswers,
  sectorForPosition,
} from "../services/pressConference.mjs";
import { catalogForOwner } from "./catalogScope.mjs";
import {
  applyClubRecoveryEffects,
  awardCompletedCompetitionPrizes,
  clubCareerEffectsByClub,
  clubCareerPerformanceEffects,
  careerDateFor,
  ensureClubCareerSystems,
  fireClubStaff as fireClubStaffOperation,
  hireClubStaff as hireClubStaffOperation,
  markClubCareerNewsRead,
  processClubCareerDate,
  recordCareerTransitionEvents,
  recordClubCareerEvent,
  recordClubMatchday,
  recordPlayerAvailabilityEvents,
  renewClubStaff as renewClubStaffOperation,
  startClubUpgrade,
  syncMarketCareerSideEffects,
} from "../game/clubCareerSystem.mjs";
import { creditFinance, debitFinance } from "../game/clubFinance.mjs";
import { postFinancialTransaction } from "../game/clubFinance.mjs";
import {
  endProfessionalNoticeEarly,
  ensureProfessionalLifecycleState,
  hireCoachStaffPackage,
  processProfessionalLifecycleDate,
  professionalLifecycleSnapshot,
  proposeMutualSeparation,
  respondMutualSeparation,
  scheduleProfessionalRetirement,
  setCoachPreferredStaff,
  startProfessionalNotice,
  updateProfessionalRetirement,
} from "../game/professionalLifecycle.mjs";
import { runAiProfessionalLifecycleTick } from "../game/professionalLifecycleAi.mjs";
import {
  endProfessionalLeave,
  ensureProfessionalLeaveState,
  processProfessionalLeaveDate,
  startProfessionalLeave,
} from "../game/professionalLeave.mjs";
import { setStaffCoachLink } from "../game/staffEngine.mjs";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_CAREER_ROSTER_POLICY = Object.freeze({
  maxAttempts: 3,
  timeoutMs: 5_000,
  retryDelayMs: 50,
});

function clubKey(value) {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

function replaceRoom(target, source) {
  for (const field of Object.keys(target)) {
    if (!(field in source)) delete target[field];
  }
  Object.assign(target, source);
  return target;
}

const PRIVATE_COACH_EVENT_TYPES = new Set([
  "COACH_PROPOSAL_CREATED",
  "COACH_PROPOSAL_COUNTERED",
  "COACH_PROPOSAL_EXTENDED",
  "COACH_PROPOSAL_ACCEPTED",
  "COACH_APPLICATION_SUBMITTED",
  "COACH_INTERVIEW_COMPLETED",
  "COACH_INTERVIEW_STARTED",
  "COACH_INTERVIEW_TURN_RECORDED",
  "COACH_INTERVIEW_ACCEPTED",
  "COACH_INTERVIEW_REJECTED",
  "COACH_INTERVIEW_EXPIRED",
  "COACH_EVALUATED",
]);

const FAILED_COACH_NEGOTIATION_TYPES = new Set([
  "COACH_PROPOSAL_REJECTED",
  "COACH_PROPOSAL_WITHDRAWN",
  "COACH_PROPOSAL_EXPIRED",
]);

function publicCoachEventType(event) {
  if (event.type === "COACH_CONTRACT_EXPIRED") return "COACH_BECAME_UNEMPLOYED";
  if (event.type === "COACH_REPLACED") return "COACH_DISMISSED";
  if (FAILED_COACH_NEGOTIATION_TYPES.has(event.type)) return "COACH_NEGOTIATION_FAILED";
  if (
    event.type === "COACH_APPOINTED"
    && event.relatedClubId
    && clubKey(event.relatedClubId) !== clubKey(event.clubId)
  ) return "COACH_CHANGED_CLUB";
  return event.type;
}

function coachEventReason(event) {
  const supplied = String(event.payload?.reason ?? "").trim();
  if (supplied) return supplied;
  if (event.type === "COACH_PROPOSAL_REJECTED") return "proposta recusada";
  if (event.type === "COACH_PROPOSAL_WITHDRAWN") return "negociacao encerrada";
  if (event.type === "COACH_PROPOSAL_EXPIRED") return "prazo da proposta encerrado";
  if (event.type === "COACH_CONTRACT_EXPIRED") return "fim do contrato";
  return null;
}

function publicCoachCareerEvent(room, event, now) {
  const type = publicCoachEventType(event);
  const changedClub = type === "COACH_CHANGED_CLUB";
  return recordClubCareerEvent(room, {
    id: `coach-employment:${event.operationId}:${type}`,
    operationId: event.operationId,
    type,
    occurredAt: event.occurredAt ?? now,
    seasonNumber: room.currentSeason,
    aggregateType: "coach",
    aggregateId: event.coachId,
    coachId: event.coachId,
    contractId: event.contractId,
    vacancyId: event.vacancyId,
    clubIds: changedClub
      ? [event.relatedClubId, event.clubId].filter(Boolean)
      : [event.clubId, event.relatedClubId].filter(Boolean),
    payload: {
      coachId: event.coachId,
      clubId: event.clubId,
      relatedClubId: event.relatedClubId,
      ...(changedClub ? {
        fromClubId: event.relatedClubId,
        toClubId: event.clubId,
      } : {}),
      reason: coachEventReason(event),
      status: event.type,
      round: room.lastCompletedRound?.round ?? null,
    },
  });
}

function recordCoachSearchStarted(room, event, now) {
  if (!event.vacancyId) return null;
  const vacancy = (room.coachEmploymentState?.vacancies ?? [])
    .find((candidate) => candidate.id === event.vacancyId);
  if (!vacancy) return null;
  const operationId = `coach-search:${vacancy.id}`;
  return recordClubCareerEvent(room, {
    id: `coach-employment:${vacancy.id}:COACH_SEARCH_STARTED`,
    operationId,
    type: "COACH_SEARCH_STARTED",
    occurredAt: vacancy.openedAt ?? event.occurredAt ?? now,
    seasonNumber: room.currentSeason,
    aggregateType: "club",
    aggregateId: vacancy.clubId,
    vacancyId: vacancy.id,
    clubIds: [vacancy.clubId].filter(Boolean),
    payload: {
      clubId: vacancy.clubId,
      vacancyId: vacancy.id,
      reason: vacancy.reason ?? coachEventReason(event),
    },
  });
}

function coachEmploymentCallbacks(now) {
  return {
    now,
    credit: (room, transaction) => creditFinance(room, {
      ...transaction,
      originId: transaction.originId ?? transaction.operationId,
      occurredAt: transaction.occurredAt ?? now,
    }),
    debit: (room, transaction) => debitFinance(room, {
      ...transaction,
      originId: transaction.originId ?? transaction.operationId,
      occurredAt: transaction.occurredAt ?? now,
    }),
    recordEvent: (room, event) => {
      if (PRIVATE_COACH_EVENT_TYPES.has(event.type)) return null;
      const result = publicCoachCareerEvent(room, event, now);
      recordCoachSearchStarted(room, event, now);
      return result;
    },
  };
}

function staffLifecycleEventInput(event) {
  const professionalType = event.professionalType
    ?? (event.coachId ? "coach" : "staff");
  const professionalId = event.professionalId
    ?? event.coachId
    ?? event.staffId;
  return {
    ...event,
    aggregateType: professionalType,
    aggregateId: professionalId,
    clubIds: [event.clubId, event.relatedClubId].filter(Boolean),
    payload: {
      ...event.metadata,
      professionalType,
      professionalId,
      ...(professionalType === "staff" ? { staffId: professionalId } : {}),
      ...(professionalType === "coach" ? { coachId: professionalId } : {}),
      clubId: event.clubId,
      relatedClubId: event.relatedClubId,
      contractId: event.contractId,
      amount: event.amount,
    },
  };
}

function professionalLifecycleCallbacks(now) {
  return {
    ...coachEmploymentCallbacks(now),
    postFinancialTransaction: (room, transaction) => postFinancialTransaction(room, {
      ...transaction,
      direction: transaction.direction ?? transaction.type,
      originId: transaction.originId ?? transaction.operationId ?? transaction.id,
      occurredAt: transaction.occurredAt ?? transaction.date ?? now,
      metadata: {
        ...(transaction.metadata ?? {}),
        ...(transaction.staffId ? { staffId: transaction.staffId } : {}),
      },
    }),
    recordCareerEvent: (room, event) => recordClubCareerEvent(
      room,
      staffLifecycleEventInput(event),
    ),
  };
}

function syncProfessionalLifecycleTimeline(room) {
  for (const entry of room.professionalLifecycleState?.timeline ?? []) {
    const professionalType = entry.professionalType ?? "professional";
    const professionalId = entry.professionalId ?? entry.coachId ?? null;
    recordClubCareerEvent(room, {
      id: `professional-lifecycle:${entry.id}`,
      operationId: entry.operationId ?? entry.id,
      type: entry.type,
      occurredAt: entry.occurredAt,
      seasonNumber: room.currentSeason,
      aggregateType: professionalType,
      aggregateId: professionalId,
      coachId: professionalType === "coach" ? professionalId : null,
      staffId: professionalType === "staff" ? professionalId : null,
      clubIds: [entry.clubId].filter(Boolean),
      payload: {
        professionalType,
        professionalId,
        coachId: professionalType === "coach" ? professionalId : null,
        staffId: professionalType === "staff" ? professionalId : null,
        clubId: entry.clubId,
        lifecycleId: entry.lifecycleId,
        role: entry.role,
        initiatedBy: entry.initiatedBy,
        reason: entry.reason,
        financialImpact: entry.financialImpact,
        reputationImpact: entry.reputationImpact,
        relatedProfessionalIds: entry.relatedProfessionalIds ?? [],
        ...(entry.metadata ?? {}),
      },
    });
  }
}

function verifiedCoachNoticeSuccessor(room, notice, requestedCoachId = null, statuses = ["scheduled", "active"]) {
  if (!notice || notice.professionalType !== "coach") return null;
  const allowedStatuses = new Set(statuses);
  const appointments = room.coachEmploymentState?.appointments ?? [];
  const contracts = room.coachEmploymentState?.contracts ?? [];
  const successor = appointments.find((appointment) => {
    if (clubKey(appointment.clubId) !== clubKey(notice.clubId)) return false;
    if (String(appointment.coachId) === String(notice.professionalId)) return false;
    if (appointment.role !== "head_coach" || !allowedStatuses.has(appointment.status)) return false;
    if (requestedCoachId && String(appointment.coachId) !== String(requestedCoachId)) return false;
    return contracts.some((contract) => (
      String(contract.id) === String(appointment.contractId)
        && String(contract.coachId) === String(appointment.coachId)
        && clubKey(contract.clubId) === clubKey(appointment.clubId)
        && allowedStatuses.has(contract.status)
    ));
  });
  if (!successor) {
    throw new RoomError(
      requestedCoachId
        ? "O substituto informado nao possui nomeacao e contrato validos"
        : "Contrate o proximo treinador antes de encerrar o aviso",
      requestedCoachId
        ? "PROFESSIONAL_NOTICE_SUCCESSOR_INVALID"
        : "PROFESSIONAL_NOTICE_SUCCESSOR_REQUIRED",
      409,
      { noticeId: notice.id, requestedCoachId: requestedCoachId ?? null },
    );
  }
  return successor;
}

function assertNoticeLongTermDecisionApproved(room, managerId, clubId, input, decision) {
  const notice = (room.professionalLifecycleState?.notices ?? []).find((candidate) => (
    candidate.status === "active"
      && candidate.professionalType === "coach"
      && String(candidate.professionalId) === String(managerId)
      && clubKey(candidate.clubId) === clubKey(clubId)
      && candidate.longTermDecisionApprovalRequired !== false
  ));
  if (!notice || input.noticeApproval === true) return;
  throw new RoomError(
    `A diretoria precisa aprovar ${decision} durante o aviso`,
    "PROFESSIONAL_NOTICE_BOARD_APPROVAL_REQUIRED",
    409,
  );
}

function reconcileCoachNoticesWithAppointments(room, nowValue) {
  const state = room.professionalLifecycleState;
  if (!state || !Array.isArray(state.notices) || !room.coachEmploymentState) return false;
  const now = new Date(nowValue).toISOString();
  let changed = false;
  for (const notice of state.notices.filter((candidate) => (
    candidate.professionalType === "coach" && candidate.status === "active"
  ))) {
    const departingStillActive = (room.coachEmploymentState.appointments ?? []).some((appointment) => (
      appointment.status === "active"
        && appointment.role === "head_coach"
        && String(appointment.coachId) === String(notice.professionalId)
        && clubKey(appointment.clubId) === clubKey(notice.clubId)
    ));
    if (departingStillActive) continue;
    let successor;
    try {
      successor = verifiedCoachNoticeSuccessor(room, notice, null, ["active"]);
    } catch (error) {
      if (error?.code === "PROFESSIONAL_NOTICE_SUCCESSOR_REQUIRED") continue;
      throw error;
    }
    const operationId = `professional-notice-auto-successor:${notice.id}:${successor.id}`;
    if ((state.processedOperationIds ?? []).includes(operationId)) continue;
    const early = new Date(now).getTime() < new Date(notice.expectedEndDate).getTime();
    const remainingNoticeDays = early
      ? Math.max(0, Math.ceil((new Date(notice.expectedEndDate).getTime() - new Date(now).getTime()) / 86_400_000))
      : 0;
    notice.status = early ? "ended_early" : "completed";
    notice.endedAt = now;
    notice.endReason = "successor_started";
    notice.substituteCoachId = successor.coachId;
    notice.updatedAt = now;
    state.timeline ??= [];
    state.timeline.push({
      id: `professional-timeline:${operationId}`,
      operationId,
      lifecycleId: notice.id,
      type: early ? "PROFESSIONAL_NOTICE_ENDED_EARLY" : "PROFESSIONAL_NOTICE_COMPLETED",
      professionalType: "coach",
      professionalId: notice.professionalId,
      role: notice.role,
      clubId: notice.clubId,
      startedAt: notice.startDate,
      endedAt: now,
      occurredAt: now,
      initiatedBy: notice.initiatedBy,
      reason: notice.endReason,
      financialImpact: 0,
      reputationImpact: 0,
      relatedProfessionalIds: [successor.coachId],
      metadata: {
        remainingNoticeDays,
        successorAppointmentId: successor.id,
        automatic: true,
        departureKind: notice.initiatedBy === "club"
          ? "dismissal"
          : notice.initiatedBy === "professional" ? "resignation" : "mutual_agreement",
      },
    });
    state.processedOperationIds = [...new Set([
      ...(state.processedOperationIds ?? []),
      operationId,
    ])];
    changed = true;
  }
  if (changed) syncProfessionalLifecycleTimeline(room);
  return changed;
}

function normalizedProfessionalAffiliation(value) {
  if (value === "personal_staff") return "personal_team";
  if (value === "recommended") return "coach_recommended";
  return value;
}

function lifecycleRecordFromOutcome(outcome) {
  return outcome?.notice
    ?? outcome?.retirement
    ?? outcome?.agreement
    ?? outcome?.leave
    ?? outcome?.record
    ?? outcome?.member
    ?? null;
}

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

function positiveInteger(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function assignmentIncludesRound(assignment, seasonNumber, round) {
  const startedSeason = positiveInteger(assignment?.startedSeason);
  const startedRound = positiveInteger(assignment?.startedRound);
  if (seasonNumber < startedSeason || (seasonNumber === startedSeason && round < startedRound)) {
    return false;
  }
  if (assignment?.endedSeason === null || assignment?.endedSeason === undefined) return true;
  const endedSeason = positiveInteger(assignment.endedSeason);
  const endedRound = Math.max(0, Math.trunc(Number(assignment?.endedRound) || 0));
  return seasonNumber < endedSeason || (seasonNumber === endedSeason && round <= endedRound);
}

function coachAtClubRound(room, clubId, seasonNumber, round) {
  const matching = [];
  for (const coach of room?.coachCareerState?.coaches ?? []) {
    for (const assignment of coach?.assignments ?? []) {
      if (clubKey(assignment?.clubId) !== clubKey(clubId)) continue;
      if (!assignmentIncludesRound(assignment, seasonNumber, round)) continue;
      matching.push({ coach, assignment });
    }
  }
  matching.sort((left, right) => (
    positiveInteger(right.assignment?.startedSeason) - positiveInteger(left.assignment?.startedSeason)
      || positiveInteger(right.assignment?.startedRound) - positiveInteger(left.assignment?.startedRound)
      || String(left.coach?.id ?? "").localeCompare(String(right.coach?.id ?? ""), "pt-BR")
  ));
  return String(matching[0]?.coach?.id ?? "").trim() || null;
}

function decisiveTournamentFixture(room, winner) {
  const tournamentId = clubKey(winner?.tournamentId);
  const winnerClubId = clubKey(winner?.clubId);
  if (!tournamentId || !winnerClubId) return null;
  return [...(room?.competitionSeason?.fixtures ?? [])]
    .filter((fixture) => (
      clubKey(fixture?.tournamentId ?? fixture?.competitionId) === tournamentId
        && (fixture?.status === "completed" || fixture?.completedAt || fixture?.result)
        && (clubKey(fixture?.homeClubId) === winnerClubId
          || clubKey(fixture?.awayClubId) === winnerClubId)
    ))
    .sort((left, right) => (
      positiveInteger(right?.calendarRound ?? right?.round) - positiveInteger(left?.calendarRound ?? left?.round)
        || Date.parse(right?.completedAt ?? "") - Date.parse(left?.completedAt ?? "")
        || String(right?.competitionFixtureId ?? right?.id ?? "")
          .localeCompare(String(left?.competitionFixtureId ?? left?.id ?? ""), "pt-BR")
    ))[0] ?? null;
}

function archivedClubName(room, clubId) {
  const name = clubNameFor(room, clubId);
  return name && clubKey(name) !== clubKey(clubId) ? name : null;
}

/** Preserve who actually won each tournament even if the coach changes later. */
export function archiveTournamentWinners(room) {
  const seasonNumber = positiveInteger(room?.currentSeason);
  return structuredClone(room?.competitionSeason?.winners ?? []).map((winner) => {
    const fixture = decisiveTournamentFixture(room, winner);
    const tournament = (room?.tournamentCatalog ?? []).find((candidate) => (
      clubKey(candidate?.id) === clubKey(winner?.tournamentId)
    ));
    if (!fixture) {
      const clubName = archivedClubName(room, winner.clubId);
      return {
        ...winner,
        ...(clubName ? { clubName } : {}),
        ...(tournament?.format ? { format: tournament.format } : {}),
      };
    }
    const wonRound = positiveInteger(fixture?.calendarRound ?? fixture?.round);
    const managerId = coachAtClubRound(room, winner.clubId, seasonNumber, wonRound);
    const finalistClubIds = [...new Set([
      fixture?.homeClubId,
      fixture?.awayClubId,
    ].map((clubId) => String(clubId ?? "").trim()).filter(Boolean))];
    const runnerUpClubId = finalistClubIds.find((clubId) => (
      clubKey(clubId) !== clubKey(winner.clubId)
    )) ?? null;
    return {
      ...winner,
      ...(managerId ? { managerId } : {}),
      ...(archivedClubName(room, winner.clubId)
        ? { clubName: archivedClubName(room, winner.clubId) }
        : {}),
      wonRound,
      wonAt: fixture.completedAt ?? fixture.result?.completedAt ?? null,
      ...(tournament?.format ? { format: tournament.format } : {}),
      finalistClubIds,
      runnerUpClubId,
    };
  });
}

function archivedManagerMatch(room, fixture, result) {
  const fixtureId = String(fixture?.leagueFixtureId
    ?? fixture?.competitionFixtureId
    ?? fixture?.id
    ?? "").trim();
  const competitionId = String(fixture?.leagueId
    ?? fixture?.tournamentId
    ?? fixture?.competitionId
    ?? "").trim();
  const homeClubId = String(fixture?.homeClubId ?? "").trim();
  const awayClubId = String(fixture?.awayClubId ?? "").trim();
  const score = scorePair(result?.score);
  if (!fixtureId || !competitionId || !homeClubId || !awayClubId || score.length < 2) return null;
  const round = positiveInteger(fixture?.calendarRound ?? fixture?.round);
  const seasonNumber = positiveInteger(room?.currentSeason);
  const homeClubName = archivedClubName(room, homeClubId);
  const awayClubName = archivedClubName(room, awayClubId);
  return {
    fixtureId,
    competitionId,
    round,
    completedAt: fixture?.completedAt ?? result?.completedAt ?? fixture?.scheduledAt ?? null,
    homeClubId,
    awayClubId,
    ...(homeClubName ? { homeClubName } : {}),
    ...(awayClubName ? { awayClubName } : {}),
    homeManagerId: coachAtClubRound(room, homeClubId, seasonNumber, round),
    awayManagerId: coachAtClubRound(room, awayClubId, seasonNumber, round),
    score,
  };
}

/** Compact real results for career campaigns and coach-versus-coach history. */
export function archiveManagerMatchHistory(room) {
  const leagueResults = new Map((room?.leagueMatchResults ?? []).map((result) => [
    clubKey(result?.leagueFixtureId ?? result?.fixtureId),
    result,
  ]));
  const leagueMatches = (room?.leagueFixtureSchedule ?? []).flatMap((fixture) => {
    const result = leagueResults.get(clubKey(fixture?.leagueFixtureId ?? fixture?.fixtureId));
    const match = result ? archivedManagerMatch(room, fixture, result) : null;
    return match ? [match] : [];
  });
  const tournamentMatches = (room?.competitionSeason?.fixtures ?? []).flatMap((fixture) => {
    const result = fixture?.result;
    const match = result && (fixture?.status === "completed" || fixture?.completedAt)
      ? archivedManagerMatch(room, fixture, result)
      : null;
    return match ? [match] : [];
  });
  return [...new Map([...leagueMatches, ...tournamentMatches]
    .map((match) => [clubKey(match.fixtureId), match])).values()];
}

function fixtureResultKey(value) {
  return String(value ?? "").trim().toLocaleLowerCase("pt-BR");
}

function scorePair(value) {
  if (!Array.isArray(value) || value.length < 2) return [0, 0];
  return value.slice(0, 2).map((score) => Math.max(0, Math.trunc(Number(score) || 0)));
}

function possessionPair(value) {
  const source = Array.isArray(value)
    ? value
    : [value?.home?.possession, value?.away?.possession];
  if (source.length < 2) return null;
  const pair = source.slice(0, 2).map(Number);
  if (pair.some((item) => !Number.isFinite(item) || item < 0 || item > 100)) return null;
  return pair.map((item) => Math.round(item * 10) / 10);
}

function textKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .trim()
    .toLocaleUpperCase("pt-BR");
}

async function within(milliseconds, operation) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("CATALOG_TIMEOUT")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizedCareerRosterPolicy(value = {}) {
  const positiveInteger = (candidate, fallback, maximum) => {
    const parsed = Number(candidate);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
  };
  const nonNegativeInteger = (candidate, fallback, maximum) => {
    const parsed = Number(candidate);
    return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
  };
  return {
    maxAttempts: positiveInteger(value.maxAttempts, DEFAULT_CAREER_ROSTER_POLICY.maxAttempts, 5),
    timeoutMs: positiveInteger(value.timeoutMs, DEFAULT_CAREER_ROSTER_POLICY.timeoutMs, 30_000),
    retryDelayMs: nonNegativeInteger(value.retryDelayMs, DEFAULT_CAREER_ROSTER_POLICY.retryDelayMs, 2_000),
  };
}

function careerRosterLoadFailure(message, code, status, transient = false) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.transient = transient;
  return error;
}

function transientCareerRosterFailure(error) {
  if (error?.transient === true) return true;
  const code = String(error?.code ?? error?.message ?? "").toLocaleUpperCase("pt-BR");
  const status = Number(error?.status);
  return status >= 500
    || code.includes("TIMEOUT")
    || code.includes("UNAVAILABLE")
    || code.includes("DEADLINE")
    || code.includes("RESOURCE_EXHAUSTED")
    || code.includes("ECONNRESET")
    || code.includes("ETIMEDOUT");
}

function waitFor(milliseconds) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function marketOutcomeForViewer(snapshot, outcome = {}) {
  const listingId = outcome.listing?.id ?? null;
  const offerId = outcome.offer?.id ?? null;
  const transactionId = outcome.transaction?.id ?? null;
  return {
    snapshot,
    revision: snapshot.revision,
    ...(listingId ? { listing: snapshot.listings.find((item) => item.id === listingId) ?? null } : {}),
    ...(offerId ? { offer: snapshot.offers.find((item) => item.id === offerId) ?? null } : {}),
    ...(transactionId
      ? { transaction: snapshot.transactions.find((item) => item.id === transactionId) ?? null }
      : {}),
    ...(outcome.cancelled ? { cancelled: true } : {}),
  };
}

function assertMarketRoomActive(room) {
  if (room.status !== "active") {
    throw new RoomError(
      "Inicie a temporada antes de usar o mercado",
      "MARKET_ROOM_NOT_ACTIVE",
      409,
    );
  }
}

function completedMatchIndex(room, matchId) {
  return (room.completedMatches ?? []).findIndex((match) => String(match?.id ?? "") === matchId);
}

function compactCompletedMatch(match) {
  const compact = structuredClone(match);
  delete compact.playerStatistics;
  delete compact.playerEffects;
  delete compact.events;
  return compact;
}

function clubNameFor(room, clubId) {
  const key = clubKey(clubId);
  for (const league of room.competitionCatalog ?? []) {
    const club = (league.clubs ?? []).find((candidate) => clubKey(candidate?.id) === key);
    if (club?.name) return club.name;
  }
  return String(clubId ?? "").trim();
}

function managedClubFor(room, managerId, requestedClubId = null) {
  const manager = (room.managers ?? []).find((candidate) => candidate.id === managerId);
  if (!manager) {
    throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
  }
  if (!manager?.clubId) {
    throw new RoomError("Manager sem clube", "CLUB_REQUIRED", 409);
  }
  if (requestedClubId && clubKey(requestedClubId) !== clubKey(manager.clubId)) {
    throw new RoomError("Este clube nao pertence ao manager", "CLUB_FORBIDDEN", 403);
  }
  return manager.clubId;
}

function matchParticipantContext(room, match, managerId) {
  const manager = (room.managers ?? []).find((candidate) => candidate.id === managerId);
  if (!manager) throw new RoomError("Manager nao pertence a sala", "MANAGER_NOT_FOUND", 404);
  const clubId = manager.clubId;
  const fixture = (room.fixtureSchedule ?? []).find((candidate) => (
    fixtureIdsEqual(candidate?.fixtureId, match?.fixtureId)
  ));
  const homeClubId = match?.homeClubId ?? fixture?.homeClubId ?? null;
  const awayClubId = match?.awayClubId ?? fixture?.awayClubId ?? null;
  const homeManagerId = match?.homeManagerId ?? fixture?.homeManagerId ?? null;
  const awayManagerId = match?.awayManagerId ?? fixture?.awayManagerId ?? null;
  const clubName = clubNameFor(room, clubId);
  let clubSide = null;
  if (homeManagerId === managerId || (clubId && clubKey(homeClubId) === clubKey(clubId))) clubSide = "home";
  else if (awayManagerId === managerId || (clubId && clubKey(awayClubId) === clubKey(clubId))) clubSide = "away";
  else if (clubName && textKey(match?.homeTeam) === textKey(clubName)) clubSide = "home";
  else if (clubName && textKey(match?.awayTeam) === textKey(clubName)) clubSide = "away";

  const participantIds = new Set([
    ...(Array.isArray(match?.managerIds) ? match.managerIds : []),
    ...(Array.isArray(fixture?.managerIds) ? fixture.managerIds : []),
    homeManagerId,
    awayManagerId,
  ].filter(Boolean));
  if (!clubSide || (participantIds.size > 0 && !participantIds.has(managerId))) {
    throw new RoomError(
      "Este manager nao participou da partida informada",
      "PRESS_CONFERENCE_NOT_PARTICIPANT",
      403,
    );
  }
  return { manager, clubId, clubName: clubName || clubId, clubSide };
}

function latestCompletedMatchForManager(room, managerId) {
  const candidates = [...(room.completedMatches ?? [])];
  if (room.lastCompletedMatch && !candidates.some(
    (match) => String(match?.id ?? "") === String(room.lastCompletedMatch?.id ?? ""),
  )) {
    candidates.push(room.lastCompletedMatch);
  }
  for (const candidate of candidates.reverse()) {
    try {
      matchParticipantContext(room, candidate, managerId);
      return candidate;
    } catch (error) {
      if (error?.code !== "PRESS_CONFERENCE_NOT_PARTICIPANT") throw error;
    }
  }
  return null;
}

function canonicalAnswerKey(answers) {
  return JSON.stringify((answers ?? []).map(({ questionId, answerId }) => [questionId, answerId]));
}

function moraleStateFor(room, clubId) {
  room.clubMoraleStates = Array.isArray(room.clubMoraleStates) ? room.clubMoraleStates : [];
  let state = room.clubMoraleStates.find((candidate) => clubKey(candidate?.clubId) === clubKey(clubId));
  if (!state) {
    state = { clubId, active: true, score: 70, playerDeltas: [], updatedAt: null, sourceMatchId: null };
    room.clubMoraleStates.push(state);
  }
  state.active = true;
  state.score = clampMoraleScore(state.score ?? 70);
  state.playerDeltas = Array.isArray(state.playerDeltas) ? state.playerDeltas : [];
  return state;
}

function fixtureHasManager(room, fixture) {
  const managedClubs = new Set((room.managers ?? []).map((manager) => clubKey(manager.clubId)).filter(Boolean));
  return (fixture.managerIds ?? []).length > 0
    || Boolean(fixture.homeManagerId)
    || Boolean(fixture.awayManagerId)
    || managedClubs.has(clubKey(fixture.homeClubId))
    || managedClubs.has(clubKey(fixture.awayClubId));
}

function resultForLeagueFixture(room, leagueFixtureId) {
  const key = fixtureResultKey(leagueFixtureId);
  return (room.leagueMatchResults ?? []).find(
    (result) => fixtureResultKey(result.leagueFixtureId) === key,
  );
}

function advanceCompletedLeagueLoanRounds(room, previousResultIds, seasonNumber, now) {
  const resultIds = new Set((room.leagueMatchResults ?? [])
    .map((result) => fixtureResultKey(result?.leagueFixtureId))
    .filter(Boolean));
  const completedRounds = new Map();
  for (const resultId of resultIds) {
    if (previousResultIds.has(resultId)) continue;
    const fixture = (room.leagueFixtureSchedule ?? []).find(
      (candidate) => fixtureResultKey(candidate?.leagueFixtureId) === resultId,
    );
    if (!fixture?.leagueId || !Number.isInteger(fixture?.round)) continue;
    completedRounds.set(`${clubKey(fixture.leagueId)}:${fixture.round}`, {
      leagueId: fixture.leagueId,
      round: fixture.round,
    });
  }
  for (const { leagueId, round } of [...completedRounds.values()].sort((left, right) => (
    left.round - right.round || clubKey(left.leagueId).localeCompare(clubKey(right.leagueId))
  ))) {
    const fixtures = (room.leagueFixtureSchedule ?? []).filter((fixture) => (
      clubKey(fixture?.leagueId) === clubKey(leagueId) && fixture?.round === round
    ));
    if (fixtures.length === 0 || !fixtures.every((fixture) => (
      resultIds.has(fixtureResultKey(fixture?.leagueFixtureId))
    ))) continue;
    advanceMarketLoans(room, seasonNumber, round, now, leagueId);
  }
}

function compactLeagueResult({
  leagueFixtureId,
  score,
  completedAt,
  statistics = null,
  possession = null,
}) {
  const compactPossession = possessionPair(possession ?? statistics);
  return {
    leagueFixtureId,
    score: scorePair(score),
    completedAt,
    ...(compactPossession ? { possession: compactPossession } : {}),
  };
}

function recordNewLeagueMatchEconomies(room, previousResultIds, fallbackAt) {
  const recorded = [];
  for (const result of room.leagueMatchResults ?? []) {
    const resultId = fixtureResultKey(result?.leagueFixtureId);
    if (!resultId || previousResultIds.has(resultId)) continue;
    const compactFixture = (room.leagueFixtureSchedule ?? []).find(
      (fixture) => fixtureResultKey(fixture?.leagueFixtureId) === resultId,
    );
    if (!compactFixture) continue;
    const fixture = hydrateLeagueFixture(room, compactFixture);
    const economy = recordClubMatchday(room, {
      fixtureId: fixture.leagueFixtureId,
      homeClubId: fixture.homeClubId,
      awayClubId: fixture.awayClubId,
      competitionId: fixture.leagueId,
      competitionName: fixture.competition,
      round: fixture.round,
      score: result.score,
      occurredAt: fixture.scheduledAt ?? result.completedAt ?? fallbackAt,
    });
    if (economy) recorded.push(economy);
  }
  return recorded;
}

function roundMatchShape(fullFixture, humanFixture, result) {
  const source = humanFixture
    || (fullFixture.managerIds ?? []).length > 0
    || Boolean(fullFixture.homeManagerId)
    || Boolean(fullFixture.awayManagerId)
    ? "manager"
    : "ai";
  return {
    id: fullFixture.leagueFixtureId || fullFixture.fixtureId,
    fixtureId: humanFixture?.fixtureId || fullFixture.leagueFixtureId || fullFixture.fixtureId,
    source,
    homeClubId: fullFixture.homeClubId,
    awayClubId: fullFixture.awayClubId,
    homeTeam: fullFixture.homeTeam,
    awayTeam: fullFixture.awayTeam,
    ...(fullFixture.homeCode ? { homeCode: fullFixture.homeCode } : {}),
    ...(fullFixture.awayCode ? { awayCode: fullFixture.awayCode } : {}),
    ...(fullFixture.homeColor ? { homeColor: fullFixture.homeColor } : {}),
    ...(fullFixture.awayColor ? { awayColor: fullFixture.awayColor } : {}),
    ...(fullFixture.homeDarkThemeColor ? { homeDarkThemeColor: fullFixture.homeDarkThemeColor } : {}),
    ...(fullFixture.homeLightThemeColor ? { homeLightThemeColor: fullFixture.homeLightThemeColor } : {}),
    ...(fullFixture.awayDarkThemeColor ? { awayDarkThemeColor: fullFixture.awayDarkThemeColor } : {}),
    ...(fullFixture.awayLightThemeColor ? { awayLightThemeColor: fullFixture.awayLightThemeColor } : {}),
    ...(fullFixture.homeCrestImageUrl ? { homeCrestImageUrl: fullFixture.homeCrestImageUrl } : {}),
    ...(fullFixture.awayCrestImageUrl ? { awayCrestImageUrl: fullFixture.awayCrestImageUrl } : {}),
    score: result ? scorePair(result.score) : null,
    completedAt: result?.completedAt ?? null,
  };
}

function roundSummaryFor(room, humanFixture, humanResult) {
  const leagueFixtureId = humanFixture?.leagueFixtureId;
  const leagueFixture = (room.leagueFixtureSchedule ?? []).find(
    (fixture) => fixtureResultKey(fixture.leagueFixtureId) === fixtureResultKey(leagueFixtureId),
  );
  const target = leagueFixture ? hydrateLeagueFixture(room, leagueFixture) : humanFixture;
  const leagueId = target?.leagueId ?? null;
  const round = target?.round ?? humanFixture?.round ?? null;
  const fullRound = leagueFixture
    ? (room.leagueFixtureSchedule ?? []).filter((fixture) => (
      clubKey(fixture.leagueId) === clubKey(leagueId) && fixture.round === round
    ))
    : [];

  if (fullRound.length === 0) {
    return {
      leagueId,
      competition: target?.competition || "Brasileirao",
      round,
      seasonNumber: room.currentSeason,
      seasonYear: room.seasonYear,
      complete: true,
      matches: [{
        id: humanFixture?.leagueFixtureId || humanFixture?.fixtureId || humanResult.id,
        fixtureId: humanFixture?.fixtureId || humanResult.fixtureId,
        source: "manager",
        homeClubId: humanFixture?.homeClubId ?? null,
        awayClubId: humanFixture?.awayClubId ?? null,
        homeTeam: humanFixture?.homeTeam || humanResult.homeTeam,
        awayTeam: humanFixture?.awayTeam || humanResult.awayTeam,
        score: scorePair(humanResult.score),
        completedAt: humanResult.completedAt,
      }],
    };
  }

  const humanByLeagueFixture = new Map((room.fixtureSchedule ?? [])
    .filter((fixture) => fixture.leagueFixtureId)
    .map((fixture) => [fixtureResultKey(fixture.leagueFixtureId), fixture]));
  const matches = fullRound.map((compactFixture) => {
    const fixture = hydrateLeagueFixture(room, compactFixture);
    return roundMatchShape(
      fixture,
      humanByLeagueFixture.get(fixtureResultKey(fixture.leagueFixtureId)),
      resultForLeagueFixture(room, fixture.leagueFixtureId),
    );
  });
  return {
    leagueId,
    competition: target.competition || "Brasileirao",
    round,
    seasonNumber: room.currentSeason,
    seasonYear: room.seasonYear,
    complete: matches.every((match) => Array.isArray(match.score)),
    matches,
  };
}

function simulateMissingAiFixtures(room, fixtures, completedAt, aiRosters = new Map()) {
  for (const compactFixture of fixtures) {
    if (fixtureHasManager(room, compactFixture)) continue;
    if (resultForLeagueFixture(room, compactFixture.leagueFixtureId)) continue;
    const fixture = hydrateLeagueFixture(room, compactFixture);
    const simulated = simulateAiFixture(room, fixture, aiRosters, completedAt);
    enqueueMatchHistory(room, { ...simulated, completedAt }, fixture);
    room.leagueMatchResults.push(compactLeagueResult({
      leagueFixtureId: fixture.leagueFixtureId,
      score: simulated.score,
      completedAt,
      statistics: simulated.statistics,
    }));
  }
}

function competitionKickoff(room, index = 0) {
  const date = seasonCalendarStart(room);
  // League plays Sunday; custom competitions receive midweek slots.
  date.setUTCDate(date.getUTCDate() + 3 + index);
  date.setUTCHours(20, 30, 0, 0);
  return date.toISOString();
}

function createRoomCompetitionSeason(room) {
  const tournaments = (room.tournamentCatalog ?? []).filter((tournament) => (
    tournament?.active !== false && (tournament?.teamIds ?? []).length >= 2
  ));
  if (tournaments.length === 0) return null;
  const startDates = Object.fromEntries(tournaments.map((tournament, index) => [
    tournament.id,
    competitionKickoff(room, index),
  ]));
  try {
    return createCompetitionSeason(tournaments, {
      seasonNumber: room.currentSeason,
      seasonYear: room.seasonYear,
      startDate: competitionKickoff(room),
      startDates,
      roundIntervalDays: 7,
      knockoutLegIntervalDays: 7,
      knockoutRoundIntervalDays: 14,
    });
  } catch (error) {
    throw new RoomError(
      `Torneio invalido: ${error?.message ?? "configuracao nao suportada"}`,
      error?.code ?? "INVALID_TOURNAMENT_CONFIGURATION",
      409,
    );
  }
}

function deterministicWinner(fixture, score) {
  if (score[0] !== score[1]) return score[0] > score[1] ? fixture.homeClubId : fixture.awayClubId;
  return hashForResult(fixture.competitionFixtureId ?? fixture.id) % 2 === 0
    ? fixture.homeClubId
    : fixture.awayClubId;
}

function hashForResult(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function engineCompetitionResult(fixture, result) {
  const matchScore = scorePair(result?.score);
  const possession = possessionPair(result?.statistics);
  const payload = {
    score: matchScore,
    fairPlay: [
      Number(result?.statistics?.home?.yellowCards ?? 0) + Number(result?.statistics?.home?.redCards ?? 0) * 3,
      Number(result?.statistics?.away?.yellowCards ?? 0) + Number(result?.statistics?.away?.redCards ?? 0) * 3,
    ],
    ...(possession ? { possession } : {}),
  };
  if (Array.isArray(result?.extraTime ?? result?.extraTimeScore)) {
    payload.extraTime = scorePair(result.extraTime ?? result.extraTimeScore);
  }
  if (Array.isArray(result?.penalties)) payload.penalties = scorePair(result.penalties);
  if (fixture?.stageType === "knockout") {
    payload.winnerClubId = result?.winnerClubId || deterministicWinner(fixture, matchScore);
    if (!payload.penalties && matchScore[0] === matchScore[1]) {
      payload.penalties = payload.winnerClubId === fixture.homeClubId ? [5, 4] : [4, 5];
    }
  }
  return payload;
}

function pendingManagedFixture(room) {
  return pendingManagedFixtures(room)[0] ?? null;
}

function coordinateOfficialSchedule(room) {
  const coordinated = coordinateRoomFixtureCalendar(
    room,
    room.leagueFixtureSchedule ?? [],
    room.competitionSeason,
  );
  room.leagueFixtureSchedule = coordinated.leagueSchedule;
  room.competitionSeason = coordinated.competitionSeason;
  return coordinated;
}

function rebuildManagedSchedule(room) {
  coordinateOfficialSchedule(room);
  room.fixtureSchedule = createUnifiedFixtureSchedule(
    room,
    room.leagueFixtureSchedule,
    room.competitionSeason,
    { sourcesCoordinated: true },
  );
  const next = pendingManagedFixture(room);
  room.currentFixtureId = next?.fixtureId ?? null;
  room.matchReadiness = { fixtureId: room.currentFixtureId, managerIds: [] };
  return next;
}

function recordCompetitionFixture(room, fixture, result, completedAt) {
  if (!fixture?.competitionFixtureId || !room.competitionSeason) return false;
  room.competitionSeason = recordCompetitionSeasonResult(
    room.competitionSeason,
    fixture.competitionFixtureId,
    engineCompetitionResult(fixture, result),
    { completedAt },
  );
  return true;
}

function simulateOfficialAiBeforeNextManaged(room, completedAt, aiRosters = new Map(), through = null) {
  let simulatedCount = 0;
  for (let iteration = 0; iteration < 20_000; iteration += 1) {
    coordinateOfficialSchedule(room);
    const candidates = aiFixturesBeforeNextManaged(room, { through });
    const compact = candidates[0];
    if (!compact) return simulatedCount;
    if (compact.kind === "league") {
      const nextCupIndex = candidates.findIndex((fixture) => fixture.kind === "competition");
      const leagueBatch = candidates.slice(0, nextCupIndex < 0 ? undefined : nextCupIndex);
      simulateMissingAiFixtures(room, leagueBatch, completedAt, aiRosters);
      simulatedCount += leagueBatch.length;
    } else {
      const fixture = hydrateCompetitionFixture(room, compact);
      if (fixture.stageType === "knockout") {
        const coverage = validateAiFixtureRosterCoverage(room, fixture, aiRosters);
        if (!coverage.valid) {
          throw new RoomError(
            `Elenco indisponivel para o mata-mata: ${fixture.homeTeam} x ${fixture.awayTeam}`,
            "DYNAMIC_KNOCKOUT_ROSTER_INVALID",
            503,
          );
        }
      }
      const simulated = simulateAiFixture(room, fixture, aiRosters, completedAt);
      enqueueMatchHistory(room, { ...simulated, completedAt }, fixture);
      room.competitionSeason = recordCompetitionSeasonResult(
        room.competitionSeason,
        compact.competitionFixtureId,
        engineCompetitionResult(compact, simulated),
        { completedAt },
      );
      simulatedCount += 1;
    }
  }
  throw new RoomError("Calendario excedeu limite de avancos", "COMPETITION_ADVANCE_LIMIT", 409);
}

function compactCareerPlayer(player) {
  return {
    id: player.id,
    clubId: player.clubId ?? null,
    name: player.name,
    position: player.position,
    age: player.age,
    nationality: player.nationality,
    overall: player.overall,
    attributes: player.attributes,
    potential: player.potential,
    wage: player.wage,
    condition: player.condition,
    isStar: player.isStar === true,
    active: player.active !== false,
    ...(player.contract ? { contract: player.contract } : {}),
  };
}

function careerRosterForTransition(room, loadedRoster) {
  const loaded = new Map((loadedRoster ?? []).map((player) => [String(player.id), compactCareerPlayer(player)]));
  for (const overlay of room.careerState?.players ?? []) {
    const base = loaded.get(String(overlay.id));
    loaded.set(String(overlay.id), {
      ...(base ?? {}),
      ...overlay,
      // Market registrations already resolved by listRoomPlayers win club ownership.
      clubId: base?.clubId ?? overlay.clubId ?? null,
    });
  }
  const registrations = Array.isArray(room.marketState?.registrations)
    ? room.marketState.registrations
    : Object.values(room.marketState?.registrations ?? {});
  for (const registration of registrations) {
    const id = String(registration?.playerId ?? registration?.playerSnapshot?.id ?? "");
    const player = loaded.get(id);
    if (!player || !registration?.currentClubId) continue;
    const permanentClubId = registration?.permanentClubId
      ?? registration?.loan?.lenderClubId
      ?? registration.currentClubId;
    const contractClubId = registration?.loan
      ? permanentClubId
      : registration.currentClubId;
    loaded.set(id, {
      ...player,
      clubId: registration.currentClubId,
      currentClubId: registration.currentClubId,
      ownerClubId: permanentClubId,
      ...(registration?.loan ? { loan: structuredClone(registration.loan) } : {}),
      contract: player.contract ? { ...player.contract, clubId: contractClubId } : player.contract,
    });
  }
  return [...loaded.values()];
}

function careerPlayerCanEnterMarket(player) {
  return Boolean(String(player?.id ?? "").trim())
    && player?.active !== false
    && player?.retired !== true
    && player?.academy !== true
    && player?.youth !== true
    && player?.careerStage !== "academy"
    && player?.careerStage !== "retired";
}

function careerPlayerIsFreeAgent(player) {
  const contractStatus = String(player?.contract?.status ?? "").trim().toLocaleLowerCase("pt-BR");
  return ["free_agent", "expired", "released"].includes(contractStatus)
    || (!player?.currentClubId && !player?.clubId && !player?.contract?.clubId);
}

function careerClubs(room) {
  const values = [
    ...(room.competitionCatalog ?? []).flatMap((league) => (league.clubs ?? []).map((club) => ({
      ...club,
      country: club.country ?? league.country,
    }))),
    ...(room.tournamentCatalog ?? []).flatMap((tournament) => tournament.participants ?? []),
  ];
  const clubs = [...new Map(values.filter((club) => club?.id).map((club) => [clubKey(club.id), club])).values()];
  if (!room?.clubCareerState) return clubs;
  const asOf = careerDateFor(room, new Date());
  return clubs.map((club) => {
    const effects = clubCareerPerformanceEffects(room, club.id, asOf);
    return {
      ...club,
      // Derivado dos agregados persistentes. Nao altera academyLevel do catalogo
      // e, portanto, nunca acumula o mesmo bonus entre temporadas.
      youthDevelopment: effects.youthDevelopment,
    };
  });
}

function initialCareerState(room, roster) {
  const players = (roster ?? []).map((player) => normalizeCareerPlayer(
    compactCareerPlayer(player),
    { seasonNumber: room.currentSeason },
  ));
  const existing = new Set(players.map((player) => String(player.id)));
  const academy = generateYouthIntake({
    clubs: careerClubs(room),
    seasonNumber: room.currentSeason,
    countPerClub: 2,
    seed: room.id,
  }).filter((player) => !existing.has(String(player.id)));
  return {
    saveId: room.id,
    currentSeason: room.currentSeason,
    players: [...players, ...academy],
    trainingPlans: [],
    pendingRenewals: [],
    nationalSquads: [],
    lastCareerTransitionSeason: room.currentSeason,
  };
}

function aiFixturesForCompletion(room, fixtureId) {
  const humanFixture = (room.fixtureSchedule ?? []).find(
    (fixture) => fixtureIdsEqual(fixture.fixtureId, fixtureId),
  );
  if (!humanFixture) return [];
  return aiFixturesBeforeNextManaged(room, {
    excludedFixtureId: fixtureId, through: humanFixture.scheduledAt,
  });
}

function assertScheduleSize(room) {
  const fixturesByLeague = new Map();
  for (const fixture of room.leagueFixtureSchedule ?? []) {
    const leagueId = clubKey(fixture?.leagueId) || "SEM-LIGA";
    fixturesByLeague.set(leagueId, (fixturesByLeague.get(leagueId) ?? 0) + 1);
  }
  if ([...fixturesByLeague.values()].some((fixtureCount) => fixtureCount > 5_000)) {
    throw new RoomError(
      "As competicoes ativas geram partidas demais para um unico save. Reduza as ligas ou os clubes ativos",
      "LEAGUE_SCHEDULE_TOO_LARGE",
      409,
    );
  }
}

function defaultCodeFactory() {
  let suffix = "";
  for (let index = 0; index < 4; index += 1) {
    suffix += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return `BOLA-${suffix}`;
}

const VIEWER_EXCLUDED_PATHS = Object.freeze([
  "careerState",
  "marketState",
  "coachEmploymentState",
  "professionalLifecycleState",
  "professionalLeaveState",
  "seasonHistory",
  "completedMatches",
  ...MATCH_HISTORY_PATHS,
  ...SCOUTING_READ_PATHS,
  "tacticalStudyState",
]);

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

function viewerProjection(room) {
  if (!room) return room;
  const projection = structuredClone(room);
  for (const path of VIEWER_EXCLUDED_PATHS) delete projection[path];
  return projection;
}

export class RoomError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "RoomError";
    this.code = code;
    this.status = status;
  }
}

export class RoomStore {
  #persistence;
  #codeFactory;
  #now;
  #catalogStore;
  #coachInterviewAi;
  #careerRosterPolicy;
  #aiMarketExecutor;
  #aiMarketTelemetry;
  #historyArchiveDrains = new Map();
  #tacticalStudyCache = new Map();

  constructor({
    persistence,
    codeFactory = defaultCodeFactory,
    now = () => new Date(),
    catalogStore = null,
    coachInterviewAi = null,
    careerRosterPolicy = null,
    aiMarketExecutor = runAiTransferTick,
    logger = null,
    metrics = null,
  } = {}) {
    if (!persistence) throw new Error("RoomStore requer uma camada de persistencia explicita");
    this.#persistence = persistence;
    this.#codeFactory = codeFactory;
    this.#now = now;
    this.#catalogStore = catalogStore;
    this.#coachInterviewAi = coachInterviewAi ?? createCoachInterviewAiService({});
    this.#careerRosterPolicy = normalizedCareerRosterPolicy(careerRosterPolicy ?? {});
    this.#aiMarketExecutor = aiMarketExecutor;
    this.#aiMarketTelemetry = { logger, metrics };
  }

  async createRoom({
    name,
    creatorId,
    creatorName,
    clubId,
    activeLeagues,
    seasonLength,
    unlimitedSeasons = false,
    maxManagers,
    operationId,
    requestId,
  }) {
    const operation = roomCreationOperation({
      name, creatorId, clubId, activeLeagues, seasonLength, unlimitedSeasons, maxManagers, operationId, requestId,
    });
    if (operation) {
      const receipt = await this.#persistence.findCreation(operation);
      if (receipt) return this.#createdRoom(receipt, creatorId);
    }
    const ownerCatalog = await catalogForOwner(this.#catalogStore, creatorId);
    const [competitionCatalog, tournamentCatalog] = await Promise.all([
      this.#loadCompetitionCatalog(
        creatorId,
        activeLeagues,
        clubId ? [clubId] : [],
        ownerCatalog,
      ),
      this.#loadTournamentCatalog(creatorId, clubId ? [clubId] : [], ownerCatalog),
    ]);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = this.#normalizeCode(this.#codeFactory());
      const createdAt = this.#now().toISOString();
      const room = {
        id: randomUUID(),
        code,
        name,
        ownerId: creatorId,
        catalogOwnerId: creatorId,
        status: "waiting",
        activeLeagues: [...activeLeagues],
        competitionCatalog,
        tournamentCatalog,
        competitionSeason: null,
        seasonLength,
        unlimitedSeasons,
        currentSeason: 1,
        seasonYear: new Date(createdAt).getUTCFullYear(),
        seasonStartedAt: createdAt,
        seasonHistory: [],
        careerCompleted: false,
        careerCompletedAt: null,
        maxManagers,
        createdAt,
        updatedAt: createdAt,
        startedAt: null,
        revision: 1,
        version: 1,
        currentFixtureId: null,
        scheduleIssue: null,
        fixtureSchedule: [],
        leagueFixtureSchedule: [],
        leagueMatchResults: [],
        lastCompletedRound: null,
        matchReadiness: { fixtureId: null, managerIds: [] },
        completedFixtureIds: [],
        completedMatches: [],
        lastCompletedMatch: null,
        clubMoraleStates: [],
        playerStates: [],
        careerState: null,
        coachEmploymentState: null,
        marketState: null,
        lineups: [],
        managerIds: [creatorId],
        managers: [{
          id: creatorId,
          name: creatorName,
          clubId: clubId ?? null,
          ready: false,
          joinedAt: createdAt,
        }],
      };
      const created = await this.#persistence.create(room, { operation });
      if (created) return operation ? this.#createdRoom(created, creatorId) : this.#snapshot(room);
    }
    throw new RoomError("Nao foi possivel gerar o codigo da sala", "CODE_EXHAUSTED", 503);
  }

  async #createdRoom(receipt, ownerId) {
    const room = await this.#persistence.get(receipt.code);
    if (!room || room.id !== receipt.roomId) {
      throw roomCreationError("A sala desta operacao foi excluida ou nao esta mais disponivel", "ROOM_CREATION_GONE", 410);
    }
    if (room.ownerId !== ownerId) {
      throw roomCreationError("Recibo de criacao inconsistente", "ROOM_CREATION_RECEIPT_INVALID", 503);
    }
    return this.#snapshot(room);
  }

  async listRoomsForManager(managerId) {
    const rooms = typeof this.#persistence.listMetadataByManager === "function"
      ? await this.#persistence.listMetadataByManager(managerId)
      : await this.#persistence.listByManager(managerId);
    // Save picker needs metadata only. Avoid #snapshot: it hydrates careerState
    // and would defeat the lightweight Firestore query.
    return rooms.map((room) => structuredClone(room));
  }

  async getRoom(code) {
    const room = await this.#persistence.get(this.#normalizeCode(code));
    return room ? this.#snapshot(room) : null;
  }

  async requireViewerRoom(code, managerId) {
    const normalizedCode = this.#normalizeCode(code);
    const room = typeof this.#persistence.getPartial === "function"
      ? await this.#persistence.getPartial(normalizedCode, { excludePaths: VIEWER_EXCLUDED_PATHS })
      : await this.#persistence.get(normalizedCode);
    if (!room || !Array.isArray(room.managerIds) || !room.managerIds.includes(managerId)) {
      throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
    }
    // Defense in depth for persistence adapters that cannot project fields.
    return viewerProjection(room);
  }

  async requireMembershipPaths(code, managerId, paths) {
    const normalizedCode = this.#normalizeCode(code);
    const room = typeof this.#persistence.getPaths === "function"
      ? await this.#persistence.getPaths(normalizedCode, paths)
      : await this.#persistence.get(normalizedCode);
    if (!room || !Array.isArray(room.managerIds) || !room.managerIds.includes(managerId)) {
      throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
    }
    return room;
  }

  async requireRoom(code) {
    const room = await this.#persistence.get(this.#normalizeCode(code));
    if (!room) throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
    return room;
  }

  async #historyRoom(code, managerId) {
    let room = await this.requireMembershipPaths(code, managerId, MATCH_HISTORY_PATHS);
    if (room.matchHistoryVersion !== 1) {
      room = await this.#persistence.mutatePaths(room.code, [...MATCH_HISTORY_PATHS, "completedMatches", "lastCompletedMatch"], (current) => {
        if (!current?.managerIds?.includes(managerId)) throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
        initializeMatchHistory(current);
        return current;
      });
    }
    const archiveError = await this.#flushHistory(room);
    room = await this.requireMembershipPaths(code, managerId, MATCH_HISTORY_PATHS);
    return { room, archiveError };
  }

  async getMatchHistory(code, managerId, query = {}) {
    // Validate membership and pagination before allowing legacy migration.
    const authorized = await this.requireMembershipPaths(code, managerId, []);
    const options = historyPageOptions(authorized.id ?? authorized.code, query);
    const { room, archiveError } = await this.#historyRoom(code, managerId);
    const archived = await this.#persistence.matchHistory.list(room, options);
    return { ...historyPage(room.id ?? room.code, archived, room.matchHistoryPending ?? [], options), archiveError };
  }

  async getMatchHistoryDetail(code, managerId, id) {
    assertHistoryId(id);
    const { room } = await this.#historyRoom(code, managerId);
    const archived = await this.#persistence.matchHistory.get(room, id);
    const pending = (room.matchHistoryPending ?? []).find((entry) => entry.id === id);
    const record = archived?.detailsAvailable ? archived : pending ?? archived;
    if (!record) throw new RoomError("Partida nao encontrada no historico", "MATCH_HISTORY_NOT_FOUND", 404);
    return structuredClone(record);
  }

  async #flushHistory(room) {
    try {
      const remaining = await flushMatchHistory(this.#persistence, room);
      if (remaining) this.#drainHistory(room.code);
      return null;
    } catch (error) {
      // The match and durable outbox already committed. Never report it as
      // failed or discard its events just because the archive needs a retry.
      const context = { code: room.code, errorCode: error?.code ?? "MATCH_HISTORY_WRITE_FAILED", pending: room.matchHistoryPending?.length ?? 0 };
      try { (this.#aiMarketTelemetry.logger ?? console).warn("match_history.archive_pending", context); } catch { /* Logging cannot undo a committed match. */ }
      return { code: context.errorCode, message: "Arquivamento pendente; detalhes preservados no save para nova tentativa" };
    }
  }

  #drainHistory(code) {
    if (this.#historyArchiveDrains.has(code)) return;
    const drain = async () => {
      // Extra batches run outside the match response. On shutdown/failure the
      // persisted queue is retried when the room is next used or queried.
      for (;;) {
        const room = await this.#persistence.getPaths(code, MATCH_HISTORY_PATHS);
        if (!room || !(room.matchHistoryPending?.length)) return;
        if (!(await flushMatchHistory(this.#persistence, room))) return;
      }
    };
    const job = drain().catch((error) => {
      try { (this.#aiMarketTelemetry.logger ?? console).warn("match_history.drain_failed", { code, errorCode: error?.code ?? "MATCH_HISTORY_WRITE_FAILED" }); } catch { /* Durable queue remains the source of truth. */ }
    }).finally(() => this.#historyArchiveDrains.delete(code));
    this.#historyArchiveDrains.set(code, job);
  }

  async requireMembership(code, managerId) {
    let room = await this.requireRoom(code);
    if (!room.managerIds.includes(managerId)) {
      throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
    }
    room = await this.#hydrateCompetitionCatalog(room);
    if (room.status === "active") {
      let migrationPreview = structuredClone(room);
      const careerMigrationPending = ensureCareerState(migrationPreview, this.#now());
      const employmentBefore = JSON.stringify(migrationPreview.coachEmploymentState ?? null);
      migrationPreview = ensureCoachEmploymentState(migrationPreview, {
        now: careerDateFor(migrationPreview, this.#now()),
      });
      const employmentMigrationPending = employmentBefore
        !== JSON.stringify(migrationPreview.coachEmploymentState ?? null);
      const lifecycleBefore = JSON.stringify(migrationPreview.professionalLifecycleState ?? null);
      migrationPreview = ensureProfessionalLifecycleState(migrationPreview, {
        now: careerDateFor(migrationPreview, this.#now()),
      });
      const lifecycleMigrationPending = lifecycleBefore
        !== JSON.stringify(migrationPreview.professionalLifecycleState ?? null);
      const leaveBefore = JSON.stringify(migrationPreview.professionalLeaveState ?? null);
      migrationPreview = ensureProfessionalLeaveState(migrationPreview, {
        now: careerDateFor(migrationPreview, this.#now()),
      });
      const leaveMigrationPending = leaveBefore
        !== JSON.stringify(migrationPreview.professionalLeaveState ?? null);
      const fixtureMigrationPending = ensureFixtureSchedule(migrationPreview);
      const systemsBefore = JSON.stringify({
        clubCareerState: migrationPreview.clubCareerState ?? null,
        marketState: migrationPreview.marketState ?? null,
      });
      ensureClubCareerSystems(migrationPreview, { now: careerDateFor(migrationPreview, this.#now()) });
      const systemsMigrationPending = systemsBefore !== JSON.stringify({
        clubCareerState: migrationPreview.clubCareerState ?? null,
        marketState: migrationPreview.marketState ?? null,
      });
      if (
        careerMigrationPending
        || employmentMigrationPending
        || lifecycleMigrationPending
        || leaveMigrationPending
        || fixtureMigrationPending
        || systemsMigrationPending
      ) {
        room = await this.#mutate(code, (current) => {
          if (!current.managerIds.includes(managerId)) {
            throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
          }
          const careerChanged = ensureCareerState(current, this.#now());
          const employmentBeforeCurrent = JSON.stringify(current.coachEmploymentState ?? null);
          let next = ensureCoachEmploymentState(current, {
            now: careerDateFor(current, this.#now()),
          });
          const employmentChanged = employmentBeforeCurrent
            !== JSON.stringify(next.coachEmploymentState ?? null);
          const lifecycleBeforeCurrent = JSON.stringify(next.professionalLifecycleState ?? null);
          next = ensureProfessionalLifecycleState(next, {
            now: careerDateFor(next, this.#now()),
          });
          const lifecycleChanged = lifecycleBeforeCurrent
            !== JSON.stringify(next.professionalLifecycleState ?? null);
          const leaveBeforeCurrent = JSON.stringify(next.professionalLeaveState ?? null);
          next = ensureProfessionalLeaveState(next, {
            now: careerDateFor(next, this.#now()),
          });
          const leaveChanged = leaveBeforeCurrent
            !== JSON.stringify(next.professionalLeaveState ?? null);
          const fixtureChanged = ensureFixtureSchedule(next);
          ensureClubCareerSystems(next, { now: careerDateFor(next, this.#now()) });
          if (fixtureChanged) assertScheduleSize(next);
          return careerChanged
            || employmentChanged
            || lifecycleChanged
            || leaveChanged
            || fixtureChanged
            || systemsMigrationPending
            ? next
            : undefined;
        });
      }
    }
    return this.#snapshot(room);
  }

  async requireOwnership(code, managerId) {
    const room = await this.requireRoom(code);
    if (!room.managerIds.includes(managerId)) {
      throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
    }
    if (room.ownerId !== managerId) {
      throw new RoomError("Somente o criador pode excluir a temporada", "OWNER_REQUIRED", 403);
    }
    return this.#snapshot(room);
  }

  async requireDeleteOwnership(code, managerId) {
    const normalizedCode = this.#normalizeCode(code);
    const room = typeof this.#persistence.getDeletionMetadata === "function"
      ? await this.#persistence.getDeletionMetadata(normalizedCode)
      : typeof this.#persistence.getMetadata === "function"
        ? await this.#persistence.getMetadata(normalizedCode)
        : await this.#persistence.get(normalizedCode);
    if (!room || !Array.isArray(room.managerIds) || !room.managerIds.includes(managerId)) {
      throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
    }
    if (room.ownerId !== managerId) {
      throw new RoomError("Somente o criador pode excluir a temporada", "OWNER_REQUIRED", 403);
    }
    return structuredClone(room);
  }

  async deleteRoom(code, managerId) {
    const normalizedCode = this.#normalizeCode(code);
    const room = await this.#persistence.remove(normalizedCode, (current) => {
      if (!current || !current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      if (current.ownerId !== managerId) {
        throw new RoomError("Somente o criador pode excluir a temporada", "OWNER_REQUIRED", 403);
      }
    });
    // Persistence only needs to return small authorization metadata after the
    // tombstone commit. Rehydrating careerState while deleting wastes memory.
    return structuredClone(room);
  }

  async joinRoom(code, { managerId, managerName, clubId }) {
    const paths = clubId ? ["competitionCatalog", "lineups"] : [];
    return this.#mutatePaths(code, paths, (room) => {
      const existing = room.managers.find((manager) => manager.id === managerId);
      if (existing) {
        if (room.status !== "waiting") return undefined;
        if (clubId) this.#assertClubAvailable(room, clubId, managerId);
        existing.name = managerName;
        if (clubId && !this.#clubIdsEqual(existing.clubId, clubId)) this.#removeLineup(room, managerId);
        existing.clubId = clubId ?? existing.clubId;
        return room;
      }
      if (room.status !== "waiting") {
        throw new RoomError("A temporada desta sala ja comecou", "ROOM_ALREADY_STARTED", 409);
      }
      if (room.managers.length >= room.maxManagers) {
        throw new RoomError("A sala atingiu o limite de managers", "ROOM_FULL", 409);
      }
      if (clubId) this.#assertClubAvailable(room, clubId, managerId);
      room.managers.push({
        id: managerId,
        name: managerName,
        clubId: clubId ?? null,
        ready: false,
        joinedAt: this.#now().toISOString(),
      });
      room.managerIds.push(managerId);
      return room;
    });
  }

  async setReady(code, managerId, ready = true, clubId) {
    const paths = clubId ? ["competitionCatalog", "lineups"] : [];
    return this.#mutatePaths(code, paths, (room) => {
      if (room.status !== "waiting") {
        throw new RoomError("A temporada desta sala ja comecou", "ROOM_ALREADY_STARTED", 409);
      }
      const manager = room.managers.find((candidate) => candidate.id === managerId);
      if (!manager) throw new RoomError("Manager nao pertence a sala", "MANAGER_NOT_FOUND", 404);
      if (clubId) {
        this.#assertClubAvailable(room, clubId, managerId);
        if (!this.#clubIdsEqual(manager.clubId, clubId)) this.#removeLineup(room, managerId);
        manager.clubId = clubId;
      }
      if (ready && !manager.clubId) {
        throw new RoomError("Escolha um clube antes de confirmar", "CLUB_REQUIRED", 409);
      }
      manager.ready = ready;
      return room;
    });
  }

  async setMatchReady(code, managerId, ready = true, fixtureId) {
    let migratedDuringTransaction = false;
    return this.#mutate(code, (room) => {
      if (room.status !== "active") {
        throw new RoomError("Inicie a temporada antes de confirmar a partida", "ROOM_NOT_ACTIVE", 409);
      }
      const manager = room.managers.find((candidate) => candidate.id === managerId);
      if (!manager) throw new RoomError("Manager nao pertence a sala", "MANAGER_NOT_FOUND", 404);
      ensureCareerState(room, this.#now());
      const migrated = ensureFixtureSchedule(room);
      if (migrated) assertScheduleSize(room);
      migratedDuringTransaction = migratedDuringTransaction || migrated;
      if (!room.currentFixtureId) {
        throw new RoomError("A temporada nao possui partidas pendentes", "NO_PENDING_FIXTURE", 409);
      }
      const targetFixtureId = migratedDuringTransaction ? room.currentFixtureId : fixtureId || room.currentFixtureId;
      if (!fixtureIdsEqual(targetFixtureId, room.currentFixtureId)) {
        throw new RoomError("Esta fixture nao e a atual", "FIXTURE_NOT_CURRENT", 409);
      }
      const canonicalFixtureId = room.currentFixtureId;
      if (!fixtureIdsEqual(room.matchReadiness?.fixtureId, canonicalFixtureId)) {
        room.matchReadiness = { fixtureId: canonicalFixtureId, managerIds: [] };
      }
      const readyIds = new Set(room.matchReadiness.managerIds);
      if (ready) readyIds.add(managerId);
      else readyIds.delete(managerId);
      room.matchReadiness.managerIds = [...readyIds];
      return room;
    });
  }

  async clearMatchReadiness(code, fixtureId) {
    return this.#mutatePaths(code, ["matchReadiness"], (room) => {
      if (fixtureId && !fixtureIdsEqual(fixtureId, room.currentFixtureId)) return undefined;
      const canonicalFixtureId = room.currentFixtureId ?? null;
      const alreadyEmpty = fixtureIdsEqual(room.matchReadiness?.fixtureId, canonicalFixtureId)
        && (!Array.isArray(room.matchReadiness?.managerIds)
          || room.matchReadiness.managerIds.length === 0);
      if (alreadyEmpty) return undefined;
      room.matchReadiness = { fixtureId: canonicalFixtureId, managerIds: [] };
      return room;
    });
  }

  async saveLineup(code, managerId, clubId, lineupIds, tactics, cohesion) {
    return this.#mutatePaths(code, ["lineups", "matchReadiness"], (room) => {
      const manager = room.managers.find((candidate) => candidate.id === managerId);
      if (!manager) throw new RoomError("Manager nao pertence a sala", "MANAGER_NOT_FOUND", 404);
      if (!manager.clubId) throw new RoomError("Escolha um clube antes de escalar", "CLUB_REQUIRED", 409);
      if (!this.#clubIdsEqual(manager.clubId, clubId)) {
        throw new RoomError("Clube da escalacao mudou", "LINEUP_CLUB_CHANGED", 409);
      }
      room.lineups = Array.isArray(room.lineups) ? room.lineups : [];
      const previousLineup = room.lineups.find((candidate) => candidate.managerId === managerId);
      this.#removeLineup(room, managerId);
      const updatedAt = this.#now().toISOString();
      const effectiveTactics = tactics ?? previousLineup?.tactics;
      const effectiveCohesion = cohesion ?? previousLineup?.cohesion;
      const lineup = {
        managerId,
        clubId: manager.clubId,
        lineupIds: [...lineupIds],
        ...(effectiveTactics ? { tactics: structuredClone(effectiveTactics) } : {}),
        ...(effectiveCohesion
          ? { cohesion: { ...structuredClone(effectiveCohesion), updatedAt } }
          : {}),
        updatedAt,
      };
      room.lineups.push(lineup);
      if (Array.isArray(room.matchReadiness?.managerIds)) {
        room.matchReadiness.managerIds = room.matchReadiness.managerIds
          .filter((readyManagerId) => readyManagerId !== managerId);
      }
      return room;
    });
  }

  async prepareMatch(code, managerId, requestedFixtureId) {
    const preview = await this.requireRoom(code);
    const due = aiFixturesBeforeNextManaged(preview);
    const aiRosters = due.length ? await this.#loadAiRosters(preview, [
      ...due,
      ...(preview.competitionSeason?.competitions ?? []).flatMap((competition) => (
        (competition.participants ?? []).map((participant) => ({ homeClubId: participant.id }))
      )),
    ]) : new Map();
    let migrated = false;
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      const careerChanged = ensureCareerState(current, this.#now());
      const fixtureChanged = ensureFixtureSchedule(current);
      if (fixtureChanged) assertScheduleSize(current);
      const previousResults = new Set((current.leagueMatchResults ?? []).map((entry) => fixtureResultKey(entry.leagueFixtureId)));
      const aiChanged = current.status === "active" && due.length > 0
        ? simulateOfficialAiBeforeNextManaged(current, this.#now().toISOString(), aiRosters) > 0 : false;
      if (aiChanged) {
        const occurredAt = careerDateFor(current, this.#now());
        advanceCompletedLeagueLoanRounds(current, previousResults, current.currentSeason, occurredAt);
        recordNewLeagueMatchEconomies(current, previousResults, occurredAt);
        awardCompletedCompetitionPrizes(current, { occurredAt });
        rebuildManagedSchedule(current);
      }
      const changed = careerChanged || fixtureChanged || aiChanged;
      migrated ||= changed;
      return changed ? current : undefined;
    });
    return {
      room,
      migrated,
      fixtureId: migrated ? room.currentFixtureId : requestedFixtureId,
    };
  }

  async startRoom(code, managerId) {
    const current = await this.requireRoom(code);
    const managedClubIds = current.managers.map((manager) => manager.clubId).filter(Boolean);
    const ownerCatalog = await catalogForOwner(this.#catalogStore, current.catalogOwnerId || current.ownerId);
    const [liveCatalog, liveTournaments] = await Promise.all([
      this.#loadCompetitionCatalog(
        current.catalogOwnerId || current.ownerId,
        current.activeLeagues,
        managedClubIds,
        ownerCatalog,
      ),
      this.#loadTournamentCatalog(current.catalogOwnerId || current.ownerId, managedClubIds, ownerCatalog),
    ]);
    const prefetchedCatalog = liveCatalog.length
      ? liveCatalog
      : Array.isArray(current.competitionCatalog) ? current.competitionCatalog : [];
    const prefetchedTournaments = liveTournaments.length
      ? liveTournaments
      : Array.isArray(current.tournamentCatalog) ? current.tournamentCatalog : [];
    const initialCareerRoster = await this.#loadCareerRoster({
      ...current,
      competitionCatalog: prefetchedCatalog,
      tournamentCatalog: prefetchedTournaments,
    }, ownerCatalog);
    return this.#mutate(code, (room) => {
      ensureCareerState(room, this.#now());
      if (room.ownerId !== managerId) {
        throw new RoomError("Somente o criador pode iniciar a temporada", "OWNER_REQUIRED", 403);
      }
      if (room.status !== "waiting") {
        throw new RoomError("A temporada desta sala ja comecou", "ROOM_ALREADY_STARTED", 409);
      }
      if (room.managers.length === 0 || room.managers.some((manager) => !manager.ready)) {
        throw new RoomError("Todos os managers precisam estar prontos", "MANAGERS_NOT_READY", 409);
      }
      if (prefetchedCatalog.length) {
        room.competitionCatalog = structuredClone(prefetchedCatalog);
        this.#includeManagerLeagues(room);
      }
      room.tournamentCatalog = structuredClone(prefetchedTournaments);
      room.managers.forEach((manager) => this.#assertClubInActiveLeague(room, manager.clubId));
      room.status = "active";
      room.startedAt = this.#now().toISOString();
      room.seasonStartedAt = room.startedAt;
      room.careerCompleted = false;
      room.careerCompletedAt = null;
      // Estrutura e comissao precisam existir antes da primeira geracao da base.
      ensureClubCareerSystems(room, { now: room.startedAt });
      room.careerState = initialCareerState(room, initialCareerRoster);
      room.competitionSeason = createRoomCompetitionSeason(room);
      room.leagueFixtureSchedule = createLeagueFixtureSchedule(room);
      room.leagueMatchResults = [];
      rebuildManagedSchedule(room);
      assertScheduleSize(room);
      const initialAiRosters = new Map();
      for (const player of initialCareerRoster) {
        const key = clubKey(player.clubId);
        const roster = initialAiRosters.get(key) ?? [];
        roster.push(player);
        initialAiRosters.set(key, roster);
      }
      simulateOfficialAiBeforeNextManaged(room, room.startedAt, initialAiRosters);
      advanceCompletedLeagueLoanRounds(room, new Set(), room.currentSeason, room.startedAt);
      recordNewLeagueMatchEconomies(room, new Set(), room.startedAt);
      awardCompletedCompetitionPrizes(room, { occurredAt: room.startedAt });
      rebuildManagedSchedule(room);
      assertScheduleSize(room);
      room.lastCompletedRound = null;
      for (const manager of room.managers) {
        const hasFixture = room.fixtureSchedule.some(
          (fixture) => this.#clubIdsEqual(fixture.homeClubId, manager.clubId)
            || this.#clubIdsEqual(fixture.awayClubId, manager.clubId),
        );
        if (!hasFixture) {
          throw new RoomError(
            "A liga do clube escolhido precisa ter pelo menos dois clubes ativos",
            "LEAGUE_NEEDS_CLUBS",
            409,
          );
        }
      }
      room.scheduleIssue = null;
      room.scheduleVersion = FIXTURE_SCHEDULE_VERSION;
      room.currentFixtureId = room.fixtureSchedule[0]?.fixtureId ?? null;
      room.matchReadiness = { fixtureId: room.currentFixtureId, managerIds: [] };
      ensureClubCareerSystems(room, { now: room.startedAt });
      ensureCareerState(room, room.startedAt);
      const withEmployment = ensureCoachEmploymentState(room, { now: room.startedAt });
      const withLifecycle = ensureProfessionalLifecycleState(withEmployment, { now: room.startedAt });
      return ensureProfessionalLeaveState(withLifecycle, { now: room.startedAt });
    });
  }

  async hasManager(code, managerId) {
    const room = await this.requireRoom(code);
    return room.managerIds.includes(managerId);
  }

  async startClubFacilityUpgrade(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const clubId = managedClubFor(current, managerId, input.clubId);
      assertNoticeLongTermDecisionApproved(current, managerId, clubId, input, "esta obra de longo prazo");
      outcome = startClubUpgrade(current, {
        clubId,
        areaId: input.areaId,
        operationId: input.requestId ?? input.operationId,
      });
      return current;
    });
    return { room, project: structuredClone(outcome.project), quote: structuredClone(outcome.quote) };
  }

  async hireClubStaff(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const clubId = managedClubFor(current, managerId, input.clubId);
      outcome = hireClubStaffOperation(current, {
        ...input,
        clubId,
        operationId: input.requestId ?? input.operationId,
      });
      return current;
    });
    return { room, member: structuredClone(outcome.member), contract: structuredClone(outcome.contract) };
  }

  async fireClubStaff(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const clubId = managedClubFor(current, managerId, input.clubId);
      outcome = fireClubStaffOperation(current, {
        ...input,
        clubId,
        operationId: input.requestId ?? input.operationId,
      });
      return current;
    });
    return { room, member: structuredClone(outcome.member), contract: structuredClone(outcome.contract) };
  }

  async renewClubStaff(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const clubId = managedClubFor(current, managerId, input.clubId);
      outcome = renewClubStaffOperation(current, {
        ...input,
        clubId,
        operationId: input.requestId ?? input.operationId,
      });
      return current;
    });
    return { room, member: structuredClone(outcome.member), contract: structuredClone(outcome.contract) };
  }

  async manageProfessionalLifecycle(code, managerId, input) {
    let outcome;
    let professionalType = input.professionalType === "staff" ? "staff" : "coach";
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const now = careerDateFor(current, this.#now());
      professionalType = input.professionalType === "staff" ? "staff" : "coach";
      const manager = (current.managers ?? []).find((candidate) => candidate.id === managerId);
      if (!manager) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      const isCoachRetirementAction = professionalType === "coach"
        && [
          "retirement_announce",
          "retirement_postpone",
          "retirement_cancel",
        ].includes(input.action);
      const clubId = isCoachRetirementAction && !manager.clubId
        ? null
        : managedClubFor(current, managerId, input.clubId);
      let prepared = ensureCoachEmploymentState(current, { now });
      ensureClubCareerSystems(prepared, { now });
      prepared = ensureProfessionalLifecycleState(prepared, { now });
      prepared = ensureProfessionalLeaveState(prepared, { now });
      replaceRoom(current, prepared);

      const professionalId = professionalType === "coach"
        ? managerId
        : String(input.professionalId ?? input.staffId ?? "").trim();
      if (!professionalId) {
        throw new RoomError("Profissional da comissao nao informado", "PROFESSIONAL_REQUIRED", 400);
      }
      if (professionalType === "staff") {
        const member = (current.clubCareerState?.staffMembers ?? []).find(
          (candidate) => String(candidate.id) === professionalId,
        );
        if (!member || clubKey(member.clubId) !== clubKey(clubId)) {
          throw new RoomError(
            "Profissional nao pertence a comissao deste clube",
            "STAFF_CLUB_FORBIDDEN",
            403,
          );
        }
      }

      const operationId = input.requestId ?? input.operationId;
      const lifecycleId = input.lifecycleId
        ?? input.noticeId
        ?? input.retirementId
        ?? input.agreementId
        ?? input.leaveId;
      const lifecycleRecord = lifecycleId
        ? [
          ...(current.professionalLifecycleState?.notices ?? []),
          ...(current.professionalLifecycleState?.retirements ?? []),
          ...(current.professionalLifecycleState?.mutualAgreements ?? []),
          ...(current.professionalLeaveState?.leaves ?? []),
        ].find((candidate) => candidate.id === lifecycleId)
        : null;
      if (lifecycleRecord && (
        lifecycleRecord.professionalType !== professionalType
          || String(lifecycleRecord.professionalId) !== professionalId
          || (
            professionalType === "staff"
              && lifecycleRecord.clubId
              && clubKey(lifecycleRecord.clubId) !== clubKey(clubId)
          )
      )) {
        throw new RoomError(
          "Ciclo profissional pertence a outro vinculo",
          "PROFESSIONAL_LIFECYCLE_FORBIDDEN",
          403,
        );
      }
      const callbacks = professionalLifecycleCallbacks(now);
      const base = {
        ...input,
        professionalType,
        professionalId,
        coachId: professionalType === "coach" ? professionalId : input.coachId,
        staffId: professionalType === "staff" ? professionalId : input.staffId,
        clubId,
        operationId,
        requestId: operationId,
      };
      const terms = {
        ...(input.terms ?? {}),
        ...(input.compensation !== undefined ? { compensation: input.compensation } : {}),
        ...(input.terms?.waiverRate !== undefined ? { waivedRate: input.terms.waiverRate } : {}),
        ...(input.terms?.benefitsUntil ? { benefitsThrough: input.terms.benefitsUntil } : {}),
      };

      switch (input.action) {
        case "notice_start":
          outcome = startProfessionalNotice(current, {
            ...base,
            expectedEndDate: input.effectiveAt,
            noticeType: input.noticeType,
            immediateExit: input.immediateExit === true || input.noticeType === "immediate",
            interviewAllowed: input.interviewPermission,
            initiatedBy: input.noticeType === "negotiated"
              ? "mutual"
              : professionalType === "coach" ? "professional" : "club",
            compensationTerms: terms,
          }, callbacks);
          break;
        case "notice_end_early": {
          const notice = (current.professionalLifecycleState?.notices ?? [])
            .find((candidate) => candidate.id === lifecycleId && candidate.status === "active");
          const successor = professionalType === "coach"
            ? verifiedCoachNoticeSuccessor(current, notice, input.substituteCoachId)
            : null;
          outcome = endProfessionalNoticeEarly(current, {
            ...base,
            noticeId: lifecycleId,
            compensation: input.compensation,
            substituteCoachId: successor?.coachId,
          }, callbacks);
          break;
        }
        case "retirement_announce":
          {
            const retirementKind = {
              immediate: "immediate",
              end_of_season: "end_season",
              end_season: "end_season",
              end_of_contract: "end_contract",
              end_contract: "end_contract",
              planned: "future",
              scheduled: "future",
              future: "future",
            }[input.retirementType] ?? "future";
          outcome = scheduleProfessionalRetirement(current, {
            ...base,
            kind: retirementKind,
            effectiveAt: input.effectiveAt,
          }, callbacks);
          break;
          }
        case "retirement_postpone":
        case "retirement_cancel":
          outcome = updateProfessionalRetirement(current, {
            ...base,
            retirementId: lifecycleId,
            action: input.action === "retirement_postpone" ? "postpone" : "cancel",
            effectiveAt: input.newEffectiveAt ?? input.effectiveAt,
          }, callbacks);
          break;
        case "mutual_agreement_propose":
          outcome = proposeMutualSeparation(current, {
            ...base,
            proposedBy: professionalType === "coach" ? "professional" : "club",
            departureDate: input.proposedExitAt ?? input.effectiveAt,
            terms,
          }, callbacks);
          break;
        case "mutual_agreement_counter":
        case "mutual_agreement_accept":
        case "mutual_agreement_reject":
        case "mutual_agreement_sign": {
          const agreement = (current.professionalLifecycleState?.mutualAgreements ?? [])
            .find((candidate) => candidate.id === lifecycleId);
          const action = input.action.replace("mutual_agreement_", "");
          const actor = professionalType === "coach" ? "professional" : "club";
          if (agreement && action !== "sign" && agreement.nextResponder !== actor) {
            throw new RoomError(
              "A outra parte ainda precisa responder ao acordo",
              "PROFESSIONAL_MUTUAL_WAITING_COUNTERPARTY",
              409,
            );
          }
          outcome = respondMutualSeparation(current, {
            ...base,
            agreementId: lifecycleId,
            action,
            actor,
            departureDate: input.proposedExitAt ?? input.effectiveAt,
            terms,
          }, callbacks);
          break;
        }
        case "preferred_staff_update": {
          const staffIds = [...new Set([
            ...(input.staffIds ?? []),
            input.staffId,
          ].filter(Boolean).map(String))];
          let workingRoom = current;
          let preferredStaff = [];
          for (const staffId of staffIds) {
            const staffMember = [
              ...(workingRoom.clubCareerState?.staffMembers ?? []),
              ...(workingRoom.clubCareerState?.staffCandidates ?? []),
            ].find((candidate) => String(candidate.id) === staffId);
            if (!staffMember) {
              throw new RoomError(
                "Profissional da comissao nao encontrado",
                "PROFESSIONAL_STAFF_NOT_FOUND",
                404,
              );
            }
            const maySyncLink = !staffMember.clubId
              || clubKey(staffMember.clubId) === clubKey(clubId)
              || String(staffMember.linkedCoachId ?? "") === managerId;
            const result = setCoachPreferredStaff(workingRoom, {
              ...base,
              staffId,
              coachId: managerId,
              preferred: input.preferred,
              affiliationType: normalizedProfessionalAffiliation(
                input.affiliationType ?? input.linkType ?? "personal_team",
              ),
              operationId: `${operationId}:preferred:${staffId}`,
              initiatedBy: "coach",
              syncLink: maySyncLink,
            }, callbacks);
            workingRoom = result.room;
            preferredStaff = result.preferredStaff ?? preferredStaff;
          }
          outcome = { room: workingRoom, preferredStaff };
          break;
        }
        case "staff_link_update":
          outcome = setStaffCoachLink(current, {
            ...base,
            staffId: professionalId,
            coachId: input.linkedCoachId ?? input.coachId ?? null,
            linkedCoachId: input.linkedCoachId ?? input.coachId ?? null,
            affiliationType: normalizedProfessionalAffiliation(
              input.affiliationType ?? input.linkType,
            ),
          }, callbacks);
          break;
        case "staff_package_hire":
          outcome = hireCoachStaffPackage(current, {
            ...base,
            coachId: input.coachId ?? managerId,
            members: input.members ?? [],
            maximumFirstYearCost: input.maximumFirstYearCost,
          }, callbacks);
          break;
        case "interim_confirm": {
          if (professionalType !== "staff") {
            throw new RoomError(
              "Selecione o auxiliar interino que sera efetivado",
              "COACH_INTERIM_STAFF_REQUIRED",
              400,
            );
          }
          const interim = (current.coachEmploymentState?.appointments ?? []).find((appointment) => (
            appointment?.status === "active"
              && appointment?.role === "interim"
              && String(appointment?.sourceStaffId ?? "") === professionalId
              && clubKey(appointment?.clubId) === clubKey(clubId)
          ));
          const previouslyConfirmed = (current.coachEmploymentState?.appointments ?? []).find(
            (appointment) => appointment?.confirmationOperationId === operationId,
          );
          if (!interim && !previouslyConfirmed) {
            throw new RoomError(
              "Interino ativo nao encontrado para este profissional",
              "COACH_INTERIM_NOT_FOUND",
              404,
            );
          }
          outcome = confirmInterimCoach(current, {
            ...base,
            appointmentId: interim?.id,
            coachId: interim?.coachId,
            clubId,
          }, callbacks);
          break;
        }
        case "leave_start":
          outcome = startProfessionalLeave(current, {
            ...base,
            startsAt: input.startsAt ?? input.startDate,
            expectedEndAt: input.expectedEndAt ?? input.endDate ?? input.effectiveAt,
            paymentType: input.paymentType,
            paymentRate: input.paymentRate,
            paymentNotes: input.paymentNotes,
            actingStaffId: input.actingStaffId,
            temporaryBonus: input.temporaryBonus,
            authorityLevel: input.authorityLevel,
            initiatedBy: professionalType === "coach" ? "professional" : "club",
          }, callbacks);
          break;
        case "leave_end":
        case "leave_cancel":
          outcome = endProfessionalLeave(current, {
            ...base,
            leaveId: lifecycleId,
            action: input.action === "leave_cancel" ? "cancel" : "end",
            initiatedBy: professionalType === "coach" ? "professional" : "club",
          }, callbacks);
          break;
        default:
          throw new RoomError("Acao profissional invalida", "PROFESSIONAL_ACTION_INVALID", 400);
      }

      replaceRoom(current, outcome?.room ?? current);
      syncProfessionalLifecycleTimeline(current);
      if (professionalType === "coach") rebuildManagedSchedule(current);
      return current;
    });
    const lifecycle = lifecycleRecordFromOutcome(outcome);
    return {
      room,
      ...(lifecycle ? { lifecycle: structuredClone(lifecycle) } : {}),
      ...(outcome?.member ? { member: structuredClone(outcome.member) } : {}),
      ...(professionalType === "coach" ? {
        coachCareer: buildCoachCareerSnapshot(room, managerId, {
          now: careerDateFor(room, this.#now()),
        }),
      } : {}),
    };
  }

  async markClubNewsRead(code, managerId, input) {
    let news = [];
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      const readAt = careerDateFor(current, this.#now());
      news = (input.newsIds ?? [input.newsId]).filter(Boolean).map((newsId) => (
        markClubCareerNewsRead(current, { newsId, managerId, readAt })
      ));
      return current;
    });
    return { room, news: structuredClone(news), readCount: news.length };
  }

  async getMarketSnapshot(code, managerId, { withMetadata = false } = {}) {
    let settlementChanged = false;
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      if (current.status !== "active") {
        throw new RoomError("Inicie a temporada antes de usar o mercado", "MARKET_ROOM_NOT_ACTIVE", 409);
      }
      const hadState = Boolean(current.marketState);
      const settlement = settleExpiredMarket(current, this.#now());
      const beforeSideEffects = JSON.stringify(current.clubCareerState ?? null);
      syncMarketCareerSideEffects(current);
      const sideEffectsChanged = beforeSideEffects !== JSON.stringify(current.clubCareerState ?? null);
      // Firestore pode repetir o callback transacional; o ultimo snapshot lido
      // determina se esta sincronizacao realmente liquidou algo.
      settlementChanged = settlement.changed;
      return !hadState || settlement.changed || sideEffectsChanged ? current : undefined;
    });
    const snapshot = await this.#marketSnapshotFor(room, managerId);
    return withMetadata ? { snapshot, settlementChanged } : snapshot;
  }

  async createMarketOffer(code, managerId, input) {
    const preview = await this.requireMembership(code, managerId);
    const player = await this.#loadMarketPlayer(preview, input.playerId);
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const now = this.#now();
      settleExpiredMarket(current, now);
      const clubId = managedClubFor(current, managerId);
      assertNoticeLongTermDecisionApproved(current, managerId, clubId, input, "esta proposta de mercado");
      outcome = createMarketOffer(current, managerId, input, player, now);
      syncMarketCareerSideEffects(current);
      return current;
    });
    return marketOutcomeForViewer(await this.#marketSnapshotFor(room, managerId), outcome);
  }

  async getScoutingSnapshot(code, managerId, playerId = null) {
    const room = await this.requireMembershipPaths(code, managerId, SCOUTING_READ_PATHS);
    return scoutingSnapshot(room, managerId, playerId);
  }

  async getOpponentStudy(code, managerId, { clubId, depth = "standard" } = {}, catalogStore = this.#catalogStore) {
    const room = await this.requireMembershipPaths(code, managerId, TACTICAL_STUDY_PATHS);
    const context = tacticalStudyContext(room, managerId, clubId, this.#now());
    if (!context) return null;
    let players = [];
    if (studyKnowledge(room, context).available > 0) {
      const catalog = await catalogForOwner(catalogStore, room.catalogOwnerId || room.ownerId);
      let incomingError;
      const guardedCatalog = { async get(collection, id) {
        try {
          const player = await catalog?.get?.(collection, id);
          if (!player || String(player.id).toUpperCase() !== String(id).toUpperCase()) throw scoutingError("Dados de atleta contratado indisponíveis.", "STUDY_PLAYER_UNAVAILABLE", 503);
          return player;
        } catch (error) { incomingError = error; throw error; }
      }, async listPlayers(id) {
        if (typeof catalog?.listPlayers !== "function") throw scoutingError("Catálogo indisponível para análise.", "STUDY_CATALOG_UNAVAILABLE", 503);
        const result = await catalog.listPlayers(id);
        if (!Array.isArray(result?.players)) throw scoutingError("Catálogo retornou um elenco inválido.", "STUDY_ROSTER_INVALID", 503);
        return result;
      } };
      const roster = await listRoomPlayers(guardedCatalog, room, context.target.id);
      // roomRoster tolerates missing incoming snapshots for legacy callers; studies cannot silently omit them.
      if (incomingError) throw incomingError;
      players = roster.players;
      if (!players.length) throw scoutingError("Elenco indisponível para produzir o relatório.", "STUDY_ROSTER_EMPTY", 409);
    }
    return buildClubTacticalStudy(room, context, players, depth, this.#tacticalStudyCache);
  }

  async startOpponentStudy(code, managerId, input) {
    await this.requireMembershipPaths(code, managerId, []);
    await this.#persistence.mutatePaths(this.#normalizeCode(code), TACTICAL_STUDY_PATHS, (room) => {
      if (!startTacticalStudy(room, managerId, input, this.#now())) return undefined;
      room.revision = (room.revision || room.version || 0) + 1;
      room.version = room.revision;
      room.updatedAt = this.#now().toISOString();
      return room;
    });
  }

  async updateScouting(code, managerId, input) {
    const preview = await this.requireMembershipPaths(code, managerId, SCOUTING_WRITE_PATHS);
    scoutingClub(preview, managerId, input.clubId);
    let fallback = null;
    if (scoutingNeedsPlayer(preview, managerId, input) && !scoutingPlayer(preview, input.playerId)) {
      const catalog = await catalogForOwner(this.#catalogStore, preview.catalogOwnerId || preview.ownerId);
      if (typeof catalog?.get !== "function") throw scoutingError("Catalogo de jogadores indisponivel", "SCOUTING_CATALOG_UNAVAILABLE", 503);
      // A catalog timeout is not equivalent to a missing player.
      fallback = await catalog.get("players", input.playerId);
      if (!fallback) throw scoutingError("Jogador nao encontrado", "SCOUTING_PLAYER_NOT_FOUND", 404);
    }
    let outcome;
    let snapshot;
    await this.#persistence.mutatePaths(this.#normalizeCode(code), SCOUTING_WRITE_PATHS, (current) => {
      outcome = applyScoutingAction(current, managerId, input, fallback, this.#now());
      if (!outcome.duplicate) {
        current.revision = (current.revision || current.version || 0) + 1;
        current.version = current.revision;
        current.updatedAt = this.#now().toISOString();
      }
      snapshot = scoutingSnapshot(current, managerId, input.playerId);
      return outcome.duplicate ? undefined : current;
    });
    return { snapshot, ...outcome };
  }

  async respondMarketOffer(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const now = this.#now();
      settleExpiredMarket(current, now);
      if (["accept", "counter"].includes(input.action)) {
        const clubId = managedClubFor(current, managerId);
        assertNoticeLongTermDecisionApproved(current, managerId, clubId, input, "esta negociação");
      }
      outcome = respondMarketOffer(current, managerId, input, now);
      syncMarketCareerSideEffects(current);
      return current;
    });
    return marketOutcomeForViewer(await this.#marketSnapshotFor(room, managerId), outcome);
  }

  async createMarketListing(code, managerId, input) {
    const preview = await this.requireMembership(code, managerId);
    const player = await this.#loadMarketPlayer(preview, input.playerId);
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const now = this.#now();
      settleExpiredMarket(current, now);
      const clubId = managedClubFor(current, managerId);
      assertNoticeLongTermDecisionApproved(current, managerId, clubId, input, "este anúncio de jogador");
      outcome = createMarketListing(current, managerId, input, player, now);
      syncMarketCareerSideEffects(current);
      return current;
    });
    return marketOutcomeForViewer(await this.#marketSnapshotFor(room, managerId), outcome);
  }

  async placeMarketBid(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const now = this.#now();
      settleExpiredMarket(current, now);
      const clubId = managedClubFor(current, managerId);
      assertNoticeLongTermDecisionApproved(current, managerId, clubId, input, "este lance");
      outcome = placeMarketBid(current, managerId, input, now);
      syncMarketCareerSideEffects(current);
      return current;
    });
    return marketOutcomeForViewer(await this.#marketSnapshotFor(room, managerId), outcome);
  }

  async cancelMarketListing(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const now = this.#now();
      settleExpiredMarket(current, now);
      outcome = cancelMarketListing(current, managerId, input, now);
      syncMarketCareerSideEffects(current);
      return current;
    });
    return marketOutcomeForViewer(await this.#marketSnapshotFor(room, managerId), outcome);
  }

  async exerciseMarketLoanOption(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const now = this.#now();
      settleExpiredMarket(current, now);
      const clubId = managedClubFor(current, managerId);
      assertNoticeLongTermDecisionApproved(current, managerId, clubId, input, "esta opção de compra");
      outcome = exerciseMarketLoanOption(current, managerId, input, now);
      syncMarketCareerSideEffects(current);
      return current;
    });
    return marketOutcomeForViewer(await this.#marketSnapshotFor(room, managerId), outcome);
  }

  async getCoachCareerSnapshot(code, managerId) {
    let room;
    if (typeof this.#persistence.getPaths === "function") {
      room = await this.requireMembershipPaths(code, managerId, COACH_CAREER_SNAPSHOT_PATHS);
      // Older saves may still require legacy markers and catalog hydration.
      // Keep the established full migration path for those saves only.
      if (coachCareerProjectionNeedsLegacyHydration(room)) {
        room = await this.requireMembership(code, managerId);
      }
    } else {
      room = await this.requireMembership(code, managerId);
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
      }, coachEmploymentCallbacks(now));
      const next = outcome.room;
      const afterClubId = next.managers.find((manager) => manager.id === managerId)?.clubId ?? null;
      if (clubKey(beforeClubId) !== clubKey(afterClubId)) rebuildManagedSchedule(next);
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
      }, coachEmploymentCallbacks(now));
      if (outcome.appointment) rebuildManagedSchedule(outcome.room);
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
      }, coachEmploymentCallbacks(now));
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
      }, coachEmploymentCallbacks(now));
      return outcome.room;
    });
    return {
      room,
      coachCareer: buildCoachCareerSnapshot(room, managerId, { now: careerDateFor(room, this.#now()) }),
    };
  }

  async startCoachInterview(code, managerId, interviewId, input) {
    const snapshot = await this.requireMembership(code, managerId);
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
      }, coachEmploymentCallbacks(now));
      return outcome.room;
    });
    return {
      room,
      coachCareer: buildCoachCareerSnapshot(room, managerId, { now: careerDateFor(room, this.#now()) }),
    };
  }

  async answerCoachInterviewTurn(code, managerId, interviewId, input) {
    const snapshot = await this.requireMembership(code, managerId);
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
      }, coachEmploymentCallbacks(now));
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
      }, coachEmploymentCallbacks(now));
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
      }, coachEmploymentCallbacks(now));
      rebuildManagedSchedule(outcome.room);
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
        ...coachEmploymentCallbacks(now),
        minimumVacancyDays: 7,
      });
      return progressed.room;
    });
    return {
      room,
      coachCareer: buildCoachCareerSnapshot(room, managerId, { now: careerDateFor(room, this.#now()) }),
    };
  }

  async getCareerSnapshot(code, managerId) {
    const careerPaths = [
      "careerState.players",
      "careerState.trainingPlans",
      "careerState.nationalSquads",
      "careerState.nationalTeamSquads",
      "marketState.registrations",
    ];
    if (typeof this.#persistence.getSectionTail !== "function") careerPaths.push("seasonHistory");
    let room = await this.requireMembershipPaths(code, managerId, careerPaths);
    let usedMigrationFallback = false;
    // Application-level legacy saves may not have careerState yet. Hydrate and
    // persist that migration once; subsequent reads use only the projection.
    if (room.status === "active" && !Array.isArray(room.careerState?.players)) {
      room = await this.requireMembership(code, managerId);
      usedMigrationFallback = true;
    }
    const manager = room.managers.find((candidate) => candidate.id === managerId);
    const club = clubKey(manager?.clubId);
    const state = room.careerState ?? {};
    const players = careerRosterForTransition(room, state.players ?? []).filter((player) => (
      clubKey(player?.currentClubId ?? player?.clubId) === club
    ));
    const playerIds = new Set(players.map((player) => String(player.id)));
    const lastSeason = !usedMigrationFallback && typeof this.#persistence.getSectionTail === "function"
      ? await this.#persistence.getSectionTail(room.code, "seasonHistory")
      : room.seasonHistory?.at(-1) ?? null;
    return {
      currentSeason: room.currentSeason,
      players: structuredClone(players),
      trainingPlans: structuredClone((state.trainingPlans ?? []).filter(
        (plan) => playerIds.has(String(plan.playerId)),
      )),
      nationalSquads: structuredClone(state.nationalSquads ?? state.nationalTeamSquads ?? []),
      lastSummary: structuredClone(lastSeason?.careerSummary ?? null),
    };
  }

  async setTrainingPlan(code, managerId, input) {
    return this.#mutate(code, (room) => {
      const manager = room.managers.find((candidate) => candidate.id === managerId);
      if (!manager?.clubId) throw new RoomError("Manager sem clube", "CLUB_REQUIRED", 409);
      const player = (room.careerState?.players ?? []).find(
        (candidate) => String(candidate?.id) === String(input.playerId),
      );
      const registration = marketRegistrationForPlayer(room, input.playerId);
      const currentClubId = registration?.currentClubId
        ?? player?.currentClubId
        ?? player?.clubId
        ?? player?.contract?.clubId;
      if (!player || clubKey(currentClubId) !== clubKey(manager.clubId)) {
        throw new RoomError("Jogador nao pertence ao seu clube", "CAREER_PLAYER_NOT_FOUND", 404);
      }
      const others = (room.careerState.trainingPlans ?? []).filter(
        (plan) => String(plan.playerId) !== String(input.playerId),
      );
      room.careerState.trainingPlans = normalizeTrainingPlans([
        ...others,
        { ...input, active: input.active !== false },
      ]);
      return room;
    });
  }

  async renewPlayerContract(code, managerId, input) {
    return this.#mutate(code, (room) => {
      const manager = room.managers.find((candidate) => candidate.id === managerId);
      if (!manager?.clubId) throw new RoomError("Manager sem clube", "CLUB_REQUIRED", 409);
      const index = (room.careerState?.players ?? []).findIndex(
        (candidate) => String(candidate?.id) === String(input.playerId),
      );
      const player = room.careerState?.players?.[index];
      if (!player || clubKey(player.contract?.clubId ?? player.clubId) !== clubKey(manager.clubId)) {
        throw new RoomError("Jogador nao pertence ao seu clube", "CAREER_PLAYER_NOT_FOUND", 404);
      }
      const previousContract = structuredClone(player.contract ?? null);
      const renewed = resolveContractCycle([player], {
        seasonNumber: room.currentSeason,
        renewals: [{ playerId: player.id, years: input.years, wage: input.wage }],
      }).players[0];
      room.careerState.players[index] = renewed;
      const occurredAt = careerDateFor(room, this.#now());
      ensureClubCareerSystems(room, { now: occurredAt });
      const operationId = `contract-renewal:${player.id}:${previousContract?.endSeason ?? "none"}:${renewed.contract?.endSeason ?? room.currentSeason}`;
      recordClubCareerEvent(room, {
        id: operationId,
        operationId,
        type: "PLAYER_CONTRACT_RENEWED",
        occurredAt,
        seasonNumber: room.currentSeason,
        clubIds: [manager.clubId],
        playerIds: [player.id],
        payload: {
          clubId: manager.clubId,
          playerId: player.id,
          endSeason: renewed.contract?.endSeason,
          wage: renewed.contract?.wage,
        },
      });
      return room;
    });
  }

  async promoteAcademyPlayer(code, managerId, input) {
    return this.#mutate(code, (room) => {
      const manager = room.managers.find((candidate) => candidate.id === managerId);
      if (!manager?.clubId) throw new RoomError("Manager sem clube", "CLUB_REQUIRED", 409);
      const index = (room.careerState?.players ?? []).findIndex(
        (candidate) => String(candidate?.id) === String(input.playerId),
      );
      const player = room.careerState?.players?.[index];
      if (!player || clubKey(player.contract?.clubId ?? player.clubId) !== clubKey(manager.clubId)) {
        throw new RoomError("Jogador da base nao encontrado", "ACADEMY_PLAYER_NOT_FOUND", 404);
      }
      try {
        room.careerState.players[index] = promoteYouthPlayer(player, {
          seasonNumber: room.currentSeason,
          contractYears: input.years,
          wage: input.wage,
        });
        const occurredAt = careerDateFor(room, this.#now());
        ensureClubCareerSystems(room, { now: occurredAt });
        const operationId = `academy-promotion:s${room.currentSeason}:${player.id}`;
        recordClubCareerEvent(room, {
          id: operationId,
          operationId,
          type: "YOUTH_PROMOTED",
          occurredAt,
          seasonNumber: room.currentSeason,
          clubIds: [manager.clubId],
          playerIds: [player.id],
          payload: { clubId: manager.clubId, playerId: player.id },
        });
      } catch (error) {
        throw new RoomError(error.message, "ACADEMY_PROMOTION_INVALID", 409);
      }
      return room;
    });
  }

  async completeMatch(code, fixtureId, result) {
    const previewRoom = await this.requireRoom(code);
    const competitionParticipantRefs = (previewRoom.competitionSeason?.competitions ?? [])
      .flatMap((competition) => (competition.participants ?? []).map((participant) => ({
        homeClubId: participant?.id,
      })));
    const previewAiFixtures = [
      ...aiFixturesForCompletion(previewRoom, fixtureId),
      ...(previewRoom.competitionSeason?.fixtures ?? []),
      ...competitionParticipantRefs,
    ];
    const aiRosters = await this.#loadAiRosters(
      previewRoom,
      previewAiFixtures,
    );
    const aiMarketPlayers = [...aiRosters.values()].flat();
    const remainingManagedFixtures = (previewRoom.fixtureSchedule ?? []).filter((fixture) => (
      !fixtureIdsEqual(fixture.fixtureId, fixtureId)
      && !(previewRoom.completedFixtureIds ?? []).some((id) => fixtureIdsEqual(id, fixture.fixtureId))
    ));
    const careerRoster = remainingManagedFixtures.length === 0
      ? await this.#loadCareerRoster(previewRoom)
      : [];
    let marketTickRecord = null;
    const room = await this.#mutate(code, (current) => {
      // A CAS retry discards the previous callback's uncommitted telemetry.
      marketTickRecord = null;
      if (current.status !== "active") {
        throw new RoomError("A sala nao esta ativa", "ROOM_NOT_ACTIVE", 409);
      }
      ensureCareerState(current, this.#now());
      replaceRoom(current, ensureCoachEmploymentState(current, {
        now: careerDateFor(current, this.#now()),
      }));
      ensureClubCareerSystems(current, { now: careerDateFor(current, this.#now()) });
      if (ensureFixtureSchedule(current)) assertScheduleSize(current);
      current.completedFixtureIds ??= [];
      current.completedMatches ??= [];
      current.leagueMatchResults ??= [];
      const previousLeagueResultIds = new Set(current.leagueMatchResults
        .map((entry) => fixtureResultKey(entry?.leagueFixtureId))
        .filter(Boolean));
      if (current.completedFixtureIds.some((completedId) => fixtureIdsEqual(completedId, fixtureId))) {
        throw new RoomError("Esta fixture ja foi concluida", "FIXTURE_ALREADY_COMPLETED", 409);
      }
      if (!fixtureIdsEqual(current.currentFixtureId, fixtureId)) {
        throw new RoomError("Esta fixture nao e a atual", "FIXTURE_NOT_CURRENT", 409);
      }
      const humanFixture = current.fixtureSchedule?.find(
        (fixture) => fixtureIdsEqual(fixture.fixtureId, fixtureId),
      );
      const canonicalFixtureId = humanFixture?.fixtureId ?? current.currentFixtureId;
      let upcomingFixtureId = null;
      const completedAt = this.#now().toISOString();
      const careerCompletedAt = humanFixture?.scheduledAt ?? careerDateFor(current, completedAt);
      if (simulateOfficialAiBeforeNextManaged(current, completedAt, aiRosters) > 0) {
        const next = rebuildManagedSchedule(current);
        if (!fixtureIdsEqual(next?.fixtureId, canonicalFixtureId)) {
          throw new RoomError("O calendario mudou; prepare a proxima partida novamente", "FIXTURE_NOT_CURRENT", 409);
        }
      }
      const lifecycleCallbacks = professionalLifecycleCallbacks(careerCompletedAt);
      const leaveProgress = processProfessionalLeaveDate(
        current,
        careerCompletedAt,
        lifecycleCallbacks,
      );
      replaceRoom(current, leaveProgress.room);
      processClubCareerDate(current, careerCompletedAt);
      const participatingManagerIds = new Set([
        ...(humanFixture?.managerIds ?? []),
        humanFixture?.homeManagerId,
        humanFixture?.awayManagerId,
      ].filter(Boolean));
      current.lineups = (current.lineups ?? []).map((lineup) => {
        if (!participatingManagerIds.has(lineup.managerId) || lineup.lineupIds?.length !== 11) {
          return lineup;
        }
        const staffEffects = clubCareerPerformanceEffects(current, lineup.clubId, careerCompletedAt).staff;
        const cohesion = calculateTeamCohesion({
          previous: lineup.cohesion,
          lineupIds: lineup.lineupIds,
          tactics: lineup.tactics,
          reason: "match",
          cohesionGainBonus: staffEffects?.cohesionGainBonus,
          cohesionChangePenaltyMultiplier: staffEffects?.cohesionChangePenaltyMultiplier,
        });
        return {
          ...lineup,
          cohesion: { ...cohesion, updatedAt: completedAt },
        };
      });
      const previousPlayerStates = structuredClone(current.playerStates ?? []);
      const progression = applyMatchPlayerProgression(
        current,
        humanFixture ?? { fixtureId: canonicalFixtureId },
        result,
        completedAt,
      );
      let trainingEffects = [];
      if ((current.careerState?.players ?? []).length > 0
        && (current.careerState?.trainingPlans ?? []).length > 0) {
        const training = applyTrainingCycle(current.careerState.players, {
          seasonNumber: current.currentSeason,
          plans: current.careerState.trainingPlans,
          cycleId: `s${current.currentSeason}:${canonicalFixtureId}`,
          clubEffects: clubCareerEffectsByClub(current, careerCompletedAt),
        });
        current.careerState.players = training.players;
        trainingEffects = training.effects;
      }
      const leagueFixtureId = humanFixture?.leagueFixtureId ?? null;
      const leagueScore = humanFixture?.leagueFixtureReversed
        ? [...scorePair(result.score)].reverse()
        : scorePair(result.score);
      const matchPossession = possessionPair(result.statistics);
      const leaguePossession = humanFixture?.leagueFixtureReversed && matchPossession
        ? [...matchPossession].reverse()
        : matchPossession;
      const existingLeagueResult = leagueFixtureId
        ? resultForLeagueFixture(current, leagueFixtureId)
        : null;
      if (leagueFixtureId && !existingLeagueResult) {
        current.leagueMatchResults.push(compactLeagueResult({
          id: result.id,
          fixtureId: leagueFixtureId,
          managedFixtureId: canonicalFixtureId,
          leagueFixtureId,
          leagueId: humanFixture?.leagueId ?? null,
          round: humanFixture?.round ?? null,
          source: "manager",
          score: leagueScore,
          possession: leaguePossession,
          completedAt,
          room: current,
        }));
      }

      recordCompetitionFixture(current, humanFixture, result, completedAt);
      simulateOfficialAiBeforeNextManaged(current, completedAt, aiRosters, humanFixture?.scheduledAt);
      // Avance uma vez cada rodada realmente concluida, inclusive nas ligas
      // simuladas pela IA. Liquide depois para nao consumir imediatamente uma
      // rodada de emprestimos fechados neste mesmo ciclo.
      advanceCompletedLeagueLoanRounds(
        current,
        previousLeagueResultIds,
        current.currentSeason,
        completedAt,
      );
      settleExpiredMarket(current, completedAt);
      const competitionAwards = awardCompletedCompetitionPrizes(current, {
        occurredAt: careerCompletedAt,
      }).filter((award) => award.title?.created || award.prize?.applied);
      const matchdayEconomies = recordNewLeagueMatchEconomies(
        current,
        previousLeagueResultIds,
        careerCompletedAt,
      );
      if (!leagueFixtureId && humanFixture?.homeClubId && humanFixture?.awayClubId) {
        const economy = recordClubMatchday(current, {
          fixtureId: canonicalFixtureId,
          homeClubId: humanFixture.homeClubId,
          awayClubId: humanFixture.awayClubId,
          competitionId: humanFixture.competitionId ?? humanFixture.tournamentId,
          competitionName: humanFixture.competition,
          stage: humanFixture.stage,
          round: humanFixture.round,
          score: result.score,
          occurredAt: careerCompletedAt,
        });
        if (economy) matchdayEconomies.push(economy);
      }
      syncMarketCareerSideEffects(current);
      const recoveryEffects = applyClubRecoveryEffects(current, careerCompletedAt);
      recordPlayerAvailabilityEvents(current, {
        fixtureId: canonicalFixtureId,
        competitionId: humanFixture?.leagueId
          ?? humanFixture?.competitionId
          ?? humanFixture?.tournamentId
          ?? null,
        seasonNumber: current.currentSeason,
        previousPlayerStates,
        occurredAt: careerCompletedAt,
      });

      const summary = {
        code: current.code,
        id: result.id,
        fixtureId: canonicalFixtureId,
        homeClubId: humanFixture?.homeClubId ?? result.homeClubId ?? null,
        awayClubId: humanFixture?.awayClubId ?? result.awayClubId ?? null,
        homeManagerId: humanFixture?.homeManagerId ?? null,
        awayManagerId: humanFixture?.awayManagerId ?? null,
        managerIds: [...(humanFixture?.managerIds ?? [])],
        homeTeam: result.homeTeam,
        awayTeam: result.awayTeam,
        score: structuredClone(result.score),
        statistics: structuredClone(result.statistics),
        ...(result.simulationVersion ? { simulationVersion: result.simulationVersion } : {}),
        ...(Array.isArray(result.events)
          ? { events: structuredClone(result.events) }
          : {}),
        ...(result.playerStatistics
          ? { playerStatistics: structuredClone(result.playerStatistics) }
          : {}),
        ...(progression.playerEffects.length > 0
          ? { playerEffects: structuredClone(progression.playerEffects) }
          : {}),
        ...(trainingEffects.length > 0
          ? { trainingEffects: structuredClone(trainingEffects) }
          : {}),
        ...(matchdayEconomies.length > 0
          ? { matchdayEconomies: structuredClone(matchdayEconomies) }
          : {}),
        ...(recoveryEffects.changed > 0
          ? { recoveryEffects: structuredClone(recoveryEffects) }
          : {}),
        ...(competitionAwards.length > 0
          ? { competitionAwards: structuredClone(competitionAwards.map((award) => ({
            competitionId: award.competitionId,
            winnerClubId: award.winnerClubId,
            amount: award.amount,
            awarded: award.awarded,
          }))) }
          : {}),
        ...(result.starImpact ? { starImpact: structuredClone(result.starImpact) } : {}),
        ...(result.strengthProfile ? { strengthProfile: structuredClone(result.strengthProfile) } : {}),
        ...(result.tacticalMatchup ? { tacticalMatchup: structuredClone(result.tacticalMatchup) } : {}),
        ...(result.homeFormation ? { homeFormation: result.homeFormation } : {}),
        ...(result.awayFormation ? { awayFormation: result.awayFormation } : {}),
        skipped: Boolean(result.skipped),
        completedAt,
        seasonNumber: current.currentSeason,
        seasonYear: current.seasonYear,
        roomRevision: (current.revision || current.version || 0) + 1,
        nextFixtureId: upcomingFixtureId,
      };
      current.completedFixtureIds.push(canonicalFixtureId);
      upcomingFixtureId = rebuildManagedSchedule(current)?.fixtureId ?? null;
      summary.nextFixtureId = upcomingFixtureId;
      // Existing selectors keep compact summaries. The committed outbox below
      // preserves full sporting details in the separate paginated archive.
      current.completedMatches.push(compactCompletedMatch(summary));
      const humanRoundResult = {
        ...summary,
        fixtureId: canonicalFixtureId,
        completedAt,
      };
      summary.roundSummary = roundSummaryFor(current, humanFixture, humanRoundResult);
      current.lastCompletedMatch = summary;
      current.lastCompletedRound = structuredClone(summary.roundSummary);

      // Atualize primeiro a avaliacao do cargo. O ciclo profissional da IA deve
      // decidir com base na rodada que acabou de ser persistida, nao na anterior.
      const coachProgress = processCoachEmploymentDate(
        current,
        careerCompletedAt,
        {
          ...coachEmploymentCallbacks(careerCompletedAt),
          minimumGames: 5,
          autoDismissAI: true,
          autoDismissHuman: true,
        },
      );
      replaceRoom(current, coachProgress.room);
      // ensureCoachEmploymentState clona a sala. Reanexe o mesmo resumo para
      // que os ciclos abaixo e a transicao de temporada persistam este payload.
      current.lastCompletedMatch = summary;
      current.lastCompletedRound = structuredClone(summary.roundSummary);
      if (coachProgress.events.length > 0) {
        summary.coachCareerEvents = coachProgress.events.map((event) => ({
          id: event.id,
          type: event.type,
          coachId: event.coachId,
          clubId: event.clubId,
          occurredAt: event.occurredAt,
        }));
      }

      const aiLifecycleProgress = runAiProfessionalLifecycleTick(
        current,
        careerCompletedAt,
        lifecycleCallbacks,
      );
      replaceRoom(current, aiLifecycleProgress.room);
      syncProfessionalLifecycleTimeline(current);
      const lifecycleProgress = processProfessionalLifecycleDate(
        current,
        careerCompletedAt,
        lifecycleCallbacks,
      );
      replaceRoom(current, lifecycleProgress.room);
      syncProfessionalLifecycleTimeline(current);
      current.lastCompletedMatch = summary;
      current.lastCompletedRound = structuredClone(summary.roundSummary);
      if (lifecycleProgress.outcomes.length > 0) {
        summary.professionalLifecycleEvents = lifecycleProgress.outcomes.map((entry) => ({
          type: entry.type,
          id: entry.record?.id ?? null,
          status: entry.record?.status ?? null,
          professionalType: entry.record?.professionalType ?? null,
          professionalId: entry.record?.professionalId ?? null,
        }));
      }
      if (leaveProgress.activated.length > 0 || leaveProgress.completed.length > 0) {
        summary.professionalLeaveEvents = [
          ...leaveProgress.activated.map((record) => ({
            type: "activated",
            id: record.id,
            professionalType: record.professionalType,
            professionalId: record.professionalId,
            status: record.status,
          })),
          ...leaveProgress.completed.map((record) => ({
            type: "completed",
            id: record.id,
            professionalType: record.professionalType,
            professionalId: record.professionalId,
            status: record.status,
          })),
        ];
      }
      if (aiLifecycleProgress.decisions.length > 0) {
        summary.professionalLifecycleAiDecisions = aiLifecycleProgress.decisions.map((entry) => ({
          action: entry.action,
          professionalType: entry.professionalType,
          professionalId: entry.professionalId,
          clubId: entry.clubId,
          resultStatus: entry.resultStatus,
          reason: entry.reason,
        }));
      }
      const nextAfterCoachChanges = rebuildManagedSchedule(current);
      upcomingFixtureId = nextAfterCoachChanges?.fixtureId ?? null;
      summary.nextFixtureId = upcomingFixtureId;

      // Receipt and market effects commit together with the match result.
      if (summary.roundSummary.complete && Number.isInteger(humanFixture?.round)) {
        const aiMarketTick = runRecordedAiMarketTick(current, {
          players: aiMarketPlayers,
          seasonNumber: current.currentSeason,
          round: humanFixture.round,
          leagueId: humanFixture.leagueId,
        }, completedAt, { execute: this.#aiMarketExecutor });
        if (!aiMarketTick.duplicate) marketTickRecord = aiMarketTick.record;
        summary.aiMarketTick = structuredClone(aiMarketTick.record);
        if (aiMarketTick.changed) {
          const { record: _record, ...transfer } = aiMarketTick;
          summary.aiMarketTransfer = structuredClone(transfer);
        }
        // Rollback restores cloned branches, including lastCompletedMatch.
        current.lastCompletedMatch = summary;
      }

      if (!upcomingFixtureId) {
        // Odd-sized leagues may leave the manager on a BYE while AI clubs play.
        // Finish those AI-only rounds before closing or rolling the season.
        simulateOfficialAiBeforeNextManaged(current, completedAt, aiRosters, humanFixture?.scheduledAt);
        competitionAwards.push(...awardCompletedCompetitionPrizes(current, {
          occurredAt: careerCompletedAt,
        }).filter((award) => award.title?.created || award.prize?.applied));
        if (competitionAwards.length > 0) {
          summary.competitionAwards = structuredClone(competitionAwards.map((award) => ({
            competitionId: award.competitionId,
            winnerClubId: award.winnerClubId,
            amount: award.amount,
            awarded: award.awarded,
          })));
        }
        // Competition winners can be created while the final AI-only fixtures
        // are completed above. Process only conduct achievements now so title
        // reputation is persisted before a finite career closes or rolls over.
        const titleConductProgress = processCoachEmploymentDate(
          current,
          careerCompletedAt,
          {
            ...coachEmploymentCallbacks(careerCompletedAt),
            conductOnly: true,
          },
        );
        replaceRoom(current, titleConductProgress.room);
        current.lastCompletedMatch = summary;
        if (titleConductProgress.events.length > 0) {
          summary.coachCareerEvents = [
            ...(summary.coachCareerEvents ?? []),
            ...titleConductProgress.events.map((event) => ({
              id: event.id,
              type: event.type,
              coachId: event.coachId,
              clubId: event.clubId,
              occurredAt: event.occurredAt,
            })),
          ];
        }
        upcomingFixtureId = rebuildManagedSchedule(current)?.fixtureId ?? null;
        summary.nextFixtureId = upcomingFixtureId;
        if (!upcomingFixtureId) {
          const seasonNumber = current.currentSeason;
          const rankingTimeline = compactLeagueRankingTimeline(buildLeagueRankingTimeline({
            leagues: (current.competitionCatalog ?? []).filter((league) => league?.active !== false),
            fixtures: current.leagueFixtureSchedule,
            results: current.leagueMatchResults,
            managers: current.managers,
            coachCareerState: current.coachCareerState,
            seasonNumber,
            seasonYear: current.seasonYear,
          }));
          const managerMatchHistory = archiveManagerMatchHistory(current);
          const leagueTransition = transitionLeagueDivisions(current);
          const tournamentWinners = archiveTournamentWinners(current);
          const historyEntry = {
            seasonNumber,
            seasonYear: current.seasonYear,
            startedAt: current.seasonStartedAt,
            completedAt,
            completedFixtureIds: [...current.completedFixtureIds],
            matchIds: current.completedMatches
              .filter((match) => (match.seasonNumber ?? seasonNumber) === seasonNumber)
              .map((match) => match.id),
            managerMatchHistory,
            tournamentWinners,
            promotionMovements: structuredClone(leagueTransition.movements),
            rankingTimeline,
          };
          const nextSeasonNumber = current.currentSeason + 1;
          returnLoansForSeason(current, nextSeasonNumber, completedAt);
          if (careerHasNextSeason(current)) {
            processScheduledTransfers(current, nextSeasonNumber, completedAt);
            const sourceCareerRoster = careerRosterForTransition(current, careerRoster);
            const minutesByPlayer = Object.fromEntries((current.playerStates ?? []).map((state) => [
              state.playerId,
              Number(state.seasonStats?.minutes ?? 0),
            ]));
            const nationalities = [...new Set(sourceCareerRoster
              .map((player) => String(player.nationality ?? "").trim())
              .filter(Boolean))];
            const careerTransition = processCareerSeasonTransition(
              current.careerState ?? { saveId: current.id, currentSeason: current.currentSeason },
              {
                toSeason: nextSeasonNumber,
                roster: sourceCareerRoster,
                clubs: careerClubs(current),
                renewals: current.careerState?.pendingRenewals ?? [],
                trainingPlans: current.careerState?.trainingPlans ?? [],
                minutesByPlayer,
                youthCountPerClub: 2,
                nationalTeams: nationalities.map((country) => ({ id: country, country })),
                nationalSquadSize: 23,
                seed: current.id,
              },
            );
            current.careerState = {
              ...careerTransition.careerState,
              pendingRenewals: [],
              // Old retired records stay in season history, not forever in Firestore.
              players: careerTransition.players.filter((player) => (
                !player.retired || Number(player.retirementSeason) >= current.currentSeason
              )),
            };
            recordCareerTransitionEvents(current, {
              summary: careerTransition.summary,
              previousPlayers: sourceCareerRoster,
              occurredAt: completedAt,
            });
            reconcileMarketCareerState(current, completedAt);
            historyEntry.careerSummary = structuredClone(careerTransition.summary);
            current.competitionCatalog = leagueTransition.competitionCatalog;
            current.currentSeason += 1;
            current.seasonYear += 1;
            current.seasonStartedAt = completedAt;
            current.completedFixtureIds = [];
            current.leagueMatchResults = [];
            current.playerStates = (current.playerStates ?? []).map((state) => ({
              ...state,
              condition: 100,
              yellowCardAccumulator: 0,
              competitionStats: [],
              seasonStats: {
                seasonNumber: current.currentSeason,
                appearances: 0,
                starts: 0,
                minutes: 0,
                goals: 0,
                assists: 0,
                yellowCards: 0,
                redCards: 0,
                injuries: 0,
                ratedMatches: 0,
                ratingTotal: 0,
              },
            }));
            current.playerCompetitionStatsCoverage = [];
            current.competitionSeason = createRoomCompetitionSeason(current);
            current.leagueFixtureSchedule = createLeagueFixtureSchedule(current);
            rebuildManagedSchedule(current);
            current.scheduleVersion = FIXTURE_SCHEDULE_VERSION;
            delete current.scheduleCompatibility;
            current.currentFixtureId = current.fixtureSchedule[0]?.fixtureId ?? null;
            current.matchReadiness = { fixtureId: current.currentFixtureId, managerIds: [] };
            current.lineups = [];
            current.careerCompleted = false;
            current.careerCompletedAt = null;
            summary.nextFixtureId = current.currentFixtureId;
            summary.nextSeasonNumber = current.currentSeason;
            summary.nextSeasonYear = current.seasonYear;
            summary.careerSummary = structuredClone(careerTransition.summary);
            summary.promotionMovements = structuredClone(leagueTransition.movements);
          } else {
            current.careerCompleted = true;
            current.careerCompletedAt = completedAt;
          }
          current.seasonHistory.push(historyEntry);
        }
      }
      syncMarketCareerSideEffects(current);
      assertScheduleSize(current);
      enqueueMatchHistory(current, {
        ...summary,
        competition: humanFixture?.competition,
        competitionId: humanFixture?.competitionId ?? humanFixture?.tournamentId ?? humanFixture?.leagueId ?? null,
        scheduledAt: humanFixture?.scheduledAt,
        round: humanFixture?.round,
      });
      return current;
    }).catch((error) => {
      publishAiMarketCommitFailure(marketTickRecord, error, this.#aiMarketTelemetry);
      throw error;
    });
    publishAiMarketTick(marketTickRecord, this.#aiMarketTelemetry);
    return { room, summary: this.#snapshot(room.lastCompletedMatch) };
  }

  async submitPressConference(code, managerId, { matchId, answers }) {
    const canonicalMatchId = String(matchId).trim();
    const previewRoom = await this.requireMembership(code, managerId);
    const previewMatch = (previewRoom.completedMatches ?? []).find(
      (candidate) => String(candidate?.id ?? "") === canonicalMatchId,
    ) ?? (String(previewRoom.lastCompletedMatch?.id ?? "") === canonicalMatchId
      ? previewRoom.lastCompletedMatch
      : null);
    if (!previewMatch) {
      throw new RoomError("Partida concluida nao encontrada", "PRESS_CONFERENCE_MATCH_NOT_FOUND", 404);
    }
    const previewContext = matchParticipantContext(previewRoom, previewMatch, managerId);
    const previewExisting = (previewMatch.pressConferenceSubmissions ?? []).find(
      (candidate) => candidate.managerId === managerId,
    );
    const previewLatest = latestCompletedMatchForManager(previewRoom, managerId);
    if (!previewExisting && String(previewLatest?.id ?? "") !== canonicalMatchId) {
      throw new RoomError(
        "A coletiva so pode ser respondida para a ultima partida deste manager",
        "PRESS_CONFERENCE_NOT_LATEST_MATCH",
        409,
      );
    }

    let roster = [];
    try {
      const ownerCatalog = await catalogForOwner(
        this.#catalogStore,
        previewRoom.catalogOwnerId || previewRoom.ownerId,
      );
      if (typeof ownerCatalog?.listPlayers === "function" && previewContext.clubId) {
        const loaded = await listRoomPlayers(ownerCatalog, previewRoom, previewContext.clubId);
        roster = (Array.isArray(loaded) ? loaded : loaded?.players ?? [])
          .filter((player) => player?.id && player.active !== false)
          .map((player) => ({
            id: String(player.id),
            position: String(player.position ?? ""),
            morale: player.morale,
            moraleScore: player.moraleScore,
          }));
      }
    } catch {
      // A coletiva continua disponivel sem catalogo; o efeito geral ainda e aplicado.
      roster = [];
    }

    let submission = null;
    let alreadySubmitted = false;
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      current.completedMatches = Array.isArray(current.completedMatches) ? current.completedMatches : [];
      let targetIndex = completedMatchIndex(current, canonicalMatchId);
      if (targetIndex < 0 && String(current.lastCompletedMatch?.id ?? "") === canonicalMatchId) {
        current.completedMatches.push(compactCompletedMatch(current.lastCompletedMatch));
        targetIndex = current.completedMatches.length - 1;
      }
      if (targetIndex < 0) {
        throw new RoomError("Partida concluida nao encontrada", "PRESS_CONFERENCE_MATCH_NOT_FOUND", 404);
      }
      const target = current.completedMatches[targetIndex];
      const context = matchParticipantContext(current, target, managerId);
      const resolved = resolvePressConferenceAnswers({
        match: target,
        side: context.clubSide,
        answers,
      });
      target.pressConferenceSubmissions = Array.isArray(target.pressConferenceSubmissions)
        ? target.pressConferenceSubmissions
        : [];
      const existing = target.pressConferenceSubmissions.find(
        (candidate) => candidate.managerId === managerId,
      );
      if (existing) {
        if (canonicalAnswerKey(existing.answers) !== canonicalAnswerKey(resolved.answers)) {
          throw new RoomError(
            "A coletiva desta partida ja foi enviada com outras respostas",
            "PRESS_CONFERENCE_SUBMISSION_CONFLICT",
            409,
          );
        }
        submission = structuredClone(existing);
        alreadySubmitted = true;
        return undefined;
      }
      const latestMatch = latestCompletedMatchForManager(current, managerId);
      if (String(latestMatch?.id ?? "") !== canonicalMatchId) {
        throw new RoomError(
          "A coletiva so pode ser respondida para a ultima partida deste manager",
          "PRESS_CONFERENCE_NOT_LATEST_MATCH",
          409,
        );
      }

      const submittedAt = this.#now().toISOString();
      const state = moraleStateFor(current, context.clubId);
      state.score = clampMoraleScore(state.score + resolved.effects.squadMoraleDelta);
      const playerMoraleChanges = [];
      for (const player of roster) {
        const sector = sectorForPosition(player.position);
        const sectorDelta = sector ? resolved.effects.sectorDeltas[sector] : 0;
        if (!sectorDelta) continue;
        let playerState = state.playerDeltas.find((candidate) => candidate.playerId === player.id);
        if (!playerState) {
          playerState = { playerId: player.id, delta: 0 };
          state.playerDeltas.push(playerState);
        }
        const previousDelta = clampPlayerMoraleDelta(playerState.delta);
        playerState.delta = clampPlayerMoraleDelta(previousDelta + sectorDelta);
        const appliedDelta = playerState.delta - previousDelta;
        playerMoraleChanges.push({
          playerId: player.id,
          delta: appliedDelta,
          moraleScore: clampMoraleScore(
            basePlayerMoraleScore(player) + (state.score - 70) + playerState.delta,
          ),
        });
      }
      state.playerDeltas = state.playerDeltas.filter((player) => player.delta !== 0);
      state.updatedAt = submittedAt;
      state.sourceMatchId = canonicalMatchId;

      submission = {
        managerId,
        clubId: context.clubId,
        clubName: context.clubName,
        clubSide: context.clubSide,
        matchId: canonicalMatchId,
        answers: resolved.answers,
        effects: {
          squadMoraleDelta: resolved.effects.squadMoraleDelta,
          squadMoraleScore: state.score,
          sectorDeltas: resolved.effects.sectorDeltas,
          playerMoraleChanges,
        },
        submittedAt,
      };
      target.pressConferenceSubmissions.push(structuredClone(submission));
      if (String(current.lastCompletedMatch?.id ?? "") === canonicalMatchId) {
        const detailedMatch = current.lastCompletedMatch;
        current.lastCompletedMatch = {
          ...structuredClone(target),
          ...(detailedMatch.playerStatistics
            ? { playerStatistics: structuredClone(detailedMatch.playerStatistics) }
            : {}),
          ...(detailedMatch.playerEffects
            ? { playerEffects: structuredClone(detailedMatch.playerEffects) }
            : {}),
          ...(Array.isArray(detailedMatch.events)
            ? { events: structuredClone(detailedMatch.events) }
            : {}),
        };
      }
      return current;
    });
    return {
      room,
      submission: this.#snapshot(submission),
      alreadySubmitted,
    };
  }

  async getClubMoraleState(code, managerId, clubId) {
    const runtime = await this.getClubRuntimeState(code, managerId, clubId);
    return this.#snapshot(runtime.moraleState);
  }

  async getClubRuntimeState(code, managerId, clubId) {
    const room = await this.requireMembership(code, managerId);
    const state = (room.clubMoraleStates ?? []).find(
      (candidate) => clubKey(candidate?.clubId) === clubKey(clubId),
    );
    return this.#snapshot({
      currentSeason: room.currentSeason ?? 1,
      playerStates: (room.playerStates ?? []).filter(
        (candidate) => clubKey(candidate?.clubId) === clubKey(clubId),
      ),
      moraleState: state ?? {
        clubId,
        active: false,
        score: 70,
        playerDeltas: [],
        updatedAt: null,
        sourceMatchId: null,
      },
    });
  }

  async #marketCatalog(room) {
    const catalog = await catalogForOwner(
      this.#catalogStore,
      room.catalogOwnerId || room.ownerId,
    );
    if (typeof catalog?.listPlayers !== "function") {
      throw new RoomError(
        "Catalogo de jogadores indisponivel",
        "MARKET_CATALOG_UNAVAILABLE",
        503,
      );
    }
    return catalog;
  }

  async #marketClubIds(room) {
    const ids = new Set((room.competitionCatalog ?? []).flatMap((league) => (
      (league.clubs ?? []).map((club) => String(club?.id ?? "").trim()).filter(Boolean)
    )));
    for (const manager of room.managers ?? []) {
      if (manager?.clubId) ids.add(String(manager.clubId));
    }
    return [...ids];
  }

  async #loadMarketPlayer(room, playerId) {
    const normalizedId = String(playerId ?? "").trim();
    const scopedClubIds = await this.#marketClubIds(room);
    const scopedClubKeys = new Set(scopedClubIds.map(clubKey));
    const registration = marketRegistrationForPlayer(room, normalizedId);
    if (registration?.playerSnapshot) {
      const currentClubId = registration.currentClubId || registration.playerSnapshot.clubId;
      if (!scopedClubKeys.has(clubKey(currentClubId))) {
        throw new RoomError("Jogador nao pertence as ligas ativas da sala", "MARKET_PLAYER_OUT_OF_SCOPE", 409);
      }
      return structuredClone(registration.playerSnapshot);
    }

    const careerFreeAgent = (room.careerState?.players ?? []).find((player) => (
      clubKey(player?.id) === clubKey(normalizedId)
      && careerPlayerCanEnterMarket(player)
      && careerPlayerIsFreeAgent(player)
    ));
    if (careerFreeAgent) return structuredClone(careerFreeAgent);

    const catalog = await this.#marketCatalog(room);
    if (typeof catalog.get === "function" && !(room.careerState?.players ?? []).length) {
      try {
        const player = await catalog.get("players", normalizedId);
        if (player?.active !== false && scopedClubKeys.has(clubKey(player?.clubId))) return player;
      } catch {
        // Bases legadas e mocks podem nao oferecer busca direta; tenta por elenco.
      }
    }
    for (const clubId of scopedClubIds) {
      try {
        const roster = await listRoomPlayers(catalog, room, clubId);
        const player = (roster?.players ?? []).find(
          (candidate) => String(candidate?.id ?? "") === normalizedId,
        );
        if (player && player.active !== false
          && player.academy !== true
          && player.youth !== true
          && player.careerStage !== "academy") return player;
      } catch {
        // Um clube corrompido nao impede procurar nos demais.
      }
    }
    throw new RoomError("Jogador nao encontrado", "MARKET_PLAYER_NOT_FOUND", 404);
  }

  async #loadMarketCandidates(room) {
    const catalog = await this.#marketCatalog(room);
    const rosters = await Promise.all((await this.#marketClubIds(room)).map(async (clubId) => {
      try {
        const roster = await listRoomPlayers(catalog, room, clubId);
        return Array.isArray(roster?.players) ? roster.players : [];
      } catch {
        return [];
      }
    }));
    const candidates = [];
    const seen = new Set();
    for (const player of rosters.flat()) {
      const playerId = String(player?.id ?? "").trim();
      if (!careerPlayerCanEnterMarket(player) || seen.has(playerId)) continue;
      seen.add(playerId);
      candidates.push(player);
    }
    for (const player of room.careerState?.players ?? []) {
      const playerId = String(player?.id ?? "").trim();
      if (!careerPlayerCanEnterMarket(player)
        || !careerPlayerIsFreeAgent(player)
        || seen.has(playerId)) continue;
      seen.add(playerId);
      candidates.push(structuredClone(player));
    }
    return candidates;
  }

  async #marketSnapshotFor(room, managerId) {
    return marketSnapshot(
      room,
      managerId,
      await this.#loadMarketCandidates(room),
      this.#now(),
    );
  }

  async #loadAiRosters(room, fixtures) {
    if (!Array.isArray(fixtures) || fixtures.length === 0) return new Map();
    let ownerCatalog;
    try {
      ownerCatalog = await within(2_000, catalogForOwner(
        this.#catalogStore,
        room.catalogOwnerId || room.ownerId,
      ));
    } catch {
      return new Map();
    }
    if (typeof ownerCatalog?.listPlayers !== "function") return new Map();
    const clubIds = [...new Set(fixtures.flatMap((fixture) => [
      String(fixture?.homeClubId ?? "").trim(),
      String(fixture?.awayClubId ?? "").trim(),
    ]).filter(Boolean))];
    const entries = await Promise.all(clubIds.map(async (clubId) => {
      try {
        const response = await within(2_000, listRoomPlayers(ownerCatalog, room, clubId));
        const players = Array.isArray(response) ? response : response?.players;
        return [clubKey(clubId), Array.isArray(players) ? players : []];
      } catch {
        return [clubKey(clubId), []];
      }
    }));
    return new Map(entries);
  }

  async #loadCompetitionCatalog(ownerId, activeLeagues = [], managerClubIds = [], injectedOwnerCatalog = null) {
    const ownerCatalog = injectedOwnerCatalog ?? await catalogForOwner(this.#catalogStore, ownerId);
    if (typeof ownerCatalog?.listCompetitionCatalog !== "function") return [];
    const response = await ownerCatalog.listCompetitionCatalog();
    const allLeagues = Array.isArray(response) ? response : response?.leagues;
    if (!Array.isArray(allLeagues) || allLeagues.length === 0) return [];
    const requested = new Set(activeLeagues.map(clubKey));
    const managedClubs = new Set(managerClubIds.map(clubKey));
    for (const league of allLeagues) {
      if ((league.clubs ?? []).some((club) => managedClubs.has(clubKey(club.id)))) {
        requested.add(clubKey(league.id));
      }
    }
    return structuredClone(allLeagues.filter((league) => requested.has(clubKey(league.id))));
  }

  async #loadTournamentCatalog(ownerId, managerClubIds = [], injectedOwnerCatalog = null) {
    const ownerCatalog = injectedOwnerCatalog ?? await catalogForOwner(this.#catalogStore, ownerId);
    if (typeof ownerCatalog?.listActiveTournaments !== "function") return [];
    const response = await ownerCatalog.listActiveTournaments();
    const tournaments = Array.isArray(response) ? response : response?.tournaments;
    if (!Array.isArray(tournaments)) return [];
    const managed = new Set(managerClubIds.map(clubKey).filter(Boolean));
    return structuredClone(tournaments.filter((tournament) => (
      tournament?.active !== false
      && (tournament?.teamIds ?? []).length >= 2
      && (managed.size === 0 || (tournament.teamIds ?? []).some((clubId) => managed.has(clubKey(clubId))))
    )));
  }

  async #loadCareerRoster(room, injectedOwnerCatalog = null) {
    let ownerCatalog = injectedOwnerCatalog;
    if (!ownerCatalog && this.#catalogStore) {
      ownerCatalog = await this.#loadCareerRosterWithRetry(
        () => within(this.#careerRosterPolicy.timeoutMs, catalogForOwner(
          this.#catalogStore,
          room.catalogOwnerId || room.ownerId,
        )),
        null,
      );
    }
    // RoomStore unit scenarios may run without any catalog adapter. Once a
    // catalog is configured, missing roster support is an availability error.
    if (!ownerCatalog && !this.#catalogStore) return [];
    if (typeof ownerCatalog?.listPlayers !== "function") {
      throw new RoomError(
        "Catalogo de jogadores indisponivel",
        "CAREER_ROSTER_UNAVAILABLE",
        503,
      );
    }
    const clubIds = [...new Map(careerClubs(room)
      .filter((club) => club?.id)
      .map((club) => [clubKey(club.id), club.id])).values()];
    const rosters = await Promise.all(clubIds.map((clubId) => (
      this.#loadCareerClubRoster(ownerCatalog, room, clubId)
    )));
    const players = new Map();
    for (const roster of rosters) {
      for (const player of roster.players) {
        const playerId = String(player.id);
        const previousClubId = players.get(playerId)?.clubId;
        if (previousClubId && clubKey(previousClubId) !== clubKey(roster.clubId)) {
          throw new RoomError(
            `Jogador ${playerId} aparece nos elencos de ${previousClubId} e ${roster.clubId}`,
            "CAREER_ROSTER_DUPLICATE_PLAYER",
            409,
          );
        }
        players.set(playerId, { clubId: roster.clubId, player });
      }
    }
    return [...players.values()].map(({ player }) => player);
  }

  async #loadCareerClubRoster(ownerCatalog, room, clubId) {
    return this.#loadCareerRosterWithRetry(async () => {
      const response = await within(
        this.#careerRosterPolicy.timeoutMs,
        listRoomPlayers(ownerCatalog, room, clubId),
      );
      const suppliedPlayers = Array.isArray(response) ? response : response?.players;
      if (!Array.isArray(suppliedPlayers)) {
        throw careerRosterLoadFailure(
          `Catalogo retornou elenco invalido para ${clubId}`,
          "CAREER_ROSTER_PARTIAL",
          503,
          true,
        );
      }
      if (suppliedPlayers.length === 0) {
        throw careerRosterLoadFailure(
          `Clube ${clubId} nao possui elenco ativo`,
          "CAREER_ROSTER_MISSING",
          409,
        );
      }
      const players = suppliedPlayers.filter((player) => String(player?.id ?? "").trim());
      const uniqueIds = new Set(players.map((player) => String(player.id)));
      const expectedCount = Number(response?.count);
      if (
        players.length !== suppliedPlayers.length
        || uniqueIds.size !== players.length
        || (Number.isInteger(expectedCount) && expectedCount !== suppliedPlayers.length)
      ) {
        throw careerRosterLoadFailure(
          `Elenco de ${clubId} foi carregado parcialmente`,
          "CAREER_ROSTER_PARTIAL",
          503,
          true,
        );
      }
      return { clubId, players };
    }, clubId);
  }

  async #loadCareerRosterWithRetry(operation, clubId) {
    let lastError;
    for (let attempt = 1; attempt <= this.#careerRosterPolicy.maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!transientCareerRosterFailure(error)) {
          throw error instanceof RoomError
            ? error
            : new RoomError(error.message, error.code ?? "CAREER_ROSTER_LOAD_FAILED", error.status ?? 409);
        }
        if (attempt < this.#careerRosterPolicy.maxAttempts) {
          await waitFor(this.#careerRosterPolicy.retryDelayMs * attempt);
        }
      }
    }
    const timedOut = String(lastError?.code ?? lastError?.message ?? "").includes("TIMEOUT");
    const partial = lastError?.code === "CAREER_ROSTER_PARTIAL";
    throw new RoomError(
      clubId
        ? `Nao foi possivel carregar o elenco de ${clubId} apos ${this.#careerRosterPolicy.maxAttempts} tentativas`
        : `Nao foi possivel carregar a base apos ${this.#careerRosterPolicy.maxAttempts} tentativas`,
      timedOut
        ? "CAREER_ROSTER_LOAD_TIMEOUT"
        : partial ? "CAREER_ROSTER_PARTIAL" : "CAREER_ROSTER_LOAD_FAILED",
      503,
    );
  }

  #includeManagerLeagues(room) {
    const active = new Set((room.activeLeagues ?? []).map(clubKey));
    const managerClubs = new Set(room.managers.map((manager) => clubKey(manager.clubId)).filter(Boolean));
    for (const league of room.competitionCatalog ?? []) {
      if ((league.clubs ?? []).some((club) => managerClubs.has(clubKey(club.id)))) active.add(clubKey(league.id));
    }
    room.activeLeagues = [...active];
  }

  async #hydrateCompetitionCatalog(room) {
    if ((room.completedFixtureIds ?? []).length > 0) return room;
    const managerClubIds = room.managers.map((manager) => manager.clubId).filter(Boolean);
    const ownerCatalog = await catalogForOwner(this.#catalogStore, room.catalogOwnerId || room.ownerId);
    const [catalog, tournaments] = await Promise.all([
      this.#loadCompetitionCatalog(
        room.catalogOwnerId || room.ownerId,
        room.activeLeagues,
        managerClubIds,
        ownerCatalog,
      ),
      this.#loadTournamentCatalog(room.catalogOwnerId || room.ownerId, managerClubIds, ownerCatalog),
    ]);
    if (catalog.length === 0 && tournaments.length === 0) return room;
    const candidateForCareer = {
      ...room,
      competitionCatalog: catalog.length ? catalog : room.competitionCatalog,
      tournamentCatalog: tournaments,
    };
    const careerRoster = room.status === "active" && !room.careerState
      ? await this.#loadCareerRoster(candidateForCareer, ownerCatalog)
      : [];
    return this.#mutate(room.code, (current) => {
      if ((current.completedFixtureIds ?? []).length > 0) return undefined;

      const candidate = {
        ...current,
        activeLeagues: [...(current.activeLeagues ?? [])],
        competitionCatalog: structuredClone(catalog.length ? catalog : current.competitionCatalog ?? []),
        tournamentCatalog: structuredClone(tournaments),
      };
      this.#includeManagerLeagues(candidate);

      let schedule = current.fixtureSchedule ?? [];
      let leagueSchedule = current.leagueFixtureSchedule ?? [];
      let competitionSeason = current.competitionSeason ?? null;
      let scheduleIssue = null;
      if (candidate.status === "active") {
        competitionSeason = competitionSeason ?? createRoomCompetitionSeason(candidate);
        leagueSchedule = createLeagueFixtureSchedule(candidate);
        const coordinated = coordinateRoomFixtureCalendar(candidate, leagueSchedule, competitionSeason);
        leagueSchedule = coordinated.leagueSchedule;
        competitionSeason = coordinated.competitionSeason;
        candidate.competitionSeason = competitionSeason;
        schedule = createUnifiedFixtureSchedule(
          candidate,
          leagueSchedule,
          competitionSeason,
          { sourcesCoordinated: true },
        );
        const everyManagerHasFixture = candidate.managers.every((manager) => schedule.some(
          (fixture) => this.#clubIdsEqual(fixture.homeClubId, manager.clubId)
            || this.#clubIdsEqual(fixture.awayClubId, manager.clubId),
        ));
        if (!everyManagerHasFixture) {
          schedule = [];
          leagueSchedule = [];
          scheduleIssue = {
            code: "LEAGUE_NEEDS_CLUBS",
            message: "A liga do clube escolhido precisa ter pelo menos dois clubes ativos no Editor",
          };
        }
        if (!scheduleIssue) assertScheduleSize({
          ...candidate,
          fixtureSchedule: schedule,
          leagueFixtureSchedule: leagueSchedule,
        });
      }

      const catalogChanged = JSON.stringify(current.competitionCatalog ?? [])
        !== JSON.stringify(candidate.competitionCatalog);
      const tournamentsChanged = JSON.stringify(current.tournamentCatalog ?? [])
        !== JSON.stringify(candidate.tournamentCatalog);
      const competitionChanged = candidate.status === "active"
        && JSON.stringify(current.competitionSeason ?? null) !== JSON.stringify(competitionSeason);
      const leaguesChanged = JSON.stringify(current.activeLeagues ?? [])
        !== JSON.stringify(candidate.activeLeagues);
      const scheduleChanged = candidate.status === "active"
        && JSON.stringify(current.fixtureSchedule ?? []) !== JSON.stringify(schedule);
      const leagueScheduleChanged = candidate.status === "active"
        && JSON.stringify(current.leagueFixtureSchedule ?? []) !== JSON.stringify(leagueSchedule);
      const issueChanged = JSON.stringify(current.scheduleIssue ?? null) !== JSON.stringify(scheduleIssue);
      const careerChanged = candidate.status === "active" && !current.careerState && careerRoster.length > 0;
      if (!catalogChanged && !tournamentsChanged && !competitionChanged && !careerChanged
        && !leaguesChanged && !scheduleChanged && !leagueScheduleChanged && !issueChanged) {
        return undefined;
      }

      current.competitionCatalog = candidate.competitionCatalog;
      current.tournamentCatalog = candidate.tournamentCatalog;
      current.activeLeagues = candidate.activeLeagues;
      if (candidate.status === "active") {
        current.competitionSeason = competitionSeason;
        if (!current.careerState && careerRoster.length > 0) {
          current.careerState = initialCareerState(current, careerRoster);
        }
        current.fixtureSchedule = schedule;
        current.leagueFixtureSchedule = leagueSchedule;
        current.leagueMatchResults = [];
        current.scheduleIssue = scheduleIssue;
        current.scheduleVersion = FIXTURE_SCHEDULE_VERSION;
        current.currentFixtureId = schedule[0]?.fixtureId ?? null;
        current.matchReadiness = { fixtureId: current.currentFixtureId, managerIds: [] };
      }
      return current;
    });
  }

  #assertClubInActiveLeague(room, clubId) {
    if (!clubId) return;
    if (!Array.isArray(room.competitionCatalog) || room.competitionCatalog.length === 0) {
      if (this.#catalogStore) {
        throw new RoomError(
          "A base do criador nao possui ligas e clubes ativos",
          "ROOM_CATALOG_EMPTY",
          409,
        );
      }
      return;
    }
    const active = new Set((room.activeLeagues ?? []).map(clubKey));
    const league = room.competitionCatalog.find((candidate) => (
      (candidate.clubs ?? []).some((club) => this.#clubIdsEqual(club.id, clubId))
    ));
    if (!league || !active.has(clubKey(league.id))) {
      throw new RoomError(
        "O clube escolhido nao pertence a uma liga ativa desta sala",
        "CLUB_LEAGUE_NOT_ACTIVE",
        409,
      );
    }
  }

  #assertClubAvailable(room, clubId, managerId) {
    this.#assertClubInActiveLeague(room, clubId);
    const comparisonId = clubId.toLocaleUpperCase("pt-BR");
    const holder = room.managers.find(
      (manager) => manager.id !== managerId
        && manager.clubId?.toLocaleUpperCase("pt-BR") === comparisonId,
    );
    if (holder) throw new RoomError("Este clube ja foi escolhido", "CLUB_UNAVAILABLE", 409);
  }

  #clubIdsEqual(left, right) {
    return String(left ?? "").trim().toLocaleUpperCase("pt-BR")
      === String(right ?? "").trim().toLocaleUpperCase("pt-BR");
  }

  #removeLineup(room, managerId) {
    if (!Array.isArray(room.lineups)) room.lineups = [];
    else room.lineups = room.lineups.filter((lineup) => lineup.managerId !== managerId);
  }

  async #mutate(code, mutation) {
    const normalizedCode = this.#normalizeCode(code);
    const room = await this.#persistence.mutate(normalizedCode, (current) => {
      if (!current) throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      assertMatchHistoryCapacity(current);
      initializeMatchHistory(current);
      let next = mutation(current);
      if (next === undefined) return undefined;
      const lifecycleNow = careerDateFor(next, this.#now());
      const packageProgress = fulfillCoachStaffPackageCommitments(next, {
        ...professionalLifecycleCallbacks(lifecycleNow),
        now: lifecycleNow,
      });
      next = packageProgress.room;
      if (packageProgress.fulfilled.length > 0) syncProfessionalLifecycleTimeline(next);
      reconcileCoachNoticesWithAppointments(next, lifecycleNow);
      next.revision = (next.revision || next.version || 0) + 1;
      next.version = next.revision;
      next.updatedAt = this.#now().toISOString();
      return next;
    }).catch((error) => {
      if (error?.code === "MATCH_HISTORY_BACKLOG") this.#drainHistory(normalizedCode);
      throw error;
    });
    await this.#flushHistory(room);
    return this.#snapshot(room);
  }

  async #mutatePaths(code, paths, mutation) {
    const normalizedCode = this.#normalizeCode(code);
    const persist = (callback) => typeof this.#persistence.mutatePaths === "function"
      ? this.#persistence.mutatePaths(normalizedCode, paths, callback)
      : this.#persistence.mutate(normalizedCode, callback);
    const committed = await persist((current) => {
      if (!current) throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      const next = mutation(current);
      if (next === undefined) return undefined;
      next.revision = (next.revision || next.version || 0) + 1;
      next.version = next.revision;
      next.updatedAt = this.#now().toISOString();
      return next;
    });
    if (!committed) return committed;
    const projection = typeof this.#persistence.getPartial === "function"
      ? await this.#persistence.getPartial(normalizedCode, { excludePaths: VIEWER_EXCLUDED_PATHS })
      : committed;
    // Do not call #snapshot here: a partial room intentionally has no
    // careerState and hydrating it would recreate the heavy branch in memory.
    return viewerProjection(projection ?? committed);
  }

  #normalizeCode(code) {
    return String(code).trim().toUpperCase();
  }

  #snapshot(room) {
    const snapshot = structuredClone(room);
    if (snapshot && Array.isArray(snapshot.managers)) ensureCareerState(snapshot, this.#now());
    return snapshot;
  }
}
