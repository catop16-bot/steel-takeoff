import { ui } from '../app/ui';
import { segIntersect } from '../drawing/snapIndex';
import { levelAt } from '../geom/grid';
import { addScaled, dot, lerp, sub, type V3 } from '../geom/vec';
import { store } from '../model/store';
import type { DrawingItem } from '../view3d/drawings';
import type { Pane, Viewer } from '../view3d/viewer';

export type SnapKind = 'end' | 'mid' | 'grid' | 'int' | 'cen' | 'line' | 'free';

export interface Snap {
  p: V3;
  kind: SnapKind;
  /** 螢幕位置 */
  sx: number;
  sy: number;
  /** 鎖到圖紙時：圖紙 id 與局部座標 */
  drawingId?: string;
  local?: [number, number];
}

export interface SnapOpts {
  prev?: V3;
  /** 只鎖模型（軸線、構件）或只鎖圖紙 */
  only?: 'model' | 'drawing';
}

export const SNAP_LABEL: Record<SnapKind, string> = {
  end: '端點',
  mid: '中點',
  grid: '軸線交點',
  int: '交點',
  cen: '圓心',
  line: '線上',
  free: '自由點',
};

const R_POINT = 13;
const R_LINE = 8;
const RANK: Record<SnapKind, number> = { end: 0, int: 1, grid: 1, cen: 2, mid: 3, line: 4, free: 5 };

/**
 * 找游標附近的鎖點。
 * 平面、立面視圖的鎖點一律投影到工作平面上（同 Tekla 鎖點深度「平面」），
 * 避免在 2FL 平面點到下層柱底而得到 Z=0 的點。
 */
export function findSnap(viewer: Viewer, pane: Pane, px: number, py: number, opts: SnapOpts = {}): Snap | null {
  const s = rawSnap(viewer, pane, px, py, opts);
  const vs = pane.vs;
  if (!s || !vs || vs.is3d) return s;
  const { origin, normal } = vs.plane;
  return { ...s, p: addScaled(s.p, normal, -dot(sub(s.p, origin), normal)) };
}

function rawSnap(viewer: Viewer, pane: Pane, px: number, py: number, opts: SnapOpts): Snap | null {
  const vs = pane.vs;
  if (!vs) return null;
  const st = ui.snaps.peek();
  const useModel = opts.only !== 'drawing';
  const useDrawing = opts.only !== 'model' && (st.drawing || opts.only === 'drawing');
  let best = null as Snap | null;
  let bestD = R_POINT;
  const consider = (p: V3, kind: SnapKind, extra?: Partial<Snap>) => {
    const s = vs.project(p);
    if (s[2] > 1) return;
    const d = Math.hypot(s[0] - px, s[1] - py);
    if (d < bestD - 0.5 || (best && Math.abs(d - bestD) <= 0.5 && RANK[kind] < RANK[best.kind])) {
      bestD = d;
      best = { p, kind, sx: s[0], sy: s[1], ...extra };
    }
  };
  const ov = pane.overlay;
  const geoms = viewer.members.geoms;
  if (useModel) {
    if (st.grid && ov) for (const n of ov.nodes) consider(n, 'grid');
    if (st.end || st.mid) {
      for (const g of geoms.values()) {
        if (!viewer.segmentInDepth(vs, g)) continue;
        if (g.plate) {
          for (let i = 0; i < g.plate.length; i++) {
            if (st.end) consider(g.plate[i], 'end');
            if (st.mid) consider(lerp(g.plate[i], g.plate[(i + 1) % g.plate.length], 0.5), 'mid');
          }
          continue;
        }
        if (st.end) {
          consider(g.start, 'end');
          consider(g.end, 'end');
        }
        if (st.mid) consider(lerp(g.start, g.end, 0.5), 'mid');
      }
    }
  }

  // 圖紙：端點、中點、圓心、交點
  const dq: { it: DrawingItem; segs: [number, number, number, number][] }[] = [];
  if (useDrawing) {
    const ray = vs.ray(px, py);
    const wpp = vs.worldPerPixel();
    for (const it of viewer.drawings.snappable(vs)) {
      const f = it.frame!;
      const hit = vs.rayPlane(ray, { origin: f.origin, normal: f.normal, right: f.right, up: f.up });
      if (!hit) continue;
      const [lx, ly] = viewer.drawings.toLocal(it, hit);
      const r = (R_POINT * wpp) / it.ref.scale;
      const q = viewer.drawings.snapIndex(it).query(lx, ly, r);
      const extra = (x: number, y: number): Partial<Snap> => ({ drawingId: it.ref.id, local: [x, y] });
      for (const pt of q.points) {
        if (pt.kind === 'end' && !st.end) continue;
        if (pt.kind === 'mid' && !st.mid) continue;
        consider(viewer.drawings.toWorld(it, pt.x, pt.y), pt.kind, extra(pt.x, pt.y));
      }
      if (st.end) {
        const segs = q.segs.slice(0, 120);
        for (let i = 0; i < segs.length; i++) {
          for (let j = i + 1; j < segs.length; j++) {
            const x = segIntersect(segs[i], segs[j]);
            if (x && Math.abs(x[0] - lx) <= r && Math.abs(x[1] - ly) <= r) consider(viewer.drawings.toWorld(it, x[0], x[1]), 'int', extra(x[0], x[1]));
          }
        }
      }
      dq.push({ it, segs: q.segs });
    }
  }
  if (best) return best;

  if (st.line) {
    let lineBest = null as Snap | null;
    let ld = R_LINE;
    const seg = (a: V3, b: V3, extra?: (t: number) => Partial<Snap>) => {
      const pa = vs.project(a);
      const pb = vs.project(b);
      if (pa[2] > 1 || pb[2] > 1) return;
      const dx = pb[0] - pa[0];
      const dy = pb[1] - pa[1];
      const l2 = dx * dx + dy * dy;
      if (l2 < 1) return;
      const t = Math.max(0, Math.min(1, ((px - pa[0]) * dx + (py - pa[1]) * dy) / l2));
      const sx = pa[0] + dx * t;
      const sy = pa[1] + dy * t;
      const d = Math.hypot(px - sx, py - sy);
      if (d < ld) {
        ld = d;
        lineBest = { p: lerp(a, b, t), kind: 'line', sx, sy, ...extra?.(t) };
      }
    };
    if (useModel) {
      if (ov) for (const l of ov.lines) seg(l.a, l.b);
      for (const g of geoms.values()) {
        if (!viewer.segmentInDepth(vs, g)) continue;
        if (g.plate) for (let i = 0; i < g.plate.length; i++) seg(g.plate[i], g.plate[(i + 1) % g.plate.length]);
        else seg(g.start, g.end);
      }
    }
    for (const { it, segs } of dq) {
      for (const s of segs) {
        seg(viewer.drawings.toWorld(it, s[0], s[1]), viewer.drawings.toWorld(it, s[2], s[3]), (t) => ({
          drawingId: it.ref.id,
          local: [s[0] + (s[2] - s[0]) * t, s[1] + (s[3] - s[1]) * t],
        }));
      }
    }
    if (lineBest) return applyOrtho(vs.plane, lineBest, opts.prev, vs.is3d);
  }

  if (!st.free || opts.only === 'drawing') return null;
  const p = vs.rayPlane(vs.ray(px, py));
  if (!p) return null;
  return applyOrtho(vs.plane, { p, kind: 'free', sx: px, sy: py }, opts.prev, vs.is3d);
}

function applyOrtho(plane: { right: V3; up: V3; normal: V3 }, s: Snap, prev: V3 | undefined, is3d: boolean): Snap {
  if (!ui.ortho.peek() || !prev) return s;
  const d = sub(s.p, prev);
  const axes = [plane.right, plane.up];
  if (is3d) axes.push([0, 0, 1]);
  let bestAx = axes[0];
  let bestV = -1;
  for (const a of axes) {
    const v = Math.abs(dot(d, a));
    if (v > bestV) {
      bestV = v;
      bestAx = a;
    }
  }
  return { ...s, p: addScaled(prev, bestAx, dot(d, bestAx)), drawingId: undefined, local: undefined };
}

/** 點所在樓層 id（z 與某樓層高程相同時） */
export function levelIdAt(z: number): string | undefined {
  return levelAt(store.p.levels, z, 1)?.id;
}
