import type { ProfileDims, ProfileKind } from './types';

/** 一個圓角內轉角在周長上的折減量（尖角兩邊 2r 換成 1/4 圓弧） */
const FILLET = 2 - Math.PI / 2;
/** 冷軋彎角（內半徑 t、中心線半徑 1.5t）在中心線長度上的折減 */
const BEND_CL = FILLET * 1.5;

/** 依 JIS G 3192／3444／3466／3350 的公式計算斷面積（mm²） */
export function sectionArea(kind: ProfileKind, d: ProfileDims): number {
  const { h, b } = d;
  const tw = d.tw ?? 0;
  const tf = d.tf ?? 0;
  const t = d.t ?? 0;
  const c = d.c ?? 0;
  const r1 = d.r1 ?? 0;
  const r2 = d.r2 ?? 0;
  switch (kind) {
    case 'H':
      return tw * (h - 2 * tf) + 2 * b * tf + 0.858 * r1 * r1;
    case 'I':
      return tw * h + 2 * tf * (b - tw) + 0.615 * (r1 * r1 - r2 * r2);
    case 'C':
      return tw * h + 2 * tf * (b - tw) + 0.349 * (r1 * r1 - r2 * r2);
    case 'L':
      return t * (h + b - t) + 0.215 * (r1 * r1 - 2 * r2 * r2);
    case 'T':
      return tw * (h - tf) + b * tf + 0.429 * r1 * r1;
    case 'BOX': {
      // 外角半徑 2t、內角半徑 t
      const ro = 2 * t;
      const ri = t;
      return 2 * t * (h + b - 2 * t) - (4 - Math.PI) * (ro * ro - ri * ri);
    }
    case 'WBOX':
      return h * b - (h - 2 * tf) * (b - 2 * tw);
    case 'PIPE':
      return Math.PI * t * (h - t);
    case 'LC':
    case 'Z':
      return t * (h + 2 * b + 2 * c - 4 * t) - 4 * BEND_CL * t * t;
    case 'LCH':
      return t * (h + 2 * b - 2 * t) - 2 * BEND_CL * t * t;
    case 'PL':
    case 'FB':
      return h * b;
    case 'RB':
      return (Math.PI * h * h) / 4;
  }
}

/** 外露周長（mm），用於塗裝面積 */
export function sectionPerimeter(kind: ProfileKind, d: ProfileDims): number {
  const { h, b } = d;
  const tw = d.tw ?? 0;
  const t = d.t ?? 0;
  const c = d.c ?? 0;
  const r1 = d.r1 ?? 0;
  switch (kind) {
    case 'H':
    case 'I':
      return 2 * h + 4 * b - 2 * tw - 4 * FILLET * r1;
    case 'C':
      return 2 * h + 4 * b - 2 * tw - 2 * FILLET * r1;
    case 'L':
      return 2 * h + 2 * b - FILLET * r1;
    case 'T':
      return 2 * h + 2 * b - 2 * FILLET * r1;
    case 'BOX':
      return 2 * (h + b) - 4 * FILLET * 2 * t;
    case 'WBOX':
      return 2 * (h + b);
    case 'PIPE':
    case 'RB':
      return Math.PI * h;
    case 'LC':
    case 'Z':
      return 2 * (h + 2 * b + 2 * c - 4 * t - 4 * BEND_CL * t) + 2 * t;
    case 'LCH':
      return 2 * (h + 2 * b - 2 * t - 2 * BEND_CL * t) + 2 * t;
    case 'PL':
    case 'FB':
      return 2 * (h + b);
  }
}

/** 外形包絡（寬 x、高 y） */
export function sectionExtent(kind: ProfileKind, d: ProfileDims): { width: number; height: number } {
  if (kind === 'Z') return { width: 2 * d.b - (d.t ?? 0), height: d.h };
  return { width: d.b, height: d.h };
}

export type Pt = [number, number];
export interface Outline {
  outer: Pt[];
  holes: Pt[][];
}

/** 在多邊形的指定頂點加圓角（凸角、凹角皆可） */
function rounded(points: Pt[], radii: number[], seg = 4): Pt[] {
  const out: Pt[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const r = radii[i] ?? 0;
    const p = points[i];
    if (!(r > 0)) {
      out.push(p);
      continue;
    }
    const a = points[(i - 1 + n) % n];
    const bpt = points[(i + 1) % n];
    let d1x = a[0] - p[0];
    let d1y = a[1] - p[1];
    let d2x = bpt[0] - p[0];
    let d2y = bpt[1] - p[1];
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    d1x /= l1;
    d1y /= l1;
    d2x /= l2;
    d2y /= l2;
    const cos = Math.max(-1, Math.min(1, d1x * d2x + d1y * d2y));
    const theta = Math.acos(cos);
    if (theta < 1e-6 || Math.PI - theta < 1e-6) {
      out.push(p);
      continue;
    }
    const tLen = Math.min(r / Math.tan(theta / 2), l1 * 0.5, l2 * 0.5);
    const rr = tLen * Math.tan(theta / 2);
    const t1: Pt = [p[0] + d1x * tLen, p[1] + d1y * tLen];
    const t2: Pt = [p[0] + d2x * tLen, p[1] + d2y * tLen];
    let bx = d1x + d2x;
    let by = d1y + d2y;
    const bl = Math.hypot(bx, by);
    bx /= bl;
    by /= bl;
    const dist = rr / Math.sin(theta / 2);
    const cx = p[0] + bx * dist;
    const cy = p[1] + by * dist;
    const a1 = Math.atan2(t1[1] - cy, t1[0] - cx);
    const a2 = Math.atan2(t2[1] - cy, t2[0] - cx);
    let da = a2 - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= seg; k++) {
      const ang = a1 + (da * k) / seg;
      out.push([cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)]);
    }
  }
  return out;
}

function rect(w: number, h: number, r = 0, seg = 3): Pt[] {
  const p: Pt[] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  return r > 0 ? rounded(p, [r, r, r, r], seg) : p;
}

function circle(r: number, n = 24): Pt[] {
  const p: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return p;
}

/** 斷面外形（以包絡中心為原點，外圈逆時針、孔順時針） */
export function sectionOutline(kind: ProfileKind, d: ProfileDims): Outline {
  const { h, b } = d;
  const tw = d.tw ?? 0;
  const tf = d.tf ?? 0;
  const t = d.t ?? 0;
  const c = d.c ?? 0;
  const r1 = d.r1 ?? 0;
  const X = b / 2;
  const Y = h / 2;
  switch (kind) {
    case 'H':
    case 'I': {
      const p: Pt[] = [
        [-X, -Y],
        [X, -Y],
        [X, -Y + tf],
        [tw / 2, -Y + tf],
        [tw / 2, Y - tf],
        [X, Y - tf],
        [X, Y],
        [-X, Y],
        [-X, Y - tf],
        [-tw / 2, Y - tf],
        [-tw / 2, -Y + tf],
        [-X, -Y + tf],
      ];
      return { outer: rounded(p, [0, 0, 0, r1, r1, 0, 0, 0, 0, r1, r1, 0]), holes: [] };
    }
    case 'C': {
      const p: Pt[] = [
        [-X, -Y],
        [X, -Y],
        [X, -Y + tf],
        [-X + tw, -Y + tf],
        [-X + tw, Y - tf],
        [X, Y - tf],
        [X, Y],
        [-X, Y],
      ];
      return { outer: rounded(p, [0, 0, 0, r1, r1, 0, 0, 0]), holes: [] };
    }
    case 'L': {
      const p: Pt[] = [
        [-X, -Y],
        [X, -Y],
        [X, -Y + t],
        [-X + t, -Y + t],
        [-X + t, Y],
        [-X, Y],
      ];
      return { outer: rounded(p, [0, 0, 0, r1, 0, 0]), holes: [] };
    }
    case 'T': {
      const p: Pt[] = [
        [-tw / 2, -Y],
        [tw / 2, -Y],
        [tw / 2, Y - tf],
        [X, Y - tf],
        [X, Y],
        [-X, Y],
        [-X, Y - tf],
        [-tw / 2, Y - tf],
      ];
      return { outer: rounded(p, [0, 0, r1, 0, 0, 0, 0, r1]), holes: [] };
    }
    case 'BOX':
      return { outer: rect(b, h, 2 * t), holes: [rect(b - 2 * t, h - 2 * t, t).reverse()] };
    case 'WBOX':
      return { outer: rect(b, h), holes: [rect(b - 2 * tw, h - 2 * tf).reverse()] };
    case 'PIPE':
      return { outer: circle(h / 2), holes: [circle(h / 2 - t).reverse()] };
    case 'RB':
      return { outer: circle(h / 2), holes: [] };
    case 'LC': {
      const p: Pt[] = [
        [-X, -Y],
        [X, -Y],
        [X, -Y + c],
        [X - t, -Y + c],
        [X - t, -Y + t],
        [-X + t, -Y + t],
        [-X + t, Y - t],
        [X - t, Y - t],
        [X - t, Y - c],
        [X, Y - c],
        [X, Y],
        [-X, Y],
      ];
      return { outer: p, holes: [] };
    }
    case 'LCH': {
      const p: Pt[] = [
        [-X, -Y],
        [X, -Y],
        [X, -Y + t],
        [-X + t, -Y + t],
        [-X + t, Y - t],
        [X, Y - t],
        [X, Y],
        [-X, Y],
      ];
      return { outer: p, holes: [] };
    }
    case 'Z': {
      const ht = t / 2;
      const p: Pt[] = [
        [-b + ht, -Y],
        [ht, -Y],
        [ht, Y - t],
        [b - 3 * ht, Y - t],
        [b - 3 * ht, Y - c],
        [b - ht, Y - c],
        [b - ht, Y],
        [-ht, Y],
        [-ht, -Y + t],
        [-b + 3 * ht, -Y + t],
        [-b + 3 * ht, -Y + c],
        [-b + ht, -Y + c],
      ];
      return { outer: p, holes: [] };
    }
    case 'PL':
    case 'FB':
      return { outer: rect(b, h), holes: [] };
  }
}

/** 多邊形面積（鞋帶公式，取絕對值） */
export function polygonArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function polygonPerimeter(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += Math.hypot(x2 - x1, y2 - y1);
  }
  return s;
}
