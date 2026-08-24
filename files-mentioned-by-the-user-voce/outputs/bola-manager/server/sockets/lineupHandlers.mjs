import { isPlayerAvailableForMatch } from "../game/starImpact.mjs";
import { mergePlayerStates } from "../game/playerProgression.mjs";
import { listRoomPlayers } from "../game/roomRoster.mjs";
import {
  DEFAULT_TACTIC_PLAN,
  FORMATION_ROLES,
  validateLineupForFormation,
} from "../game/tactics.mjs";
import { calculateTeamCohesion } from "../game/teamCohesion.mjs";
import { clubCareerPerformanceEffects } from "../game/clubCareerSystem.mjs";
import { lineupSaveSchema, parseOrThrow } from "../schemas.mjs";
import { emitRoomForViewers, roomForViewer } from "../services/roomVisibility.mjs";
import { catalogForOwner } from "../store/catalogScope.mjs";
import { registerSafe, rememberMembership } from "./helpers.mjs";

const DEMO_PLAYER_IDS = new Set(Array.from(
  { length: 20 },
  (_, index) => `p${String(index + 1).padStart(2, "0")}`,
));

function lineupError(message, code, status = 409, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

export function registerLineupHandlers(io, socket, {
  store,
  catalogStore,
  matchSessions,
  matchSessionStore,
}) {
  const user = socket.data.user;

  registerSafe(socket, "lineup:save", async (payload) => {
    const data = parseOrThrow(lineupSaveSchema, payload);
    if (matchSessions.has(data.code) || await matchSessionStore.has(data.code)) {
      throw lineupError("Nao altere a escalacao durante uma partida", "MATCH_IN_PROGRESS");
    }
    const currentRoom = await store.requireMembership(data.code, user.uid);
    const manager = currentRoom.managers.find((candidate) => candidate.id === user.uid);
    if (!manager?.clubId) throw lineupError("Escolha um clube antes de escalar", "CLUB_REQUIRED");
    const roomCatalog = await catalogForOwner(
      catalogStore,
      currentRoom.catalogOwnerId || currentRoom.ownerId,
    );
    if (typeof roomCatalog?.listPlayers !== "function") {
      throw lineupError("Catalogo de jogadores indisponivel", "LINEUP_CATALOG_UNAVAILABLE", 503);
    }

    const reservation = { kind: "lineup-update", playback: null };
    if (matchSessions.has(data.code) || await matchSessionStore.has(data.code)) {
      throw lineupError("Partida em preparacao", "MATCH_IN_PROGRESS");
    }
    matchSessions.set(data.code, reservation);
    try {
      const roster = await listRoomPlayers(roomCatalog, currentRoom, manager.clubId);
      if (roster.source === "brasfoot-not-loaded") {
        throw lineupError("Catalogo de jogadores indisponivel", "LINEUP_CATALOG_UNAVAILABLE", 503);
      }
      const demoFallback = roster.source === "demo-fallback" && roster.players.length === 0;
      const runtimePlayers = mergePlayerStates(roster.players, currentRoom, manager.clubId);
      const playersById = new Map(runtimePlayers.map((player) => [String(player.id), player]));
      const knownIds = demoFallback ? DEMO_PLAYER_IDS : new Set(playersById.keys());
      const unknownIds = data.lineupIds.filter((playerId) => !knownIds.has(playerId));
      if (unknownIds.length > 0) {
        throw lineupError(
          "A escalacao contem jogador que nao pertence ao clube",
          "LINEUP_PLAYER_NOT_IN_CLUB",
          409,
          { playerIds: unknownIds },
        );
      }
      const unavailableIds = demoFallback ? [] : data.lineupIds.filter(
        (playerId) => !isPlayerAvailableForMatch(playersById.get(playerId)),
      );
      if (unavailableIds.length > 0) {
        throw lineupError(
          "A escalacao contem jogador lesionado ou suspenso",
          "LINEUP_PLAYER_UNAVAILABLE",
          409,
          { playerIds: unavailableIds },
        );
      }
      const previousLineup = currentRoom.lineups?.find(
        (candidate) => candidate.managerId === user.uid,
      );
      const effectiveTactics = structuredClone(
        data.tactics ?? previousLineup?.tactics ?? DEFAULT_TACTIC_PLAN,
      );
      const formationRoles = FORMATION_ROLES[effectiveTactics.formationId] ?? [];
      const knownPositions = new Set(Object.values(FORMATION_ROLES).flat());
      const hasPositionData = runtimePlayers.some((player) => (
        knownPositions.has(String(player?.position ?? "").trim().toUpperCase())
      ));
      const validationPlayers = demoFallback || !hasPositionData
        ? data.lineupIds.map((id, index) => ({
            ...(playersById.get(id) ?? {}),
            id,
            position: formationRoles[index],
          }))
        : runtimePlayers;
      const validation = validateLineupForFormation(
        effectiveTactics,
        data.lineupIds,
        validationPlayers,
      );
      if (!validation.valid) {
        const firstIssue = validation.errors[0];
        throw lineupError(
          firstIssue?.message ?? "A escalacao nao e valida para a formacao escolhida",
          firstIssue?.code ?? "LINEUP_INVALID",
          409,
          { issues: validation.errors },
        );
      }
      const careerEffects = clubCareerPerformanceEffects(currentRoom, manager.clubId);
      const cohesion = calculateTeamCohesion({
        previous: previousLineup?.cohesion,
        lineupIds: data.lineupIds,
        tactics: effectiveTactics,
        players: validationPlayers,
        reason: "save",
        cohesionGainBonus: careerEffects.staff?.cohesionGainBonus,
        cohesionChangePenaltyMultiplier: careerEffects.staff?.cohesionChangePenaltyMultiplier,
      });
      const room = await store.saveLineup(
        data.code,
        user.uid,
        manager.clubId,
        data.lineupIds,
        effectiveTactics,
        cohesion,
      );
      const lineup = room.lineups.find((candidate) => candidate.managerId === user.uid);
      rememberMembership(socket, data.code);
      await emitRoomForViewers(io, room);
      return {
        room: roomForViewer(room, user.uid),
        lineup,
        warnings: validation.warnings,
        source: roster.source,
      };
    } finally {
      if (matchSessions.get(data.code) === reservation) matchSessions.delete(data.code);
    }
  });
}
