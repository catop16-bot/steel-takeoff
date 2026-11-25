import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  server: { port: 5180 },
  build: { chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  // LibreDWG 用 new URL('…wasm', import.meta.url) 找 wasm，不能預先打包
  optimizeDeps: { include: ['pdfjs-dist', 'exceljs'], exclude: ['@mlightcad/libredwg-web'] },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
