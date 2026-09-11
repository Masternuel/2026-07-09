import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const outDir = '.tmp/ui-actions-browser';
await build({ root, configFile: false, envFile: false, logLevel: 'error',
  esbuild: { jsx: 'automatic' }, css: { postcss: { plugins: [] } },
  build: { outDir, emptyOutDir: false, rollupOptions: { input: fileURLToPath(new URL('./fixtures/uiActionsBrowser.html', import.meta.url)) } },
});
const vite = await preview({ root, configFile: false, envFile: false, build: { outDir },
  preview: { host: '127.0.0.1', port: 5190, strictPort: true } });
console.log('http://127.0.0.1:5190/server/tests/fixtures/uiActionsBrowser.html');
async function close() { await new Promise((resolve) => vite.httpServer.close(resolve)); process.exit(0); }
process.once('SIGINT', close); process.once('SIGTERM', close);
