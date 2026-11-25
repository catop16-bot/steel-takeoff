import { gridToWorld, worldToGrid } from '../geom/grid';
import { add, closestT, cross, dist, dot, lerp, norm, round3, scale, sub, type V3 } from '../geom/vec';
import { uid } from './defaults';
import type { Grid, Member } from './types';

export type PointFn = (p: V3) => V3;

/** 套用點變換到構件（起訖點與鋼板頂點）；mirror 時左右對調 */
export function transformMember(m: Member, fn: PointFn, opts: { copy?: boolean; mirror?: boolean } = {}): Member {
  const n: Member = {
    ...m,
    start: round3(fn(m.start)),
    end: round3(fn(m.end)),
    points: m.points?.map((p) => round3(fn(p))),
  };
  if (opts.mirror) {
    n.pos = { ...m.pos, plane: m.pos.plane === 'left' ? 'right' : m.pos.plane === 'right' ? 'left' : 'middle', planeOffset: -m.pos.planeOffset };
    // 鋼板頂點順序反轉以保持法向
    if (n.points) n.points = [...n.points].reverse();
  }
  if (opts.copy) {
    n.id = uid('m');
    n.mark = undefined;
  }
  return n;
}

export const translate =
  (d: V3): PointFn =>
  (p) =>
    add(p, d);

/** 以通過 a、b 且垂直於 normal 平面的鏡射面 */
export function mirrorFn(a: V3, b: V3, planeNormal: V3): PointFn {
  const dir = norm(sub(b, a));
  const n = norm(cross(dir, planeNormal));
  return (p) => {
    const d = dot(sub(p, a), n);
    return sub(p, scale(n, 2 * d));
  };
}

/** 繞通過 c、方向 axis 的軸旋轉 deg 度 */
export function rotateFn(c: V3, axis: V3, deg: number): PointFn {
  const k = norm(axis);
  const a = (deg * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return (p) => {
    const v = sub(p, c);
    const kv = cross(k, v);
    const kd = dot(k, v);
    return add(c, [v[0] * cs + kv[0] * sn + k[0] * kd * (1 - cs), v[1] * cs + kv[1] * sn + k[1] * kd * (1 - cs), v[2] * cs + kv[2] * sn + k[2] * kd * (1 - cs)]);
  };
}

/** 在 p（投影到軸線）處把構件分成兩支 */
export function splitMember(m: Member, p: V3): [Member, Member] | null {
  if (m.points?.length) return null;
  const t = closestT(p, m.start, m.end);
  const L = dist(m.start, m.end);
  if (t * L < 10 || (1 - t) * L < 10) return null;
  const q = round3(lerp(m.start, m.end, t));
  const zero = { dx: 0, dy: 0, dz: 0 };
  const a: Member = { ...m, id: uid('m'), end: q, offEnd: zero, endRef: undefined, mark: undefined };
  const b: Member = { ...m, id: uid('m'), start: q, offStart: zero, startRef: undefined, mark: undefined };
  return [a, b];
}

export interface DupGroup {
  kind: 'same' | 'overlap';
  ids: string[];
  desc: string;
}

/**
 * 重複構件：同類型、同斷面、端點相同（不分方向）＝重複；
 * 同一直線上部分重疊＝重疊。兩者都會造成重複算量。
 */
export function findDuplicates(members: Member[], tol = 5): DupGroup[] {
  const lin = members.filter((m) => !m.points?.length);
  const groups: DupGroup[] = [];
  const key = (p: V3) => p.map((v) => Math.round(v / tol)).join(',');
  const byEnds = new Map<string, Member[]>();
  for (const m of lin) {
    const a = key(m.start);
    const b = key(m.end);
    const k = `${m.type}|${m.profile}|${a < b ? a + '|' + b : b + '|' + a}`;
    let arr = byEnds.get(k);
    if (!arr) byEnds.set(k, (arr = []));
    arr.push(m);
  }
  const inSame = new Set<string>();
  for (const arr of byEnds.values()) {
    if (arr.length < 2) continue;
    groups.push({ kind: 'same', ids: arr.map((m) => m.id), desc: `${arr.length} 支 ${arr[0].profile} 完全重疊` });
    for (const m of arr) inSame.add(m.id);
  }
  // 部分重疊：同類型、共線、範圍重疊超過 50 mm
  const rest = lin.filter((m) => !inSame.has(m.id));
  const bucket = new Map<string, Member[]>();
  for (const m of rest) {
    const d = norm(sub(m.end, m.start));
    const s = d[0] < 0 || (d[0] === 0 && (d[1] < 0 || (d[1] === 0 && d[2] < 0))) ? scale(d, -1) : d;
    const k = `${m.type}|${s.map((v) => Math.round(v * 200)).join(',')}`;
    let arr = bucket.get(k);
    if (!arr) bucket.set(k, (arr = []));
    arr.push(m);
  }
  for (const arr of bucket.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        const d = norm(sub(a.end, a.start));
        // b 的兩端到 a 直線的距離
        const off = (p: V3) => {
          const v = sub(p, a.start);
          return dist(v, scale(d, dot(v, d)));
        };
        if (off(b.start) > tol || off(b.end) > tol) continue;
        const ta = [0, dot(sub(a.end, a.start), d)];
        const tb = [dot(sub(b.start, a.start), d), dot(sub(b.end, a.start), d)].sort((x, y) => x - y);
        const ov = Math.min(ta[1], tb[1]) - Math.max(ta[0], tb[0]);
        if (ov > 50) groups.push({ kind: 'overlap', ids: [a.id, b.id], desc: `${a.profile} 與 ${b.profile} 重疊 ${Math.round(ov)} mm` });
      }
    }
  }
  return groups;
}

/**
 * 磁性軸線：構件端點落在舊軸線上的，跟著同標籤的新軸線移動；
 * 軸線原點、旋轉改變時，落在軸線上的點一起轉換。不在任何軸線上的點不動。
 */
export function magneticGridUpdate(members: Member[], old: Grid, next: Grid, tol = 1): Member[] {
  const moved: Member[] = [];
  const mapPoint = (p: V3): V3 | null => {
    const [u, v] = worldToGrid(old, p);
    const xi = old.xs.find((a) => Math.abs(a.offset - u) <= tol);
    const yi = old.ys.find((a) => Math.abs(a.offset - v) <= tol);
    if (!xi && !yi) return null;
    const nx = xi ? next.xs.find((a) => a.label === xi.label) : undefined;
    const ny = yi ? next.ys.find((a) => a.label === yi.label) : undefined;
    const nu = xi && nx ? nx.offset : u;
    const nv = yi && ny ? ny.offset : v;
    const q = gridToWorld(next, nu, nv, p[2]);
    return dist(q, p) > 0.01 ? round3(q) : null;
  };
  for (const m of members) {
    const s = mapPoint(m.start);
    const e = mapPoint(m.end);
    const pts = m.points?.map((p) => mapPoint(p) ?? p);
    const ptsChanged = m.points?.some((p, i) => pts![i] !== p);
    if (!s && !e && !ptsChanged) continue;
    moved.push({ ...m, start: s ?? m.start, end: e ?? m.end, points: pts });
  }
  return moved;
}
