import { Router } from "express";
import { z } from "zod";
import { editorRecordIdSchema } from "../editorSchemas.mjs";
import {
  careerAcademyPromotionSchema,
  careerContractRenewalSchema,
  careerTrainingPlanSchema,
  coachBoardProposalResponseSchema,
  coachContractRenewalSchema,
  coachInterviewResponseSchema,
  coachInterviewStartSchema,
  coachInterviewTurnSchema,
  coachJobSearchSchema,
  coachProfessionalLifecycleSchema,
  coachProposalResponseSchema,
  coachResignationSchema,
  coachVacancyApplicationSchema,
  createRoomSchema,
  joinRoomSchema,
  parseOrThrow,
  readyRoomSchema,
  roomCodeSchema,
  startRoomSchema,
} from "../schemas.mjs";
import { roomForViewer } from "../services/roomVisibility.mjs";
import { buildRoomRankings } from "../services/rankings.mjs";
import { catalogForOwner } from "../store/catalogScope.mjs";
import { buildOpponentStudy } from "../game/opponentStudy.mjs";
import { mergePlayerStates } from "../game/playerProgression.mjs";
import { listRoomPlayers } from "../game/roomRoster.mjs";
import { clubCareerPerformanceEffects } from "../game/clubCareerSystem.mjs";

const rankingsQuerySchema = z.object({
  clubId: editorRecordIdSchema.optional(),
  competitionId: editorRecordIdSchema.optional(),
}).strict();

const opponentStudyQuerySchema = z.object({
  depth: z.enum(["quick", "standard", "deep"]).default("standard"),
}).strict();

const coachCareerRecordIdSchema = z.string().trim().min(1).max(160);

function key(value) {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

function opponentStudyDto(report) {
  if (!report) return null;
  const sectors = Object.values(report.sectors ?? {}).map((sector) => ({
    key: String(sector.code ?? "").toLocaleLowerCase("pt-BR"),
    label: sector.label,
    rating: sector.rating ?? 0,
    level: sector.classification === "strong"
      ? "strong"
      : sector.classification === "vulnerable" ? "vulnerable" : "balanced",
  }));
  return {
    fixtureId: report.fixtureId,
    opponentClubId: report.opponent?.id ?? "",
    opponentName: report.opponent?.name ?? "Adversário",
    depth: report.confidence?.depth ?? "standard",
    confidence: report.confidence?.score ?? 0,
    estimatedStudyHours: report.confidence?.estimatedStudyHours ?? 0,
    scoutingSpeedMultiplier: report.confidence?.scoutingSpeedMultiplier ?? 1,
    source: report.evidence?.tacticSource === "public-preview" ? "observed" : "estimated",
    probableFormation: report.probableFormation?.id ?? "4-3-3",
    style: report.style?.label ?? "Equilibrado",
    probableLineup: (report.probableLineup ?? []).map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      rating: player.overall ?? 0,
      reason: `Provável função: ${player.role}`,
    })),
    dangerousPlayers: (report.dangerousPlayers ?? []).map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      rating: player.score ?? 0,
      reason: (player.reasons ?? []).map((reason) => reason.label).join(" e ") || "Destaque pelos dados do elenco",
    })),
    sectors,
    strengths: report.strengths ?? [],
    weaknesses: report.weaknesses ?? [],
    recommendations: report.recommendations ?? [],
  };
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function createRoomsRouter(store, catalogStore = null, { broadcastRoom = null } = {}) {
  const router = Router();

  const coachMutationResponse = async (response, result, managerId) => {
    const room = result?.room ?? result;
    const coachCareer = result?.coachCareer
      ?? result?.snapshot
      ?? await store.getCoachCareerSnapshot(room.code, managerId);
    if (room && typeof broadcastRoom === "function") await broadcastRoom(room);
    response.json({
      coachCareer,
      ...(room ? { room: roomForViewer(room, managerId) } : {}),
    });
  };

  router.get("/", asyncRoute(async (request, response) => {
    const rooms = await store.listRoomsForManager(request.user.uid);
    response.json({ rooms: rooms.map((room) => roomForViewer(room, request.user.uid)) });
  }));

  router.post("/", asyncRoute(async (request, response) => {
    const payload = parseOrThrow(createRoomSchema, request.body);
    const room = await store.createRoom({
      ...payload,
      creatorId: request.user.uid,
      creatorName: request.user.name,
    });
    response.status(201).json({ room: roomForViewer(room, request.user.uid) });
  }));

  router.get("/:code", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const room = await store.requireViewerRoom(code, request.user.uid);
    response.json({ room: roomForViewer(room, request.user.uid) });
  }));

  router.get("/:code/opponent-study", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const query = parseOrThrow(opponentStudyQuerySchema, request.query);
    const room = await store.requireMembership(code, request.user.uid);
    const manager = (room.managers ?? []).find((candidate) => candidate.id === request.user.uid);
    if (!manager?.clubId) {
      response.json({ study: null });
      return;
    }
    const completed = new Set((room.completedFixtureIds ?? []).map(key));
    const fixture = (room.fixtureSchedule ?? []).find((candidate) => (
      !completed.has(key(candidate.fixtureId))
      && [candidate.homeClubId, candidate.awayClubId].some((clubId) => key(clubId) === key(manager.clubId))
    ));
    if (!fixture) {
      response.json({ study: null });
      return;
    }
    const opponentClubId = key(fixture.homeClubId) === key(manager.clubId)
      ? fixture.awayClubId
      : fixture.homeClubId;
    const opponentManager = (room.managers ?? []).find((candidate) => key(candidate.clubId) === key(opponentClubId));
    const opponentLineup = (room.lineups ?? []).find((candidate) => (
      (opponentManager && candidate.managerId === opponentManager.id)
      || key(candidate.clubId) === key(opponentClubId)
    ));
    const publicTactics = opponentLineup?.tactics?.secret === false
      ? opponentLineup.tactics
      : null;
    const tacticPreview = publicTactics
      ? {
          formationId: publicTactics.formationId,
          ...(query.depth !== "quick" ? { mentality: publicTactics.mentality } : {}),
          ...(query.depth === "deep"
            ? { teamInstructions: structuredClone(publicTactics.teamInstructions) }
            : {}),
        }
      : null;
    const observedLineup = publicTactics && query.depth === "deep"
      ? { lineupIds: opponentLineup.lineupIds }
      : null;
    const activeCatalog = await catalogForOwner(catalogStore, room.catalogOwnerId || room.ownerId);
    const roster = await listRoomPlayers(activeCatalog, room, opponentClubId);
    const players = mergePlayerStates(roster.players ?? [], room, opponentClubId);
    const opponentClub = (room.competitionCatalog ?? [])
      .flatMap((league) => league.clubs ?? [])
      .find((candidate) => key(candidate.id) === key(opponentClubId)) ?? {
        id: opponentClubId,
        name: key(fixture.homeClubId) === key(opponentClubId) ? fixture.homeTeam : fixture.awayTeam,
      };
    const careerEffects = clubCareerPerformanceEffects(room, manager.clubId);
    const report = buildOpponentStudy({
      fixture,
      viewerClubId: manager.clubId,
      opponentClub,
      players,
      lineup: observedLineup,
      tacticPreview,
      depth: query.depth,
      professionalConfidenceBonus: careerEffects.analysisConfidenceBonus + careerEffects.scoutingConfidenceBonus,
      professionalSpeedMultiplier: careerEffects.scoutingSpeedMultiplier,
    });
    response.json({ study: opponentStudyDto(report) });
  }));

  router.post("/:code/join", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const payload = parseOrThrow(joinRoomSchema, request.body);
    const room = await store.joinRoom(code, {
      ...payload,
      managerId: request.user.uid,
      managerName: request.user.name,
    });
    response.json({ room: roomForViewer(room, request.user.uid) });
  }));

  router.patch("/:code/ready", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const payload = parseOrThrow(readyRoomSchema, request.body);
    const room = await store.setReady(code, request.user.uid, payload.ready, payload.clubId);
    response.json({ room: roomForViewer(room, request.user.uid) });
  }));

  router.post("/:code/start", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    parseOrThrow(startRoomSchema, request.body ?? {});
    const room = await store.startRoom(code, request.user.uid);
    response.json({ room: roomForViewer(room, request.user.uid) });
  }));

  router.get("/:code/rankings", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const query = parseOrThrow(rankingsQuerySchema, request.query);
    const room = await store.requireMembership(code, request.user.uid);
    const activeCatalog = await catalogForOwner(
      catalogStore,
      room.catalogOwnerId || room.ownerId,
    );
    const rankings = await buildRoomRankings({
      room,
      catalogStore: activeCatalog,
      clubId: query.clubId,
      competitionId: query.competitionId,
      viewerId: request.user.uid,
    });
    response.json({ rankings });
  }));

  router.get("/:code/career", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    response.json({ career: await store.getCareerSnapshot(code, request.user.uid) });
  }));

  router.put("/:code/career/training", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const payload = parseOrThrow(careerTrainingPlanSchema, request.body);
    const room = await store.setTrainingPlan(code, request.user.uid, payload);
    response.json({ room: roomForViewer(room, request.user.uid) });
  }));

  router.post("/:code/career/contracts/renew", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const payload = parseOrThrow(careerContractRenewalSchema, request.body);
    const room = await store.renewPlayerContract(code, request.user.uid, payload);
    response.json({ room: roomForViewer(room, request.user.uid) });
  }));

  router.post("/:code/career/academy/promote", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const payload = parseOrThrow(careerAcademyPromotionSchema, request.body);
    const room = await store.promoteAcademyPlayer(code, request.user.uid, payload);
    response.json({ room: roomForViewer(room, request.user.uid) });
  }));

  router.get("/:code/coach-career", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    response.json({ coachCareer: await store.getCoachCareerSnapshot(code, request.user.uid) });
  }));

  router.post("/:code/coach-career/proposals/:proposalId/respond", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const proposalId = parseOrThrow(coachCareerRecordIdSchema, request.params.proposalId);
    const payload = parseOrThrow(coachProposalResponseSchema, request.body);
    const result = await store.respondCoachProposal(code, request.user.uid, proposalId, payload);
    await coachMutationResponse(response, result, request.user.uid);
  }));

  router.post("/:code/coach-career/proposals/:proposalId/board-response", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const proposalId = parseOrThrow(coachCareerRecordIdSchema, request.params.proposalId);
    const payload = parseOrThrow(coachBoardProposalResponseSchema, request.body);
    const result = await store.respondCoachBoardDecision(code, request.user.uid, proposalId, {
      ...payload,
      responsible: payload.responsible ?? request.user.name,
    });
    await coachMutationResponse(response, result, request.user.uid);
  }));

  router.post("/:code/coach-career/vacancies/:vacancyId/apply", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const vacancyId = parseOrThrow(coachCareerRecordIdSchema, request.params.vacancyId);
    const payload = parseOrThrow(coachVacancyApplicationSchema, request.body);
    const result = await store.applyForCoachVacancy(code, request.user.uid, vacancyId, payload);
    await coachMutationResponse(response, result, request.user.uid);
  }));

  router.post("/:code/coach-career/interviews/:interviewId/respond", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const interviewId = parseOrThrow(coachCareerRecordIdSchema, request.params.interviewId);
    const payload = parseOrThrow(coachInterviewResponseSchema, request.body);
    const result = await store.respondCoachInterview(code, request.user.uid, interviewId, payload);
    await coachMutationResponse(response, result, request.user.uid);
  }));

  router.post("/:code/coach-career/interviews/:interviewId/start", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const interviewId = parseOrThrow(coachCareerRecordIdSchema, request.params.interviewId);
    const payload = parseOrThrow(coachInterviewStartSchema, request.body);
    const result = await store.startCoachInterview(code, request.user.uid, interviewId, payload);
    await coachMutationResponse(response, result, request.user.uid);
  }));

  router.post("/:code/coach-career/interviews/:interviewId/turn", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const interviewId = parseOrThrow(coachCareerRecordIdSchema, request.params.interviewId);
    const payload = parseOrThrow(coachInterviewTurnSchema, request.body);
    const result = await store.answerCoachInterviewTurn(code, request.user.uid, interviewId, payload);
    await coachMutationResponse(response, result, request.user.uid);
  }));

  router.post("/:code/coach-career/contracts/renew", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const payload = parseOrThrow(coachContractRenewalSchema, request.body);
    const result = await store.renewCoachContract(code, request.user.uid, payload);
    await coachMutationResponse(response, result, request.user.uid);
  }));

  router.post("/:code/coach-career/resign", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const payload = parseOrThrow(coachResignationSchema, request.body);
    const result = await store.resignCoach(code, request.user.uid, payload);
    await coachMutationResponse(response, result, request.user.uid);
  }));

  router.post("/:code/coach-career/search", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const payload = parseOrThrow(coachJobSearchSchema, request.body);
    const result = await store.setCoachJobSearch(code, request.user.uid, payload);
    await coachMutationResponse(response, result, request.user.uid);
  }));

  router.post("/:code/coach-career/lifecycle", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const payload = parseOrThrow(coachProfessionalLifecycleSchema, request.body);
    const result = await store.manageProfessionalLifecycle(code, request.user.uid, {
      ...payload,
      professionalType: "coach",
      professionalId: request.user.uid,
      coachId: request.user.uid,
    });
    await coachMutationResponse(response, result, request.user.uid);
  }));

  return router;
}
