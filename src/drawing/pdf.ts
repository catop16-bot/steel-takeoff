import { buildDrawing } from './flatten';
import { visibleOnLight } from './text';
import type { Drawing2D, DrawLayer, DrawText } from './types';

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** PDF 點（1/72 英寸）→ mm，比例 1:1 時 */
export const PT_MM = 25.4 / 72;

/** pdf.js 的 DrawOPS（路徑資料編碼） */
const D = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };

/** 只用到的 pdf.js 介面（方便在測試中用 legacy build 注入） */
export interface PdfPageLike {
  view: number[];
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: any[] }>;
  getTextContent(): Promise<{ items: any[] }>;
}

export interface PdfOps {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  setStrokeRGBColor: number;
  stroke: number;
  closeStroke: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
  closeFillStroke: number;
  closeEOFillStroke: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
}

/**
 * 擷取 PDF 一頁的向量線段與文字。
 * 線段依筆畫顏色分成「圖層」（CAD 出圖的 PDF 通常一個圖層一種顏色），填色路徑另成一層。
 */
export async function extractPdfPage(page: PdfPageLike, OPS: PdfOps): Promise<Drawing2D> {
  const ops = await page.getOperatorList();
  const layers: DrawLayer[] = [];
  const segs: number[][] = [];
  const layerIdx = new Map<string, number>();
  const layerOf = (name: string, color: string) => {
    let i = layerIdx.get(name);
    if (i === undefined) {
      i = layers.length;
      layerIdx.set(name, i);
      layers.push({ name, color: visibleOnLight(color), linetype: 'CONTINUOUS', off: false });
      segs.push([]);
    }
    return i;
  };
  let ctm: M = [1, 0, 0, 1, 0, 0];
  let color = '#000000';
  const stack: [M, string][] = [];
  const strokeOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const fillOps = new Set([OPS.fill, OPS.eoFill]);
  let count = 0;

  const emitPath = (data: ArrayLike<number>, li: number) => {
    const arr = segs[li];
    const tx = (x: number, y: number): [number, number] => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
    let cur: [number, number] | null = null;
    let start: [number, number] | null = null;
    const seg = (a: [number, number], b: [number, number]) => {
      if (a[0] === b[0] && a[1] === b[1]) return;
      arr.push(a[0], a[1], b[0], b[1]);
      count++;
    };
    for (let i = 0; i < data.length; ) {
      const op = data[i++];
      if (op === D.moveTo) {
        cur = tx(data[i++], data[i++]);
        start = cur;
      } else if (op === D.lineTo) {
        const p = tx(data[i++], data[i++]);
        if (cur) seg(cur, p);
        cur = p;
      } else if (op === D.curveTo) {
        const c1 = tx(data[i++], data[i++]);
        const c2 = tx(data[i++], data[i++]);
        const p = tx(data[i++], data[i++]);
        if (cur) {
          let prev = cur;
          for (let k = 1; k <= 8; k++) {
            const t = k / 8;
            const u = 1 - t;
            const q: [number, number] = [
              u * u * u * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p[0],
              u * u * u * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p[1],
            ];
            seg(prev, q);
            prev = q;
          }
        }
        cur = p;
      } else if (op === D.quadraticCurveTo) {
        const c = tx(data[i++], data[i++]);
        const p = tx(data[i++], data[i++]);
        if (cur) {
          let prev = cur;
          for (let k = 1; k <= 6; k++) {
            const t = k / 6;
            const u = 1 - t;
            const q: [number, number] = [u * u * cur[0] + 2 * u * t * c[0] + t * t * p[0], u * u * cur[1] + 2 * u * t * c[1] + t * t * p[1]];
            seg(prev, q);
            prev = q;
          }
        }
        cur = p;
      } else if (op === D.closePath) {
        if (cur && start) seg(cur, start);
        cur = start;
      } else break;
    }
  };

  const { fnArray, argsArray } = ops;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push([ctm, color]);
    else if (fn === OPS.restore) {
      const s = stack.pop();
      if (s) [ctm, color] = s;
    } else if (fn === OPS.transform) ctm = mul(ctm, args as M);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push([ctm, color]);
      if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = mul(ctm, Array.from(args[0] as ArrayLike<number>) as M);
    } else if (fn === OPS.paintFormXObjectEnd) {
      const s = stack.pop();
      if (s) [ctm, color] = s;
    } else if (fn === OPS.setStrokeRGBColor) {
      const c = args?.[0];
      if (typeof c === 'string') color = c;
      else if (c && c.length >= 3) color = `#${[c[0], c[1], c[2]].map((v: number) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    } else if (fn === OPS.constructPath) {
      const [op, payload] = args as [number, any[]];
      const data = payload?.[0];
      if (!data) continue;
      if (strokeOps.has(op)) emitPath(data, layerOf(`顏色 ${color}`, color));
      else if (fillOps.has(op)) emitPath(data, layerOf('填色區塊', '#9aa3ad'));
    }
  }

  const tc = await page.getTextContent();
  const texts: DrawText[] = [];
  const textLayer = layerOf('文字', '#2b2f33');
  for (const it of tc.items) {
    const s = String(it.str ?? '').trim();
    if (!s || !it.transform) continue;
    const [a, b, c, d, e, f] = it.transform as number[];
    const size = Math.hypot(c, d);
    // PDF 字級約為大寫字高的 1.4 倍
    texts.push({ s, x: e, y: f, h: size * 0.72, rot: (Math.atan2(b, a) * 180) / Math.PI, ha: 0, va: 0, wf: 1, layer: textLayer });
  }
  const v = page.view;
  const d = buildDrawing({
    format: 'pdf',
    layers,
    segs,
    texts,
    circles: [],
    unitScale: PT_MM,
    unitsKnown: false,
    unitName: 'pt（1:1 時）',
    encoding: 'pdf',
    entities: fnArray.length,
    skipped: {},
    extraBounds: [v[0], v[1], v[2], v[3]],
  });
  d.stats.segments = count;
  // 填色區塊預設隱藏（多為牆線剖面、陰影）
  const fillIdx = layerIdx.get('填色區塊');
  if (fillIdx !== undefined) d.layers[fillIdx].off = true;
  return d;
}

// ---------- 瀏覽器端：載入 pdf.js ----------

let pdfjsPromise: Promise<any> | null = null;

export function loadPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/** 把 PDF 頁面畫成點陣（底圖用）；回傳 PNG 與頁面範圍（PDF 座標） */
export async function rasterizePage(page: any, maxPx = 4096): Promise<{ blob: Blob; view: number[] }> {
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(maxPx / vp1.width, maxPx / vp1.height, 6);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('點陣化失敗'))), 'image/png'));
  return { blob, view: page.view };
}

export async function pageThumb(page: any, width = 180): Promise<string> {
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / vp1.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
  return canvas.toDataURL('image/png');
}
