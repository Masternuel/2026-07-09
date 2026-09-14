import { createBolaManagerServer } from "../index.mjs";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";
import { MemoryMatchSessionPersistence } from "../store/matchSessionPersistence.mjs";

const USERS = {
  "owner-token": { uid: "uid-owner", name: "Dona da Sala", email: "owner@example.com" },
  "second-token": { uid: "uid-second", name: "Segundo Manager", email: "second@example.com" },
  "intruder-token": { uid: "uid-intruder", name: "Intruso", email: "intruder@example.com" },
  "editor-token": { uid: "uid-editor", name: "Editora", email: "editor@example.com", editor: true },
  "admin-token": { uid: "uid-admin", name: "Admin", email: "admin@example.com" },
  "string-editor-token": { uid: "uid-string-editor", name: "Claim invalido", editor: "true" },
};

export function fakeFirebase({ firestore = null, bucket = null } = {}) {
  return {
    enabled: true,
    firestore,
    storage: bucket ? { bucket: () => bucket } : null,
    bucket,
    auth: {
      async verifyIdToken(token) {
        const decoded = USERS[token];
        if (!decoded) throw new Error("invalid token");
        return { ...decoded, exp: Math.floor(Date.now() / 1000) + 3600 };
      },
    },
  };
}

export function automaticallyReadyAtHalftime(socket) {
  socket.once("match:halftime", (halftime) => {
    void socket.timeout(1_000).emitWithAck("match:halftime-ready", {
      code: halftime.code,
      matchId: halftime.matchId,
      ready: true,
    }).catch(() => {});
  });
}

export async function startTestServer({
  store: injectedStore,
  newsStore,
  socialAi,
  catalogStore,
  mediaService,
  brasfootImportService,
  firebase,
  env = {},
  matchDelayMs = 0,
  matchSessionStore,
  redisRuntime,
  distributedLocks,
  rateLimiter,
  readinessCheck,
  metrics,
  structuredLogger,
  socketAdapterFactory,
} = {}) {
  const store = injectedStore ?? new RoomStore({
    persistence: new MemoryRoomPersistence(),
    codeFactory: () => "BOLA-T3ST",
    now: () => new Date("2026-07-10T00:00:00.000Z"),
  });
  const server = await createBolaManagerServer({
    env: {
      NODE_ENV: "test",
      CLIENT_ORIGIN: "http://localhost:5191,http://127.0.0.1:5191",
      MATCH_EVENT_DELAY_MS: String(matchDelayMs),
      ...env,
    },
    firebase: firebase ?? fakeFirebase(),
    store,
    newsStore,
    socialAi,
    catalogStore,
    mediaService,
    brasfootImportService,
    matchSessionStore: matchSessionStore ?? new MemoryMatchSessionPersistence(),
    redisRuntime,
    distributedLocks,
    rateLimiter,
    readinessCheck,
    metrics,
    structuredLogger,
    socketAdapterFactory,
    logger: { error() {} },
  });
  await new Promise((resolve, reject) => {
    server.httpServer.once("error", reject);
    server.httpServer.listen(0, "127.0.0.1", () => {
      server.httpServer.off("error", reject);
      resolve();
    });
  });
  const address = server.httpServer.address();
  return { server, store, url: `http://127.0.0.1:${address.port}` };
}

export function jsonRequest(url, token, { method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
