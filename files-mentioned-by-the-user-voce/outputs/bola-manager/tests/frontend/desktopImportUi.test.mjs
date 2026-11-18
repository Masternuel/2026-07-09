import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
let vite;
let DesktopCatalogImport;
let EditorAvailabilityPage;
let DesktopExportView;
let AuthContext;
let localCatalogOrigin;

before(async () => {
  vite = await createServer({ root, configFile: false, envDir: false,
    esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ DesktopCatalogImport, localCatalogOrigin } = await vite.ssrLoadModule('/src/components/menu/DesktopCatalogImport.tsx'));
  ({ EditorAvailabilityPage } = await vite.ssrLoadModule('/src/components/menu/EditorAvailabilityPage.tsx'));
  ({ DesktopExportView } = await vite.ssrLoadModule('/src/views/DesktopExportView.tsx'));
  ({ AuthContext } = await vite.ssrLoadModule('/src/auth/AuthContext.tsx'));
});
after(async () => { await vite?.close(); });

const identity = (mode = 'local') => ({ uid: 'catalog-manager', displayName: 'Manager da Base', email: 'catalog@example.invalid', photoURL: null, mode });
function exportPage(changes = {}) {
  const fail = () => assert.fail('Rendering must never sign in, sign out, or export automatically');
  const auth = { status: 'anonymous', identity: null, error: null, firebaseConfigured: true,
    desktopAvailable: false, startLocal: fail, signInEmail: fail, createEmailAccount: fail,
    signInGoogle: fail, startDemo: fail, signOut: fail, updateDisplayName: fail,
    getIdToken: fail, clearError: fail, ...changes };
  return renderToStaticMarkup(React.createElement(AuthContext.Provider, { value: auth }, React.createElement(DesktopExportView)));
}

test('catalog import accepts only plain loopback origins', () => {
  assert.equal(localCatalogOrigin(' http://localhost:5173/ '), 'http://localhost:5173');
  assert.equal(localCatalogOrigin('https://127.0.0.1:8443'), 'https://127.0.0.1:8443');
  assert.equal(localCatalogOrigin('http://[::1]:5173'), 'http://[::1]:5173');
  for (const origin of ['https://example.invalid', 'http://localhost.example.invalid',
    'http://user:password@localhost:5173', 'http://localhost:5173/desktop-export',
    'http://localhost:5173/?key=secret', 'http://localhost:5173/#secret',
    'file:///desktop-export', 'javascript:alert(1)', 'not a URL']) {
    assert.equal(localCatalogOrigin(origin), null);
  }
});

test('Editor exposes import scope only for local identity, never peer or demo', () => {
  const local = renderToStaticMarkup(React.createElement(EditorAvailabilityPage, { identity: identity(), onOpen() {} }));
  assert.match(local, /desktop-catalog-import/);
  assert.match(local, /Catálogo salvo neste computador, sem sincronização com a nuvem/);
  assert.match(local, /Abrir Editor/);
  assert.match(local, /As edições valem para novas carreiras; saves existentes mantêm sua base/);
  for (const mode of ['peer', 'demo', 'firebase']) {
    const html = renderToStaticMarkup(React.createElement(EditorAvailabilityPage, { identity: identity(mode), onOpen() {} }));
    assert.doesNotMatch(html, /desktop-catalog-import/);
  }
});

test('missing native bridge shows an honest unavailable state without actions', () => {
  const html = renderToStaticMarkup(React.createElement(DesktopCatalogImport, { bridge: null }));
  assert.match(html, /apenas no launcher desktop/);
  assert.doesNotMatch(html, /<button|<input/);
});

test('launcher import offers explicit browser and chooser actions without invoking either on render', () => {
  const bridge = new Proxy({}, { get: () => () => assert.fail('Native actions must require user interaction') });
  const html = renderToStaticMarkup(React.createElement(DesktopCatalogImport, { bridge }));
  assert.match(html, /Entrar com Google no navegador/);
  assert.match(html, /Selecionar base exportada/);
  assert.match(html, /http:\/\/localhost:5173/);
  assert.match(html, /Consultando a base local/);
  assert.match(html, /backup local completo/);
  assert.match(html, /As carreiras existentes mantêm sua base anterior/);
  assert.doesNotMatch(html, /type="file"|Aceitar sincronização|Google conectado/);
});

test('web export requires explicit Google sign-in and contains no demo fallback or password form', () => {
  const html = exportPage();
  assert.match(html, /Entrar com Google/);
  assert.match(html, /Nenhum download será feito automaticamente/);
  assert.doesNotMatch(html, /<form|type="password"|Explorar modo demonstração|Baixar minha base/);
});

test('signed-in export identifies account and offers one catalog download and sign-out', () => {
  const html = exportPage({ status: 'authenticated', identity: identity('firebase') });
  assert.match(html, /catalog@example.invalid/);
  assert.match(html, /Baixar minha base \(\.json\)/);
  assert.match(html, /Sair da conta/);
  assert.match(html, /Saves da nuvem e arquivos binários de imagens não são exportados/);
  assert.doesNotMatch(html, /Entrar com Google/);
});

test('missing Firebase configuration blocks export without offering a fake catalog', () => {
  const html = exportPage({ firebaseConfigured: false });
  assert.match(html, /Firebase não configurado nesta versão web/);
  assert.match(html, /mesmo projeto Firebase/);
  assert.doesNotMatch(html, /<button|demonstração|Baixar minha base/);
});

test('web export masks raw authentication exceptions', () => {
  const html = exportPage({ error: 'SECRET_TOKEN https://untrusted.invalid/private?token=secret' });
  assert.match(html, /Não foi possível verificar o acesso à conta/);
  assert.doesNotMatch(html, /SECRET_TOKEN|untrusted\.invalid|token=secret/);
});

test('export route is exact, web-only and silent; only the existing App receives the music provider', async () => {
  const source = await readFile(new URL('../../src/main.tsx', import.meta.url), 'utf8');
  assert.match(source, /!desktopBridge && window\.location\.pathname === '\/desktop-export'/);
  assert.match(source, /showDesktopExport \? <DesktopExportView \/> : <MusicProvider><App \/><\/MusicProvider>/);
  assert.match(source, /<AuthProvider>[\s\S]*<UserPreferencesProvider>[\s\S]*showDesktopExport/);
});

test('import and export preserve explicit confirmation and in-flight locks', async () => {
  const panel = await readFile(new URL('../../src/components/menu/DesktopCatalogImport.tsx', import.meta.url), 'utf8');
  const external = await readFile(new URL('../../src/views/DesktopExportView.tsx', import.meta.url), 'utf8');
  assert.match(panel, /if \(!bridge \|\| inFlight\.current\) return false/);
  assert.match(panel, /!acknowledged \|\| !startAction\('commit'\)/);
  assert.match(panel, /await bridge\.catalogCommit\(previewRef\.current\.id\)/);
  assert.match(panel, /await bridge\.catalogCancel\(previewRef\.current\.id\)/);
  assert.match(panel, /não migra saves da nuvem nem arquivos binários de imagens/);
  assert.match(panel, /seu perfil no launcher permanece local/);
  assert.match(external, /if \(inFlight\.current\) return false/);
  assert.equal((external.match(/apiBlobDownload\('\/api\/editor\/database\/export'/g) || []).length, 1);
  assert.doesNotMatch(external, /useEditorCatalog|\.startDemo\(|error\.message|String\(nextError\)/);
});
