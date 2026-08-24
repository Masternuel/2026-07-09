import { Router } from "express";
import { FieldPath } from "firebase-admin/firestore";
import { z } from "zod";
import { parseOrThrow, roomCodeSchema } from "../schemas.mjs";
import { editorRecordIdSchema } from "../editorSchemas.mjs";
import { mergePlayerStates } from "../game/playerProgression.mjs";
import { listRoomPlayers } from "../game/roomRoster.mjs";
import { calculateStarImpact } from "../game/starImpact.mjs";
import {
  basePlayerMoraleScore,
  clampMoraleScore,
  moraleLabel,
} from "../services/pressConference.mjs";
import { CatalogStore } from "../store/catalogStore.mjs";
import { catalogForRequest } from "../store/catalogScope.mjs";

const querySchema = z.object({
  country: z.string().trim().min(2).max(60).optional(),
  division: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  cursor: z.string().trim().min(1).max(128).optional(),
  roomCode: z.string().trim().min(4).max(12).optional(),
}).strict();

const roomScopeSchema = z.object({
  roomCode: roomCodeSchema.optional(),
}).strict();

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function serializeTeam(document) {
  return { ...document.data(), id: document.id };
}

export function createTeamsRouter(firestore, injectedCatalogStore, roomStore = null) {
  const router = Router();
  const catalogStore = injectedCatalogStore ?? new CatalogStore({ firestore });
  router.get("/", asyncRoute(async (request, response) => {
    const filters = parseOrThrow(querySchema, request.query);
    if (filters.roomCode && typeof roomStore?.requireMembership === "function") {
      const room = await roomStore.requireMembership(filters.roomCode, request.user?.uid);
      if (Array.isArray(room.competitionCatalog) && room.competitionCatalog.length > 0) {
        const byId = new Map();
        for (const league of room.competitionCatalog) {
          if (filters.country && String(league.country) !== filters.country) continue;
          if (filters.division && String(league.division) !== filters.division) continue;
          for (const club of league.clubs ?? []) {
            byId.set(String(club.id), {
              ...club,
              id: club.id,
              leagueId: league.id,
              country: league.country ?? null,
              division: league.division ?? null,
              colors: Array.isArray(club.colors) ? club.colors : [club.color ?? "#c8ff3d"],
              active: true,
            });
          }
        }
        const all = [...byId.values()].sort((left, right) => String(left.id).localeCompare(String(right.id), "pt-BR"));
        const cursorIndex = filters.cursor
          ? all.findIndex((club) => String(club.id) === filters.cursor)
          : -1;
        const teams = all.slice(cursorIndex + 1, cursorIndex + 1 + filters.limit);
        const nextCursor = cursorIndex + 1 + filters.limit < all.length
          ? teams.at(-1)?.id ?? null
          : null;
        response.json({ teams, count: teams.length, nextCursor, source: "room-save" });
        return;
      }
    }
    const activeCatalog = await catalogForRequest(catalogStore, roomStore, request);
    if (!activeCatalog?.firestore) {
      response.json({ teams: [], count: 0, nextCursor: null, source: "brasfoot-not-loaded" });
      return;
    }
    let query = activeCatalog.collection("clubs");
    if (filters.country) query = query.where("country", "==", filters.country);
    if (filters.division) query = query.where("division", "==", filters.division);
    query = query.orderBy(FieldPath.documentId());
    if (filters.cursor) query = query.startAfter(filters.cursor);
    const snapshot = await query.limit(filters.limit).get();
    const teams = snapshot.docs
      .filter((document) => document.data().active !== false)
      .map(serializeTeam);
    const nextCursor = snapshot.docs.length === filters.limit
      ? snapshot.docs.at(-1)?.id ?? null
      : null;
    response.json({ teams, count: teams.length, nextCursor, source: "firestore" });
  }));
  router.get("/:clubId/star-impact", asyncRoute(async (request, response) => {
    const clubId = parseOrThrow(editorRecordIdSchema, request.params.clubId);
    const scope = parseOrThrow(roomScopeSchema, request.query);
    const activeCatalog = await catalogForRequest(catalogStore, roomStore, request);
    let impact;
    if (scope.roomCode && typeof roomStore?.requireMembership === "function") {
      const room = await roomStore.requireMembership(scope.roomCode, request.user?.uid);
      const roster = await listRoomPlayers(activeCatalog, room, clubId);
      const lineup = (room.lineups ?? []).find(
        (candidate) => String(candidate?.clubId ?? "").toLocaleUpperCase("pt-BR")
          === String(clubId).toLocaleUpperCase("pt-BR"),
      );
      impact = {
        ...calculateStarImpact(
          clubId,
          mergePlayerStates(roster.players ?? [], room, clubId),
          { lineupIds: lineup?.lineupIds },
        ),
        source: roster.source ?? activeCatalog.source ?? "room",
      };
    } else {
      impact = await activeCatalog.getStarImpact(clubId);
    }
    response.json({
      impact,
      source: impact.source ?? activeCatalog.source ?? (firestore ? "firestore" : "brasfoot-not-loaded"),
    });
  }));
  router.get("/:clubId/players", asyncRoute(async (request, response) => {
    const clubId = parseOrThrow(editorRecordIdSchema, request.params.clubId);
    const scope = parseOrThrow(roomScopeSchema, request.query);
    const activeCatalog = await catalogForRequest(catalogStore, roomStore, request);
    if (!scope.roomCode) {
      const roster = await activeCatalog.listPlayers(clubId);
      response.json(roster);
      return;
    }
    if (
      typeof roomStore?.getClubRuntimeState !== "function"
      && typeof roomStore?.getClubMoraleState !== "function"
    ) {
      const error = new Error("Estado dos jogadores da sala indisponivel");
      error.code = "ROOM_PLAYER_STATE_UNAVAILABLE";
      error.status = 503;
      throw error;
    }
    const runtime = typeof roomStore.getClubRuntimeState === "function"
      ? await roomStore.getClubRuntimeState(scope.roomCode, request.user?.uid, clubId)
      : {
        currentSeason: 1,
        playerStates: [],
        moraleState: await roomStore.getClubMoraleState(scope.roomCode, request.user?.uid, clubId),
      };
    const roomSnapshot = runtime.marketState || typeof roomStore?.requireMembership !== "function"
      ? runtime
      : await roomStore.requireMembership(scope.roomCode, request.user?.uid);
    const roster = await listRoomPlayers(activeCatalog, roomSnapshot, clubId);
    const state = runtime.moraleState;
    const playerDeltas = new Map((state.playerDeltas ?? []).map((player) => [player.playerId, player.delta]));
    const players = mergePlayerStates(roster.players, runtime, clubId).map((player) => {
      const roomOffset = state.active === false ? 0 : (state.score ?? 70) - 70;
      const moraleScore = clampMoraleScore(
        basePlayerMoraleScore(player) + roomOffset + (playerDeltas.get(player.id) ?? 0),
      );
      return { ...player, moraleScore, morale: moraleLabel(moraleScore) };
    });
    response.json({ ...roster, players, count: players.length });
  }));
  return router;
}
