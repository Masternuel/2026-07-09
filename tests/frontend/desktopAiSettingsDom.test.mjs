// Interaction tests for DesktopAiSettingsPanel in a simulated DOM (happy-dom).
// They replace source-text assertions with observable behavior: what the user
// sees and which bridge calls happen, in which order.
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createServer } from 'vite';

let vite, React, createRoot, DesktopAiSettingsPanel;
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
  ({ DesktopAiSettingsPanel } = await vite.ssrLoadModule('/src/components/settings/DesktopAiSettingsPanel.tsx'));
});

afterEach(async () => {
  while (mounted.length) { const root = mounted.pop(); await React.act(async () => root.unmount()); }
  document.body.innerHTML = '';
});

after(async () => {
  await vite?.close();
  await GlobalRegistrator.unregister();
});

const settled = (overrides = {}) => ({
  configured: false, enabled: false, storageAvailable: true, model: 'gemini-test', lastResult: null, lastError: null, ...overrides,
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Records every bridge call; each method answers with the next queued result.
function fakeBridge(initial) {
  const calls = [];
  const queues = { readAiSettings: [initial], writeAiSettings: [], testAiConnection: [] };
  const bridge = Object.fromEntries(Object.keys(queues).map((name) => [name, (...args) => {
    calls.push([name, ...args]);
    const next = queues[name].shift();
    if (next === undefined) throw new Error(`Unexpected ${name}`);
    return next instanceof Promise ? next : Promise.resolve(next);
  }]));
  return { bridge, calls, queues };
}

async function render(props) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  await React.act(async () => root.render(React.createElement(DesktopAiSettingsPanel, props)));
  return container;
}

const button = (container, label) => [...container.querySelectorAll('button')].find((item) => item.textContent.includes(label));
const keyInput = (container) => container.querySelector('input[type="password"]');

async function click(element) { await React.act(async () => { element.click(); }); }

async function typeKey(container, value) {
  const input = keyInput(container);
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

async function submit(container) {
  await React.act(async () => {
    container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
}

// The panel must never reach the network, browser storage or the console itself.
function watchSideEffects() {
  const used = [];
  const originals = { fetch: globalThis.fetch, setItem: window.localStorage.setItem, log: console.log, error: console.error, warn: console.warn };
  globalThis.fetch = (...args) => { used.push('fetch'); return originals.fetch(...args); };
  window.localStorage.setItem = function setItem(...args) { used.push('localStorage'); return originals.setItem.apply(this, args); };
  for (const level of ['log', 'error', 'warn']) console[level] = (...args) => { used.push(`console.${level}`); originals[level](...args); };
  return () => {
    globalThis.fetch = originals.fetch; window.localStorage.setItem = originals.setItem;
    console.log = originals.log; console.error = originals.error; console.warn = originals.warn;
    return used;
  };
}

test('the key leaves the field before persistence finishes and failures never echo the exception', async () => {
  const { bridge, calls, queues } = fakeBridge(settled());
  const write = deferred();
  queues.writeAiSettings.push(write.promise);
  const restore = watchSideEffects();
  const container = await render({ bridge });

  await typeKey(container, '  chave-secreta-123  ');
  assert.equal(keyInput(container).value, '  chave-secreta-123  ');
  await submit(container);

  // Persistence is still pending, but the field is already empty.
  assert.equal(keyInput(container).value, '');
  assert.deepEqual(calls.at(-1), ['writeAiSettings', { apiKey: 'chave-secreta-123', enabled: true }]);

  await React.act(async () => { write.reject(new Error('IPC exploded with chave-secreta-123')); });
  const alert = container.querySelector('[role="alert"]');
  assert.match(alert.textContent, /Não foi possível confirmar a ativação/);
  assert.doesNotMatch(container.textContent, /IPC exploded|chave-secreta-123/);
  assert.deepEqual(restore(), []);
});

test('saving does nothing without secure storage or as a P2P guest', async () => {
  const noStorage = fakeBridge(settled({ storageAvailable: false }));
  const first = await render({ bridge: noStorage.bridge });
  assert.equal(keyInput(first).disabled, true);
  await submit(first);
  assert.deepEqual(noStorage.calls.map(([name]) => name), ['readAiSettings']);

  const guest = fakeBridge(settled({ configured: true, enabled: true }));
  const second = await render({ bridge: guest.bridge, guest: true });
  assert.equal(button(second, 'Salvar e ativar').disabled, true);
  assert.equal(button(second, 'Testar conexão').disabled, true);
  assert.deepEqual(guest.calls.map(([name]) => name), ['readAiSettings']);
});

test('the provider test runs only on an explicit click, never on load, refresh or save', async () => {
  const { bridge, calls, queues } = fakeBridge(settled({ configured: true, enabled: true }));
  queues.readAiSettings.push(settled({ configured: true, enabled: true }));
  queues.writeAiSettings.push(settled({ configured: true, enabled: true }));
  queues.testAiConnection.push(settled({ configured: true, enabled: true, lastResult: 'gemini' }));
  const container = await render({ bridge });

  await click(button(container, 'Atualizar status'));
  await typeKey(container, 'nova-chave');
  await submit(container);
  assert.equal(calls.filter(([name]) => name === 'testAiConnection').length, 0);

  await click(button(container, 'Testar conexão'));
  assert.equal(calls.filter(([name]) => name === 'testAiConnection').length, 1);
  assert.match(container.textContent, /Conexão validada: o Gemini respondeu ao teste/);
});

test('the test button stays disabled until a key is saved and enabled', async () => {
  const notConfigured = await render({ bridge: fakeBridge(settled()).bridge });
  assert.equal(button(notConfigured, 'Testar conexão').disabled, true);
  const disabled = await render({ bridge: fakeBridge(settled({ configured: true, enabled: false })).bridge });
  assert.equal(button(disabled, 'Testar conexão').disabled, true);
});

test('generated and fallback replies are told apart, and disabling keeps the key', async () => {
  const { bridge, calls, queues } = fakeBridge(settled({ configured: true, enabled: true, lastResult: 'fallback', lastError: 'RAW_PROVIDER_ERROR_429' }));
  queues.writeAiSettings.push(settled({ configured: true, enabled: false, lastResult: 'fallback' }));
  queues.writeAiSettings.push(settled({ configured: false, enabled: false }));
  const container = await render({ bridge });

  assert.match(container.textContent, /texto automático de reserva, não IA generativa/);
  assert.doesNotMatch(container.textContent, /RAW_PROVIDER_ERROR_429/);

  await click(button(container, 'Desativar, manter chave'));
  assert.deepEqual(calls.at(-1), ['writeAiSettings', { enabled: false }]);
  assert.match(container.textContent, /A chave permanece protegida neste computador/);

  await click(button(container, 'Remover chave'));
  assert.deepEqual(calls.at(-1), ['writeAiSettings', { enabled: false, removeKey: true }]);
  assert.match(container.textContent, /Chave removida deste computador/);
});

test('a reply generated by Gemini is labelled as such', async () => {
  const container = await render({ bridge: fakeBridge(settled({ configured: true, enabled: true, lastResult: 'gemini' })).bridge });
  assert.match(container.textContent, /A última resposta foi gerada pelo Gemini/);
});
