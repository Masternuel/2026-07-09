import { createServer as createHttpServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { createExpressAuthMiddleware, createSocketAuthMiddleware } from "./auth.mjs";
import { getServerConfig, loadLocalEnvironment } from "./config.mjs";
import { createRoomsRouter } from "./routes/rooms.mjs";
import { createMarketRouter } from "./routes/market.mjs";
import { createMatchRouter } from "./routes/match.mjs";
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
} = {}) {
  const config = getServerConfig(env);
  const firebase = injectedFirebase ?? await initializeFirebaseAdmin(env);
  const catalogStore = injectedCatalogStore ?? new CatalogStore({ firestore: firebase.firestore });
  const coachInterviewAi = injectedCoachInterviewAi ?? createCoachInterviewAiService({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    fallbackModels: env.GEMINI_FALLBACK_MODELS,
    logger,
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
  });
  const matchSessionStore = injectedMatchSessionStore ?? createMatchSessionPersistence({
    firestore: firebase.firestore,
    mode: injectedStore && !firebase.firestore ? "memory" : config.roomStoreMode,
    nodeEnv: config.nodeEnv,
    allowDemoAuth: config.allowDemoAuth,
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
  const io = new SocketIOServer(httpServer, { cors: corsOptions });
  const newsStore = injectedNewsStore ?? new NewsStore({ firestore: firebase.firestore });
  const mediaService = injectedMediaService ?? createMediaService({ env, bucket: firebase.bucket });
  const brasfootImportService = injectedBrasfootImportService ?? createBrasfootImportSessionService({
    database: firebase.firestore,
    databaseForOwner: async (ownerId) => (await catalogForOwner(catalogStore, ownerId)).firestore,
    mediaService,
    logger,
  });
  const socialAi = injectedSocialAi ?? createSocialAiService({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    fallbackModels: env.GEMINI_FALLBACK_MODELS,
    logger,
  });

  app.disable("x-powered-by");
  app.use(cors(corsOptions));
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "bola-manager-server",
      firebase: firebase.enabled ? "connected" : "disabled",
      auth: config.allowDemoAuth ? "firebase-or-explicit-demo" : "firebase",
      roomStore: config.roomStoreMode,
      mediaStorage: mediaService.provider ?? "custom",
      mediaUpload: mediaService.configured === false ? "unavailable" : "ready",
      timestamp: new Date().toISOString(),
    });
  });

  const expressAuth = createExpressAuthMiddleware({
    auth: firebase.auth,
    allowDemoAuth: config.allowDemoAuth,
    nodeEnv: config.nodeEnv,
  });
  app.use("/api/rooms", expressAuth, createRoomsRouter(store, catalogStore, {
    broadcastRoom(room) {
      return emitRoomForViewers(io, room);
    },
  }));
  app.use("/api/teams", expressAuth, createTeamsRouter(firebase.firestore, catalogStore, store));
  app.use("/api/leagues", expressAuth, createLeaguesRouter(catalogStore, store));
  app.use("/api/tournaments", expressAuth, createTournamentsRouter(catalogStore, store));
  app.use("/api/matches", expressAuth, createMatchRouter(store));
  app.use("/api/market", expressAuth, createMarketRouter(store));
  app.use("/api/news", expressAuth, createNewsRouter(store, newsStore, socialAi, {
    logger,
    broadcast(post) {
      io.to(channelForRoom(post.roomCode)).emit("news:post", post);
    },
    broadcastRoom(room) {
      return emitRoomForViewers(io, room);
    },
  }));
  app.use("/api/editor", expressAuth, createEditorRouter(catalogStore, mediaService, {
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
  app.use((error, _request, response, _next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) logger.error(error);
    response.status(status).json({
      error: {
        code: error.code || (error.name === "ValidationError" ? "VALIDATION_ERROR" : "SERVER_ERROR"),
        message: status >= 500 && error.expose !== true ? "Erro interno do servidor" : error.message,
        details: error.details,
      },
    });
  });

  io.use(createSocketAuthMiddleware({
    auth: firebase.auth,
    allowDemoAuth: config.allowDemoAuth,
    nodeEnv: config.nodeEnv,
  }));
  const sockets = registerSocketHandlers(io, {
    store,
    catalogStore,
    mediaService,
    matchDelayMs: config.matchEventDelayMs,
    matchSessionStore,
  });

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
      sockets.close();
      await new Promise((resolveClose) => io.close(() => resolveClose()));
      await brasfootImportService.close?.();
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
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
