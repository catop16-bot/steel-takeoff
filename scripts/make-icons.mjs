// 產生應用程式圖示（public/icons/*.png）。改圖示時執行：node scripts/make-icons.mjs
// 用 pdfjs-dist 附帶的 @napi-rs/canvas 繪製，產出的 PNG 直接提交，建置時不需要再跑。
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

/**
 * size：畫布邊長；inset：底板內縮比例（0 = 滿版，給 maskable／iOS 用）；
 * symbol：H 型鋼斷面占畫布的比例
 */
function draw(size, inset, symbol) {
  const c = createCanvas(size, size);
  const g = c.getContext('2d');
  const pad = size * inset;
  const body = size - pad * 2;
  const r = inset ? body * 0.225 : 0;

  // 底板：功能區的深藍灰漸層
  const bg = g.createLinearGradient(0, pad, 0, pad + body);
  bg.addColorStop(0, '#3a4f64');
  bg.addColorStop(1, '#22303d');
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(pad, pad, body, body, r);
  g.fill();
  g.save();
  g.clip();

  // 背景軸線（一點鏈線）
  const cx = size / 2;
  const cy = size / 2;
  g.strokeStyle = 'rgba(159,179,200,0.45)';
  g.lineWidth = Math.max(1, size / 170);
  g.setLineDash([size / 14, size / 40, size / 120, size / 40]);
  const a = (size * symbol) / 2 + size * 0.07;
  for (const d of [-a, a]) {
    g.beginPath();
    g.moveTo(pad, cy + d);
    g.lineTo(pad + body, cy + d);
    g.stroke();
    g.beginPath();
    g.moveTo(cx + d, pad);
    g.lineTo(cx + d, pad + body);
    g.stroke();
  }
  g.setLineDash([]);

  // H 型鋼斷面（與介面左上角同一個圖形，原始座標 32×32）
  const s = (size * symbol) / 24;
  const ox = cx - 16 * s;
  const oy = cy - 16 * s;
  const P = (x, y) => [ox + x * s, oy + y * s];
  const pts = [P(4, 5), P(28, 5), P(28, 10), P(19, 10), P(19, 22), P(28, 22), P(28, 27), P(4, 27), P(4, 22), P(13, 22), P(13, 10), P(4, 10)];
  const fg = g.createLinearGradient(0, oy + 5 * s, 0, oy + 27 * s);
  fg.addColorStop(0, '#7db6ff');
  fg.addColorStop(1, '#3d87f0');
  g.fillStyle = fg;
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = size / 40;
  g.shadowOffsetY = size / 120;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
  g.restore();
  return c.toBuffer('image/png');
}

const files = {
  'icon-192.png': draw(192, 0.08, 0.5),
  'icon-512.png': draw(512, 0.08, 0.5),
  'icon-maskable-512.png': draw(512, 0, 0.46),
  'apple-touch-icon.png': draw(180, 0, 0.5),
  'favicon-32.png': draw(32, 0, 0.72),
};
for (const [name, buf] of Object.entries(files)) {
  writeFileSync(join(out, name), buf);
  console.log(name, buf.length, 'bytes');
}
