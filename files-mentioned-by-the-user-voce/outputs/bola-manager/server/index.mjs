import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter as createRedisAdapter } from "@socket.io/redis-adapter";
import { createExpressAuthMiddleware, createSocketAuthMiddleware } from "./auth.mjs";
import { getServerConfig, loadLocalEnvironment } from "./config.mjs";
import { createRoomsRouter } from "./routes/rooms.mjs";
import { createMarketRouter } from "./routes/market.mjs";
import { createMatchRouter } from "./routes/match.mjs";
import { createScoutingRouter } from "./routes/scouting.mjs";
import { createNewsRouter } from "./routes/news.mjs";
import { createTeamsRouter } from "./routes/teams.mjs";
import { createLeaguesRouter } from "./routes/leagues.mjs";
import { createTournamentsRouter } from "./routes/tournaments.mjs";
import { createEditorRouter } from "./routes/editor.mjs";
import { initializeFirebaseAdmin } from "./services/firebaseAdmin.mjs";
import { createSocialAiService } from "./services/socialAi.mjs";
import { createCoachInterviewAiService } from "./services/coachInterviewAi.mjs";
import { createMediaService } from "./services/mediaService.mjs";
import { createBrasfootImportSessionService } from "./services/brasfootImportSessions.mjs";
import { emitRoomForViewers } from "./services/roomVisibility.mjs";
import { channelForRoom } from "./sockets/helpers.mjs";
import { registerSocketHandlers } from "./sockets/index.mjs";
import { NewsStore } from "./store/newsStore.mjs";
import { CatalogStore } from "./store/catalogStore.mjs";
import { catalogForOwner } from "./store/catalogScope.mjs";
import { createRoomPersistence } from "./store/roomPersistence.mjs";
import { createMatchSessionPersistence } from "./store/matchSessionPersistence.mjs";
import { RoomStore } from "./store/roomStore.mjs";
import { createDistributedLock } from "./infrastructure/distributedLock.mjs";
import {
  createDistributedRateLimiter,
  createRateLimitMiddleware,
} from "./infrastructure/distributedRateLimit.mjs";
import {
  createHttpMetricsMiddleware,
  createMetricsRegistry,
  createStructuredLogger,
} from "./infrastructure/observability.mjs";
import {
  createFirestoreReadinessCheck,
  createLivenessPayload,
  createReadinessChecker,
  createRedisReadinessCheck,
} from "./infrastructure/readiness.mjs";
import { createDisabledRedisRuntime, createRedisRuntime } from "./infrastructure/redisRuntime.mjs";
import { createMetricsHandler } from "./infrastructure/metricsEndpoint.mjs";
import { createImagesRouter } from "./routes/images.mjs";
import { createCoordinationGuard, coordinationUnavailable } from "./infrastructure/coordinationAvailability.mjs";

export async function createBolaManagerServer({
  env = process.env,
  logger = console,
  store: injectedStore,
  firebase: injectedFirebase,
  newsStore: injectedNewsStore,
  socialAi: injectedSocialAi,
  coachInterviewAi: injectedCoachInterviewAi,
  catalogStore: injectedCatalogStore,
  mediaService: injectedMediaService,
  brasfootImportService: injectedBrasfootImportService,
  matchSessionStore: injectedMatchSessionStore,
  redisRuntime: injectedRedisRuntime,
  distributedLocks: injectedDistributedLocks,
  rateLimiter: injectedRateLimiter,
  readinessCheck: injectedReadinessCheck,
  metrics: injectedMetrics,
  structuredLogger: injectedStructuredLogger,
  socketAdapterFactory = createRedisAdapter,
} = {}) {
  const config = getServerConfig(env);
  const metrics = injectedMetrics ?? createMetricsRegistry();
  const structuredLogger = injectedStructuredLogger ?? createStructuredLogger({
    output: logger,
    instanceId: config.instanceId,
    level: config.nodeEnv === "development" ? "debug" : "info",
  });
  let redisRuntime = injectedRedisRuntime;
  if (!redisRuntime) {
    try {
      redisRuntime = await createRedisRuntime({
        url: config.redisUrl,
        connectTimeoutMs: config.dependencyTimeoutMs,
        logger: structuredLogger,
      });
    } catch (error) {
      structuredLogger.error("redis.startup_unavailable", { error });
      redisRuntime = createDisabledRedisRuntime("connection-failed");
    }
  }
  const distributedLocks = injectedDistributedLocks ?? (redisRuntime.enabled
    ? createDistributedLock({
      client: redisRuntime.client,
      defaultTtlMs: config.lockTtlMs,
      defaultWaitTimeoutMs: config.lockWaitMs,
      retryMinMs: config.lockRetryMs,
      retryMaxMs: Math.max(config.lockRetryMs, config.lockRetryMs * 4),
      commandTimeoutMs: config.dependencyTimeoutMs,
      instanceId: config.instanceId,
      logger: structuredLogger,
      metrics,
    })
    : null);
  const rateLimiter = injectedRateLimiter ?? (redisRuntime.enabled
    ? createDistributedRateLimiter({
      client: redisRuntime.client,
      limit: config.rateLimitHttpMax,
      windowMs: config.rateLimitWindowMs,
      commandTimeoutMs: config.dependencyTimeoutMs,
      metrics,
    })
    : null);
  const firebase = injectedFirebase ?? await initializeFirebaseAdmin(env);
  const catalogStore = injectedCatalogStore ?? new CatalogStore({ firestore: firebase.firestore });
  try {
    await catalogStore?.ensureInitialized?.();
  } catch (error) {
    structuredLogger.error("firestore.catalog_startup_unavailable", { error });
  }
  const coachInterviewAi = injectedCoachInterviewAi ?? createCoachInterviewAiService({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    fallbackModels: env.GEMINI_FALLBACK_MODELS,
    logger: structuredLogger,
  });
  const store = injectedStore ?? new RoomStore({
    persistence: createRoomPersistence({
      firestore: firebase.firestore,
      mode: config.roomStoreMode,
      nodeEnv: config.nodeEnv,
      allowDemoAuth: config.allowDemoAuth,
    }),
    catalogStore,
    coachInterviewAi,
    logger: structuredLogger,
    metrics,
  });
  const matchSessionStore = injectedMatchSessionStore ?? createMatchSessionPersistence({
    firestore: firebase.firestore,
    mode: injectedStore && !firebase.firestore ? "memory" : config.roomStoreMode,
    nodeEnv: config.nodeEnv,
    allowDemoAuth: config.allowDemoAuth,
    operationTimeoutMs: config.matchPersistenceTimeoutMs,
  });

  const app = express();
  const httpServer = createHttpServer(app);
  const allowedOrigins = config.clientOrigin.split(",").map((origin) => origin.trim()).filter(Boolean);
  const corsOptions = {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error("Origem nao permitida pelo CORS"));
    },
    credentials: true,
  };
  const io = new SocketIOServer(httpServer, {
    cors: corsOptions,
    ...(config.nodeEnv === "production" ? { transports: ["websocket"] } : {}),
  });
  if (redisRuntime.enabled) {
    io.adapter(socketAdapterFactory(redisRuntime.publisher, redisRuntime.subscriber, {
      requestsTimeout: config.dependencyTimeoutMs,
    }));
  }
  const newsStore = injectedNewsStore ?? new NewsStore({ firestore: firebase.firestore });
  const mediaService = injectedMediaService ?? createMediaService({ env, bucket: firebase.bucket });
  const brasfootImportService = injectedBrasfootImportService ?? createBrasfootImportSessionService({
    database: firebase.firestore,
    databaseForOwner: async (ownerId) => catalogForOwner(catalogStore, ownerId),
    bucket: firebase.bucket,
    mediaService,
    logger: structuredLogger,
    nodeEnv: config.nodeEnv,
  });
  const socialAi = injectedSocialAi ?? createSocialAiService({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    fallbackModels: env.GEMINI_FALLBACK_MODELS,
    logger: structuredLogger,
  });

  let draining = false;
  const eventLoopIntervalMs = 1_000;
  let expectedEventLoopAt = Date.now() + eventLoopIntervalMs;
  let lastEventLoopWarningAt = 0;
  const eventLoopMonitor = setInterval(() => {
    const now = Date.now();
    const lagMs = Math.max(0, now - expectedEventLoopAt);
    expectedEventLoopAt = now + eventLoopIntervalMs;
    metrics.setGauge("event_loop_lag_ms", lagMs);
    if (lagMs >= config.eventLoopWarnMs && now - lastEventLoopWarningAt >= 10_000) {
      lastEventLoopWarningAt = now;
      structuredLogger.warn("event_loop.slow", { lagMs, thresholdMs: config.eventLoopWarnMs });
    }
  }, eventLoopIntervalMs);
  eventLoopMonitor.unref?.();
  const liveness = createLivenessPayload({ instanceId: config.instanceId });
  const firestoreRequired = !injectedStore && config.roomStoreMode === "firestore";
  const productionCoordinationRequired = config.nodeEnv === "production" && !injectedStore;
  const redisRequired = productionCoordinationRequired || Boolean(config.redisUrl);
  const assertCoordinationAvailable = createCoordinationGuard({
    required: redisRequired, runtime: redisRuntime, locks: distributedLocks, rateLimiter,
  });
  const readinessCheck = injectedReadinessCheck ?? createReadinessChecker({
    checks: {
      ...(firestoreRequired || firebase.firestore
        ? { firestore: createFirestoreReadinessCheck(firebase.firestore, { timeoutMs: config.dependencyTimeoutMs }) }
        : {}),
      ...(redisRequired || redisRuntime.enabled
        ? { redis: createRedisReadinessCheck(redisRuntime, { timeoutMs: config.dependencyTimeoutMs }) }
        : {}),
    },
    timeoutMs: config.dependencyTimeoutMs,
    metrics,
  });

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(cors(corsOptions));
  app.use((request, response, next) => {
    const startedAt = Date.now();
    request.requestId = String(request.headers["x-request-id"] ?? randomUUID()).slice(0, 128);
    response.setHeader("X-Request-Id", request.requestId);
    const context = {
      requestId: request.requestId,
      method: request.method,
      path: request.path,
    };
    structuredLogger.info("http.request_start", context);
    let finished = false;
    const slowTimer = setTimeout(() => {
      structuredLogger.warn("http.request_slow", {
        ...context,
        durationMs: Date.now() - startedAt,
        thresholdMs: config.httpSlowMs,
      });
    }, config.httpSlowMs);
    slowTimer.unref?.();
    response.once("finish", () => {
      finished = true;
      clearTimeout(slowTimer);
      structuredLogger.info("http.request_end", {
        ...context,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    response.once("close", () => {
      clearTimeout(slowTimer);
      if (!finished) structuredLogger.warn("http.request_aborted", {
        ...context,
        durationMs: Date.now() - startedAt,
      });
    });
    if (draining && !["/health", "/ready", "/metrics"].includes(request.path)) {
      response.status(503).json({ error: { code: "SERVER_DRAINING", message: "Servidor encerrando" } });
      return;
    }
    next();
  });
  app.use(createHttpMetricsMiddleware(metrics));
  app.all("/metrics", createMetricsHandler({ token: config.metricsToken, metrics, instanceId: config.instanceId }));
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_request, response) => {
    response.json({
      ...liveness(),
      firebase: firebase.enabled ? "connected" : "disabled",
      auth: config.allowDemoAuth ? "firebase-or-explicit-demo" : "firebase",
      roomStore: config.roomStoreMode,
      mediaStorage: mediaService.provider ?? "custom",
      mediaUpload: mediaService.configured === false ? "unavailable" : "ready",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/ready", async (_request, response) => {
    if (draining) {
      response.status(503).json({ status: "draining", instanceId: config.instanceId });
      return;
    }
    const readiness = await readinessCheck();
    structuredLogger[readiness.ok ? "debug" : "warn"]("dependencies.readiness", readiness);
    response.status(readiness.ok ? 200 : 503).json({
      ...readiness,
      instanceId: config.instanceId,
    });
  });

  app.use((_request, _response, next) => {
    try { assertCoordinationAvailable(); next(); } catch (error) { next(error); }
  });
  if (rateLimiter) {
    app.use(createRateLimitMiddleware(rateLimiter, {
      keyResolver: (request) => `http:${request.ip || request.socket?.remoteAddress || "unknown"}`,
      limit: config.rateLimitHttpMax,
      windowMs: config.rateLimitWindowMs,
    }));
  }
  app.use((_request, _response, next) => {
    try { assertCoordinationAvailable(); next(); } catch (error) { next(error); }
  });

  app.use("/api/media", createImagesRouter());

  const expressAuth = createExpressAuthMiddleware({
    auth: firebase.auth,
    allowDemoAuth: config.allowDemoAuth,
    nodeEnv: config.nodeEnv,
    timeoutMs: config.authTimeoutMs,
  });
  app.use("/api/rooms", expressAuth, createRoomsRouter(store, catalogStore, {
    broadcastRoom(room) {
      return emitRoomForViewers(io, room);
    },
    logger: structuredLogger,
  }));
  app.use("/api/teams", expressAuth, createTeamsRouter(firebase.firestore, catalogStore, store));
  app.use("/api/leagues", expressAuth, createLeaguesRouter(catalogStore, store));
  app.use("/api/tournaments", expressAuth, createTournamentsRouter(catalogStore, store));
  app.use("/api/matches", expressAuth, createMatchRouter(store));
  app.use("/api/market", expressAuth, createMarketRouter(store));
  app.use("/api/scouting", expressAuth, createScoutingRouter(store));
  app.use("/api/news", expressAuth, createNewsRouter(store, newsStore, socialAi, {
    logger: structuredLogger,
    broadcast(post) {
      io.to(channelForRoom(post.roomCode)).emit("news:post", post);
    },
    broadcastRoom(room) {
      return emitRoomForViewers(io, room);
    },
  }));
  app.use("/api/editor", expressAuth, createEditorRouter(catalogStore, mediaService, {
    logger: structuredLogger,
    nodeEnv: config.nodeEnv,
    allowLocalEditor: config.allowLocalEditor,
    editorAdminUids: config.editorAdminUids,
    brasfootImportService,
  }));

  app.use((request, response) => {
    response.status(404).json({
      error: { code: "NOT_FOUND", message: `Rota nao encontrada: ${request.method} ${request.path}` },
    });
  });
  app.use((error, request, response, _next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) structuredLogger.error("http.request_error", {
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      status,
      error,
    });
    response.status(status).json({
      error: {
        code: error.code || (error.name === "ValidationError" ? "VALIDATION_ERROR" : "SERVER_ERROR"),
        message: status >= 500 && error.expose !== true ? "Erro interno do servidor" : error.message,
        details: error.details,
      },
    });
  });

  io.use((_socket, next) => {
    try { assertCoordinationAvailable(); next(); } catch (error) { next(error); }
  });
  if (rateLimiter) {
    io.use(async (socket, next) => {
      try {
        const result = await rateLimiter.consume(
          `socket-connect:${socket.handshake.address || "unknown"}`,
          { limit: config.rateLimitSocketMax, windowMs: config.rateLimitWindowMs },
        );
        if (!result.allowed) {
          const error = new Error("Muitas conexoes em tempo real");
          error.data = { code: "RATE_LIMITED", retryAfterMs: result.retryAfterMs };
          next(error);
          return;
        }
        next();
      } catch (error) {
        structuredLogger.warn("socket.coordination_unavailable", { error });
        next(coordinationUnavailable(error));
      }
    });
  }
  const authenticateSocket = createSocketAuthMiddleware({
    auth: firebase.auth,
    allowDemoAuth: config.allowDemoAuth,
    nodeEnv: config.nodeEnv,
    timeoutMs: config.authTimeoutMs,
    recheckMs: config.socketAuthRecheckMs,
  });
  io.use(authenticateSocket);
  io.use((_socket, next) => {
    try { assertCoordinationAvailable(); next(); } catch (error) { next(error); }
  });
  const sockets = registerSocketHandlers(io, {
    assertCoordinationAvailable,
    authenticateSocket,
    store,
    catalogStore,
    mediaService,
    matchDelayMs: config.matchEventDelayMs,
    matchSessionStore,
    distributedLocks,
    matchLockTtlMs: config.lockTtlMs,
    matchLockWaitMs: config.lockWaitMs,
    rateLimiter,
    socketRateLimit: config.rateLimitSocketMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
    socketSlowMs: config.socketSlowMs,
    matchPersistenceTimeoutMs: config.matchPersistenceTimeoutMs,
    metrics,
    logger: structuredLogger,
  });

  io.on("connection", (socket) => {
    metrics.increment("socket_connections_total");
    metrics.setGauge("socket_connections_active", io.engine.clientsCount);
    structuredLogger.info("socket.connected", { socketId: socket.id });
    socket.once("disconnect", (reason) => {
      metrics.increment("socket_disconnections_total");
      metrics.setGauge("socket_connections_active", io.engine.clientsCount);
      structuredLogger.info("socket.disconnected", { socketId: socket.id, reason });
    });
  });
  io.engine.on("connection_error", (error) => {
    structuredLogger.warn("socket.connection_error", {
      code: error.code,
      message: error.message,
      transport: error.context?.transport?.name,
    });
  });

  let closePromise = null;

  return {
    app,
    config,
    firebase,
    httpServer,
    io,
    newsStore,
    catalogStore,
    brasfootImportService,
    socialAi,
    store,
    matchSessionStore,
    redisRuntime,
    distributedLocks,
    rateLimiter,
    metrics,
    async listen(port = config.port) {
      await new Promise((resolveListen, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, () => {
          httpServer.off("error", reject);
          resolveListen();
        });
      });
      return httpServer.address();
    },
    async close() {
      if (!closePromise) {
        draining = true;
        clearInterval(eventLoopMonitor);
        metrics.setGauge("server_ready", 0);
        closePromise = (async () => {
          const graceful = (async () => {
            await sockets.close();
            await new Promise((resolveClose) => io.close(() => resolveClose()));
            await brasfootImportService.close?.();
            await redisRuntime.close?.();
            structuredLogger.info("server.shutdown_complete");
          })();
          let timer;
          try {
            await Promise.race([
              graceful,
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(Object.assign(new Error("Shutdown timeout"), {
                  code: "SHUTDOWN_TIMEOUT",
                })), config.shutdownTimeoutMs);
              }),
            ]);
          } catch (error) {
            structuredLogger.error("server.shutdown_forced", { error });
            io.disconnectSockets(true);
            httpServer.closeAllConnections?.();
            redisRuntime.subscriber?.disconnect?.();
            redisRuntime.publisher?.disconnect?.();
            redisRuntime.client?.disconnect?.();
            throw error;
          } finally {
            clearTimeout(timer);
          }
        })();
      }
      return closePromise;
    },
  };
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  loadLocalEnvironment();
  const server = await createBolaManagerServer();
  await server.listen();
  console.log(`Bola Manager server em http://localhost:${server.config.port}`);
  console.log(`Firebase Admin: ${server.firebase.enabled ? "ativo" : "desativado"}`);

  const shutdown = async () => {
    try {
      await server.close();
      process.exitCode = 0;
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
