import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 建置後產生 dist/sw.js：列出 dist 內所有檔案供離線快取，
 * 版本號取所有檔案內容的雜湊，內容有變才會讓瀏覽器更新快取。
 */
function serviceWorker(): Plugin {
  let cfg: ResolvedConfig;
  return {
    name: 'steel-takeoff-sw',
    apply: 'build',
    configResolved(c) {
      cfg = c;
    },
    closeBundle() {
      const outDir = resolve(cfg.root, cfg.build.outDir);
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else files.push(relative(outDir, p).split('\\').join('/'));
        }
      };
      walk(outDir);
      const list = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map') && f !== '.DS_Store').sort();
      const template = readFileSync(resolve(cfg.root, 'src/pwa/sw.js'), 'utf8');
      const hash = createHash('sha256').update(template);
      for (const f of list) hash.update(f).update(readFileSync(join(outDir, f)));
      const urls = ['./', ...list.filter((f) => f !== 'index.html').map((f) => `./${f}`)];
      const src = template
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__PRECACHE__', JSON.stringify(urls, null, 1));
      writeFileSync(join(outDir, 'sw.js'), src);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), serviceWorker()],
  server: { port: 5180 },
  preview: { port: 5181 },
  build: { chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  // LibreDWG 用 new URL('…wasm', import.meta.url) 找 wasm，不能預先打包
  optimizeDeps: { include: ['pdfjs-dist', 'exceljs'], exclude: ['@mlightcad/libredwg-web'] },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
