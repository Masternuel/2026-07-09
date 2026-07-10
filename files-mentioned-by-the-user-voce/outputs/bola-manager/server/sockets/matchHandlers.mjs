import { resolveServerFixture } from "../game/fixtures.mjs";
import { MatchPlayback, simulateMatch } from "../game/matchSimulator.mjs";
import { matchControlSchema, matchStartSchema, parseOrThrow } from "../schemas.mjs";
import { channelForRoom, registerSafe } from "./helpers.mjs";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function registerMatchHandlers(io, socket, { store, matchSessions, matchDelayMs }) {
  const user = socket.data.user;

  registerSafe(socket, "match:start", async (payload) => {
    const data = parseOrThrow(matchStartSchema, payload);
    const room = await store.requireMembership(data.code, user.uid);
    if (room.status !== "active") {
      const error = new Error("Inicie a temporada antes da partida");
      error.code = "ROOM_NOT_ACTIVE";
      error.status = 409;
      throw error;
    }
    if (matchSessions.has(data.code)) {
      const error = new Error("Ja existe uma partida em andamento nesta sala");
      error.code = "MATCH_IN_PROGRESS";
      error.status = 409;
      throw error;
    }

    const fixture = resolveServerFixture(room, data.fixtureId);
    const match = { ...simulateMatch(fixture), fixtureId: fixture.fixtureId };
    const roomChannel = channelForRoom(data.code);
    const started = {
      id: match.id,
      fixtureId: fixture.fixtureId,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      eventCount: match.events.length,
      delayMs: matchDelayMs,
    };
    const session = {
      started,
      events: [],
      result: null,
      playback: null,
    };
    const playback = new MatchPlayback(match, {
      delayMs: matchDelayMs,
      onEvent: (matchEvent, playbackState) => {
        const enrichedEvent = {
          matchId: match.id,
          fixtureId: fixture.fixtureId,
          ...matchEvent,
          skipped: playbackState.skipped,
        };
        session.events.push(clone(enrichedEvent));
        io.to(roomChannel).emit("match:event", enrichedEvent);
      },
      onFinish: async (result) => {
        const completion = await store.completeMatch(data.code, fixture.fixtureId, result);
        const finishedResult = {
          ...result,
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
    matchSessions.set(data.code, session);

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
            if (matchSessions.get(data.code) === session) matchSessions.delete(data.code);
          });
      },
    };
  });

  registerSafe(socket, "match:skip", async (payload) => {
    const data = parseOrThrow(matchControlSchema, payload);
    await store.requireMembership(data.code, user.uid);
    const session = matchSessions.get(data.code);
    if (!session) {
      const error = new Error("Nao existe partida em andamento");
      error.code = "MATCH_NOT_FOUND";
      error.status = 404;
      throw error;
    }
    session.playback.skip();
    io.to(channelForRoom(data.code)).emit("match:skipped", { code: data.code });
    return { skipped: true };
  });

  registerSafe(socket, "match:sync", async (payload) => {
    const data = parseOrThrow(matchControlSchema, payload);
    const room = await store.requireMembership(data.code, user.uid);
    socket.join(channelForRoom(data.code));
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

