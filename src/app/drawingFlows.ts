import { signal } from '@preact/signals';
import { activeViewId, showViewIn } from './panes';
import { parseCad } from '../drawing/parse';
import { extractPdfPage, loadPdfjs, pageThumb, PT_MM, rasterizePage } from '../drawing/pdf';
import { localToPlane, targetFrame } from '../drawing/placement';
import { deleteDrawing, putDrawing } from '../drawing/storage';
import type { Drawing2D } from '../drawing/types';
import { gridExtent, gridToWorld } from '../geom/grid';
import { uid } from '../model/defaults';
import { pickFile } from '../model/persist';
import { store } from '../model/store';
import type { DrawingRef, DrawingTarget } from '../model/types';
import { app } from './core';
import { toast } from './ui';

export interface ImportState {
  file: File;
  kind: 'dxf' | 'dwg' | 'pdf';
  stage: 'parsing' | 'pages' | 'place' | 'error';
  error?: string;
  encoding: string;
  /** PDF */
  pdf?: any;
  pages?: { n: number; thumb: string }[];
  page?: number;
  pdfScale?: number;
  data?: Drawing2D;
}

export const importState = signal<ImportState | null>(null);

function kindOf(name: string): 'dxf' | 'dwg' | 'pdf' | null {
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'dxf' || ext === 'dwg' || ext === 'pdf' ? ext : null;
}

export async function importDrawingFlow(file?: File) {
  const f = file ?? (await pickFile('.dxf,.dwg,.pdf'));
  if (!f) return;
  const kind = kindOf(f.name);
  if (!kind) {
    toast('只支援 DWG、DXF、PDF');
    return;
  }
  importState.value = { file: f, kind, stage: 'parsing', encoding: 'auto' };
  if (kind === 'pdf') await openPdf(f);
  else await parseCadFile('auto');
}

export async function parseCadFile(encoding: string) {
  const st = importState.peek();
  if (!st || st.kind === 'pdf') return;
  importState.value = { ...st, stage: 'parsing', encoding, error: undefined };
  try {
    const data = await parseCad(st.kind, await st.file.arrayBuffer(), encoding);
    importState.value = { ...importState.peek()!, stage: 'place', data };
  } catch (e) {
    importState.value = { ...importState.peek()!, stage: 'error', error: (e as Error).message };
  }
}

async function openPdf(f: File) {
  try {
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false }).promise;
    const n = pdf.numPages;
    const pages: { n: number; thumb: string }[] = [];
    importState.value = { ...importState.peek()!, pdf, pages, stage: n === 1 ? 'parsing' : 'pages', pdfScale: 100 };
    if (n === 1) {
      await pickPdfPage(1, 100);
      return;
    }
    for (let i = 1; i <= Math.min(n, 60); i++) {
      const page = await pdf.getPage(i);
      pages.push({ n: i, thumb: await pageThumb(page) });
      const cur = importState.peek();
      if (!cur || cur.pdf !== pdf) return;
      importState.value = { ...cur, pages: [...pages] };
    }
  } catch (e) {
    importState.value = { ...importState.peek()!, stage: 'error', error: `PDF 讀取失敗：${(e as Error).message}` };
  }
}

export async function pickPdfPage(n: number, scale: number) {
  const st = importState.peek();
  if (!st?.pdf) return;
  importState.value = { ...st, stage: 'parsing', page: n, pdfScale: scale };
  try {
    const pdfjs = await loadPdfjs();
    const page = await st.pdf.getPage(n);
    const data = await extractPdfPage(page, pdfjs.OPS);
    // 點陣底圖：沒什麼向量內容（掃描檔）時一定要；其他情況也存，預設不顯示
    try {
      const r = await rasterizePage(page, data.stats.segments < 50 ? 6000 : 4096);
      data.raster = { blob: r.blob, x0: r.view[0] - data.base[0], y0: r.view[1] - data.base[1], x1: r.view[2] - data.base[0], y1: r.view[3] - data.base[1] };
    } catch {
      /* 點陣化失敗不影響向量 */
    }
    importState.value = { ...importState.peek()!, stage: 'place', data };
  } catch (e) {
    importState.value = { ...importState.peek()!, stage: 'error', error: `PDF 擷取失敗：${(e as Error).message}` };
  }
}

/** 匯入時預設放在目前窗格的平面／立面 */
export function defaultTarget(): DrawingTarget | null {
  const p = store.p;
  const vid = activeViewId();
  const v = p.views.find((x) => x.id === vid);
  if (v?.kind === 'plan' && v.levelId) return { kind: 'plan', levelId: v.levelId };
  if (v?.kind === 'elevation' && v.gridRef) return { kind: 'elevation', ...v.gridRef };
  const lv = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  return lv[0] ? { kind: 'plan', levelId: lv[0].id } : null;
}

/** 讓圖紙中心對到軸線（平面）或軸線＋樓層（立面）的中心 */
export function centerOffset(data: Drawing2D, scale: number, rotation: number, target: DrawingTarget): [number, number] {
  const p = store.p;
  let cu = 0;
  let cv = 0;
  const g = p.grids[0];
  if (target.kind === 'plan' && g) {
    const e = gridExtent(g);
    const c = gridToWorld(g, (e.u0 + e.u1) / 2, (e.v0 + e.v1) / 2);
    cu = c[0];
    cv = c[1];
  } else if (target.kind === 'elevation') {
    const gg = p.grids.find((x) => x.id === target.gridId);
    if (gg) {
      const e = gridExtent(gg);
      cu = target.dir === 'x' ? (e.v0 + e.v1) / 2 : (e.u0 + e.u1) / 2;
    }
    const zs = p.levels.map((l) => l.elevation);
    cv = zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0;
  }
  const [bx0, by0, bx1, by1] = data.bounds;
  const mid = localToPlane({ scale, rotation, offset: [0, 0] }, data.base, (bx0 + bx1) / 2, (by0 + by1) / 2);
  return [Math.round(cu - mid[0]), Math.round(cv - mid[1])];
}

/** 原座標是否已大致落在軸線範圍內（是的話不移動） */
export function overlapsGrid(data: Drawing2D, scale: number, target: DrawingTarget): boolean {
  if (target.kind !== 'plan') return false;
  const g = store.p.grids[0];
  if (!g) return false;
  const e = gridExtent(g);
  const a = gridToWorld(g, e.u0, e.v0);
  const b = gridToWorld(g, e.u1, e.v1);
  const [x0, y0, x1, y1] = data.bounds;
  const p0 = localToPlane({ scale, rotation: 0, offset: [0, 0] }, data.base, x0, y0);
  const p1 = localToPlane({ scale, rotation: 0, offset: [0, 0] }, data.base, x1, y1);
  const ox = Math.min(p1[0], Math.max(a[0], b[0])) - Math.max(p0[0], Math.min(a[0], b[0]));
  const oy = Math.min(p1[1], Math.max(a[1], b[1])) - Math.max(p0[1], Math.min(a[1], b[1]));
  return ox > 0 && oy > 0;
}

export async function commitImport(opts: { name: string; target: DrawingTarget; scale: number; center: boolean }): Promise<DrawingRef | null> {
  const st = importState.peek();
  if (!st?.data) return null;
  const data = st.data;
  const offset: [number, number] = opts.center ? centerOffset(data, opts.scale, 0, opts.target) : [0, 0];
  const ref: DrawingRef = {
    id: uid('d'),
    name: opts.name,
    fileName: st.file.name,
    format: st.kind,
    page: st.page,
    target: opts.target,
    scale: opts.scale,
    rotation: 0,
    offset,
    visible: true,
    opacity: 0.85,
    mono: false,
    showText: true,
    hiddenLayers: data.layers.filter((l) => l.off).map((l) => l.name),
    raster: st.kind === 'pdf' && data.stats.segments < 50,
    encoding: data.encoding,
  };
  await putDrawing(ref.id, data);
  store.add('drawings', [ref], `匯入圖紙 ${ref.name}`);
  importState.value = null;
  // 切到放置的視圖並縮放
  const v = store.p.views.find((x) =>
    opts.target.kind === 'plan'
      ? x.kind === 'plan' && x.levelId === opts.target.levelId
      : x.kind === 'elevation' && x.gridRef?.gridId === opts.target.gridId && x.gridRef.dir === opts.target.dir && x.gridRef.label === opts.target.label,
  );
  if (v) showViewIn(v.id);
  setTimeout(() => app.viewer?.fitAll(), 50);
  return ref;
}

export function removeDrawing(ref: DrawingRef) {
  store.remove('drawings', [ref.id], `刪除圖紙 ${ref.name}`);
  // 幾何資料保留在 IndexedDB 以便復原；專案中都沒有參考時才真正刪
  setTimeout(() => {
    if (!store.p.drawings.some((d) => d.id === ref.id) && !store.canUndo.peek()) void deleteDrawing(ref.id);
  }, 0);
}

export function targetValid(t: DrawingTarget): boolean {
  return !!targetFrame(t, store.p);
}

export const PDF_PT_MM = PT_MM;
