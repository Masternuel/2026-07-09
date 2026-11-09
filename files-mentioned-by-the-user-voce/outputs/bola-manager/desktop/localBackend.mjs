import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { createBolaManagerServer } from "../server/index.mjs";
import { RoomStore } from "../server/store/roomStore.mjs";
import { createOriginPolicy } from "../server/infrastructure/networkPolicy.mjs";
import { createDisabledRedisRuntime } from "../server/infrastructure/redisRuntime.mjs";
import { openLocalDatabase } from "./localDatabase.mjs";
import { createFileStores } from "./fileStores.mjs";
import { createStarterCatalog } from "./localCatalog.mjs";
import { LocalEditorCatalog } from "./localEditorCatalog.mjs";
import { LocalEditorMedia } from "./localEditorMedia.mjs";
import { createLocalBrasfootImport } from "./localBrasfootImport.mjs";
import { catalogCounts } from "./catalogImport.mjs";
import { createDesktopSocialAi } from "./socialAi.mjs";

export async function startLocalBackend({ directory, staticDirectory, logger = console, socialAiConfig, socialAiFetch } = {}) {
  if (staticDirectory) await access(join(staticDirectory, "index.html"));
  const database = await openLocalDatabase(directory, {
    profile: { uid: `local-${randomUUID()}`, displayName: "Manager", preferences: null },
    catalog: createStarterCatalog(),
    rooms: { rooms: [], deletedCodes: [], creationReceipts: [], history: [] },
    matches: [],
    news: { posts: [], operations: [] },
  });
  let server;
  try {
    const profile = await database.read((state) => state.profile);
    const socialAi = createDesktopSocialAi({ config: socialAiConfig, fetchImpl: socialAiFetch, logger });
    const authorizations = new Map();
    let origin = null;
    let peerMode = () => "offline";
    const assertEditable = () => {
      if (peerMode() !== "offline" || authorizations.size) throw Object.assign(new Error("Desconecte a sessao multiplayer antes de editar a base"), { code: "LOCAL_EDITOR_PEER_ACTIVE", status: 409, public: true });
    };
    const media = new LocalEditorMedia(database, profile.uid, { origin: () => origin, assertEditable });
    const catalog = new LocalEditorCatalog(database, profile.uid, {
      canRead: (uid) => [...authorizations.values()].some((entry) => entry.uid === uid), assertEditable, media,
    });
    const brasfootImportService = createLocalBrasfootImport({ catalog, mediaService: media, tempDirectory: join(directory, "imports"), logger });
    const stores = createFileStores(database);
    const store = new RoomStore({ persistence: stores.persistence, catalogStore: catalog });
    const capability = randomBytes(32).toString("base64url");
    const allowed = (request) => origin && request.headers.host === new URL(origin).host
      && createOriginPolicy(origin, "production").allows(request.headers.origin);
    const originPolicy = {
      allows: (value) => origin && createOriginPolicy(origin, "production").allows(value),
      cors: { credentials: false, origin(value, callback) {
        if (origin && createOriginPolicy(origin, "production").allows(value)) return callback(null, value ? true : false);
        callback(Object.assign(new Error("Origem local nao permitida"), { status: 403, code: "CORS_ORIGIN_DENIED" }));
      } },
      allowRequest(request, callback) { callback(null, Boolean(allowed(request))); },
    };
    server = await createBolaManagerServer({
      env: { NODE_ENV: "production", BOLA_ENV_FILES: "false", ALLOW_DEMO_AUTH: "false", ALLOW_LOCAL_EDITOR: "false", TRUST_PROXY: "false", CLIENT_ORIGIN: "http://127.0.0.1", INSTANCE_ID: `desktop-${randomUUID()}` },
      logger,
      store,
      catalogStore: catalog,
      mediaService: media,
      brasfootImportService,
      editorAccess: (user) => user.uid === profile.uid,
      localMediaHandler: (request, response, next) => media.handle(request, response, next),
      newsStore: stores.newsStore,
      socialAi,
      matchSessionStore: stores.matchSessionStore,
      redisRuntime: createDisabledRedisRuntime("desktop-offline"),
      firebase: { enabled: false, firestore: null, bucket: null, auth: {
        async verifyIdToken(token) {
          const provided = Buffer.from(String(token));
          const entry = [...authorizations.entries()].find(([value]) => {
            const expected = Buffer.from(value);
            return provided.length === expected.length && timingSafeEqual(provided, expected);
          })?.[1];
          const expected = Buffer.from(capability);
          const owner = provided.length === expected.length && timingSafeEqual(provided, expected);
          if (!owner && !entry) {
            throw Object.assign(new Error("Sessao local invalida"), { code: "auth/invalid-id-token" });
          }
          const current = await database.read((state) => state.profile);
          return { uid: entry?.uid ?? current.uid, name: entry?.name ?? current.displayName, exp: Math.floor(Date.now() / 1000) + 3600 };
        },
      } },
      originPolicy,
      requestGuard(request, response, next) {
        if (!allowed(request)) return response.status(403).json({ error: { code: "LOCAL_ORIGIN_DENIED", message: "Origem local nao permitida" } });
        next();
      },
      staticDirectory,
    });
    const address = await server.listen(0, "127.0.0.1");
    origin = `http://127.0.0.1:${address.port}`;
    return {
      origin,
      server,
      database,
      profileId: profile.uid,
      socialAiStatus: () => socialAi.status(),
      configureSocialAi: (value) => { socialAi.configure(value); return socialAi.status(); },
      testSocialAi: () => socialAi.test(profile.uid),
      setEditorPeerMode(readMode) { peerMode = readMode; },
      grantPeer(identity) {
        const token = randomBytes(32).toString("base64url");
        authorizations.set(token, { ...identity });
        return token;
      },
      revokePeer(token) { authorizations.delete(token); },
      async session() {
        const current = await database.read((state) => state.profile);
        return { identity: { uid: current.uid, displayName: current.displayName, email: null, photoURL: null, mode: "local" }, token: capability };
      },
      async updateProfile(displayName) {
        if (typeof displayName !== "string" || displayName.trim().length < 2 || displayName.trim().length > 60) throw new Error("Nome deve ter entre 2 e 60 caracteres.");
        return database.transaction((state) => { state.profile.displayName = displayName.trim(); });
      },
      readPreferences: () => database.read((state) => state.profile.preferences),
      catalogStatus: () => database.read((state) => ({ counts: catalogCounts(state.catalog),
        source: state.catalogImport ? "local-import" : "local-starter", importedAt: state.catalogImport?.importedAt ?? null,
        preservedCareers: state.rooms.rooms.filter((room) => Object.hasOwn(state.catalogArchives ?? {}, room.catalogOwnerId)).length })),
      async writePreferences(value) {
        // Only a small JSON DTO may cross IPC; no paths, commands or SDK objects.
        const bytes = JSON.stringify(value);
        if (!bytes || bytes.length > 4096 || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Preferencias invalidas.");
        await database.transaction((state) => { state.profile.preferences = JSON.parse(bytes); });
      },
      async close() {
        try { await server.close(); } finally { await database.close(); }
      },
    };
  } catch (error) {
    try { await server?.close(); } finally { await database.close(); }
    throw error;
  }
}
