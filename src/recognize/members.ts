import { parseProfile } from '../catalog/parse';
import type { MemberType } from '../model/types';
import { angleDiff, lineIntersect, mergeCollinear, pointOn, type MergedLine, type Seg } from './lines';
import { MARK_RE, markType } from './schedule';

export type P = [number, number];

export interface PlaneText {
  s: string;
  x: number;
  y: number;
  h: number;
}

export interface MemberCandidate {
  id: number;
  type: MemberType;
  a: P;
  b: P;
  mark: string;
  profile: string;
  /** 梁寬（雙線間距，mm）；柱為 0 */
  width: number;
  status: 'ok' | 'noprofile' | 'nolabel' | 'exists';
  checked: boolean;
  note: string;
}

export interface GridRef {
  /** 平面上的軸線（無限直線） */
  lines: { angle: number; c: number }[];
  nodes: P[];
}

export interface BeamOptions {
  mode: 'auto' | 'double' | 'single';
  /** 雙線間距範圍 mm */
  minWidth: number;
  maxWidth: number;
  /** 最短梁長 mm */
  minLength: number;
  /** 標註文字最遠距離 mm */
  labelDist: number;
}

export const DEFAULT_BEAM_OPTS: BeamOptions = { mode: 'auto', minWidth: 60, maxWidth: 1000, minLength: 800, labelDist: 1500 };

interface Center {
  angle: number;
  c: number;
  t0: number;
  t1: number;
  width: number;
}

function parseLabel(s: string): { mark?: string; profile?: string } {
  const raw = s
    .normalize('NFKC')
    .replace(/\s*([x×*X])\s*(?=\d)/g, 'x')
    .replace(/(^|\s)(BH|H|I|C|L|CT|BOX|□|口|φ|\[)\s*-?\s+(?=\d)/gi, '$1$2');
  const out: { mark?: string; profile?: string } = {};
  for (const w of raw.split(/[\s,，、()（）]+/).filter(Boolean)) {
    const p = parseProfile(w);
    if (p.ok && !p.profile.thicknessOnly && /\d+x\d+/i.test(w)) out.profile ??= p.profile.name;
    else if (MARK_RE.test(w.toUpperCase())) out.mark ??= w.toUpperCase();
  }
  return out;
}

/** 平面上的雙線（或單線）梁 → 中心線 */
function centerlines(segs: Seg[], o: BeamOptions): { centers: Center[]; mode: 'double' | 'single' } {
  const lines = mergeCollinear(segs, (0.5 * Math.PI) / 180, 15, 600).filter((l) => l.t1 - l.t0 >= o.minLength * 0.5);
  const byAngle = [...lines].sort((a, b) => a.angle - b.angle || a.c - b.c);
  const used = new Set<MergedLine>();
  const pairs: Center[] = [];
  for (const l of byAngle) {
    if (used.has(l)) continue;
    let best: MergedLine | null = null;
    let bd = Infinity;
    for (const m of byAngle) {
      if (m === l || used.has(m) || angleDiff(m.angle, l.angle) > (0.5 * Math.PI) / 180) continue;
      const w = Math.abs(m.c - l.c);
      if (w < o.minWidth || w > o.maxWidth) continue;
      const ov = Math.min(l.t1, m.t1) - Math.max(l.t0, m.t0);
      const short = Math.min(l.t1 - l.t0, m.t1 - m.t0);
      if (ov < short * 0.6) continue;
      if (w < bd) {
        bd = w;
        best = m;
      }
    }
    if (best) {
      used.add(l);
      used.add(best);
      pairs.push({ angle: l.angle, c: (l.c + best.c) / 2, t0: Math.min(l.t0, best.t0), t1: Math.max(l.t1, best.t1), width: Math.abs(best.c - l.c) });
    }
  }
  const total = lines.reduce((s, l) => s + (l.t1 - l.t0), 0);
  const pairedLen = pairs.reduce((s, p) => s + 2 * (p.t1 - p.t0), 0);
  const mode = o.mode === 'auto' ? (pairedLen >= total * 0.5 ? 'double' : 'single') : o.mode;
  if (mode === 'double') return { centers: pairs, mode };
  return { centers: lines.map((l) => ({ angle: l.angle, c: l.c, t0: l.t0, t1: l.t1, width: 0 })), mode };
}

/**
 * 梁候選：雙線取中心線、端點延伸到軸線或其他梁中心線、在柱位（軸線交點）分跨、配對編號／斷面文字。
 */
export function detectBeams(segs: Seg[], texts: PlaneText[], grid: GridRef, schedule: Map<string, string>, opts: Partial<BeamOptions> = {}): { list: MemberCandidate[]; mode: 'double' | 'single' } {
  const o = { ...DEFAULT_BEAM_OPTS, ...opts };
  const { centers, mode } = centerlines(segs, o);
  const tol = (c: Center) => Math.max(800, c.width + 300);
  // 端點延伸：找此中心線上與軸線、其他中心線的交點
  for (const c of centers) {
    const targets: number[] = [];
    const ca = Math.cos(c.angle);
    const sa = Math.sin(c.angle);
    const tAt = (p: P) => ca * p[0] + sa * p[1];
    for (const g of grid.lines) {
      if (angleDiff(g.angle, c.angle) < Math.PI / 6) continue;
      const x = lineIntersect(c, g);
      if (x) targets.push(tAt(x));
    }
    for (const d of centers) {
      if (d === c || angleDiff(d.angle, c.angle) < Math.PI / 6) continue;
      const x = lineIntersect(c, d);
      if (!x) continue;
      const td = Math.cos(d.angle) * x[0] + Math.sin(d.angle) * x[1];
      if (td < d.t0 - tol(d) || td > d.t1 + tol(d)) continue;
      targets.push(tAt(x));
    }
    const T = tol(c);
    const snap = (t: number) => {
      let best = t;
      let bd = T;
      for (const v of targets) {
        const dd = Math.abs(v - t);
        if (dd < bd) {
          bd = dd;
          best = v;
        }
      }
      return best;
    };
    c.t0 = snap(c.t0);
    c.t1 = snap(c.t1);
  }
  // 分跨：軸線上的大梁在柱位（軸線交點）分；不在軸線上的小梁遇到軸線或軸線上的大梁就分（簡支）
  const onGridLine = (c: Center) => grid.lines.some((g) => angleDiff(g.angle, c.angle) < (1 * Math.PI) / 180 && Math.abs(g.c - c.c) < 50);
  const spans: Center[] = [];
  for (const c of centers) {
    const ca = Math.cos(c.angle);
    const sa = Math.sin(c.angle);
    const tAt = (p: P) => ca * p[0] + sa * p[1];
    let cutPts: number[];
    if (onGridLine(c)) {
      cutPts = grid.nodes.filter((n) => Math.abs(-sa * n[0] + ca * n[1] - c.c) < 50).map(tAt);
    } else {
      cutPts = [];
      for (const g of grid.lines) {
        if (angleDiff(g.angle, c.angle) < Math.PI / 6) continue;
        const x = lineIntersect(c, g);
        if (x) cutPts.push(tAt(x));
      }
      for (const d of centers) {
        if (d === c || !onGridLine(d) || angleDiff(d.angle, c.angle) < Math.PI / 6) continue;
        const x = lineIntersect(c, d);
        if (!x) continue;
        const td = Math.cos(d.angle) * x[0] + Math.sin(d.angle) * x[1];
        if (td >= d.t0 - 50 && td <= d.t1 + 50) cutPts.push(tAt(x));
      }
    }
    const cuts = [...new Set(cutPts.map((t) => Math.round(t)))]
      .filter((t) => t > c.t0 + 300 && t < c.t1 - 300)
      .sort((a, b) => a - b);
    let s = c.t0;
    for (const t of [...cuts, c.t1]) {
      if (t - s >= o.minLength) spans.push({ ...c, t0: s, t1: t });
      s = t;
    }
  }
  // 標註
  // 柱編號（C1…）不拿來標梁
  const labels = texts
    .map((t) => ({ ...t, ...parseLabel(t.s) }))
    .filter((t) => (t.mark && markType(t.mark) !== 'column') || (!t.mark && t.profile));
  // 標註配對：每個文字先指派給分數最好的一跨（離線近、在跨內而非端部），各跨再取最好的
  const score = (c: Center, t: (typeof labels)[number]): number => {
    const ca = Math.cos(c.angle);
    const sa = Math.sin(c.angle);
    const tt = ca * t.x + sa * t.y;
    const off = Math.abs(-sa * t.x + ca * t.y - c.c);
    const len = Math.max(1, c.t1 - c.t0);
    if (tt < c.t0 - 300 || tt > c.t1 + 300) return Infinity;
    if (off > Math.max(o.labelDist, t.h * 6)) return Infinity;
    const frac = Math.min(Math.abs(tt - c.t0), Math.abs(tt - c.t1)) / len;
    const endPenalty = frac < 0.15 ? 1500 * (1 - frac / 0.15) : 0;
    return off + endPenalty;
  };
  const assigned = new Map<number, { t: (typeof labels)[number]; sc: number }>();
  for (const t of labels) {
    let bi = -1;
    let bs = Infinity;
    spans.forEach((c, i) => {
      const sc = score(c, t);
      if (sc < bs) {
        bs = sc;
        bi = i;
      }
    });
    if (bi < 0) continue;
    const cur = assigned.get(bi);
    if (!cur || bs < cur.sc) assigned.set(bi, { t, sc: bs });
  }
  // 連續梁只標一次：同一中心線上沒標註的跨沿用相鄰跨
  const sameLine = (a: Center, b: Center) => angleDiff(a.angle, b.angle) < (0.5 * Math.PI) / 180 && Math.abs(a.c - b.c) < 20;
  let id = 0;
  const list: MemberCandidate[] = spans.map((c, i) => {
    let best = assigned.get(i)?.t ?? null;
    if (!best) {
      let bd = Infinity;
      spans.forEach((d, j) => {
        const a = assigned.get(j);
        if (!a || !sameLine(c, d)) return;
        const gap = Math.max(d.t0 - c.t1, c.t0 - d.t1, 0);
        if (gap < bd) {
          bd = gap;
          best = a.t;
        }
      });
    }
    const lb = best as (typeof labels)[number] | null;
    const mark = lb?.mark ?? '';
    const profile = lb?.profile ?? (mark ? (schedule.get(mark) ?? '') : '');
    const mt = mark ? markType(mark) : '';
    const type: MemberType = mt === 'girder' || mt === 'beam' || mt === 'brace' || mt === 'purlin' ? mt : onGridLine(c) ? 'girder' : 'beam';
    return {
      id: id++,
      type,
      a: pointOn(c, c.t0),
      b: pointOn(c, c.t1),
      mark,
      profile,
      width: c.width,
      status: profile ? 'ok' : mark ? 'noprofile' : 'nolabel',
      checked: true,
      note: mark ? `圖面編號 ${mark}` : '',
    };
  });
  return { list, mode };
}

/** 柱候選：軸線交點附近有柱圖層的線，或有柱編號文字 */
export function detectColumns(colSegs: Seg[], texts: PlaneText[], grid: GridRef, schedule: Map<string, string>, radius = 700): MemberCandidate[] {
  const labels = texts.map((t) => ({ ...t, ...parseLabel(t.s) }));
  const out: MemberCandidate[] = [];
  let id = 100000;
  for (const n of grid.nodes) {
    const geo = colSegs.some((s) => Math.hypot((s.x1 + s.x2) / 2 - n[0], (s.y1 + s.y2) / 2 - n[1]) <= radius);
    let mark = '';
    let profile = '';
    let md = Infinity;
    for (const t of labels) {
      const d = Math.hypot(t.x - n[0], t.y - n[1]);
      if (d > radius * 2) continue;
      if (t.mark && markType(t.mark) === 'column' && d < md) {
        md = d;
        mark = t.mark;
      }
      if (t.profile && !profile && d <= radius * 1.5) profile = t.profile;
    }
    if (!geo && !mark) continue;
    if (!profile && mark) profile = schedule.get(mark) ?? '';
    out.push({
      id: id++,
      type: 'column',
      a: n,
      b: n,
      mark,
      profile,
      width: 0,
      status: profile ? 'ok' : mark ? 'noprofile' : 'nolabel',
      checked: true,
      note: mark ? `圖面編號 ${mark}` : '',
    });
  }
  return out;
}
