import { aciColor, insunitsToMm, rgbHex, visibleOnLight } from './text';
import type { Drawing2D, DrawLayer, DrawText, P2, RawDoc, RawEntity } from './types';

/** 2D 仿射矩陣：x' = a x + c y + e、y' = b x + d y + f */
type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];

function mul(m: M, n: M): M {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
const tr = (x: number, y: number): M => [1, 0, 0, 1, x, y];
const rotD = (deg: number): M => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, -s, c, 0, 0];
};
const sc = (x: number, y: number): M => [x, 0, 0, y, 0, 0];

const MAX_SEGMENTS = 4_000_000;
const MAX_DEPTH = 12;

interface Out {
  segs: number[][];
  texts: DrawText[];
  circles: number[];
  layerIndex: Map<string, number>;
  layers: DrawLayer[];
  count: number;
  truncated: boolean;
}

function layerOf(o: Out, name: string): number {
  let i = o.layerIndex.get(name);
  if (i === undefined) {
    i = o.layers.length;
    o.layerIndex.set(name, i);
    o.layers.push({ name, color: '#2b2f33', linetype: 'CONTINUOUS', off: false });
    o.segs.push([]);
  }
  return i;
}

/** 依 AutoCAD 規則：圖塊內位於 0 層的物件沿用插入點的圖層 */
function effLayer(e: RawEntity, parent: string | null): string {
  return parent !== null && e.layer === '0' ? parent : e.layer;
}

function apply(m: M, x: number, y: number): P2 {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function polyline(o: Out, m: M, layer: number, pts: P2[], closed: boolean) {
  const arr = o.segs[layer];
  const n = pts.length;
  if (n < 2) return;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    if (o.count >= MAX_SEGMENTS) {
      o.truncated = true;
      return;
    }
    const a = apply(m, pts[i][0], pts[i][1]);
    const b = apply(m, pts[(i + 1) % n][0], pts[(i + 1) % n][1]);
    arr.push(a[0], a[1], b[0], b[1]);
    o.count++;
  }
}

function arcPoints(cx: number, cy: number, r: number, a0: number, sweep: number): P2[] {
  const n = Math.max(4, Math.min(256, Math.ceil(Math.abs(sweep) / (Math.PI / 24))));
  const pts: P2[] = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + (sweep * k) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** 多段線凸度展開成點 */
function bulgePoints(v: { x: number; y: number; b: number }[], closed: boolean): P2[] {
  const out: P2[] = [];
  const n = v.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p = v[i];
    const q = v[(i + 1) % n];
    if (!out.length) out.push([p.x, p.y]);
    if (Math.abs(p.b) > 1e-9) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const c = Math.hypot(dx, dy);
      if (c > 1e-12) {
        const theta = 4 * Math.atan(p.b);
        const h = c / 2 / Math.tan(theta / 2);
        const cx = (p.x + q.x) / 2 - (dy / c) * h;
        const cy = (p.y + q.y) / 2 + (dx / c) * h;
        const r = Math.hypot(p.x - cx, p.y - cy);
        const a0 = Math.atan2(p.y - cy, p.x - cx);
        const pts = arcPoints(cx, cy, r, a0, theta);
        out.push(...pts.slice(1, -1));
      }
    }
    out.push([q.x, q.y]);
  }
  if (closed && out.length > 1) out.pop();
  return out;
}

/** 有理 B 雲形線（de Boor） */
function splinePoints(e: RawEntity): P2[] {
  const ctrl = e.ctrl ?? [];
  const p = e.degree ?? 3;
  const k = e.knots ?? [];
  if (ctrl.length < 2 || k.length !== ctrl.length + p + 1) return e.fit && e.fit.length >= 2 ? e.fit : ctrl;
  const w = e.weights && e.weights.length === ctrl.length ? e.weights : ctrl.map(() => 1);
  const t0 = k[p];
  const t1 = k[ctrl.length];
  const n = Math.min(400, Math.max(24, ctrl.length * 8));
  const out: P2[] = [];
  for (let s = 0; s <= n; s++) {
    const t = s === n ? t1 - 1e-9 * Math.max(1, Math.abs(t1)) : t0 + ((t1 - t0) * s) / n;
    let span = p;
    while (span < ctrl.length - 1 && t >= k[span + 1]) span++;
    const d: [number, number, number][] = [];
    for (let j = 0; j <= p; j++) {
      const c = ctrl[span - p + j];
      const ww = w[span - p + j];
      d.push([c[0] * ww, c[1] * ww, ww]);
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = span - p + j;
        const den = k[i + p - r + 1] - k[i];
        const a = den > 1e-12 ? (t - k[i]) / den : 0;
        d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
      }
    }
    const h = d[p];
    out.push([h[0] / h[2], h[1] / h[2]]);
  }
  return out;
}

function emitText(o: Out, m: M, layer: number, s: string, x: number, y: number, h: number, rot: number, ha: number, va: number, wf: number) {
  if (!s.trim() || !(h > 0)) return;
  const [px, py] = apply(m, x, y);
  const r = (rot * Math.PI) / 180;
  const dir = [m[0] * Math.cos(r) + m[2] * Math.sin(r), m[1] * Math.cos(r) + m[3] * Math.sin(r)];
  const up = [m[0] * -Math.sin(r) + m[2] * Math.cos(r), m[1] * -Math.sin(r) + m[3] * Math.cos(r)];
  const lx = Math.hypot(dir[0], dir[1]);
  const ly = Math.hypot(up[0], up[1]);
  o.texts.push({
    s,
    x: px,
    y: py,
    h: h * ly,
    rot: (Math.atan2(dir[1], dir[0]) * 180) / Math.PI,
    ha: Math.max(0, Math.min(2, ha)) as 0 | 1 | 2,
    va: Math.max(0, Math.min(3, va)) as 0 | 1 | 2 | 3,
    wf: (wf || 1) * (ly > 0 ? lx / ly : 1),
    layer,
  });
}

function text(o: Out, m: M, layer: number, e: RawEntity) {
  const s = e.text ?? '';
  const h = e.h ?? 1;
  if (e.mtext) {
    const a = e.attach ?? 1;
    const ha = (a - 1) % 3;
    const row = Math.floor((a - 1) / 3);
    const rot = e.dir ? (Math.atan2(e.dir[1], e.dir[0]) * 180) / Math.PI : (e.rot ?? 0);
    const lines = s.split('\n');
    const L = (h * 5) / 3;
    const r = (rot * Math.PI) / 180;
    const down: P2 = [Math.sin(r), -Math.cos(r)];
    const n = lines.length;
    const shift = row === 0 ? 0 : row === 1 ? ((n - 1) * L) / 2 : (n - 1) * L;
    const va = row === 0 ? 3 : row === 1 ? 2 : 1;
    lines.forEach((line, i) => {
      const d = i * L - shift;
      emitText(o, m, layer, line, e.p![0] + down[0] * d, e.p![1] + down[1] * d, h, rot, ha, va, 1);
    });
    return;
  }
  const ha = e.ha ?? 0;
  const va = e.va ?? 0;
  let p = e.p!;
  let rot = e.rot ?? 0;
  let hh = ha;
  let vv = va;
  if (ha === 0 && va === 0) {
    /* 左下基線 */
  } else if (ha === 3 || ha === 5) {
    if (e.p2) rot = (Math.atan2(e.p2[1] - p[1], e.p2[0] - p[0]) * 180) / Math.PI;
    hh = 0;
    vv = 0;
  } else if (ha === 4) {
    p = e.p2 ?? p;
    hh = 1;
    vv = 2;
  } else {
    p = e.p2 ?? p;
  }
  emitText(o, m, layer, s, p[0], p[1], h, rot, hh, vv, e.wf ?? 1);
}

function walk(o: Out, doc: RawDoc, ents: RawEntity[], m: M, parentLayer: string | null, depth: number, stack: Set<string>) {
  for (const e of ents) {
    if (o.truncated) return;
    if (e.invisible) continue;
    const lname = effLayer(e, parentLayer);
    const li = layerOf(o, lname);
    // OCS 擠出方向為 −Z 時 X 鏡射
    const mm = e.extZ !== undefined && e.extZ < 0 ? mul(m, sc(-1, 1)) : m;
    switch (e.type) {
      case 'LINE':
        polyline(o, mm, li, [e.p!, e.p2!], false);
        break;
      case 'POLY':
        polyline(o, mm, li, bulgePoints(e.pts ?? [], !!e.closed), !!e.closed);
        break;
      case 'CIRCLE': {
        const r = e.r ?? 0;
        if (!(r > 0)) break;
        polyline(o, mm, li, arcPoints(e.p![0], e.p![1], r, 0, Math.PI * 2).slice(0, -1), true);
        const c = apply(mm, e.p![0], e.p![1]);
        const rr = r * Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2]));
        o.circles.push(c[0], c[1], rr, li);
        break;
      }
      case 'ARC': {
        const r = e.r ?? 0;
        if (!(r > 0)) break;
        const a0 = ((e.a0 ?? 0) * Math.PI) / 180;
        let a1 = ((e.a1 ?? 360) * Math.PI) / 180;
        while (a1 <= a0) a1 += Math.PI * 2;
        polyline(o, mm, li, arcPoints(e.p![0], e.p![1], r, a0, a1 - a0), false);
        break;
      }
      case 'ELLIPSE': {
        const [cx, cy] = e.p!;
        const [mx, my] = e.major!;
        const ratio = e.ratio ?? 1;
        let t0 = e.t0 ?? 0;
        let t1 = e.t1 ?? Math.PI * 2;
        while (t1 <= t0) t1 += Math.PI * 2;
        const n = Math.max(8, Math.ceil(((t1 - t0) / (Math.PI * 2)) * 64));
        const pts: P2[] = [];
        for (let k = 0; k <= n; k++) {
          const t = t0 + ((t1 - t0) * k) / n;
          pts.push([cx + mx * Math.cos(t) - my * ratio * Math.sin(t), cy + my * Math.cos(t) + mx * ratio * Math.sin(t)]);
        }
        polyline(o, mm, li, pts, false);
        break;
      }
      case 'SPLINE':
        polyline(o, mm, li, splinePoints(e), !!e.closed);
        break;
      case 'QUAD':
        polyline(o, mm, li, e.closed ? [e.p!, e.p2!, e.p3!, e.p4!] : [e.p!, e.p2!, e.p4!, e.p3!], true);
        break;
      case 'TEXT':
      case 'ATTRIB':
        text(o, mm, li, e);
        break;
      case 'DIMENSION': {
        const b = e.name ? doc.blocks.get(e.name) : undefined;
        if (b && depth < MAX_DEPTH && !stack.has(b.name)) {
          stack.add(b.name);
          walk(o, doc, b.entities, mul(m, tr(-b.base[0], -b.base[1])), lname, depth + 1, stack);
          stack.delete(b.name);
        } else if (e.text && e.text !== '<>' && e.p) emitText(o, m, li, e.text, e.p[0], e.p[1], 2.5, 0, 1, 2, 1);
        break;
      }
      case 'INSERT': {
        const b = doc.blocks.get(e.name ?? '');
        if (b && depth < MAX_DEPTH && !stack.has(b.name)) {
          stack.add(b.name);
          const cols = Math.min(e.cols ?? 1, 500);
          const rows = Math.min(e.rows ?? 1, 500);
          for (let ci = 0; ci < cols; ci++) {
            for (let ri = 0; ri < rows; ri++) {
              const bm = mul(mm, mul(tr(e.p![0], e.p![1]), mul(rotD(e.rot ?? 0), mul(tr(ci * (e.cs ?? 0), ri * (e.rs ?? 0)), mul(sc(e.sx ?? 1, e.sy ?? 1), tr(-b.base[0], -b.base[1]))))));
              walk(o, doc, b.entities, bm, lname, depth + 1, stack);
            }
          }
          stack.delete(b.name);
        }
        // 屬性文字在插入點所在座標系
        for (const a of e.attribs ?? []) if (!a.invisible) text(o, m, layerOf(o, effLayer(a, parentLayer)), a);
        break;
      }
    }
  }
}

/** 中間格式 → 圖紙（座標以外框中心為 base，存成 Float32） */
export function flatten(doc: RawDoc, format: Drawing2D['format'], skipped: Record<string, number>): Drawing2D {
  const o: Out = { segs: [], texts: [], circles: [], layerIndex: new Map(), layers: [], count: 0, truncated: false };
  for (const l of doc.layers) {
    const i = o.layers.length;
    o.layerIndex.set(l.name, i);
    const color = visibleOnLight(l.rgb !== undefined ? rgbHex(l.rgb) : aciColor(l.aci));
    o.layers.push({ name: l.name, color, linetype: l.linetype, off: l.off || l.frozen });
    o.segs.push([]);
  }
  walk(o, doc, doc.entities, I, null, 0, new Set());

  const u = insunitsToMm(doc.insunits);
  if (o.truncated) skipped['（線段過多，已截斷）'] = 1;
  return buildDrawing({
    format,
    layers: o.layers,
    segs: o.segs,
    texts: o.texts,
    circles: o.circles,
    unitScale: u.scale,
    unitsKnown: u.known,
    unitName: u.name,
    encoding: doc.encoding,
    entities: doc.entities.length,
    skipped,
  });
}

/** 以外框中心為 base，把世界座標轉成 Float32 局部座標 */
export function buildDrawing(a: {
  format: Drawing2D['format'];
  layers: DrawLayer[];
  segs: number[][];
  texts: DrawText[];
  circles: number[];
  unitScale: number;
  unitsKnown: boolean;
  unitName: string;
  encoding: string;
  entities: number;
  skipped: Record<string, number>;
  extraBounds?: [number, number, number, number];
}): Drawing2D {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  let count = 0;
  for (const arr of a.segs) {
    count += arr.length / 4;
    for (let i = 0; i < arr.length; i += 2) grow(arr[i], arr[i + 1]);
  }
  for (const t of a.texts) grow(t.x, t.y);
  if (a.extraBounds) {
    grow(a.extraBounds[0], a.extraBounds[1]);
    grow(a.extraBounds[2], a.extraBounds[3]);
  }
  if (!Number.isFinite(minX)) {
    minX = minY = 0;
    maxX = maxY = 1;
  }
  const base: [number, number] = [Math.round((minX + maxX) / 2), Math.round((minY + maxY) / 2)];
  const segs = a.segs.map((arr) => {
    const f = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i += 2) {
      f[i] = arr[i] - base[0];
      f[i + 1] = arr[i + 1] - base[1];
    }
    return f;
  });
  for (const t of a.texts) {
    t.x -= base[0];
    t.y -= base[1];
  }
  const circles = new Float32Array(a.circles.length);
  for (let i = 0; i < a.circles.length; i += 4) {
    circles[i] = a.circles[i] - base[0];
    circles[i + 1] = a.circles[i + 1] - base[1];
    circles[i + 2] = a.circles[i + 2];
    circles[i + 3] = a.circles[i + 3];
  }
  return {
    version: 1,
    format: a.format,
    unitScale: a.unitScale,
    unitsKnown: a.unitsKnown,
    unitName: a.unitName,
    base,
    bounds: [minX - base[0], minY - base[1], maxX - base[0], maxY - base[1]],
    layers: a.layers,
    segs,
    texts: a.texts,
    circles,
    encoding: a.encoding,
    stats: { entities: a.entities, segments: count, texts: a.texts.length, skipped: a.skipped },
  };
}
