import { registerChatHandlers } from "./chatHandlers.mjs";
import { registerMatchHandlers } from "./matchHandlers.mjs";
import { registerMarketHandlers } from "./marketHandlers.mjs";
import { registerRoomHandlers } from "./roomHandlers.mjs";
import { registerLineupHandlers } from "./lineupHandlers.mjs";
import { registerClubCareerHandlers } from "./clubCareerHandlers.mjs";
import { channelForManager } from "./helpers.mjs";

export function registerSocketHandlers(io, options) {
  const matchSessions = new Map();
  const matchRecoveryLocks = new Map();
  const deletingRooms = new Set();
  const deletedRooms = new Set();
  const matchOptions = {
    ...options,
    matchSessions,
    matchRecoveryLocks,
    deletingRooms,
    deletedRooms,
  };

  function clusterSocket(user) {
    const handlers = new Map();
    return {
      data: { user, roomCodes: [] },
      on(eventName, handler) {
        handlers.set(eventName, handler);
      },
      emit() {},
      join() {},
      leave() {},
      dispatch(eventName, payload) {
        const handler = handlers.get(eventName);
        if (!handler) return Promise.resolve(null);
        return new Promise((resolve) => handler(payload, resolve));
      },
    };
  }

  if (options.distributedLocks) {
    io.on("cluster:match-command", async (request, acknowledgement) => {
      const code = String(request?.payload?.code ?? "").trim().toUpperCase();
      const eventName = String(request?.event ?? "");
      if (!code || !eventName.startsWith("match:") || !matchSessions.has(code)) {
        acknowledgement?.({ handled: false });
        return;
      }
      try {
        const proxy = clusterSocket(request.user);
        registerMatchHandlers(io, proxy, matchOptions);
        const response = await proxy.dispatch(eventName, request.payload);
        acknowledgement?.({ handled: Boolean(response), response });
      } catch (error) {
        options.logger?.error?.("socket.cluster_command_error", { eventName, code, error });
        acknowledgement?.({ handled: false });
      }
    });
  }

  io.on("connection", (socket) => {
    if (options.rateLimiter) {
      socket.data.consumeRateLimit = async (eventName) => {
        try {
          return await options.rateLimiter.consume(
            `socket-event:${socket.data.user.uid}`,
            {
              limit: options.socketRateLimit,
              windowMs: options.rateLimitWindowMs,
              labels: { event: eventName },
            },
          );
        } catch (error) {
          error.code ??= "RATE_LIMIT_UNAVAILABLE";
          error.status ??= 503;
          throw error;
        }
      };
    }
    if (options.distributedLocks && typeof io.serverSideEmitWithAck === "function") {
      socket.data.forwardEvent = async (eventName, payload) => {
        if (!eventName.startsWith("match:")) return null;
        const responses = await io.serverSideEmitWithAck("cluster:match-command", {
          event: eventName,
          payload,
          user: {
            uid: socket.data.user.uid,
            name: socket.data.user.name,
            email: socket.data.user.email,
            editor: socket.data.user.editor,
            authType: socket.data.user.authType,
          },
        });
        return responses.find((response) => response?.handled)?.response ?? null;
      };
    }
    socket.join(channelForManager(socket.data.user.uid));
    socket.emit("server:ready", { socketId: socket.id });
    registerRoomHandlers(io, socket, { ...options, matchSessions, deletingRooms, deletedRooms });
    registerLineupHandlers(io, socket, { ...options, matchSessions });
    registerChatHandlers(io, socket, options);
    registerMatchHandlers(io, socket, matchOptions);
    registerMarketHandlers(io, socket, { ...options, matchSessions });
    registerClubCareerHandlers(io, socket, options);
  });

  return {
    async close() {
      const sessions = [...matchSessions.values()];
      for (const session of sessions) {
        session.playback?.cancel();
      }
      await Promise.allSettled(sessions.map((session) => Promise.resolve(session.persistChain)));
      const releases = [];
      for (const session of sessions) {
        session.ownershipReleased = true;
        clearInterval(session.ownershipHeartbeat);
        releases.push(Promise.resolve(session.ownership?.release?.()).catch(() => {}));
      }
      matchSessions.clear();
      matchRecoveryLocks.clear();
      deletingRooms.clear();
      deletedRooms.clear();
      await Promise.all(releases);
    },
  };
}
