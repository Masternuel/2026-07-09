import { isPlayerAvailableForMatch } from "../game/starImpact.mjs";
import { lineupSaveSchema, parseOrThrow } from "../schemas.mjs";
import { emitRoomForViewers, roomForViewer } from "../services/roomVisibility.mjs";
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

export function registerLineupHandlers(io, socket, { store, catalogStore, matchSessions }) {
  const user = socket.data.user;

  registerSafe(socket, "lineup:save", async (payload) => {
    const data = parseOrThrow(lineupSaveSchema, payload);
    if (matchSessions.has(data.code)) {
      throw lineupError("Nao altere a escalacao durante uma partida", "MATCH_IN_PROGRESS");
    }
    const currentRoom = await store.requireMembership(data.code, user.uid);
    const manager = currentRoom.managers.find((candidate) => candidate.id === user.uid);
    if (!manager?.clubId) throw lineupError("Escolha um clube antes de escalar", "CLUB_REQUIRED");
    if (typeof catalogStore?.listPlayers !== "function") {
      throw lineupError("Catalogo de jogadores indisponivel", "LINEUP_CATALOG_UNAVAILABLE", 503);
    }

    const reservation = { kind: "lineup-update", playback: null };
    if (matchSessions.has(data.code)) throw lineupError("Partida em preparacao", "MATCH_IN_PROGRESS");
    matchSessions.set(data.code, reservation);
    try {
      const roster = await catalogStore.listPlayers(manager.clubId);
      if (roster.source === "brasfoot-not-loaded") {
        throw lineupError("Catalogo de jogadores indisponivel", "LINEUP_CATALOG_UNAVAILABLE", 503);
      }
      const demoFallback = roster.source === "demo-fallback" && roster.players.length === 0;
      const playersById = new Map(roster.players.map((player) => [String(player.id), player]));
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
      const room = await store.saveLineup(data.code, user.uid, manager.clubId, data.lineupIds);
      const lineup = room.lineups.find((candidate) => candidate.managerId === user.uid);
      rememberMembership(socket, data.code);
      await emitRoomForViewers(io, room);
      return { room: roomForViewer(room, user.uid), lineup, source: roster.source };
    } finally {
      if (matchSessions.get(data.code) === reservation) matchSessions.delete(data.code);
    }
  });
}
