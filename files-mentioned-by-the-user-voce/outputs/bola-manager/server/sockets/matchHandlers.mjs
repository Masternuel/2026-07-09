import { resolveServerFixture } from "../game/fixtures.mjs";
import { MatchPlayback, simulateMatch } from "../game/matchSimulator.mjs";
import { applyStarImpactToFixture, loadStarImpactsAtomically } from "../game/starImpact.mjs";
import { matchControlSchema, matchReadySchema, matchStartSchema, parseOrThrow } from "../schemas.mjs";
import { emitRoomForViewers, roomForViewer } from "../services/roomVisibility.mjs";
import { channelForRoom, registerSafe, rememberMembership } from "./helpers.mjs";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function matchError(message, code, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function assertRoomAvailable(code, deletingRooms, deletedRooms) {
  if (deletingRooms.has(code) || deletedRooms.has(code)) {
    throw matchError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
  }
}

function readinessFor(room, fixtureId) {
  const validManagerIds = new Set(room.managerIds);
  const readyIds = room.matchReadiness?.fixtureId === fixtureId
    ? room.matchReadiness.managerIds.filter((managerId) => validManagerIds.has(managerId))
    : [];
  return {
    readyIds,
    readyCount: readyIds.length,
    requiredCount: room.managerIds.length,
    allReady: room.managerIds.length > 0 && room.managerIds.every((managerId) => readyIds.includes(managerId)),
  };
}

function clubKey(value) {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

function lineupForClub(room, managerId, clubId) {
  if (!managerId || !Array.isArray(room.lineups)) return undefined;
  const lineup = room.lineups.find((candidate) => (
    candidate.managerId === managerId && clubKey(candidate.clubId) === clubKey(clubId)
  ));
  return Array.isArray(lineup?.lineupIds) && lineup.lineupIds.length > 0
    ? [...lineup.lineupIds]
    : undefined;
}

function managerForClub(room, fixtureManagerId, clubId) {
  if (fixtureManagerId) return fixtureManagerId;
  return room.managers.find((manager) => clubKey(manager.clubId) === clubKey(clubId))?.id;
}

export function registerMatchHandlers(io, socket, {
  store,
  matchSessions,
  deletingRooms,
  deletedRooms,
  matchDelayMs,
  catalogStore,
}) {
  const user = socket.data.user;

  async function startMatchSession(room, code, requestedFixtureId) {
    assertRoomAvailable(code, deletingRooms, deletedRooms);
    if (room.status !== "active") {
      throw matchError("Inicie a temporada antes da partida", "ROOM_NOT_ACTIVE");
    }
    if (matchSessions.has(code)) {
      throw matchError("Ja existe uma partida em andamento nesta sala", "MATCH_IN_PROGRESS");
    }

    const fixture = resolveServerFixture(room, requestedFixtureId);
    const readiness = readinessFor(room, fixture.fixtureId);
    if (!readiness.allReady) {
      throw matchError("Todos os managers precisam confirmar que estao prontos", "MATCH_MANAGERS_NOT_READY");
    }

    // Reserva a sala antes das consultas assincronas para impedir dois inicios concorrentes.
    const session = { preparing: true, started: null, events: [], result: null, playback: null };
    matchSessions.set(code, session);

    try {
      const impacts = await loadStarImpactsAtomically(
        catalogStore,
        fixture.homeClubId,
        fixture.awayClubId,
        {
          homeLineupIds: lineupForClub(
            room,
            managerForClub(room, fixture.homeManagerId, fixture.homeClubId),
            fixture.homeClubId,
          ),
          awayLineupIds: lineupForClub(
            room,
            managerForClub(room, fixture.awayManagerId, fixture.awayClubId),
            fixture.awayClubId,
          ),
        },
      );
      assertRoomAvailable(code, deletingRooms, deletedRooms);
      if (matchSessions.get(code) !== session) {
        throw matchError("Inicio da partida foi cancelado", "MATCH_START_CANCELLED");
      }
      const adjustedFixture = applyStarImpactToFixture(fixture, impacts.home, impacts.away);
      const match = {
        ...simulateMatch(adjustedFixture),
        fixtureId: fixture.fixtureId,
        seasonNumber: room.currentSeason,
        seasonYear: room.seasonYear,
        starImpact: adjustedFixture.starImpact,
        strengthProfile: adjustedFixture.strengthProfile,
      };
      const roomChannel = channelForRoom(code);
      const started = {
        code,
        id: match.id,
        fixtureId: fixture.fixtureId,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        eventCount: match.events.length,
        delayMs: matchDelayMs,
        seasonNumber: room.currentSeason,
        seasonYear: room.seasonYear,
        starImpact: match.starImpact,
        strengthProfile: match.strengthProfile,
      };
      session.started = started;
      session.preparing = false;
      const playback = new MatchPlayback(match, {
        delayMs: matchDelayMs,
        onEvent: (matchEvent, playbackState) => {
          const enrichedEvent = {
            matchId: match.id,
            fixtureId: fixture.fixtureId,
            ...matchEvent,
            code,
            skipped: playbackState.skipped,
          };
          session.events.push(clone(enrichedEvent));
          io.to(roomChannel).emit("match:event", enrichedEvent);
        },
        onFinish: async (result) => {
          const completion = await store.completeMatch(code, fixture.fixtureId, result);
          const finishedResult = {
            ...result,
            code,
            fixtureId: fixture.fixtureId,
            completedAt: completion.summary.completedAt,
            roomRevision: completion.room.revision,
            nextFixtureId: completion.room.currentFixtureId,
            seasonNumber: completion.summary.seasonNumber,
            seasonYear: completion.summary.seasonYear,
            nextSeasonNumber: completion.summary.nextSeasonNumber ?? null,
            nextSeasonYear: completion.summary.nextSeasonYear ?? null,
          };
          session.result = clone(finishedResult);
          await emitRoomForViewers(io, completion.room);
          io.to(roomChannel).emit("match:finished", finishedResult);
        },
      });
      session.playback = playback;

      return {
        matchId: match.id,
        starImpact: match.starImpact,
        strengthProfile: match.strengthProfile,
        afterAcknowledgement: () => {
          io.to(roomChannel).emit("match:started", started);
          void playback.start()
            .catch((error) => socket.emit("server:error", {
              event: "match:start",
              error: { code: error.code || "MATCH_PLAYBACK_ERROR", message: error.message },
            }))
            .finally(() => {
              if (matchSessions.get(code) === session) matchSessions.delete(code);
            });
        },
      };
    } catch (error) {
      if (matchSessions.get(code) === session) matchSessions.delete(code);
      throw error;
    }
  }

  registerSafe(socket, "match:ready", async (payload) => {
    const data = parseOrThrow(matchReadySchema, payload);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    if (matchSessions.has(data.code)) {
      throw matchError("A partida desta rodada ja esta em andamento", "MATCH_IN_PROGRESS");
    }
    const room = await store.setMatchReady(data.code, user.uid, data.ready, data.fixtureId);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const fixtureId = room.currentFixtureId;
    const readiness = readinessFor(room, fixtureId);
    await emitRoomForViewers(io, room);

    if (!data.ready || !readiness.allReady) {
      return { room: roomForViewer(room, user.uid), started: false, ...readiness };
    }
    const start = await startMatchSession(room, data.code, fixtureId);
    return { room: roomForViewer(room, user.uid), started: true, ...readiness, ...start };
  });

  registerSafe(socket, "match:start", async (payload) => {
    const data = parseOrThrow(matchStartSchema, payload);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const prepared = await store.prepareMatch(data.code, user.uid, data.fixtureId);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    rememberMembership(socket, data.code);
    if (prepared.migrated) await emitRoomForViewers(io, prepared.room);
    return startMatchSession(prepared.room, data.code, prepared.fixtureId);
  });

  registerSafe(socket, "match:skip", async (payload) => {
    const data = parseOrThrow(matchControlSchema, payload);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    await store.requireMembership(data.code, user.uid);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const session = matchSessions.get(data.code);
    if (!session) throw matchError("Nao existe partida em andamento", "MATCH_NOT_FOUND", 404);
    if (!session.playback) throw matchError("A partida ainda esta sendo preparada", "MATCH_PREPARING");
    session.playback.skip();
    io.to(channelForRoom(data.code)).emit("match:skipped", { code: data.code });
    return { skipped: true };
  });

  registerSafe(socket, "match:sync", async (payload) => {
    const data = parseOrThrow(matchControlSchema, payload);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const room = await store.requireMembership(data.code, user.uid);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    rememberMembership(socket, data.code);
    const session = matchSessions.get(data.code);
    if (session) {
      return {
        source: "live",
        started: clone(session.started),
        events: clone(session.events),
        result: clone(session.result),
      };
    }
    if (room.lastCompletedMatch) {
      return {
        source: "persisted",
        started: null,
        events: [],
        result: clone(room.lastCompletedMatch),
      };
    }
    return { source: "idle", started: null, events: [], result: null };
  });
}
