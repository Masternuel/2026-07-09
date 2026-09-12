// Isolated manual smoke test. Never connects to real authentication or saves.
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';
import { MemoryRoomPersistence } from '../store/roomPersistence.mjs';
import { RoomStore } from '../store/roomStore.mjs';
import { startTestServer } from './testHarness.mjs';

const persistence = new MemoryRoomPersistence();
await persistence.create({
  id: 'scouting-smoke', code: 'BOLA-SCOT', status: 'active', ownerId: 'uid-owner',
  managerIds: ['uid-owner'], managers: [{ id: 'uid-owner', clubId: 'A' }], revision: 1,
  currentSeason: 1, seasonYear: 2026, createdAt: '2026-07-10T00:00:00.000Z',
  competitionCatalog: [{ id: 'L', clubs: [{ id: 'A' }, { id: 'C' }] }],
  careerState: { players: [{ id: 'p1', clubId: 'C', name: 'Jogador de teste', age: 25,
    overall: 12, active: true, marketValue: 5000000, contract: { wage: 45000, endsAt: '2028-12-31' } }] },
});
const backend = await startTestServer({ store: new RoomStore({ persistence }) });
const root = fileURLToPath(new URL('../..', import.meta.url));
const outDir = '.tmp/scouting-browser';
await build({
  root, configFile: false, envFile: false, logLevel: 'error',
  define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify(backend.url) },
  css: { postcss: { plugins: [] } },
  build: { outDir, emptyOutDir: false, rollupOptions: { input: fileURLToPath(new URL('./fixtures/scoutingBrowser.html', import.meta.url)) } },
});
const vite = await preview({ root, configFile: false, envFile: false, build: { outDir },
  preview: { host: '127.0.0.1', port: 5187, strictPort: true } });
console.log('Scouting isolado: http://127.0.0.1:5187/server/tests/fixtures/scoutingBrowser.html');
async function close() { await new Promise((resolve) => vite.httpServer.close(resolve)); await backend.server.close(); process.exit(0); }
process.once('SIGINT', close);
process.once('SIGTERM', close);
