import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let model;
let MainMenuLayout;
let HistoryPage;
let EditorAvailabilityPage;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
    envDir: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  model = await vite.ssrLoadModule('/src/components/menu/mainMenuModel.ts');
  ({ MainMenuLayout } = await vite.ssrLoadModule('/src/components/menu/MainMenuLayout.tsx'));
  ({ HistoryPage } = await vite.ssrLoadModule('/src/components/menu/HistoryPage.tsx'));
  ({ EditorAvailabilityPage } = await vite.ssrLoadModule('/src/components/menu/EditorAvailabilityPage.tsx'));
});
after(async () => { await vite?.close(); });

const identity = (mode = 'local') => ({ uid: 'manager-menu', displayName: 'Manager', email: null, photoURL: null, mode });
const room = (changes = {}) => ({ code: 'MENU-1', name: 'Carreira de teste', ownerId: 'manager-menu', managers: [],
  status: 'waiting', careerCompleted: false, currentSeason: 1, seasonYear: 2026,
  createdAt: '2026-10-01T12:00:00Z', ...changes });
function layout(changes = {}) {
  return renderToStaticMarkup(React.createElement(MainMenuLayout, { identity: identity(), page: 'career',
    connectionState: 'connected', canContinue: false, continueReason: 'Nenhum save disponível.', pending: false,
    sessionSelected: false, onNavigate() {}, onExit() {}, children: 'Workspace', ...changes }));
}
function buttonAttributes(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<button([^>]*)>(?:(?!<\\/button>)[\\s\\S])*?${escaped}(?:(?!<\\/button>)[\\s\\S])*?<\\/button>`));
  assert.ok(match, `Missing button: ${label}`);
  return match[1];
}

test('main menu registry covers the required destinations without duplicate IDs', () => {
  assert.deepEqual(model.mainMenuPages.map(({ id }) => id), ['career', 'new-game', 'continue', 'multiplayer', 'editor', 'settings', 'profile', 'history', 'credits']);
  assert.equal(new Set(model.mainMenuPages.map(({ id }) => id)).size, model.mainMenuPages.length);
  assert.match(layout(), /Sair/);
});
test('menu capabilities expose only real Editor and multiplayer integrations', () => {
  for (const mode of ['peer', 'demo']) assert.equal(model.getMenuCapabilities(mode).canEdit, false);
  for (const mode of ['firebase', 'local']) assert.equal(model.getMenuCapabilities(mode).canEdit, true);
  assert.equal(model.getMenuCapabilities('firebase').webRooms, true);
  assert.equal(model.getMenuCapabilities('demo').webRooms, false);
  assert.equal(model.getMenuCapabilities('demo').desktopPeer, false);
  assert.equal(model.getMenuCapabilities('local').desktopPeer, true);
  assert.equal(model.getMenuCapabilities('peer').canCreate, false);
  assert.equal(model.getMenuCapabilities('peer').canResume, false);
});
test('latest save uses a valid creation date when update metadata is malformed', () => {
  const fallback = room({ code: 'FALLBACK', updatedAt: 'invalid', createdAt: '2026-10-03T12:00:00Z' });
  assert.equal(model.roomTimestamp(fallback), Date.parse(fallback.createdAt));
  assert.equal(model.latestAuthorizedSave([room(), fallback], identity()), fallback);
  assert.equal(model.roomTimestamp(room({ createdAt: 'invalid', updatedAt: 'invalid' })), null);
  assert.equal(model.formatSaveDate(room({ createdAt: 'invalid' })), 'Data não informada');
});
test('save ordering and selection do not mutate the authoritative room list', () => {
  const older = Object.freeze(room());
  const latest = Object.freeze(room({ code: 'NEWER', updatedAt: '2026-10-04T12:00:00Z' }));
  const saves = Object.freeze([older, latest]);
  assert.deepEqual(model.sortAuthorizedSaves(saves, identity()), [latest, older]);
  assert.deepEqual(saves, [older, latest]);
});
test('continue never chooses a save belonging to an unrelated account', () => {
  const foreign = room({ ownerId: 'other', updatedAt: '2026-10-06T12:00:00Z' });
  const member = room({ code: 'MEMBER', ownerId: 'other', managers: [{ id: 'manager-menu' }] });
  assert.equal(model.canResumeSave(foreign, identity()), false);
  assert.equal(model.canResumeSave(member, identity()), true);
  assert.equal(model.latestAuthorizedSave([foreign, member], identity()), member);
  assert.equal(model.latestAuthorizedSave([foreign], identity()), null);
  assert.equal(model.latestAuthorizedSave([member], identity('peer')), null);
});
test('history does not confuse normalized empty arrays with measured zero counts', () => {
  const metadata = model.saveMetadata(room({ completedFixtureIds: [], completedMatches: [], seasonHistory: [] }));
  assert.equal(metadata.completedFixtures, null);
  assert.equal(metadata.completedMatches, null);
  assert.equal(metadata.seasonHistory, null);
  assert.equal(model.formatMetadataCount(null), 'Não informado');
  assert.equal(model.formatMetadataCount(0), '0');
});
test('history accepts real zero but rejects malformed counts', () => {
  assert.equal(model.saveMetadata(room({ completedFixtureCount: 0 })).completedFixtures, 0);
  for (const value of [-1, 0.5, NaN, Infinity, '2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(model.saveMetadata(room({ completedFixtureCount: value })).completedFixtures, null);
  }
});
test('history aggregates explicitly mark incomplete metadata', () => {
  const summary = model.summarizeSaves([room({ completedFixtureCount: 3, completedMatchCount: 2, seasonHistoryCount: 0 }), room({ code: 'UNKNOWN' })]);
  assert.deepEqual(summary.completedFixtures, { total: 3, knownSaves: 1, missingSaves: 1 });
  assert.deepEqual(summary.completedMatches, { total: 2, knownSaves: 1, missingSaves: 1 });
  assert.deepEqual(summary.seasonHistory, { total: 0, knownSaves: 1, missingSaves: 1 });
});
test('completed careers are not counted again as active careers', () => {
  const summary = model.summarizeSaves([room(), room({ status: 'active' }), room({ status: 'active', careerCompleted: true })]);
  assert.equal(summary.waiting, 1);
  assert.equal(summary.active, 1);
  assert.equal(summary.completed, 1);
});
test('continue remains disabled with an explicit reason when no authorized save exists', () => {
  const html = layout();
  assert.match(buttonAttributes(html, 'Continuar'), /disabled/);
  assert.match(html, /Nenhum save disponível/);
  assert.match(buttonAttributes(layout({ canContinue: true }), 'Continuar'), /^(?!.*disabled)/);
  assert.match(buttonAttributes(layout({ canContinue: true, pending: true }), 'Continuar'), /disabled/);
});
test('menu navigation uses current-page semantics and a focusable content target', () => {
  const html = layout({ page: 'history' });
  assert.match(html, /aria-label="Menu principal"/);
  assert.match(buttonAttributes(html, 'Estatísticas / histórico'), /aria-current="page"/);
  assert.match(html, /href="#main-menu-content"/);
  assert.match(html, /id="main-menu-content"[^>]*tabindex="-1"/);
});
test('peer guests cannot create or resume a separate career from the menu', () => {
  const html = layout({ identity: identity('peer') });
  assert.match(buttonAttributes(html, 'Novo Jogo'), /disabled/);
  assert.match(buttonAttributes(html, 'Continuar'), /disabled/);
  assert.match(html, /Save no anfitrião/);
});
test('selected-session setup prevents unrelated menu navigation without disconnecting the room', () => {
  const html = layout({ sessionSelected: true, canContinue: true });
  for (const { label } of model.mainMenuPages) assert.match(buttonAttributes(html, label), /disabled/);
  assert.match(html, /Temporada selecionada/);
});
test('history page renders honest metadata, not invented trophies or results', () => {
  const html = renderToStaticMarkup(React.createElement(HistoryPage, { saves: [room({ completedFixtureCount: 3 }), room({ code: 'MISSING' })], loading: false }));
  assert.match(html, /parcial/);
  assert.match(html, /Não informado/);
  assert.match(html, /não estão disponíveis neste resumo/);
  assert.doesNotMatch(html, /<button|<a /);
});
test('history loading and empty states are explicit', () => {
  assert.match(renderToStaticMarkup(React.createElement(HistoryPage, { saves: [], loading: true })), /role="status"/);
  assert.match(renderToStaticMarkup(React.createElement(HistoryPage, { saves: [], loading: false })), /Nenhuma carreira para resumir/);
});
test('Editor entry offers the existing Editor only to owners, never peer or demo identities', () => {
  for (const mode of ['peer', 'demo']) {
    const html = renderToStaticMarkup(React.createElement(EditorAvailabilityPage, { identity: identity(mode), onOpen() { assert.fail('SSR must not invoke the Editor'); } }));
    assert.match(html, /Indisponível neste modo/);
    assert.doesNotMatch(html, /<button/);
    assert.match(html, /Planejado/);
  }
  for (const mode of ['firebase', 'local']) {
    assert.match(renderToStaticMarkup(React.createElement(EditorAvailabilityPage, { identity: identity(mode), onOpen() {} })), /Abrir Editor/);
  }
});
