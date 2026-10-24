import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const dataDir = fileURLToPath(new URL('../data', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@data': dataDir } },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: { '/api': { target: process.env.VITE_DEV_API_PROXY ?? 'http://localhost:8000', changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 6000,
    rollupOptions: { output: { manualChunks: { babylon: ['@babylonjs/core'] } } },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
