import { app, BrowserWindow, dialog, ipcMain, MessageChannelMain, utilityProcess, shell, safeStorage } from "electron";
import { open, readFile, rename, writeFile } from "node:fs/promises";
import { constants as osConstants, setPriority } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { encodeSignal, parseSignal } from "./peer/identity.mjs";
import { catalogExportAddress } from "./catalogImport.mjs";
import { BUNDLED_CATALOG_RELATIVE_PATH, readBundledCatalogBytes } from "./bundledCatalog.mjs";
import { MAX_CATALOG_DATABASE_BYTES } from "../server/services/catalogDatabase.mjs";
import { createAiSettingsStore } from "./aiSettings.mjs";
import { DEFAULT_LOCAL_MODEL, LOCAL_AI_MODELS } from "./localAi/catalog.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
app.setName("Bola Manager Desktop");
const dataArgument = process.argv.find((value) => value.startsWith("--desktop-data-dir="));
if (dataArgument) app.setPath("userData", dataArgument.slice("--desktop-data-dir=".length));

let worker;
let aiWorker;
let window;
let networkWindow;
let origin;
let quitting = false;
const pending = new Map();
const networkPending = new Map();
const networkPage = pathToFileURL(join(root, "desktop/peer-network.html")).href;
function networkCommand(action, value = {}, expectsResult = true) {
  if (!networkWindow || networkWindow.isDestroyed()) return Promise.reject(new Error("PEER_TRANSPORT_CLOSED"));
  if (!expectsResult) {
    networkWindow.webContents.send("peer:command", { action, ...value });
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { networkPending.delete(id); reject(new Error("PEER_TRANSPORT_TIMEOUT")); }, 15_000);
    networkPending.set(id, { resolve, reject, timer });
    networkWindow.webContents.send("peer:command", { id, action, ...value });
  });
}
function request(action, value, options) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("LOCAL_BACKEND_TIMEOUT")); }, 30_000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, action, value, options });
  });
}
function rejectPending() {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("LOCAL_BACKEND_CLOSED")); }
  pending.clear();
  for (const item of networkPending.values()) { clearTimeout(item.timer); item.reject(new Error("PEER_TRANSPORT_CLOSED")); }
  networkPending.clear();
}

if (!app.requestSingleInstanceLock()) {
  console.error("LOCAL_STARTUP:ALREADY_RUNNING");
  app.quit();
}
else {
  app.on("second-instance", () => { window?.restore(); window?.focus(); });
  void app.whenReady().then(async () => {
  try {
    const aiSettings = createAiSettingsStore({ directory: app.getPath("userData"), encryption: {
      available: () => safeStorage.isAsyncEncryptionAvailable(),
      backend: () => safeStorage.getSelectedStorageBackend(),
      encrypt: (value) => safeStorage.encryptStringAsync(value),
      decrypt: async (bytes) => (await safeStorage.decryptStringAsync(bytes)).result,
    } });
    let aiSettingsError = null;
    const socialAiConfig = await aiSettings.read().catch((error) => {
      aiSettingsError = error.code;
      return { apiKey: "", enabled: false };
    });
    // Local AI preference: plain JSON (no secret), outside saves and exports.
    const localAiPath = join(app.getPath("userData"), "local-ai.json");
    let localAiConfig = await readFile(localAiPath, "utf8").then((text) => {
      const value = JSON.parse(text);
      return { enabled: value?.enabled === true, modelId: Object.hasOwn(LOCAL_AI_MODELS, value?.modelId) ? value.modelId : DEFAULT_LOCAL_MODEL };
    }).catch(() => ({ enabled: false, modelId: DEFAULT_LOCAL_MODEL }));
    const saveLocalAiConfig = async (value) => {
      localAiConfig = value;
      const temporary = `${localAiPath}.${randomUUID()}.pending`;
      await writeFile(temporary, JSON.stringify(value));
      await rename(temporary, localAiPath);
    };
    socialAiConfig.local = localAiConfig;
    // Explicit OS-only environment: no inherited Firebase, Redis or provider secrets.
    const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
      .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
    worker = utilityProcess.fork(join(root, "desktop/server-worker.mjs"), [], { env, stdio: "pipe", serviceName: "Bola Manager local engine" });
    worker.stdout?.resume();
    worker.stderr?.resume();
    worker.on("message", (message) => {
      if (message.type === "peerSend") {
        void networkCommand("send", { peerId: message.peerId, frame: message.frame }, false).catch(() => request("peerDrop", message.peerId).catch(() => undefined));
        return;
      }
      if (message.type === "peerClose") {
        void networkCommand("close", { peerId: message.peerId }, false).catch(() => undefined);
        return;
      }
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else item.resolve(message.value);
    });
    worker.on("exit", () => {
      rejectPending();
      if (!quitting) {
        dialog.showErrorBox("Motor local indisponível", "O motor local encerrou. Reinicie o jogo para carregar o último save confirmado.");
        app.quit();
      }
    });
    // Local model host: separate, below-normal priority, CPU-only; the game engine talks to it
    // over a private port. If it dies, social replies fall back to the deterministic ones.
    const aiPending = new Map();
    let aiNextId = 1;
    const aiRequest = (action, value, timeoutMs = 20_000) => new Promise((resolve, reject) => {
      if (!aiWorker) { reject(Object.assign(new Error("IA local indisponivel"), { code: "LOCAL_AI_CLOSED" })); return; }
      const id = aiNextId++;
      const timer = setTimeout(() => { aiPending.delete(id); reject(Object.assign(new Error("IA local sem resposta"), { code: "LOCAL_AI_TIMEOUT" })); }, timeoutMs);
      aiPending.set(id, { resolve, reject, timer });
      aiWorker.postMessage({ id, action, value });
    });
    const startAiWorker = () => {
      aiWorker = utilityProcess.fork(join(root, "desktop/localAi/worker.mjs"), [], {
        env: { ...env, BOLA_LOCAL_AI_DIR: app.getPath("userData") }, stdio: "pipe", serviceName: "Bola Manager IA local" });
      aiWorker.stdout?.resume();
      aiWorker.stderr?.resume();
      aiWorker.on("spawn", () => {
        try { setPriority(aiWorker.pid, osConstants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
        const { port1, port2 } = new MessageChannelMain();
        aiWorker.postMessage({ type: "enginePort" }, [port2]);
        worker.postMessage({ type: "localAiPort" }, [port1]);
      });
      aiWorker.on("message", (message) => {
        const item = aiPending.get(message?.id);
        if (!item) return;
        aiPending.delete(message.id); clearTimeout(item.timer);
        if (message.error) item.reject(Object.assign(new Error("IA local indisponivel"), { code: message.error.code }));
        else item.resolve(message.value);
      });
      aiWorker.on("exit", () => {
        aiWorker = null;
        for (const item of aiPending.values()) { clearTimeout(item.timer); item.reject(Object.assign(new Error("IA local encerrada"), { code: "LOCAL_AI_CLOSED" })); }
        aiPending.clear();
      });
    };
    ({ origin } = await request("start", undefined, { directory: join(app.getPath("userData"), "saves"), staticDirectory: join(root, "dist-desktop"), socialAiConfig,
      // Installed builds only: source runs and tests keep the deterministic starter catalog.
      bundledCatalogPath: app.isPackaged ? join(root, BUNDLED_CATALOG_RELATIVE_PATH) : null }));
    networkWindow = new BrowserWindow({ show: false, webPreferences: {
      preload: join(root, "desktop/peer-network-preload.cjs"), partition: "bola-peer-network",
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
    } });
    const networkSender = (event) => event.sender === networkWindow?.webContents
      && event.senderFrame === networkWindow.webContents.mainFrame && event.senderFrame.url === networkPage;
    ipcMain.on("peer:result", (event, message) => {
      if (!networkSender(event)) return;
      const item = networkPending.get(message?.id);
      if (!item) return;
      networkPending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(Object.assign(new Error("Conexao P2P indisponivel."), { code: message.error }));
      else item.resolve(message.value);
    });
    ipcMain.on("peer:message", (event, message) => {
      if (!networkSender(event) || !/^[a-f0-9-]{36}$/.test(message?.peerId)) return;
      void request("peerReceive", { peerId: message.peerId, frame: message.frame }).catch(() => {
        void networkCommand("close", { peerId: message.peerId }, false).catch(() => undefined);
        void request("peerDrop", message.peerId).catch(() => undefined);
      });
    });
    ipcMain.on("peer:closed", (event, message) => {
      if (networkSender(event) && /^[a-f0-9-]{36}$/.test(message)) void request("peerDrop", message).catch(() => undefined);
    });
    networkWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    networkWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    networkWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    networkWindow.webContents.session.setPermissionCheckHandler(() => false);
    const peerDirectory = pathToFileURL(join(root, "desktop/peer/")).href;
    networkWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: details.url !== networkPage && !details.url.startsWith(peerDirectory) });
    });
    await networkWindow.loadFile(join(root, "desktop/peer-network.html"));
    window = new BrowserWindow({
      width: 1440, height: 960, minWidth: 900, minHeight: 640, backgroundColor: "#111214", show: false,
      icon: join(root, "dist-desktop/assets/brand/bola-manager-icon.png"),
      autoHideMenuBar: true,
      webPreferences: { preload: join(root, "desktop/preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    });
    const trustedSender = (event) => event.sender === window.webContents
      && event.senderFrame === window.webContents.mainFrame
      && new URL(event.senderFrame.url).origin === origin;
    for (const action of ["session", "updateProfile", "readPreferences", "writePreferences", "catalogStatus", "catalogCancel"]) {
      ipcMain.handle(`desktop:${action}`, (event, value) => {
        if (!trustedSender(event)) throw new Error("LOCAL_IPC_FORBIDDEN");
        return request(action, value);
      });
    }
    startAiWorker();
    const readAiSettings = async () => ({ ...await request("socialAiStatus"),
      storageAvailable: await aiSettings.available(), ...(aiSettingsError ? { lastError: aiSettingsError } : {}) });
    let aiSettingsBusy = false;
    ipcMain.handle("desktop:readAiSettings", async (event) => {
      if (!trustedSender(event)) throw new Error("LOCAL_IPC_FORBIDDEN");
      return readAiSettings();
    });
    for (const action of ["writeAiSettings", "testAiConnection"]) ipcMain.handle(`desktop:${action}`, async (event, value) => {
      if (!trustedSender(event)) throw new Error("LOCAL_IPC_FORBIDDEN");
      if (aiSettingsBusy) throw new Error("Configuracao Gemini em andamento.");
      aiSettingsBusy = true;
      try {
        if ((await request("peerStatus")).mode === "guest") throw new Error("LOCAL_AI_HOST_REQUIRED");
        if (action === "testAiConnection") await request("testSocialAi");
        else {
          const config = await aiSettings.write(value);
          await request("configureSocialAi", { ...config, local: localAiConfig });
          aiSettingsError = null;
        }
        return await readAiSettings();
      } catch { throw new Error("Nao foi possivel configurar/testar o Gemini. Verifique a chave, a conexao e se voce e o anfitriao."); }
      finally { aiSettingsBusy = false; }
    });
    const localAiStatus = async () => ({ ...await aiRequest("status", { modelId: localAiConfig.modelId }), enabled: localAiConfig.enabled, running: Boolean(aiWorker) });
    const reconfigureSocialAi = async () => {
      const gemini = await aiSettings.read().catch(() => ({ apiKey: "", enabled: false }));
      await request("configureSocialAi", { ...gemini, local: localAiConfig });
    };
    const localAiHandlers = {
      localAiStatus: () => localAiStatus(),
      async localAiDownload() {
        if (!aiWorker) startAiWorker();
        await aiRequest("download", { modelId: localAiConfig.modelId });
        return localAiStatus();
      },
      async localAiCancel() { await aiRequest("cancelDownload"); return localAiStatus(); },
      async localAiSetEnabled(value) {
        if (typeof value !== "boolean") throw new Error("LOCAL_AI_SETTINGS_INVALID");
        if ((await request("peerStatus")).mode === "guest") throw new Error("LOCAL_AI_HOST_REQUIRED");
        if (value && !(await aiRequest("status", { modelId: localAiConfig.modelId })).installed) throw new Error("LOCAL_AI_MODEL_MISSING");
        await saveLocalAiConfig({ ...localAiConfig, enabled: value });
        await reconfigureSocialAi();
        if (!value) await aiRequest("unload").catch(() => undefined);
        return localAiStatus();
      },
      async localAiRemove() {
        await saveLocalAiConfig({ ...localAiConfig, enabled: false });
        await reconfigureSocialAi();
        await aiRequest("remove", { modelId: localAiConfig.modelId });
        return localAiStatus();
      },
    };
    for (const [action, handler] of Object.entries(localAiHandlers)) ipcMain.handle(`desktop:${action}`, async (event, value) => {
      if (!trustedSender(event)) throw new Error("LOCAL_IPC_FORBIDDEN");
      try { return await handler(value); }
      catch (error) { throw new Error(`IA local: ${error?.code ?? error?.message ?? "LOCAL_AI_FAILED"}`); }
    });
    let catalogDialogOpen = false;
    const catalogHandlers = {
      async catalogOpenBrowser(value) {
        const address = catalogExportAddress(value);
        if ((await request("peerStatus")).mode !== "offline") throw new Error("LOCAL_IMPORT_PEER_ACTIVE");
        await shell.openExternal(address);
      },
      async catalogPreview(source) {
        if (catalogDialogOpen) throw new Error("LOCAL_IMPORT_BUSY");
        catalogDialogOpen = true;
        try {
          if ((await request("peerStatus")).mode !== "offline") throw new Error("LOCAL_IMPORT_PEER_ACTIVE");
          if (source === "bundled") {
            // Only the database shipped with this build; the renderer never supplies a path.
            const bytes = readBundledCatalogBytes(join(root, BUNDLED_CATALOG_RELATIVE_PATH));
            if (!bytes) throw new Error("LOCAL_IMPORT_BUNDLED_MISSING");
            return await request("catalogPreview", bytes);
          }
          const selection = await dialog.showOpenDialog(window, { title: "Selecionar base exportada do Bola Manager",
            properties: ["openFile"], filters: [{ name: "Base Bola Manager", extensions: ["json"] }] });
          if (selection.canceled || selection.filePaths.length !== 1) return null;
          const handle = await open(selection.filePaths[0], "r");
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_CATALOG_DATABASE_BYTES) throw new Error("LOCAL_IMPORT_SIZE_INVALID");
            const bytes = await handle.readFile();
            if (bytes.length > MAX_CATALOG_DATABASE_BYTES) throw new Error("LOCAL_IMPORT_SIZE_INVALID");
            return await request("catalogPreview", bytes);
          } finally { await handle.close(); }
        } finally { catalogDialogOpen = false; }
      },
      async brasfootFolderPreview() {
        if (catalogDialogOpen) throw new Error("LOCAL_IMPORT_BUSY");
        catalogDialogOpen = true;
        try {
          if ((await request("peerStatus")).mode !== "offline") throw new Error("LOCAL_IMPORT_PEER_ACTIVE");
          // The folder comes only from this native dialog; the renderer never sends a path.
          const selection = await dialog.showOpenDialog(window, { title: "Selecionar a pasta do Brasfoot", properties: ["openDirectory"] });
          if (selection.canceled || selection.filePaths.length !== 1) return null;
          return await request("brasfootFolderPreview", selection.filePaths[0]);
        } finally { catalogDialogOpen = false; }
      },
      brasfootFolderCancel: (id) => request("brasfootFolderCancel", typeof id === "string" ? id : ""),
      async brasfootFolderCommit(value) {
        const countries = Array.isArray(value?.countries) ? value.countries.filter((item) => typeof item === "string" && item.length <= 16).slice(0, 300) : [];
        const result = await request("brasfootFolderCommit", { id: typeof value?.id === "string" ? value.id : "", countries });
        origin = result.origin;
        if (result.error) await dialog.showMessageBox(window, { type: "error", title: "Importação não concluída",
          message: "A base anterior foi preservada. Confira a seleção de países e tente novamente." });
        await window.loadURL(origin);
      },
      async catalogCommit(id) {
        const value = await request("catalogCommit", id);
        origin = value.origin;
        if (value.error) await dialog.showMessageBox(window, { type: "error", title: "Importação não concluída",
          message: "A base anterior foi preservada. Verifique o arquivo e tente novamente." });
        await window.loadURL(origin);
      },
    };
    for (const [action, handler] of Object.entries(catalogHandlers)) ipcMain.handle(`desktop:${action}`, async (event, value) => {
      if (!trustedSender(event)) throw new Error("LOCAL_IPC_FORBIDDEN");
      try { return await handler(value); }
      catch { throw new Error("Importacao indisponivel. Verifique a base, encerre partidas e desconecte o P2P antes de tentar novamente."); }
    });
    const peerHandlers = {
      peerStatus: () => request("peerStatus"),
      async peerCreateOffer(roomCode) {
        const invitation = await request("peerCreateInvite", roomCode);
        try {
          const description = await networkCommand("offer", { peerId: invitation.id });
          return encodeSignal({ type: "offer", id: invitation.id, invitation, description });
        } catch (error) { await request("peerDrop", invitation.id); throw error; }
      },
      async peerCreateAnswer(text) {
        const offer = parseSignal(text, "offer");
        const proof = await request("peerBeginGuest", offer.invitation);
        try {
          const description = await networkCommand("answer", { peerId: offer.id, description: offer.description, proof });
          return encodeSignal({ type: "answer", id: offer.id, description });
        } catch (error) { await request("peerDisconnect"); throw error; }
      },
      async peerAcceptAnswer(text) {
        const answer = parseSignal(text, "answer");
        await networkCommand("accept", { peerId: answer.id, description: answer.description });
      },
      async peerEnterGuest() {
        ({ origin } = await request("peerEnterGuest"));
        await window.loadURL(origin);
      },
      async peerDisconnect() {
        ({ origin } = await request("peerDisconnect"));
        await window.loadURL(origin);
      },
    };
    for (const [action, handler] of Object.entries(peerHandlers)) ipcMain.handle(`desktop:${action}`, async (event, value) => {
      if (!trustedSender(event)) throw new Error("LOCAL_IPC_FORBIDDEN");
      // IPC keeps only the error message, so the PEER_* code goes there for the screen
      // to explain the cause (expired invite, wrong text). No other detail crosses.
      try { return await handler(value); }
      catch (error) {
        const code = [error?.code, error?.message].find((item) => /^PEER_[A-Z_]{1,60}$/.test(String(item)));
        throw new Error(code ?? "PEER_FAILED");
      }
    });
    const session = window.webContents.session;
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.webRequest.onBeforeRequest((details, callback) => {
      const target = new URL(details.url);
      const sameLocal = ["http:", "ws:"].includes(target.protocol) && target.host === new URL(origin).host;
      callback({ cancel: !sameLocal && !["blob:", "data:"].includes(target.protocol) });
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => { if (!quitting) app.quit(); });
    // A reload during the first load supersedes it (ERR_ABORTED); the window keeps loading,
    // so that is not a startup failure. Real failures (refused, timeout) still reach the catch.
    await window.loadURL(origin).catch((error) => { if (error?.code !== "ERR_ABORTED") throw error; });
  } catch (error) {
    // Same pattern as LOCAL_SHUTDOWN: a code-only line, so a blocked modal still leaves evidence.
    const code = /^[A-Z0-9_:-]{1,80}$/.test(error?.code) ? error.code : "LOCAL_STARTUP_FAILED";
    console.error(`LOCAL_STARTUP:${code}`);
    dialog.showErrorBox("Não foi possível abrir o jogo", `Falha local (${error.code ?? "LOCAL_STARTUP_FAILED"}). Nenhum save foi apagado.`);
    worker?.kill(); aiWorker?.kill();
    quitting = true;
    app.quit();
  }
  app.on("window-all-closed", () => { if (!quitting) app.quit(); });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    // Stop renderer connections before draining HTTP; the worker still flushes saves.
    if (window && !window.isDestroyed()) window.destroy();
    void request("close").catch((error) => {
      const code = /^[A-Z0-9_:-]{1,80}$/.test(error?.code) ? error.code : "LOCAL_SHUTDOWN_FAILED";
      console.error(`LOCAL_SHUTDOWN:${code}`);
      dialog.showErrorBox("Encerramento local incompleto", "O último save confirmado foi preservado; verifique o encerramento antes de continuar.");
    }).finally(() => { networkWindow?.destroy(); worker?.kill(); aiWorker?.kill(); rejectPending(); app.quit(); });
  });
  });
}
