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
import { initializeFirebaseAdmin } from "./services/firebaseAdmin.mjs";
import { registerSocketHandlers } from "./sockets/index.mjs";
import { createRoomPersistence } from "./store/roomPersistence.mjs";
import { RoomStore } from "./store/roomStore.mjs";

export async function createBolaManagerServer({
  env = process.env,
  logger = console,
  store: injectedStore,
  firebase: injectedFirebase,
} = {}) {
  const config = getServerConfig(env);
  const firebase = injectedFirebase ?? await initializeFirebaseAdmin(env);
  const store = injectedStore ?? new RoomStore({
    persistence: createRoomPersistence({
      firestore: firebase.firestore,
      mode: config.roomStoreMode,
      nodeEnv: config.nodeEnv,
      allowDemoAuth: config.allowDemoAuth,
    }),
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
      timestamp: new Date().toISOString(),
    });
  });

  const expressAuth = createExpressAuthMiddleware({
    auth: firebase.auth,
    allowDemoAuth: config.allowDemoAuth,
    nodeEnv: config.nodeEnv,
  });
  app.use("/api/rooms", expressAuth, createRoomsRouter(store));
  app.use("/api/teams", expressAuth, createTeamsRouter(firebase.firestore));
  app.use("/api/matches", expressAuth, createMatchRouter(store));
  app.use("/api/market", expressAuth, createMarketRouter(store, firebase.firestore));
  app.use("/api/news", expressAuth, createNewsRouter(store, firebase.firestore));

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
        message: status >= 500 ? "Erro interno do servidor" : error.message,
        details: error.details,
      },
    });
  });

  const io = new SocketIOServer(httpServer, { cors: corsOptions });
  io.use(createSocketAuthMiddleware({
    auth: firebase.auth,
    allowDemoAuth: config.allowDemoAuth,
    nodeEnv: config.nodeEnv,
  }));
  const sockets = registerSocketHandlers(io, {
    store,
    matchDelayMs: config.matchEventDelayMs,
  });

  return {
    app,
    config,
    firebase,
    httpServer,
    io,
    store,
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
