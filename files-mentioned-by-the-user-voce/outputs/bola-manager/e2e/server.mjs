import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';
import { CatalogStore } from '../server/store/catalogStore.mjs';
import { RoomStore } from '../server/store/roomStore.mjs';
import { MemoryRoomPersistence } from '../server/store/roomPersistence.mjs';
import { createFakeFirestore } from '../server/tests/helpers/fakeFirestore.mjs';
import { startTestServer } from '../server/tests/testHarness.mjs';
import { HTTP_CSP } from '../shared/imagePolicy.mjs';
import { SECURITY_HEADERS } from '../shared/securityHeaders.mjs';

export default async function setup() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const firestore = createFakeFirestore();
  const catalogStore = new CatalogStore({ firestore });
  await catalogStore.create('leagues', { id: 'E2E-L', name: 'Liga E2E', country: 'Brasil', level: 1, division: 'Série A', legs: 'double', active: true }, 'seed');
  const positions = ['GOL', 'LE', 'ZAG', 'ZAG', 'LD', 'VOL', 'MC', 'MEI', 'PE', 'ATA', 'PD', 'GOL', 'ZAG', 'MC', 'ATA', 'MEI'];
  const attributes = Object.fromEntries(['velocidade', 'chute', 'drible', 'nocao', 'defesa', 'passe', 'peBom', 'peRuim', 'forca', 'resistencia', 'impulsao', 'reflexos', 'posicionamentoGol', 'saidaGol', 'penaltis'].map((key) => [key, 12]));
  for (const [index, name] of ['Alfa', 'Beta', 'Gama', 'Delta'].entries()) {
    const id = `E2E-${index}`;
    await catalogStore.create('clubs', { id, name: `Clube ${name}`, abbreviation: name.toUpperCase(), colors: ['#4488cc'], stadium: `Estádio ${name}`, stadiumCapacity: 20000, reputation: 12, division: 'Série A', country: 'Brasil', city: 'São Paulo', leagueId: 'E2E-L', budget: 120_000_000, active: true }, 'seed');
    for (const [number, position] of positions.entries()) {
      await catalogStore.create('players', { id: `${id}-P${number}`, clubId: id, name: `${name} Jogador ${String(number).padStart(2, '0')}`, position, age: 24, nationality: 'BRA', shirtNumber: number + 1, attributes, overall: 12, active: true }, 'seed');
    }
  }
  const store = new RoomStore({ persistence: new MemoryRoomPersistence(), catalogStore });
  const backend = await startTestServer({ store, catalogStore, matchDelayMs: 5, env: { RATE_LIMIT_HTTP_MAX: '10000', RATE_LIMIT_SOCKET_MAX: '10000' } });
  let web;
  try {
    // Never load .env or production credentials; replace only the entry's auth adapter.
    await build({ root, configFile: false, envFile: false, envPrefix: '__E2E_NO_CLIENT_ENV__', logLevel: 'warn',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'isolated-e2e-auth', enforce: 'pre', transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/src/main.tsx')) return;
        const result = source.replace(/from ['"]\.\/auth\/AuthContext['"]/, "from '../e2e/AuthProvider'");
        if (result === source) throw new Error('Não foi possível isolar AuthProvider no build E2E');
        return result;
      } }],
      define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify(backend.url) },
      build: { outDir: '.tmp/e2e/app', emptyOutDir: false },
    });
    web = await preview({ root, configFile: false, envFile: false, build: { outDir: '.tmp/e2e/app' }, preview: {
      host: '127.0.0.1', port: 5191, strictPort: true,
      headers: { ...SECURITY_HEADERS, 'Content-Security-Policy': HTTP_CSP, 'X-Frame-Options': 'DENY' },
    } });
  } catch (error) { await backend.server.close(); throw error; }
  let closing = false;
  async function close() {
    if (closing) return; closing = true;
    await Promise.all([new Promise((resolve) => web.httpServer.close(resolve)), backend.server.close()]);
  }
  return close;
}
