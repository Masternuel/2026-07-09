import { createBolaManagerServer } from "../index.mjs";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

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
        return decoded;
      },
    },
  };
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
} = {}) {
  const store = injectedStore ?? new RoomStore({
    persistence: new MemoryRoomPersistence(),
    codeFactory: () => "BOLA-T3ST",
    now: () => new Date("2026-07-10T00:00:00.000Z"),
  });
  const server = await createBolaManagerServer({
    env: {
      NODE_ENV: "test",
      CLIENT_ORIGIN: "*",
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
    logger: { error() {} },
  });
  const address = await server.listen(0);
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
