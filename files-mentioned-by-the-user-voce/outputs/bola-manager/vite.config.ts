import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { IMAGE_CSP } from './shared/imagePolicy.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: projectRoot,
  plugins: [react()],
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
    headers: { 'Content-Security-Policy': IMAGE_CSP, 'X-Content-Type-Options': 'nosniff' },
    port: 5173,
    host: true,
    fs: {
      allow: [projectRoot],
    },
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
  preview: { headers: { 'Content-Security-Policy': IMAGE_CSP, 'X-Content-Type-Options': 'nosniff' } },
});
