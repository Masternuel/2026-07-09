import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { HTTP_CSP } from './shared/imagePolicy.mjs';
import { SECURITY_HEADERS } from './shared/securityHeaders.mjs';
import { APP_CSP_REPORT_ONLY } from './shared/contentSecurityPolicy.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: projectRoot,
  envDir: process.env.BOLA_ENV_FILES === 'false' ? false : projectRoot,
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/firebase/') || id.includes('/node_modules/@firebase/')) return 'firebase';
          if (id.includes('/node_modules/socket.io-client/') || id.includes('/node_modules/engine.io-client/')) return 'realtime';
          if (id.includes('/node_modules/lucide-react/')) return 'icons';
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    headers: { ...SECURITY_HEADERS, 'Content-Security-Policy': HTTP_CSP, 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' },
    port: 5173,
    host: '127.0.0.1',
    fs: {
      allow: [projectRoot],
    },
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
  preview: { headers: { ...SECURITY_HEADERS, 'Content-Security-Policy': HTTP_CSP, 'Content-Security-Policy-Report-Only': APP_CSP_REPORT_ONLY, 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' } },
});
