import type { Drawing2D } from '../drawing/types';

/** 以 mm 為單位、平面座標的線段 */
export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  layer: number;
}

/** 同方向、同一直線上的線段合併後的「直線」 */
export interface MergedLine {
  /** 方向角（弧度，0 ≤ θ < π） */
  angle: number;
  /** 法向距離 c = −sinθ·x + cosθ·y */
  c: number;
  /** 沿方向的範圍 t = cosθ·x + sinθ·y */
  t0: number;
  t1: number;
  /** 實際被線段覆蓋的總長（虛線會小於範圍） */
  covered: number;
  layers: Set<number>;
  pieces: number;
}

/** 取出圖紙線段（套用座標轉換） */
export function segmentsOf(d: Drawing2D, toMm: (x: number, y: number) => [number, number], layerFilter?: (li: number) => boolean): Seg[] {
  const out: Seg[] = [];
  d.segs.forEach((s, li) => {
    if (layerFilter && !layerFilter(li)) return;
    for (let i = 0; i < s.length; i += 4) {
      const [x1, y1] = toMm(s[i], s[i + 1]);
      const [x2, y2] = toMm(s[i + 2], s[i + 3]);
      out.push({ x1, y1, x2, y2, layer: li });
    }
  });
  return out;
}

export const segLen = (s: Seg) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

function normAngle(a: number): number {
  let t = a % Math.PI;
  if (t < 0) t += Math.PI;
  if (t >= Math.PI - 1e-9) t -= Math.PI;
  return t;
}

/** 角度差（考慮 0 與 π 相同） */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

/**
 * 把共線的線段合併成直線（容許虛線斷開）。
 * angTol 弧度、offTol mm。
 */
export function mergeCollinear(segs: Seg[], angTol = (0.5 * Math.PI) / 180, offTol = 20, maxGap = Infinity): MergedLine[] {
  const items = segs
    .map((s) => {
      const a = normAngle(Math.atan2(s.y2 - s.y1, s.x2 - s.x1));
      return { s, a, len: segLen(s) };
    })
    .filter((x) => x.len > 1e-6)
    .sort((p, q) => p.a - q.a);
  const lines: MergedLine[] = [];
  // 依角度分組，再依法向距離分組
  const groups: (typeof items)[] = [];
  for (const it of items) {
    const g = groups.find((gg) => angleDiff(gg[0].a, it.a) <= angTol);
    if (g) g.push(it);
    else groups.push([it]);
  }
  for (const g of groups) {
    // 以長度加權平均角度
    let sx = 0;
    let sy = 0;
    for (const it of g) {
      sx += Math.cos(2 * it.a) * it.len;
      sy += Math.sin(2 * it.a) * it.len;
    }
    const a = normAngle(Math.atan2(sy, sx) / 2);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const withC = g
      .map((it) => {
        const c = (-sa * (it.s.x1 + it.s.x2)) / 2 + (ca * (it.s.y1 + it.s.y2)) / 2;
        const ta = ca * it.s.x1 + sa * it.s.y1;
        const tb = ca * it.s.x2 + sa * it.s.y2;
        return { ...it, c, t0: Math.min(ta, tb), t1: Math.max(ta, tb) };
      })
      .sort((p, q) => p.c - q.c);
    let cur: MergedLine | null = null;
    let csum = 0;
    let cw = 0;
    const flush = () => {
      if (cur) {
        cur.c = csum / Math.max(cw, 1e-9);
        lines.push(cur);
      }
    };
    for (const it of withC) {
      if (!cur || Math.abs(it.c - csum / cw) > offTol) {
        flush();
        cur = { angle: a, c: it.c, t0: it.t0, t1: it.t1, covered: 0, layers: new Set(), pieces: 0 };
        csum = 0;
        cw = 0;
      }
      cur.t0 = Math.min(cur.t0, it.t0);
      cur.t1 = Math.max(cur.t1, it.t1);
      cur.covered += it.len;
      cur.layers.add(it.s.layer);
      cur.pieces++;
      csum += it.c * it.len;
      cw += it.len;
    }
    flush();
  }
  if (maxGap === Infinity) return lines;
  // 同一直線上相距超過 maxGap 的線段分成不同段
  return splitRuns(lines, segs, angTol, offTol, maxGap);
}

function splitRuns(lines: MergedLine[], segs: Seg[], angTol: number, offTol: number, maxGap: number): MergedLine[] {
  const out: MergedLine[] = [];
  for (const l of lines) {
    const ca = Math.cos(l.angle);
    const sa = Math.sin(l.angle);
    const iv: [number, number, number, number][] = [];
    for (const s of segs) {
      const a = normAngle(Math.atan2(s.y2 - s.y1, s.x2 - s.x1));
      if (angleDiff(a, l.angle) > angTol) continue;
      const c = (-sa * (s.x1 + s.x2)) / 2 + (ca * (s.y1 + s.y2)) / 2;
      if (Math.abs(c - l.c) > offTol) continue;
      const ta = ca * s.x1 + sa * s.y1;
      const tb = ca * s.x2 + sa * s.y2;
      iv.push([Math.min(ta, tb), Math.max(ta, tb), segLen(s), s.layer]);
    }
    iv.sort((p, q) => p[0] - q[0]);
    let cur: MergedLine | null = null;
    for (const [t0, t1, len, layer] of iv) {
      if (!cur || t0 - cur.t1 > maxGap) {
        if (cur) out.push(cur);
        cur = { angle: l.angle, c: l.c, t0, t1, covered: 0, layers: new Set(), pieces: 0 };
      }
      cur.t1 = Math.max(cur.t1, t1);
      cur.covered += len;
      cur.layers.add(layer);
      cur.pieces++;
    }
    if (cur) out.push(cur);
  }
  return out;
}


/** 直線上 t 處的點 */
export function pointOn(l: { angle: number; c: number }, t: number): [number, number] {
  const ca = Math.cos(l.angle);
  const sa = Math.sin(l.angle);
  return [ca * t - sa * l.c, sa * t + ca * l.c];
}

/** 兩條無限直線交點 */
export function lineIntersect(a: { angle: number; c: number }, b: { angle: number; c: number }): [number, number] | null {
  // 直線：−sinθ x + cosθ y = c
  const a1 = -Math.sin(a.angle);
  const b1 = Math.cos(a.angle);
  const a2 = -Math.sin(b.angle);
  const b2 = Math.cos(b.angle);
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-9) return null;
  return [(a.c * b2 - b.c * b1) / det, (a1 * b.c - a2 * a.c) / det];
}
