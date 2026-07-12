import { resolveServerFixture } from "../game/fixtures.mjs";
import { MatchPlayback, simulateMatch } from "../game/matchSimulator.mjs";
import { matchControlSchema, matchReadySchema, matchStartSchema, parseOrThrow } from "../schemas.mjs";
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

export function registerMatchHandlers(io, socket, {
  store,
  matchSessions,
  deletingRooms,
  deletedRooms,
  matchDelayMs,
}) {
  const user = socket.data.user;

  function startMatchSession(room, code, requestedFixtureId) {
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

    const match = { ...simulateMatch(fixture), fixtureId: fixture.fixtureId };
    const roomChannel = channelForRoom(code);
    const started = {
      code,
      id: match.id,
      fixtureId: fixture.fixtureId,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      eventCount: match.events.length,
      delayMs: matchDelayMs,
    };
    const session = { started, events: [], result: null, playback: null };
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
        };
        session.result = clone(finishedResult);
        io.to(roomChannel).emit("room:state", completion.room);
        io.to(roomChannel).emit("match:finished", finishedResult);
      },
    });
    session.playback = playback;
    matchSessions.set(code, session);

    return {
      matchId: match.id,
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
    io.to(channelForRoom(data.code)).emit("room:state", room);

    if (!data.ready || !readiness.allReady) {
      return { room, started: false, ...readiness };
    }
    const start = startMatchSession(room, data.code, fixtureId);
    return { room, started: true, ...readiness, ...start };
  });

  registerSafe(socket, "match:start", async (payload) => {
    const data = parseOrThrow(matchStartSchema, payload);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const prepared = await store.prepareMatch(data.code, user.uid, data.fixtureId);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    rememberMembership(socket, data.code);
    if (prepared.migrated) io.to(channelForRoom(data.code)).emit("room:state", prepared.room);
    return startMatchSession(prepared.room, data.code, prepared.fixtureId);
  });

  registerSafe(socket, "match:skip", async (payload) => {
    const data = parseOrThrow(matchControlSchema, payload);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    await store.requireMembership(data.code, user.uid);
    assertRoomAvailable(data.code, deletingRooms, deletedRooms);
    const session = matchSessions.get(data.code);
    if (!session) throw matchError("Nao existe partida em andamento", "MATCH_NOT_FOUND", 404);
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
