import type { Drawing2D } from '../drawing/types';
import { formatSpacing, nextLabel } from '../geom/grid';
import { angleDiff, mergeCollinear, segmentsOf, type MergedLine } from './lines';

/** 軸線常用的圖層名稱、線型 */
export const AXIS_LAYER_RE = /AXIS|GRID|軸|CEN|中心|^C[-_ ]?L$|^AX|DOTE|通り|S-GRID|GRD/i;
export const AXIS_LTYPE_RE = /CENTER|DASHDOT|CHAIN|PHANTOM|DOT|CENTRE|一點鎖線/i;

export interface GridLineDet {
  offset: number;
  label: string;
  /** 標籤是否從圖上讀到（否則為自動遞增） */
  found: boolean;
}

export interface GridDetection {
  /** 圖紙 mm 座標中，軸線 X 方向（Y 向軸線的走向）的角度（度） */
  angle: number;
  /** 第一條 X、Y 軸線交點（圖紙 mm 座標） */
  origin: [number, number];
  xs: GridLineDet[];
  ys: GridLineDet[];
  xText: string;
  yText: string;
  xLabels: string;
  yLabels: string;
  layers: string[];
  warnings: string[];
}

interface Labeled extends MergedLine {
  label?: string;
}

/** 從圖紙辨識正交軸線（座標以圖紙原始座標 × 單位換算成 mm） */
export function detectGrid(d: Drawing2D, unitScale: number, opts: { layers?: string[] } = {}): GridDetection | null {
  const toMm = (x: number, y: number): [number, number] => [(x + d.base[0]) * unitScale, (y + d.base[1]) * unitScale];
  let layerIdx: number[];
  if (opts.layers?.length) layerIdx = d.layers.map((l, i) => (opts.layers!.includes(l.name) ? i : -1)).filter((i) => i >= 0);
  else {
    layerIdx = d.layers.map((l, i) => (AXIS_LAYER_RE.test(l.name) || AXIS_LTYPE_RE.test(l.linetype) ? i : -1)).filter((i) => i >= 0);
  }
  const warnings: string[] = [];
  if (!layerIdx.length) {
    warnings.push('找不到軸線圖層（名稱含 AXIS／GRID／軸，或線型為 CENTER），改用全部圖層的長線');
    layerIdx = d.layers.map((_, i) => i);
  }
  const set = new Set(layerIdx);
  const segs = segmentsOf(d, toMm, (li) => set.has(li));
  if (!segs.length) return null;
  const merged = mergeCollinear(segs);
  const maxExt = Math.max(...merged.map((l) => l.t1 - l.t0));
  // 軸線：夠長（≥ 最長線的 35% 且 ≥ 3 m），且大部分有畫到（虛線容許斷開）
  const cand = merged.filter((l) => l.t1 - l.t0 >= Math.max(3000, maxExt * 0.35) && l.covered >= (l.t1 - l.t0) * 0.35);
  if (cand.length < 2) return null;
  // 主方向：以長度加權的角度直方圖（1° 一格）
  const hist = new Map<number, number>();
  for (const l of cand) {
    const k = Math.round((l.angle * 180) / Math.PI) % 180;
    hist.set(k, (hist.get(k) ?? 0) + (l.t1 - l.t0));
  }
  const ranked = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  const a1 = (ranked[0][0] * Math.PI) / 180;
  const fam1 = cand.filter((l) => angleDiff(l.angle, a1) < (2 * Math.PI) / 180);
  const fam2 = cand.filter((l) => Math.abs(angleDiff(l.angle, a1) - Math.PI / 2) < (2 * Math.PI) / 180);
  if (!fam2.length) warnings.push('只找到單一方向的軸線');
  // 較接近水平的一族為 Y 向軸線（A、B、C…），另一族為 X 向軸線（1、2、3…）
  const horiz = (f: MergedLine[]) => (f.length ? Math.min(angleDiff(f[0].angle, 0), angleDiff(f[0].angle, Math.PI)) : 9);
  let yLines: Labeled[] = fam1;
  let xLines: Labeled[] = fam2;
  if (horiz(fam2) < horiz(fam1)) [yLines, xLines] = [fam2, fam1];
  // 角度：Y 向軸線的走向，化成 −45°～45°
  let phi = yLines.length ? yLines[0].angle : xLines[0].angle - Math.PI / 2;
  if (phi > Math.PI / 2) phi -= Math.PI;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);

  // 標籤：線端的泡泡（圓）內的文字，或線端延伸方向上的短文字
  const circles: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < d.circles.length; i += 4) {
    const [x, y] = toMm(d.circles[i], d.circles[i + 1]);
    circles.push({ x, y, r: d.circles[i + 2] * unitScale });
  }
  const texts = d.texts
    .filter((t) => /^[A-Za-z0-9]{1,4}('|′)?$/.test(t.s.trim()))
    .map((t) => {
      const [x, y] = toMm(t.x, t.y);
      return { s: t.s.trim(), x, y, h: t.h * unitScale, ha: t.ha, va: t.va };
    });
  const labelFor = (l: MergedLine): string | undefined => {
    const ca = Math.cos(l.angle);
    const sa = Math.sin(l.angle);
    const counts = new Map<string, number>();
    const near = (x: number, y: number, r: number) => {
      // 文字錨點可能在左下角，放寬到 1.6 倍半徑
      for (const t of texts) {
        const cx = t.ha === 0 ? t.x + t.h * 0.35 : t.x;
        const cy = t.va === 0 ? t.y + t.h * 0.5 : t.y;
        if (Math.hypot(cx - x, cy - y) <= r * 1.6) counts.set(t.s, (counts.get(t.s) ?? 0) + 1);
      }
    };
    for (const c of circles) {
      const t = ca * c.x + sa * c.y;
      const off = -sa * c.x + ca * c.y;
      if (Math.abs(off - l.c) > c.r * 0.5) continue;
      if (t < l.t0 - c.r * 4 || t > l.t1 + c.r * 4) continue;
      // 圓心在線端附近（線外或線內 3r 內）
      if (Math.min(Math.abs(t - l.t0), Math.abs(t - l.t1)) > c.r * 4) continue;
      near(c.x, c.y, c.r);
    }
    if (!counts.size) {
      for (const t of texts) {
        const tt = ca * t.x + sa * t.y;
        const off = -sa * t.x + ca * t.y;
        if (Math.abs(off - l.c) > t.h * 2) continue;
        const beyond = tt < l.t0 ? l.t0 - tt : tt > l.t1 ? tt - l.t1 : -1;
        if (beyond >= 0 && beyond < t.h * 8) counts.set(t.s, (counts.get(t.s) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  for (const l of [...xLines, ...yLines]) l.label = labelFor(l);

  const uOf = (l: MergedLine) => {
    // X 向軸線的位置沿 X 軸量
    const p = [-Math.sin(l.angle) * l.c, Math.cos(l.angle) * l.c];
    return cp * p[0] + sp * p[1];
  };
  const vOf = (l: MergedLine) => {
    const p = [-Math.sin(l.angle) * l.c, Math.cos(l.angle) * l.c];
    return -sp * p[0] + cp * p[1];
  };
  const build = (lines: Labeled[], pos: (l: MergedLine) => number, fallback: string): GridLineDet[] => {
    const sorted = lines.map((l) => ({ l, o: pos(l) })).sort((a, b) => a.o - b.o);
    const out: GridLineDet[] = [];
    for (const it of sorted) {
      const last = out[out.length - 1];
      if (last && Math.abs(it.o - (last as any)._o) < 5) {
        if (!last.found && it.l.label) {
          last.label = it.l.label;
          last.found = true;
        }
        continue;
      }
      out.push(Object.assign({ offset: it.o, label: it.l.label ?? '', found: !!it.l.label }, { _o: it.o }));
    }
    // 沒讀到的標籤依前後遞增
    for (let i = 0; i < out.length; i++) {
      if (out[i].label) continue;
      out[i].label = i === 0 ? fallback : nextLabel(out[i - 1].label);
    }
    const base = out[0]?.offset ?? 0;
    return out.map((g) => ({ offset: Math.round((g.offset - base) * 10) / 10, label: g.label, found: g.found }));
  };
  const xRaw = xLines.map(uOf).sort((a, b) => a - b);
  const yRaw = yLines.map(vOf).sort((a, b) => a - b);
  const xs = build(xLines, uOf, '1');
  const ys = build(yLines, vOf, 'A');
  const u0 = xRaw[0] ?? 0;
  const v0 = yRaw[0] ?? 0;
  const origin: [number, number] = [cp * u0 - sp * v0, sp * u0 + cp * v0];
  const missing = [...xs, ...ys].filter((g) => !g.found).length;
  if (missing) warnings.push(`${missing} 條軸線沒讀到標籤，已自動編號`);
  return {
    angle: (phi * 180) / Math.PI,
    origin,
    xs,
    ys,
    xText: formatSpacing(xs.map((g) => g.offset)),
    yText: formatSpacing(ys.map((g) => g.offset)),
    xLabels: xs.map((g) => g.label).join(' '),
    yLabels: ys.map((g) => g.label).join(' '),
    layers: layerIdx.map((i) => d.layers[i].name),
    warnings,
  };
}
