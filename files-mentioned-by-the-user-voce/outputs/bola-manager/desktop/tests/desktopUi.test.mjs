import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let vite;
let LobbyView;
let DesktopPeerPanel;
let Header;
let ConfigView;
let AuthContext;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), configFile: false, envDir: false,
    esbuild: { jsx: "automatic" }, optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  ({ LobbyView } = await vite.ssrLoadModule("/src/views/LobbyView.tsx"));
  ({ DesktopPeerPanel } = await vite.ssrLoadModule("/src/components/lobby/DesktopPeerPanel.tsx"));
  ({ Header } = await vite.ssrLoadModule("/src/components/layout/Header.tsx"));
  ({ ConfigView } = await vite.ssrLoadModule("/src/views/media/ConfigView.tsx"));
  ({ AuthContext } = await vite.ssrLoadModule("/src/auth/AuthContext.tsx"));
});
after(async () => { await vite?.close(); });
const identity = (mode) => ({ uid: "local-test", displayName: "Manager", mode });
const sharedRoom = { code: "BOLA-TEST", name: "Amigos da bola", ownerId: "local-test", maxManagers: 4,
  managers: [], activeLeagues: [], status: "setup", seasonLength: 3, revision: 1 };
const bridge = {
  session: async () => ({ identity: identity("local"), token: "test" }),
  updateProfile: async () => {}, readPreferences: async () => ({}), writePreferences: async () => {},
  peerStatus: async () => ({ mode: "offline", connected: false, roomCode: null, peers: 0, pendingInvites: 0, transport: "direct-webrtc" }),
  peerCreateOffer: async () => "private-offer", peerAcceptAnswer: async () => {},
  peerCreateAnswer: async () => "private-answer", peerEnterGuest: async () => {}, peerDisconnect: async () => {},
};
function render(mode, room = null) {
  return renderToStaticMarkup(React.createElement(LobbyView, {
    identity: identity(mode), clubs: [], leagues: [], room,
    savedRooms: [], connectionState: "connected", catalogLoading: false, leagueCatalogLoading: false,
    catalogSource: "firestore", catalogError: null, leagueCatalogError: null, loading: false, pending: false,
    onCreate() {}, onJoin() {}, onOpenEditor() {}, onRefreshCatalog() {}, onBack() {}, onToast() {},
  }));
}
function renderPeer(mode, room = null, currentBridge = bridge) {
  return renderToStaticMarkup(React.createElement(DesktopPeerPanel, { identity: identity(mode), room, bridge: currentBridge }));
}
function buttonAttributes(html, text) {
  const match = html.match(new RegExp(`<button([^>]*)>(?:(?!<\\/button>)[\\s\\S])*?${text}<\\/button>`));
  assert.ok(match, `Button not found: ${text}`);
  return match[1];
}
test("desktop UI: local careers expose explicit offline/P2P capacity without cloud join or Editor", () => {
  const html = render("local");
  assert.match(html, /CARREIRA LOCAL · P2P/);
  assert.match(html, /MOTOR LOCAL CONECTADO/);
  assert.match(html, /jogadores fictícios/);
  assert.doesNotMatch(html, /Editor da Base/);
  assert.doesNotMatch(html, /id="lobby-tab-join"/);
  assert.doesNotMatch(html, /id="lobby-panel-join"/);
  assert.doesNotMatch(html, /P2P e importação de carreiras virão depois/);
  assert.match(html, /<option value="1" selected="">1 · Offline<\/option>/);
  for (const capacity of [4, 6, 8]) assert.match(html, new RegExp(`<option value="${capacity}">${capacity} · P2P<\\/option>`));
});
test("desktop UI: web lobby still exposes existing multiplayer and Editor", () => {
  const html = render("firebase");
  assert.match(html, /TEMPO REAL CONECTADO/);
  assert.match(html, /Editor da Base/);
  assert.match(html, /id="lobby-tab-join"/);
  assert.doesNotMatch(html, /CARREIRA LOCAL · P2P/);
  assert.doesNotMatch(html, /desktop-peer-panel/);
});
test("desktop UI: guests cannot create, delete, or join remote careers by cloud code", () => {
  const html = render("peer");
  assert.match(html, /CONVIDADO P2P/);
  assert.match(html, /P2P · ANFITRIÃO CONECTADO/);
  assert.match(html, /Apenas o anfitrião cria, mantém e exclui este save/);
  assert.doesNotMatch(html, /Editor da Base|lobby-tab-create|lobby-panel-create|lobby-tab-join|lobby-panel-join|save-manager__delete|Novo save/);
});
test("desktop UI: host pairing requires ownership and shared capacity", () => {
  const host = renderPeer("local", sharedRoom);
  assert.match(host, /Anfitrião/);
  assert.match(host, /Gere um convite|Envie em particular|Aceite a resposta/);
  assert.doesNotMatch(buttonAttributes(host, "Gerar convite"), /disabled/);
  assert.match(buttonAttributes(host, "Aceitar resposta"), /disabled/);
  const solo = renderPeer("local", { ...sharedRoom, maxManagers: 1 });
  assert.match(buttonAttributes(solo, "Gerar convite"), /disabled/);
  assert.match(solo, /continua offline/);
  const notOwner = renderPeer("local", { ...sharedRoom, ownerId: "another-manager" });
  assert.match(buttonAttributes(notOwner, "Gerar convite"), /disabled/);
  assert.match(notOwner, /Somente o dono/);
});
test("desktop UI: guest pairing is private, labeled, wrapped, and closed before connection", () => {
  const html = renderPeer("local");
  assert.match(html, /Convidado/);
  assert.match(html, /Receba o convite|Responda ao anfitrião|Entre quando conectar/);
  assert.match(html, /<label for="[^"]+">Convite do anfitrião<\/label>/);
  assert.match(html, /spellcheck="false"/);
  assert.match(html, /wrap="soft"/);
  assert.match(html, /role="status"/);
  assert.match(buttonAttributes(html, "Gerar resposta"), /disabled/);
  assert.match(buttonAttributes(html, "Entrar na carreira"), /disabled/);
  assert.match(html, /dados privados de pareamento e rede/);
  assert.match(html, /LAN\/VPN|STUN\/TURN|relay Steam|NAT/);
  assert.match(html, /Sem migração de anfitrião/);
});
test("desktop UI: P2P panel is unavailable on web or without the native bridge", () => {
  assert.equal(renderPeer("firebase", sharedRoom), "");
  assert.equal(renderPeer("demo", sharedRoom), "");
  assert.equal(renderPeer("local", sharedRoom, null), "");
});
test("desktop UI: game header distinguishes local and guest profiles without universal offline labels", () => {
  function header(mode) {
    return renderToStaticMarkup(React.createElement(Header, { route: "home", club: { name: "Meu clube" }, manager: identity(mode), nextFixture: null, lightMode: false }));
  }
  assert.match(header("local"), /Perfil local · seu computador/);
  assert.doesNotMatch(header("local"), /offline/);
  assert.match(header("peer"), /Convidado P2P · save no anfitrião/);
  assert.match(header("firebase"), /Conta Firebase/);
});
test("desktop UI: multiplayer controls remain reachable from active-game settings", () => {
  function settings(mode) {
    return renderToStaticMarkup(React.createElement(AuthContext.Provider, { value: { identity: identity(mode) } },
      React.createElement(ConfigView, { room: sharedRoom, onToast() {} })));
  }
  for (const mode of ["local", "peer"]) {
    const html = settings(mode);
    assert.match(html, /Multiplayer P2P/);
    assert.match(html, /id="settings-peer"/);
    assert.match(html, /Preferências no computador/);
    assert.doesNotMatch(html, /Preferências temporárias/);
  }
  assert.doesNotMatch(settings("firebase"), /Multiplayer P2P|settings-peer/);
});
