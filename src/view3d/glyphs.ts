import * as THREE from 'three';
import type { DrawText } from '../drawing/types';

/**
 * 字形圖集：用 canvas 把用到的字（含中文）畫進 2048×2048 的貼圖，
 * 文字以四邊形批次繪製，一頁一次 draw call。
 */
const PAGE = 2048;
const CELL = 48;
const FONT = 36;
const PAD_X = 6;
const BASE_Y = 37;
const PER_ROW = Math.floor(PAGE / CELL);
const PER_PAGE = PER_ROW * PER_ROW;
const MAX_PAGES = 4;
/** 大寫字高 ≈ 0.7 em */
const CAP = 0.7;
const FAMILY = `-apple-system, 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', 'Heiti TC', sans-serif`;

interface Glyph {
  page: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** 前進寬度（em） */
  adv: number;
}

interface Page {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  count: number;
}

class Atlas {
  pages: Page[] = [];
  glyphs = new Map<string, Glyph>();
  private dirty = new Set<Page>();

  private newPage(): Page | null {
    if (this.pages.length >= MAX_PAGES) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PAGE;
    const ctx = canvas.getContext('2d')!;
    ctx.font = `${FONT}px ${FAMILY}`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 4;
    const p = { canvas, ctx, tex, count: 0 };
    this.pages.push(p);
    return p;
  }

  get(ch: string): Glyph | null {
    const g = this.glyphs.get(ch);
    if (g) return g;
    let page = this.pages[this.pages.length - 1];
    if (!page || page.count >= PER_PAGE) {
      const np = this.newPage();
      if (!np) return this.glyphs.get('?') ?? null;
      page = np;
    }
    const i = page.count++;
    const cx = (i % PER_ROW) * CELL;
    const cy = Math.floor(i / PER_ROW) * CELL;
    page.ctx.fillText(ch, cx + PAD_X, cy + BASE_Y);
    const adv = page.ctx.measureText(ch).width / FONT;
    const glyph: Glyph = {
      page: this.pages.indexOf(page),
      u0: cx / PAGE,
      u1: (cx + CELL) / PAGE,
      v0: 1 - (cy + CELL) / PAGE,
      v1: 1 - cy / PAGE,
      adv,
    };
    this.glyphs.set(ch, glyph);
    this.dirty.add(page);
    return glyph;
  }

  flush() {
    for (const p of this.dirty) p.tex.needsUpdate = true;
    this.dirty.clear();
  }
}

export const atlas = new Atlas();

/** 把文字轉成各頁的網格（局部座標 z=0） */
export function buildTextMeshes(texts: DrawText[], colorOf: (layer: number) => THREE.Color, visibleLayer: (layer: number) => boolean, material: (page: number) => THREE.Material): THREE.Mesh[] {
  const per: { pos: number[]; uv: number[]; col: number[]; idx: number[] }[] = [];
  const cellW = CELL / FONT;
  const below = (CELL - BASE_Y) / FONT;
  const above = BASE_Y / FONT;
  for (const t of texts) {
    if (!visibleLayer(t.layer)) continue;
    const em = t.h / CAP;
    const glyphs: (Glyph | null)[] = [];
    let width = 0;
    for (const ch of t.s) {
      const g = ch === ' ' ? null : atlas.get(ch);
      glyphs.push(g);
      width += (g ? g.adv : 0.3) * em * t.wf;
    }
    const dx = t.ha === 1 ? -width / 2 : t.ha === 2 ? -width : 0;
    const dy = t.va === 1 ? 0.3 * t.h : t.va === 2 ? -t.h / 2 : t.va === 3 ? -t.h : 0;
    const r = (t.rot * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const color = colorOf(t.layer);
    let pen = dx;
    let k = 0;
    for (const ch of t.s) {
      const g = glyphs[k++];
      const adv = (g ? g.adv : 0.3) * em * t.wf;
      if (g) {
        let bucket = per[g.page];
        if (!bucket) per[g.page] = bucket = { pos: [], uv: [], col: [], idx: [] };
        const x0 = pen - (PAD_X / FONT) * em * t.wf;
        const x1 = x0 + cellW * em * t.wf;
        const y0 = dy - below * em;
        const y1 = dy + above * em;
        const base = bucket.pos.length / 3;
        for (const [lx, ly] of [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ]) {
          bucket.pos.push(t.x + lx * c - ly * s, t.y + lx * s + ly * c, 0);
          bucket.col.push(color.r, color.g, color.b);
        }
        bucket.uv.push(g.u0, g.v0, g.u1, g.v0, g.u1, g.v1, g.u0, g.v1);
        bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      pen += adv;
      void ch;
    }
  }
  atlas.flush();
  const meshes: THREE.Mesh[] = [];
  per.forEach((b, page) => {
    if (!b) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.setIndex(b.idx);
    const m = new THREE.Mesh(g, material(page));
    m.frustumCulled = false;
    meshes.push(m);
  });
  return meshes;
}

export function pageTexture(page: number): THREE.Texture {
  return atlas.pages[page].tex;
}
