import { startLocalBackend } from "./localBackend.mjs";
import { createPeerRuntime } from "./peer/runtime.mjs";
import { openLocalDatabase } from "./localDatabase.mjs";
import { prepareCatalogImport, previewCatalogImport, commitCatalogImport, requireCatalogImportMode } from "./catalogImport.mjs";

let backend;
let peers;
let backendOptions;
let candidate;
let importOperation;
let importing = false;
async function initialize(options) {
  backend = await startLocalBackend(options);
  peers = createPeerRuntime(backend, {
    staticDirectory: options.staticDirectory,
    send(peerId, frame) { process.parentPort.postMessage({ type: "peerSend", peerId, frame }); },
    closeTransport(peerId) { process.parentPort.postMessage({ type: "peerClose", peerId }); },
  });
  backend.setEditorPeerMode(() => peers.status().mode);
}
async function applyImport(id) {
  await requireCatalogImportMode(backend, peers);
  if (!candidate || candidate.id !== id || Date.now() >= candidate.expiresAt) throw Object.assign(new Error(), { code: "LOCAL_IMPORT_EXPIRED" });
  const selected = candidate;
  candidate = null;
  // Quiesce HTTP/matches before pinning old career catalogs; restart from committed disk.
  await peers.close();
  await backend.close();
  backend = null;
  let result;
  let error;
  let database;
  try {
    database = await openLocalDatabase(backendOptions.directory);
    result = await commitCatalogImport(database, selected);
  } catch (failure) { error = { code: failure.code ?? "LOCAL_IMPORT_FAILED" }; }
  finally { await database?.close(); }
  await initialize(backendOptions);
  return { origin: backend.origin, result, error };
}
const handlers = {
  session: () => peers.session(),
  updateProfile: (name) => backend.updateProfile(name),
  readPreferences: () => backend.readPreferences(),
  writePreferences: (value) => backend.writePreferences(value),
  socialAiStatus: () => backend.socialAiStatus(),
  configureSocialAi(value) {
    if (peers.status().mode === "guest") throw Object.assign(new Error(), { code: "LOCAL_AI_HOST_REQUIRED" });
    backend.configureSocialAi(value);
    backendOptions.socialAiConfig = { apiKey: value.apiKey, enabled: value.enabled };
    return backend.socialAiStatus();
  },
  testSocialAi() {
    if (peers.status().mode === "guest") throw Object.assign(new Error(), { code: "LOCAL_AI_HOST_REQUIRED" });
    return backend.testSocialAi();
  },
  catalogStatus: () => {
    if (peers.status().mode === "guest") throw Object.assign(new Error(), { code: "LOCAL_IMPORT_PEER_ACTIVE" });
    return backend.catalogStatus();
  },
  async catalogPreview(bytes) {
    await requireCatalogImportMode(backend, peers);
    candidate = null;
    candidate = prepareCatalogImport(bytes);
    return previewCatalogImport(candidate, await backend.database.read((state) => state.rooms.rooms.length));
  },
  catalogCancel(id) { if (candidate?.id === id) candidate = null; },
  catalogCommit(id) {
    importing = true;
    importOperation = applyImport(id).finally(() => { importing = false; });
    return importOperation;
  },
  peerCreateInvite: (roomCode) => peers.createInvite(roomCode),
  peerBeginGuest: (invitation) => peers.beginGuest(invitation),
  peerReceive: ({ peerId, frame }) => peers.receive(peerId, frame),
  peerDrop: (id) => peers.drop(id),
  peerStatus: () => peers.status(),
  peerEnterGuest: () => peers.activateGuest(),
  peerDisconnect: () => peers.disconnect(),
  close: async () => { await importOperation?.catch(() => undefined); candidate = null; await peers.close(); await backend?.close(); backend = null; },
};
process.parentPort.on("message", async ({ data }) => {
  try {
    if (data.action === "start" && !backend) {
      backendOptions = data.options;
      await initialize(backendOptions);
      process.parentPort.postMessage({ id: data.id, value: { origin: backend.origin } });
      return;
    }
    if (importing && data.action !== "close") throw Object.assign(new Error(), { code: "LOCAL_IMPORT_BUSY" });
    if (!backend || !Object.hasOwn(handlers, data.action)) throw new Error("Comando local invalido.");
    const value = await handlers[data.action](data.value);
    process.parentPort.postMessage({ id: data.id, value });
  } catch (error) {
    process.parentPort.postMessage({ id: data.id, error: { code: error.code ?? "LOCAL_OPERATION_FAILED", message: "Operacao local falhou. O save existente foi preservado." } });
  }
});
