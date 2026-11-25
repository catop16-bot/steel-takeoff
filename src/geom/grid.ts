import type { Grid, GridAxis, Level } from '../model/types';
import type { V3 } from './vec';

/**
 * 解析 Tekla 軸線座標語法：第一個值是起點座標，其後為間距，`n*d` 表示 n 個 d。
 * 例：`0 4*6000 7500` → [0, 6000, 12000, 18000, 24000, 31500]
 */
export function parseSpacing(text: string): { ok: true; values: number[] } | { ok: false; error: string } {
  const tokens = text
    .normalize('NFKC')
    .replace(/[，,;；]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return { ok: false, error: '請輸入座標' };
  const values: number[] = [];
  let cur = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = t.match(/^(\d+)\s*[*xX×]\s*(-?\d+(?:\.\d+)?)$/);
    let reps = 1;
    let v: number;
    if (m) {
      reps = Number(m[1]);
      v = Number(m[2]);
      if (!(reps >= 1 && reps <= 500)) return { ok: false, error: `重複次數錯誤「${t}」` };
    } else {
      v = Number(t);
      if (!Number.isFinite(v)) return { ok: false, error: `無法解析「${t}」` };
    }
    for (let k = 0; k < reps; k++) {
      if (i === 0 && k === 0) cur = v;
      else {
        if (!(v > 0)) return { ok: false, error: `間距必須大於 0「${t}」` };
        cur += v;
      }
      values.push(cur);
    }
  }
  return { ok: true, values };
}

/** 把座標轉回 Tekla 語法（連續相同間距合併成 n*d） */
export function formatSpacing(values: number[]): string {
  if (!values.length) return '';
  const out: string[] = [String(round(values[0]))];
  let i = 1;
  while (i < values.length) {
    const d = round(values[i] - values[i - 1]);
    let n = 1;
    while (i + n < values.length && Math.abs(round(values[i + n] - values[i + n - 1]) - d) < 1e-6) n++;
    out.push(n > 1 ? `${n}*${d}` : String(d));
    i += n;
  }
  return out.join(' ');
}

const round = (n: number) => Math.round(n * 100) / 100;

/** 標籤遞增：A→B、Z→AA、1→2、A1→A2、C10→C11 */
export function nextLabel(label: string): string {
  const m = label.match(/^(.*?)(\d+)$/);
  if (m) {
    const n = String(Number(m[2]) + 1).padStart(m[2].length, '0');
    return m[1] + n;
  }
  const lm = label.match(/^(.*?)([A-Za-z]+)$/);
  if (lm) {
    const chars = lm[2].split('');
    let i = chars.length - 1;
    while (i >= 0) {
      const c = chars[i];
      if (c === 'Z' || c === 'z') {
        chars[i] = c === 'Z' ? 'A' : 'a';
        i--;
      } else {
        chars[i] = String.fromCharCode(c.charCodeAt(0) + 1);
        break;
      }
    }
    if (i < 0) chars.unshift(lm[2][0] === lm[2][0].toLowerCase() ? 'a' : 'A');
    return lm[1] + chars.join('');
  }
  return label + "'";
}

/** 依標籤文字產生 n 個標籤；不足的自動遞增 */
export function expandLabels(text: string, n: number, fallback: string): string[] {
  const given = text.normalize('NFKC').trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i < given.length) out.push(given[i]);
    else out.push(i === 0 ? fallback : nextLabel(out[i - 1]));
  }
  return out;
}

export function buildAxes(coordText: string, labelText: string, fallback: string): GridAxis[] | string {
  const r = parseSpacing(coordText);
  if (!r.ok) return r.error;
  const labels = expandLabels(labelText, r.values.length, fallback);
  return r.values.map((offset, i) => ({ offset, label: labels[i] }));
}

/** 軸線局部座標（u 沿 X 軸、v 沿 Y 軸）→ 世界座標 */
export function gridToWorld(g: Grid, u: number, v: number, z = 0): V3 {
  const a = (g.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [g.origin[0] + u * c - v * s, g.origin[1] + u * s + v * c, z];
}

export function worldToGrid(g: Grid, p: V3): [number, number] {
  const a = (g.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = p[0] - g.origin[0];
  const dy = p[1] - g.origin[1];
  return [dx * c + dy * s, -dx * s + dy * c];
}

export function gridExtent(g: Grid): { u0: number; u1: number; v0: number; v1: number } {
  const us = g.xs.map((a) => a.offset);
  const vs = g.ys.map((a) => a.offset);
  return {
    u0: Math.min(0, ...us),
    u1: Math.max(0, ...us),
    v0: Math.min(0, ...vs),
    v1: Math.max(0, ...vs),
  };
}

export interface GridLine3 {
  gridId: string;
  dir: 'x' | 'y';
  label: string;
  a: V3;
  b: V3;
}

/** 軸線在某高程的線段（含延伸長度） */
export function gridLines(g: Grid, z = 0): GridLine3[] {
  const e = gridExtent(g);
  const out: GridLine3[] = [];
  for (const ax of g.xs) {
    out.push({ gridId: g.id, dir: 'x', label: ax.label, a: gridToWorld(g, ax.offset, e.v0 - g.ext, z), b: gridToWorld(g, ax.offset, e.v1 + g.ext, z) });
  }
  for (const ax of g.ys) {
    out.push({ gridId: g.id, dir: 'y', label: ax.label, a: gridToWorld(g, e.u0 - g.ext, ax.offset, z), b: gridToWorld(g, e.u1 + g.ext, ax.offset, z) });
  }
  return out;
}

export interface GridNode {
  p: V3;
  xLabel: string;
  yLabel: string;
}

export function gridNodes(g: Grid, z = 0): GridNode[] {
  const out: GridNode[] = [];
  for (const x of g.xs) for (const y of g.ys) out.push({ p: gridToWorld(g, x.offset, y.offset, z), xLabel: x.label, yLabel: y.label });
  return out;
}

/** 點的軸線位置描述，如「B-3」，不在交點上則加「≈」 */
export function gridLocation(grids: Grid[], p: V3, tol = 50): string {
  let best = '';
  let bestD = Infinity;
  for (const g of grids) {
    const [u, v] = worldToGrid(g, p);
    let bx: { label: string; d: number } | null = null;
    let by: { label: string; d: number } | null = null;
    for (const a of g.xs) {
      const d = Math.abs(a.offset - u);
      if (!bx || d < bx.d) bx = { label: a.label, d };
    }
    for (const a of g.ys) {
      const d = Math.abs(a.offset - v);
      if (!by || d < by.d) by = { label: a.label, d };
    }
    if (!bx || !by) continue;
    const d = Math.hypot(bx.d, by.d);
    if (d < bestD) {
      bestD = d;
      best = `${by.label}-${bx.label}`;
    }
  }
  if (!best) return '';
  return bestD <= tol ? best : `≈${best}`;
}

/** 依高程找最接近的樓層 */
export function levelAt(levels: Level[], z: number, tol = 1): Level | undefined {
  let best: Level | undefined;
  let bd = Infinity;
  for (const l of levels) {
    const d = Math.abs(l.elevation - z);
    if (d < bd) {
      bd = d;
      best = l;
    }
  }
  return bd <= tol ? best : undefined;
}

/** 某高程所屬樓層：該高程以下最近的樓層（柱歸在底部所在層） */
export function levelBelow(levels: Level[], z: number): Level | undefined {
  const sorted = [...levels].sort((a, b) => a.elevation - b.elevation);
  let found: Level | undefined;
  for (const l of sorted) if (l.elevation <= z + 1) found = l;
  return found ?? sorted[0];
}
