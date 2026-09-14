import { registerChatHandlers } from "./chatHandlers.mjs";
import { registerMatchHandlers } from "./matchHandlers.mjs";
import { registerMarketHandlers } from "./marketHandlers.mjs";
import { registerRoomHandlers } from "./roomHandlers.mjs";
import { registerLineupHandlers } from "./lineupHandlers.mjs";
import { registerClubCareerHandlers } from "./clubCareerHandlers.mjs";
import { channelForManager, clientError } from "./helpers.mjs";
import { coordinationUnavailable } from "../infrastructure/coordinationAvailability.mjs";

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

  function clusterSocket(credentials) {
    const handlers = new Map();
    return {
      data: {
        roomCodes: [],
        logger: options.logger,
        metrics: options.metrics,
        slowOperationMs: options.socketSlowMs,
        assertCoordinationAvailable: options.assertCoordinationAvailable,
      },
      handshake: { auth: credentials },
      disconnect() { this.data.disposeAuthSession?.(); },
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
      const proxy = clusterSocket(request?.auth);
      try {
        options.assertCoordinationAvailable?.();
        await new Promise((resolve, reject) => options.authenticateSocket(proxy, (error) => error ? reject(error) : resolve()));
        registerMatchHandlers(io, proxy, matchOptions);
        const response = await proxy.dispatch(eventName, request.payload);
        acknowledgement?.({ handled: Boolean(response), response });
      } catch (error) {
        const serialized = clientError(error, request?.payload?._requestId);
        options.logger?.error?.("socket.cluster_command_error", { eventName, code, requestId: serialized.requestId, error });
        acknowledgement?.({ handled: true, response: { ok: false, error: serialized } });
      } finally {
        proxy.data.disposeAuthSession?.();
      }
    });
  }

  io.on("connection", (socket) => {
    socket.data.logger = options.logger;
    socket.data.metrics = options.metrics;
    socket.data.slowOperationMs = options.socketSlowMs;
    socket.data.assertCoordinationAvailable = options.assertCoordinationAvailable;
    socket.data.startAuthSession?.();
    socket.onAnyOutgoing?.((eventName) => {
      options.logger?.debug?.("socket.event_sent", { eventName, socketId: socket.id });
    });
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
          options.logger?.warn?.("socket.coordination_unavailable", { error });
          throw coordinationUnavailable(error);
        }
      };
    }
    if (options.distributedLocks && typeof io.serverSideEmitWithAck === "function") {
      socket.data.forwardEvent = async (eventName, payload) => {
        if (!eventName.startsWith("match:")) return null;
        await socket.data.authorize(eventName);
        options.assertCoordinationAvailable?.();
        const responses = await io.serverSideEmitWithAck("cluster:match-command", {
          event: eventName,
          payload,
          auth: socket.data.authCredentials(),
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
