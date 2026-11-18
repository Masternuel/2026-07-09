import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const credentials = {
  identity: { uid: 'test-user', displayName: 'Teste', mode: 'firebase' },
  getIdToken: async () => 'test-token',
};

for (const scenario of [
  { name: 'Node sem window nem configuração', configured: undefined, origin: undefined, expected: '/api/test' },
  { name: 'Node com URL configurada', configured: 'https://api.example.test/', origin: undefined, expected: 'https://api.example.test/api/test' },
  { name: 'navegador sem configuração usa mesma origem', configured: undefined, origin: 'https://game.example.test', expected: 'https://game.example.test/api/test' },
  { name: 'URL configurada tem prioridade no navegador', configured: 'https://api.example.test/', origin: 'https://game.example.test', expected: 'https://api.example.test/api/test' },
]) {
  test(`API: ${scenario.name}`, async (context) => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    if (scenario.origin) Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: scenario.origin } } });
    else delete globalThis.window;
    context.after(() => {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else delete globalThis.window;
    });
    const vite = await createServer({
      root, configFile: false, envFile: false, envPrefix: '__TEST_NO_CLIENT_ENV__',
      define: { 'import.meta.env.VITE_SERVER_URL': scenario.configured === undefined ? 'undefined' : JSON.stringify(scenario.configured) },
      optimizeDeps: { noDiscovery: true, include: [] },
      appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
    });
    context.after(() => vite.close());
    const { apiRequest, apiBlobDownload } = await vite.ssrLoadModule('/src/lib/apiClient.ts');
    const requests = [];
    context.mock.method(globalThis, 'fetch', async (url, options) => {
      requests.push(url);
      assert.equal(options.headers.get('Authorization'), 'Bearer test-token');
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    });
    assert.deepEqual(await apiRequest('/api/test', credentials), { ok: true });
    const download = await apiBlobDownload('api/test', credentials);
    assert.equal(await download.blob.text(), '{"ok":true}');
    assert.deepEqual(requests, [scenario.expected, scenario.expected]);
  });
}
