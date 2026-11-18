// Editor da Base: importing from the installed Brasfoot folder with a country choice.
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createServer } from 'vite';

let vite, React, createRoot, DesktopBrasfootFolderImport;
const mounted = [];

before(async () => {
  GlobalRegistrator.register({ url: 'http://localhost/' });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  vite = await createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false, envDir: false,
    esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
  });
  ({ DesktopBrasfootFolderImport } = await vite.ssrLoadModule('/src/components/menu/DesktopBrasfootFolderImport.tsx'));
});

afterEach(async () => {
  while (mounted.length) { const root = mounted.pop(); await React.act(async () => root.unmount()); }
  document.body.innerHTML = '';
});

after(async () => {
  await vite?.close();
  await GlobalRegistrator.unregister();
});

const preview = {
  id: 'preview-1',
  countries: [
    { country: 'POL', leagues: 4, clubs: 131, players: 3666, crests: 131 },
    { country: 'BRA', leagues: 4, clubs: 128, players: 3454, crests: 128 },
    { country: 'ING', leagues: 4, clubs: 92, players: 2718, crests: 92 },
  ],
  limits: { clubs: 5000, players: 6500 },
  errors: 0,
  expiresAt: '2026-11-18T20:00:00.000Z',
};

async function render(bridge) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  await React.act(async () => root.render(React.createElement(DesktopBrasfootFolderImport, { bridge })));
  return container;
}

const button = (label) => [...document.querySelectorAll('button')].find((item) => item.textContent.includes(label));

test('choosing the folder lists countries with Brazil preselected and imports the selection', async () => {
  const commits = [];
  const bridge = {
    brasfootFolderPreview: async () => preview,
    brasfootFolderCancel: async () => undefined,
    brasfootFolderCommit: async (value) => { commits.push(value); },
  };
  await render(bridge);
  await React.act(async () => { button('Selecionar pasta do Brasfoot').click(); });
  const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
  assert.equal(boxes.length, 3);
  assert.match(document.body.textContent, /Brasil/);
  assert.match(document.body.textContent, /Inglaterra/);
  assert.deepEqual(boxes.map((box) => box.checked), [false, true, false]);
  assert.match(document.body.textContent, /Selecionado: 128 clubes, 3\.454 jogadores, 128 escudos/);
  await React.act(async () => { boxes[2].click(); });
  assert.match(document.body.textContent, /Importar 2 país\(es\)/);
  await React.act(async () => { button('Importar 2').click(); });
  assert.deepEqual(commits, [{ id: 'preview-1', countries: ['BRA', 'ING'] }]);
});

test('a selection above the player limit cannot be imported', async () => {
  const bridge = { brasfootFolderPreview: async () => preview, brasfootFolderCancel: async () => undefined, brasfootFolderCommit: async () => assert.fail('must not import') };
  await render(bridge);
  await React.act(async () => { button('Selecionar pasta do Brasfoot').click(); });
  const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
  await React.act(async () => { boxes[0].click(); });
  assert.match(document.body.textContent, /Acima do limite/);
  assert.equal(button('Importar 2').disabled, true);
});

test('the section is hidden when the launcher has no folder import', async () => {
  const container = await render({});
  assert.equal(container.textContent, '');
});

test('compact mode (Editor toolbar) is just the "Importar Brasfoot" button opening the same country dialog', async () => {
  const bridge = { brasfootFolderPreview: async () => preview, brasfootFolderCancel: async () => undefined, brasfootFolderCommit: async () => undefined };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  await React.act(async () => root.render(React.createElement(DesktopBrasfootFolderImport, { bridge, compact: true, label: 'Importar Brasfoot' })));
  assert.equal(container.querySelector('section'), null);
  assert.doesNotMatch(container.textContent, /Lê direto a pasta/);
  await React.act(async () => { button('Importar Brasfoot').click(); });
  assert.equal(document.querySelectorAll('input[type="checkbox"]').length, 3);
});
