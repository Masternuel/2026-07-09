import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { allowedDesktopImage, allowedExternalImage } from '../../shared/imagePolicy.mjs';

let vite;
let EditorView;
let BrasfootImportModal;
let mutationPayload;
let AuthContext;
let ResilientImage;
let EditorRecordForm;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
    envDir: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ EditorView } = await vite.ssrLoadModule('/src/views/editor/EditorView.tsx'));
  ({ BrasfootImportModal } = await vite.ssrLoadModule('/src/components/editor/BrasfootImportModal.tsx'));
  ({ mutationPayload } = await vite.ssrLoadModule('/src/hooks/useEditorCatalog.ts'));
  ({ AuthContext } = await vite.ssrLoadModule('/src/auth/AuthContext.tsx'));
  ({ ResilientImage } = await vite.ssrLoadModule('/src/components/shared/ResilientImage.tsx'));
  ({ EditorRecordForm } = await vite.ssrLoadModule('/src/components/editor/EditorRecordForm.tsx'));
});
after(async () => { await vite?.close(); });

const identity = (mode = 'local') => ({ uid: 'local-editor-test', displayName: 'Manager', email: null, photoURL: null, mode });
const getIdToken = async () => { assert.fail('Rendering must not request tokens or mutate the catalog'); };
const renderEditor = (mode) => renderToStaticMarkup(React.createElement(EditorView, {
  identity: identity(mode), getIdToken, onBack() {}, onToast() {},
}));

test('local Editor uses disk and backup language without claiming cloud synchronization', () => {
  const html = renderEditor('local');
  for (const copy of ['PERFIL LOCAL', 'Base local', 'Carregando catálogo local', 'Backup em JSON',
    'Novas carreiras usam esta base.', 'Saves existentes mantêm o catálogo anterior.',
    'Os dados ficam no disco deste computador, sem sincronização com a nuvem.',
    'Encerre sessões P2P e partidas em andamento antes de editar.']) assert.ok(html.includes(copy), copy);
  assert.doesNotMatch(html, /MINHA CONTA|da sua conta|Sincronizando catálogo|Operações auditadas/);
  for (const action of ['Exportar base', 'Importar base', 'Importar Brasfoot', 'Adicionar']) assert.ok(html.includes(action));
  assert.match(html, /role="status" aria-label="Carregando catálogo local"/);
});

test('web Editor preserves account language and all existing entity destinations', () => {
  const html = renderEditor('firebase');
  assert.match(html, /MINHA CONTA/);
  assert.match(html, /Sincronizando catálogo/);
  assert.match(html, /Clubes, ligas e jogadores da sua conta/);
  assert.match(html, /Saves existentes mantêm o catálogo anterior/);
  assert.doesNotMatch(html, /Os dados ficam no disco deste computador/);
  for (const entity of ['Ligas', 'Clubes', 'Jogadores', 'Torneios']) assert.ok(html.includes(entity));
});

test('Brasfoot import shows the right destination while preserving the session workflow', async () => {
  for (const mode of ['local', 'firebase']) {
    const html = renderToStaticMarkup(React.createElement(BrasfootImportModal, {
      open: true, credentials: { identity: identity(mode), getIdToken }, onClose() {}, onComplete() {},
    }));
    assert.match(html, /Arquivos/);
    assert.match(html, /Análise/);
    if (mode === 'local') {
      assert.match(html, /Base local/);
      assert.match(html, /sem envio para a nuvem/);
      assert.match(html, /saves existentes serão preservados/);
      assert.doesNotMatch(html, /Firebase/);
    } else {
      assert.match(html, /Firebase/);
      assert.doesNotMatch(html, /sem envio para a nuvem/);
    }
  }
  const source = await readFile(new URL('../../src/components/editor/BrasfootImportModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /\/api\/editor\/brasfoot-import\/sessions/);
  assert.match(source, /body: \{ allowPartial, importAssets \}/);
  assert.match(source, /nextError instanceof Error \? nextError\.message/);
});

test('league turn selection survives both create and update payloads', () => {
  const league = { id: 'TEST-LIGA', name: 'Liga de teste', country: 'Brasil', level: 1, division: 'A', active: true };
  for (const legs of ['single', 'double']) {
    for (const includeId of [true, false]) {
      const payload = mutationPayload('leagues', { ...league, legs }, includeId);
      assert.equal(payload.legs, legs);
      assert.equal(payload.name, league.name);
      assert.equal(Object.hasOwn(payload, 'id'), includeId);
    }
  }
  assert.equal(mutationPayload('leagues', { ...league, legs: 'invalid' }, true).legs, 'double');
});

test('App shares owner-only capability gates and never opens the Editor with a selected room', async () => {
  const source = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /onOpenEditor=\{\(\) => \{ if \(auth\.identity && getMenuCapabilities\(auth\.identity\.mode\)\.canEdit && !rooms\.room\) setStage\('editor'\)/);
  assert.match(source, /stage === 'editor' && auth\.identity && getMenuCapabilities\(auth\.identity\.mode\)\.canEdit && !rooms\.room/);
  assert.match(source, /\(stage === 'lobby' \|\| stage === 'editor'\) && auth\.identity && \([\s\S]*?<div hidden=\{stage !== 'lobby'\}>[\s\S]*?<MainMenuView/,
    'Keep the menu draft mounted while its owner edits the catalog');
});

test('Editor catalog actions wrap inside the panel without weakening the three-column workspace', async () => {
  const css = await readFile(new URL('../../src/styles/editor.css', import.meta.url), 'utf8');
  const responsive = await readFile(new URL('../../src/styles/responsive.css', import.meta.url), 'utf8');
  assert.match(css, /\.editor-catalog-panel__actions\s*\{[^}]*max-width: 100%;[^}]*flex-wrap: wrap/);
  assert.match(css, /\.editor-workspace\s*\{[^}]*grid-template-columns: 182px minmax\(540px, 1fr\) minmax\(390px, 440px\)/);
  assert.match(responsive, /\.editor-catalog-panel__actions \.button\s*\{ flex: 1 1 140px/);
});

test('desktop media policy rewrites only safe loopback media to the current app origin', () => {
  const origin = 'http://127.0.0.1:49123';
  const path = '/desktop-media/0a79e21d-39bd-4aa5-bc1f-777b9642cd13';
  const source = `${origin}${path}`;
  assert.equal(allowedDesktopImage(source, origin), source);
  assert.equal(allowedDesktopImage(source.replace('49123', '49124'), origin), source);
  assert.equal(allowedDesktopImage(`http://127.0.0.1${path}`, origin), source);
  assert.equal(allowedExternalImage(source), null, 'Desktop URLs must not enter the external image proxy');
  for (const candidate of [null, `${origin}${path}?token=secret`, `${origin}${path}#image`, `${source}/`,
    `${origin}/desktop-media/not-an-id`, `${origin}/desktop-media/${'a'.repeat(35)}`, `${origin}/assets/crest.png`,
    `${origin}/private${path}`, `${origin}/a/..${path}`, `${origin}${path.replace('0a', '%30a')}`,
    source.replace('127.0.0.1', 'localhost'),
    source.replace('127.0.0.1', '127.0.0.2'), source.replace('http:', 'https:'),
    source.replace('http://', 'http://owner:secret@'), `${source}\n`, source.replace('/desktop-media/', '\\desktop-media\\'),
    `https://example.invalid${path}`, `//127.0.0.1:49123${path}`]) {
    assert.equal(allowedDesktopImage(candidate, origin), null, String(candidate));
  }
  for (const otherOrigin of ['https://example.invalid', 'http://localhost:49123', `${origin}/`, '', null]) {
    assert.equal(allowedDesktopImage(source, otherOrigin), null, String(otherOrigin));
  }
});

test('saved desktop images and form previews normalize old ports only for native local/peer identities', () => {
  const previousWindow = globalThis.window;
  const origin = 'http://127.0.0.1:49123';
  const source = `${origin}/desktop-media/0a79e21d-39bd-4aa5-bc1f-777b9642cd13`;
  function markup(mode, bridge, image = source) {
    globalThis.window = { location: { origin }, ...(bridge ? { bolaDesktop: {} } : {}) };
    return renderToStaticMarkup(React.createElement(AuthContext.Provider, { value: { identity: identity(mode) } },
      React.createElement(ResilientImage, { src: image, alt: 'Local crest', fallback: 'Blocked image' })));
  }
  try {
    assert.match(markup('local', true), /<img[^>]*src="http:\/\/127\.0\.0\.1:49123\/desktop-media\//);
    assert.match(markup('peer', true), /<img[^>]*src="http:\/\/127\.0\.0\.1:49123\/desktop-media\//);
    for (const mode of ['firebase', 'demo']) assert.equal(markup(mode, true), 'Blocked image');
    assert.equal(markup('local', false), 'Blocked image');
    assert.match(markup('local', true, source.replace('49123', '49124')), /<img[^>]*src="http:\/\/127\.0\.0\.1:49123\/desktop-media\//);
    assert.match(markup('local', true, source.replace(':49123', '')), /<img[^>]*src="http:\/\/127\.0\.0\.1:49123\/desktop-media\//);
    assert.match(markup('local', true, '/assets/crests/local.png'), /<img[^>]*src="\/assets\/crests\/local.png"/);

    globalThis.window = { location: { origin }, bolaDesktop: {} };
    const renderForm = (image) => renderToStaticMarkup(React.createElement(AuthContext.Provider, { value: { identity: identity('local') } },
      React.createElement(EditorRecordForm, { entity: 'clubs', mode: 'edit',
        record: { id: 'TEST', name: 'Clube local', abbreviation: 'TST', colors: ['#c8ff3d'],
          country: 'Brasil', division: 'A', stadium: 'Estádio', stadiumCapacity: 1000,
          reputation: 10, budget: 10000, active: true, crestImageUrl: image },
        leagues: [], clubs: [], pending: false, onSubmit() {}, onRemoveMedia() {}, onCancel() {}, onArchive() {}, onDelete() {},
      })));
    assert.doesNotMatch(renderForm(source), /Origem da imagem bloqueada/);
    assert.doesNotMatch(renderForm('/assets/crests/local.png'), /Origem da imagem bloqueada/);
    assert.doesNotMatch(renderForm(source.replace('49123', '49124')), /Origem da imagem bloqueada/);
    assert.match(renderForm(source.replace('127.0.0.1', 'localhost')), /Origem da imagem bloqueada/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
