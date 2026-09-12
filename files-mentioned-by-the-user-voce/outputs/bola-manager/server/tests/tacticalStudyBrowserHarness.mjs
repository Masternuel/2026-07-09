// Manual browser smoke test with memory-only saves and fake auth. No real user data.
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';
import { MemoryRoomPersistence } from '../store/roomPersistence.mjs';
import { RoomStore } from '../store/roomStore.mjs';
import { startTestServer } from './testHarness.mjs';
import { studyRoom, studyRoster } from './fixtures/tacticalStudyData.mjs';

const persistence = new MemoryRoomPersistence();
await persistence.create(studyRoom());
let catalogFailure = false;
const catalogStore = { forOwner() { return { async ensureInitialized() {}, async listPlayers(id) {
  if (catalogFailure) throw Object.assign(new Error('Catálogo indisponível no teste'), { status: 503 });
  return { players: studyRoster(id), count: 11 };
} }; } };
const backend = await startTestServer({ store: new RoomStore({ persistence, catalogStore }), catalogStore });
const root = fileURLToPath(new URL('../..', import.meta.url));
const outDir = '.tmp/tactical-study-browser';
await build({ root, configFile: false, envFile: false, logLevel: 'error',
  define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify(backend.url) },
  css: { postcss: { plugins: [] } },
  build: { outDir, emptyOutDir: false, rollupOptions: { input: fileURLToPath(new URL('./fixtures/tacticalStudyBrowser.html', import.meta.url)) } },
});
const vite = await preview({ root, configFile: false, envFile: false, build: { outDir },
  plugins: [{ name: 'isolated-study-controls', configurePreviewServer(server) {
    server.middlewares.use('/__study-test', async (request, response) => {
      if (request.method !== 'POST') { response.statusCode = 405; response.end(); return; }
      try {
        const command = request.url;
        if (command === '/fail') catalogFailure = true;
        if (command === '/restore') catalogFailure = false;
        const room = await persistence.mutate('BOLA-STDY', (current) => {
          if (command === '/advance') current.clubCareerState.currentDate = new Date(Date.parse(current.clubCareerState.currentDate) + 2 * 86400000).toISOString();
          if (command === '/staff') current.clubCareerState.staffContracts[0].status = 'terminated';
          current.revision += 1; return current;
        });
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ revision: room.revision }));
      } catch { response.statusCode = 500; response.end(); }
    });
  } }], preview: { host: '127.0.0.1', port: 5188, strictPort: true },
});
console.log('Estudo isolado: http://127.0.0.1:5188/server/tests/fixtures/tacticalStudyBrowser.html');
async function close() { await new Promise((resolve) => vite.httpServer.close(resolve)); await backend.server.close(); process.exit(0); }
process.once('SIGINT', close);
process.once('SIGTERM', close);
