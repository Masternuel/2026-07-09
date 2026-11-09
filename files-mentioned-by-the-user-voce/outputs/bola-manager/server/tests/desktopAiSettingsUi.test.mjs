import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite, DesktopAiSettingsPanel;
const panelPath = new URL('../../src/components/settings/DesktopAiSettingsPanel.tsx', import.meta.url);

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

test('key is cleared before asynchronous persistence and errors never echo exceptions', async () => {
  const source = await readFile(panelPath, 'utf8');
  assert.match(source, /const submittedKey = apiKey\.trim\(\);\s*setApiKey\(''\);[\s\S]*await bridge\.writeAiSettings\(\{ apiKey: submittedKey, enabled: true \}\)/);
  assert.doesNotMatch(source, /error\.message|String\(error\)|console\.|localStorage|sessionStorage|fetch\(|import\.meta\.env/);
  assert.match(source, /if \(!bridge \|\| guest \|\| busy \|\| !settings\?\.storageAvailable \|\| !submittedKey\) return/);
  assert.match(source, /catch \{\s*setError\('Não foi possível confirmar a ativação/);
  assert.doesNotMatch(source, /A nova chave não foi salva/);
});

test('provider test is isolated to explicit click and never runs during read/save/activation', async () => {
  const source = await readFile(panelPath, 'utf8');
  assert.equal((source.match(/await bridge\.testAiConnection\(\)/g) || []).length, 1);
  const effect = source.slice(source.indexOf('useEffect(() =>'), source.indexOf('if (!bridge) return null;'));
  assert.doesNotMatch(effect, /testAiConnection|writeAiSettings/);
  assert.match(source, /onClick=\{\(\) => void testConnection\(\)\}/);
  assert.match(source, /if \(!bridge \|\| guest \|\| busy \|\| !settings\?\.configured \|\| !settings\.enabled \|\| !settings\.storageAvailable\) return/);
  assert.match(source, /disabled=\{controlsDisabled \|\| !settings\?\.configured \|\| !settings\.enabled \|\| !settings\.storageAvailable\}/);
});

test('UI distinguishes generated Gemini responses from automatic fallback and retains key on disable', async () => {
  const source = await readFile(panelPath, 'utf8');
  assert.match(source, /settings\.lastResult === 'gemini'/);
  assert.match(source, /settings\.lastResult === 'fallback'/);
  assert.match(source, /texto automático de reserva, não IA generativa/);
  assert.match(source, /updateActivation\(!settings\.enabled\)/);
  assert.match(source, /updateActivation\(false, true\)/);
  assert.match(source, /\{ enabled, \.\.\.\(removeKey \? \{ removeKey: true \} : \{\}\) \}/);
  assert.doesNotMatch(source, /\{settings\.lastError\}|JSON\.stringify\(settings\)/);
});
