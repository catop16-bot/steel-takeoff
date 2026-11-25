import type { Drawing2D } from './types';

export type DPointKind = 'end' | 'mid' | 'cen';

/** 圖紙鎖點的空間雜湊（局部座標） */
export class SnapIndex {
  private cell: number;
  private minX: number;
  private minY: number;
  private segCells = new Map<number, number[]>();
  private ptCells = new Map<number, number[]>();
  /** 線段：x1,y1,x2,y2 */
  private segs: Float32Array;
  /** 點：x,y,kind（0 end、1 mid、2 cen） */
  private pts: Float32Array;
  /** 每條線段的圖層 */
  private segLayer: Uint16Array;

  constructor(d: Drawing2D, hidden: Set<number>) {
    const [x0, y0, x1, y1] = d.bounds;
    const span = Math.max(x1 - x0, y1 - y0, 1);
    this.cell = Math.max(span / 384, 1e-6);
    this.minX = x0;
    this.minY = y0;
    let n = 0;
    d.segs.forEach((s, li) => {
      if (!hidden.has(li)) n += s.length / 4;
    });
    this.segs = new Float32Array(n * 4);
    this.segLayer = new Uint16Array(n);
    let k = 0;
    d.segs.forEach((s, li) => {
      if (hidden.has(li)) return;
      this.segs.set(s, k * 4);
      this.segLayer.fill(li, k, k + s.length / 4);
      k += s.length / 4;
    });
    let nc = 0;
    for (let i = 0; i < d.circles.length; i += 4) if (!hidden.has(d.circles[i + 3])) nc++;
    this.pts = new Float32Array((n * 3 + nc) * 3);
    let p = 0;
    const addPt = (x: number, y: number, kind: number) => {
      const id = p / 3;
      this.pts[p++] = x;
      this.pts[p++] = y;
      this.pts[p++] = kind;
      this.push(this.ptCells, this.key(x, y), id);
    };
    for (let i = 0; i < n; i++) {
      const a = i * 4;
      const sx = this.segs[a];
      const sy = this.segs[a + 1];
      const ex = this.segs[a + 2];
      const ey = this.segs[a + 3];
      addPt(sx, sy, 0);
      addPt(ex, ey, 0);
      addPt((sx + ex) / 2, (sy + ey) / 2, 1);
      // 沿線段走過的格子
      const len = Math.hypot(ex - sx, ey - sy);
      const steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
      let last = -1;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const key = this.key(sx + (ex - sx) * t, sy + (ey - sy) * t);
        if (key !== last) {
          this.push(this.segCells, key, i);
          last = key;
        }
      }
    }
    for (let i = 0; i < d.circles.length; i += 4) {
      if (hidden.has(d.circles[i + 3])) continue;
      addPt(d.circles[i], d.circles[i + 1], 2);
    }
    this.pts = this.pts.subarray(0, p);
  }

  private key(x: number, y: number): number {
    const cx = Math.floor((x - this.minX) / this.cell);
    const cy = Math.floor((y - this.minY) / this.cell);
    return cx * 100003 + cy;
  }

  private push(m: Map<number, number[]>, k: number, v: number) {
    const arr = m.get(k);
    if (arr) {
      if (arr[arr.length - 1] !== v) arr.push(v);
    } else m.set(k, [v]);
  }

  /** 最近的線段與其圖層 */
  nearestSeg(x: number, y: number, r: number): { layer: number; dist: number } | null {
    const c0x = Math.floor((x - r - this.minX) / this.cell);
    const c1x = Math.floor((x + r - this.minX) / this.cell);
    const c0y = Math.floor((y - r - this.minY) / this.cell);
    const c1y = Math.floor((y + r - this.minY) / this.cell);
    let best: { layer: number; dist: number } | null = null;
    const seen = new Set<number>();
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        for (const id of this.segCells.get(cx * 100003 + cy) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const a = id * 4;
          const x1 = this.segs[a];
          const y1 = this.segs[a + 1];
          const dx = this.segs[a + 2] - x1;
          const dy = this.segs[a + 3] - y1;
          const l2 = dx * dx + dy * dy;
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)) : 0;
          const dist = Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t));
          if (dist <= r && (!best || dist < best.dist)) best = { layer: this.segLayer[id], dist };
        }
      }
    }
    return best;
  }

  /** 半徑 r 內的點、線段（局部座標） */
  query(x: number, y: number, r: number): { points: { x: number; y: number; kind: DPointKind }[]; segs: [number, number, number, number][] } {
    const c0x = Math.floor((x - r - this.minX) / this.cell);
    const c1x = Math.floor((x + r - this.minX) / this.cell);
    const c0y = Math.floor((y - r - this.minY) / this.cell);
    const c1y = Math.floor((y + r - this.minY) / this.cell);
    const points: { x: number; y: number; kind: DPointKind }[] = [];
    const segIds = new Set<number>();
    const kinds: DPointKind[] = ['end', 'mid', 'cen'];
    const visit = (k: number) => {
      for (const id of this.ptCells.get(k) ?? []) {
        const px = this.pts[id * 3];
        const py = this.pts[id * 3 + 1];
        if (Math.abs(px - x) <= r && Math.abs(py - y) <= r) points.push({ x: px, y: py, kind: kinds[this.pts[id * 3 + 2]] });
      }
      for (const id of this.segCells.get(k) ?? []) segIds.add(id);
    };
    const area = (c1x - c0x + 1) * (c1y - c0y + 1);
    if (area > this.ptCells.size + this.segCells.size) {
      // 縮得很小時，查詢範圍的格子比有資料的格子還多：改掃有資料的格子
      const keys = new Set([...this.ptCells.keys(), ...this.segCells.keys()]);
      for (const k of keys) {
        const cx = Math.floor(k / 100003);
        const cy = k - cx * 100003;
        if (cx >= c0x && cx <= c1x && cy >= c0y && cy <= c1y) visit(k);
      }
    } else {
      for (let cx = c0x; cx <= c1x; cx++) for (let cy = c0y; cy <= c1y; cy++) visit(cx * 100003 + cy);
    }
    const segs: [number, number, number, number][] = [];
    for (const id of segIds) {
      const a = id * 4;
      segs.push([this.segs[a], this.segs[a + 1], this.segs[a + 2], this.segs[a + 3]]);
      if (segs.length > 400) break;
    }
    return { points, segs };
  }
}

/** 兩線段交點（含端點） */
export function segIntersect(a: [number, number, number, number], b: [number, number, number, number]): [number, number] | null {
  const [x1, y1, x2, y2] = a;
  const [x3, y3, x4, y4] = b;
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
}
