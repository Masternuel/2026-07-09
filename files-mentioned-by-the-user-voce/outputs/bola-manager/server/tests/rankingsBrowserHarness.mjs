// Isolated production UI + real rankings route. Memory fixtures and fake auth only.
import express from 'express';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';
import { createRoomsRouter } from '../routes/rooms.mjs';
import { room, players } from './fixtures/rankingsBrowserData.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const outDir = '.tmp/rankings-browser';
let mode = 'restore'; let lastQuery = {};
const app = express();
const store = { async requireMembership() { return structuredClone(room); } };
const catalog = { forOwner() { return { async ensureInitialized() {}, async listPlayers(id) {
  return { players: players.filter((player) => player.clubId === id) };
} }; } };
app.use('/api/rooms', async (request, response, next) => {
  if (request.headers.authorization !== 'Bearer ranking-test-token') { response.status(401).json({ error: { message: 'Teste não autenticado' } }); return; }
  lastQuery = request.query;
  if (mode === 'fail') { response.status(503).json({ error: { message: 'Falha simulada' } }); return; }
  if (mode === 'invalid') { response.json({ rankings: {} }); return; }
  if (request.query.search === 'Atleta 01') await new Promise((resolve) => setTimeout(resolve, 1200));
  request.user = { uid: 'owner' }; next();
}, createRoomsRouter(store, catalog));
app.use((error, _request, response, _next) => response.status(error.status ?? 500).json({ error: { message: error.message } }));
await build({ root, configFile: false, envFile: false, logLevel: 'error',
  define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify('http://127.0.0.1:5189') },
  esbuild: { jsx: 'automatic' }, css: { postcss: { plugins: [] } },
  build: { outDir, emptyOutDir: false, rollupOptions: { input: fileURLToPath(new URL('./fixtures/rankingsBrowser.html', import.meta.url)) } },
});
const vite = await preview({ root, configFile: false, envFile: false, build: { outDir },
  plugins: [{ name: 'ranking-test-api', configurePreviewServer(server) {
    server.middlewares.use('/__rankings-test', (request, response) => {
      if (request.method !== 'POST') { response.statusCode = 405; response.end(); return; }
      const command = request.url.slice(1);
      if (['fail', 'restore', 'invalid'].includes(command)) mode = command;
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ mode, lastQuery }));
    });
    server.middlewares.use(app);
  } }], preview: { host: '127.0.0.1', port: 5189, strictPort: true },
});
console.log('http://127.0.0.1:5189/server/tests/fixtures/rankingsBrowser.html');
async function close() { await new Promise((resolve) => vite.httpServer.close(resolve)); process.exit(0); }
process.once('SIGINT', close); process.once('SIGTERM', close);
