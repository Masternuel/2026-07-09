import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite, DesktopAiSettingsPanel;

before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false, envDir: false,
    esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
  });
  ({ DesktopAiSettingsPanel } = await vite.ssrLoadModule('/src/components/settings/DesktopAiSettingsPanel.tsx'));
});

after(async () => { await vite?.close(); });

const bridge = {
  readAiSettings: () => assert.fail('SSR must not acquire status or call a provider'),
  writeAiSettings: () => assert.fail('Saving requires explicit interaction'),
  testAiConnection: () => assert.fail('Gemini test requires explicit interaction'),
};

test('web without the native bridge exposes no Gemini key field or provider action', () => {
  const html = renderToStaticMarkup(React.createElement(DesktopAiSettingsPanel, { bridge: null }));
  assert.equal(html, '');
});

test('desktop initial UI explains cost and storage without calling Gemini on render', () => {
  const html = renderToStaticMarkup(React.createElement(DesktopAiSettingsPanel, { bridge }));
  assert.match(html, /id="settings-ai"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /type="password"[^>]*autoComplete="off"[^>]*disabled=""/);
  assert.match(html, /Salvar e ativar/);
  assert.match(html, /Testar conexão/);
  assert.match(html, /Atualizar status/);
  assert.match(html, /não o save inteiro/);
  assert.match(html, /podem consumir quota ou gerar custos/);
  assert.match(html, /separada do save/);
  assert.match(html, /Nunca|nunca é exibida novamente/);
  assert.match(html, /não executam testes pagos automaticamente/);
});

test('P2P guest gets explicit host control notice and disabled save/test actions', () => {
  const html = renderToStaticMarkup(React.createElement(DesktopAiSettingsPanel, { bridge, guest: true }));
  assert.match(html, /Você está conectado como convidado P2P/);
  assert.match(html, /somente ele pode configurar e testar o Gemini/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Salvar e ativar/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Testar conexão/);
});

test('settings integration remains native-only and reflects P2P identity', async () => {
  const source = await readFile(new URL('../../src/views/media/ConfigView.tsx', import.meta.url), 'utf8');
  assert.match(source, /desktopBridge && <button[^\n]+openSection\('ai'\)/);
  assert.match(source, /desktopBridge && <DesktopAiSettingsPanel guest=\{identity\?\.mode === 'peer'\}/);
  assert.match(source, /<AudioSettingsPanel \/>/);
  assert.match(source, /<DesktopPeerPanel identity=\{identity\} room=\{room\}/);
});

// Key handling, the explicit-click-only provider test and the Gemini/fallback
// labels are covered by interaction tests in desktopAiSettingsDom.test.mjs.
