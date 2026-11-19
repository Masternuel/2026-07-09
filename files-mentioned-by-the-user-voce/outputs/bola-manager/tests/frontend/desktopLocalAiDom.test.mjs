// Settings > IA local: download with progress, enable, disable and remove.
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createServer } from 'vite';

let vite, React, createRoot, DesktopLocalAiPanel;
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
  ({ DesktopLocalAiPanel } = await vite.ssrLoadModule('/src/components/settings/DesktopLocalAiPanel.tsx'));
});

afterEach(async () => {
  while (mounted.length) { const root = mounted.pop(); await React.act(async () => root.unmount()); }
  document.body.innerHTML = '';
});

after(async () => {
  await vite?.close();
  await GlobalRegistrator.unregister();
});

const base = { modelId: 'qwen3-1.7b', label: 'Qwen3 1.7B', bytes: 1_282_439_584, installed: false, loaded: false, downloading: false, received: 0,
  downloadError: null, threads: 2, lastGenerationMs: null, enabled: false, running: true };

async function render(bridge, props = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  await React.act(async () => root.render(React.createElement(DesktopLocalAiPanel, { bridge, ...props })));
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return container;
}
const button = (container, label) => [...container.querySelectorAll('button')].find((item) => item.textContent.includes(label));

test('not downloaded: explains the light footprint and offers the 1.2 GB download', async () => {
  const calls = [];
  let state = { ...base };
  const bridge = {
    localAiStatus: async () => state,
    localAiDownload: async () => { calls.push('download'); state = { ...state, downloading: true, received: 641_219_792 }; return state; },
    localAiCancel: async () => state, localAiSetEnabled: async () => state, localAiRemove: async () => state,
  };
  const container = await render(bridge);
  assert.match(container.textContent, /Não baixada/);
  assert.match(container.textContent, /no máximo 2 núcleos/);
  assert.match(container.textContent, /libera tudo 90 s depois/);
  await React.act(async () => { button(container, 'Baixar IA local').click(); });
  assert.deepEqual(calls, ['download']);
  assert.match(container.textContent, /Baixando 50%/);
  assert.ok(container.querySelector('progress'));
  assert.ok(button(container, 'Cancelar download'));
});

test('installed: enable and remove go through the bridge', async () => {
  const calls = [];
  let state = { ...base, installed: true };
  const bridge = {
    localAiStatus: async () => state,
    localAiDownload: async () => state, localAiCancel: async () => state,
    localAiSetEnabled: async (enabled) => { calls.push(`enabled:${enabled}`); state = { ...state, enabled }; return state; },
    localAiRemove: async () => { calls.push('remove'); state = { ...base }; return state; },
  };
  const container = await render(bridge);
  assert.match(container.textContent, /Baixada, desativada/);
  await React.act(async () => { button(container, 'Ativar IA local').click(); });
  assert.match(container.textContent, /Ativa/);
  await React.act(async () => { button(container, 'Remover modelo').click(); });
  assert.deepEqual(calls, ['enabled:true', 'remove']);
  assert.match(container.textContent, /Não baixada/);
});

test('a P2P guest sees why the controls are off', async () => {
  const bridge = { localAiStatus: async () => ({ ...base, installed: true }), localAiDownload: async () => base, localAiCancel: async () => base, localAiSetEnabled: async () => base, localAiRemove: async () => base };
  const container = await render(bridge, { guest: true });
  assert.match(container.textContent, /anfitrião/);
  assert.equal(button(container, 'Ativar IA local').disabled, true);
});
