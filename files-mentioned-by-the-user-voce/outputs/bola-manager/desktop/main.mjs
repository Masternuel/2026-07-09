import { app, BrowserWindow, dialog, ipcMain, utilityProcess, shell, safeStorage } from "electron";
import { open } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { encodeSignal, parseSignal } from "./peer/identity.mjs";
import { catalogExportAddress } from "./catalogImport.mjs";
import { MAX_CATALOG_DATABASE_BYTES } from "../server/services/catalogDatabase.mjs";
import { createAiSettingsStore } from "./aiSettings.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
app.setName("Bola Manager Desktop");
const dataArgument = process.argv.find((value) => value.startsWith("--desktop-data-dir="));
if (dataArgument) app.setPath("userData", dataArgument.slice("--desktop-data-dir=".length));

let worker;
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

if (!app.requestSingleInstanceLock()) app.quit();
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
    ({ origin } = await request("start", undefined, { directory: join(app.getPath("userData"), "saves"), staticDirectory: join(root, "dist-desktop"), socialAiConfig }));
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
          await request("configureSocialAi", config);
          aiSettingsError = null;
        }
        return await readAiSettings();
      } catch { throw new Error("Nao foi possivel configurar/testar o Gemini. Verifique a chave, a conexao e se voce e o anfitriao."); }
      finally { aiSettingsBusy = false; }
    });
    let catalogDialogOpen = false;
    const catalogHandlers = {
      async catalogOpenBrowser(value) {
        const address = catalogExportAddress(value);
        if ((await request("peerStatus")).mode !== "offline") throw new Error("LOCAL_IMPORT_PEER_ACTIVE");
        await shell.openExternal(address);
      },
      async catalogPreview() {
        if (catalogDialogOpen) throw new Error("LOCAL_IMPORT_BUSY");
        catalogDialogOpen = true;
        try {
          if ((await request("peerStatus")).mode !== "offline") throw new Error("LOCAL_IMPORT_PEER_ACTIVE");
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
    for (const [action, handler] of Object.entries(peerHandlers)) ipcMain.handle(`desktop:${action}`, (event, value) => {
      if (!trustedSender(event)) throw new Error("LOCAL_IPC_FORBIDDEN");
      return handler(value);
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
    await window.loadURL(origin);
  } catch (error) {
    dialog.showErrorBox("Não foi possível abrir o jogo", `Falha local (${error.code ?? "LOCAL_STARTUP_FAILED"}). Nenhum save foi apagado.`);
    worker?.kill();
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
    }).finally(() => { networkWindow?.destroy(); worker?.kill(); rejectPending(); app.quit(); });
  });
  });
}
