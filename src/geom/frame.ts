import type { Member, MemberPosition } from '../model/types';
import { add, addScaled, cross, dot, len, norm, sub, type V3 } from './vec';

const ROT_BASE: Record<MemberPosition['rotation'], number> = { top: 0, front: 90, below: 180, back: 270 };

export interface MemberFrame {
  /** 實際起點、終點（含端部偏移） */
  p0: V3;
  p1: V3;
  length: number;
  /** 構件軸向 */
  x: V3;
  /** 斷面寬向、高向（已含旋轉） */
  w: V3;
  u: V3;
  /** 斷面中心相對軸線的偏移（世界座標） */
  offset: V3;
}

/**
 * 參考「上」方向：一般構件取全域 Z 在垂直軸向平面上的投影；
 * 接近垂直的構件（柱）取全域 X，使斷面高度方向（H 型鋼腹板）沿 X。
 */
export function referenceUp(x: V3): V3 {
  if (Math.abs(x[2]) < 0.995) {
    const z: V3 = [0, 0, 1];
    return norm(sub(z, [x[0] * x[2], x[1] * x[2], x[2] * x[2]]));
  }
  const gx: V3 = [1, 0, 0];
  const d = dot(gx, x);
  return norm(addScaled(gx, x, -d));
}

function axes(a: V3, b: V3): { x: V3; u: V3; w: V3 } | null {
  const d = sub(b, a);
  if (len(d) < 1e-6) return null;
  const x = norm(d);
  const u = referenceUp(x);
  const w = norm(cross(u, x));
  return { x, u, w };
}

/**
 * 計算構件局部座標。sectionW／sectionH 為斷面外形包絡寬、高（mm），
 * 用於「平面上 左／右」「深度 前／後」的對齊。
 */
export function memberFrame(m: Pick<Member, 'start' | 'end' | 'pos' | 'offStart' | 'offEnd'>, sectionW: number, sectionH: number): MemberFrame | null {
  const base = axes(m.start, m.end);
  if (!base) return null;
  // 端部偏移以原始局部座標套用
  const p0 = add(add(addScaled(m.start, base.x, m.offStart.dx), scaleV(base.w, m.offStart.dy)), scaleV(base.u, m.offStart.dz));
  const p1 = add(add(addScaled(m.end, base.x, m.offEnd.dx), scaleV(base.w, m.offEnd.dy)), scaleV(base.u, m.offEnd.dz));
  const ax = axes(p0, p1);
  if (!ax) return null;
  const length = len(sub(p1, p0));
  const th = ((ROT_BASE[m.pos.rotation] + (m.pos.rotationAngle || 0)) * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const w = norm(add(scaleV(ax.w, c), scaleV(ax.u, s)));
  const u = norm(add(scaleV(ax.w, -s), scaleV(ax.u, c)));
  // 旋轉後斷面在原 w／u 方向的半包絡
  const ew = (Math.abs(c) * sectionW + Math.abs(s) * sectionH) / 2;
  const eu = (Math.abs(s) * sectionW + Math.abs(c) * sectionH) / 2;
  const ow = (m.pos.plane === 'left' ? ew : m.pos.plane === 'right' ? -ew : 0) + (m.pos.planeOffset || 0);
  const ou = (m.pos.depth === 'front' ? eu : m.pos.depth === 'behind' ? -eu : 0) + (m.pos.depthOffset || 0);
  const offset = add(scaleV(ax.w, ow), scaleV(ax.u, ou));
  return { p0, p1, length, x: ax.x, w, u, offset };
}

function scaleV(a: V3, s: number): V3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** 構件實際長度（含端部偏移），mm */
export function memberLength(m: Pick<Member, 'start' | 'end' | 'offStart' | 'offEnd'>): number {
  const base = axes(m.start, m.end);
  if (!base) return 0;
  const p0 = add(add(addScaled(m.start, base.x, m.offStart.dx), scaleV(base.w, m.offStart.dy)), scaleV(base.u, m.offStart.dz));
  const p1 = add(add(addScaled(m.end, base.x, m.offEnd.dx), scaleV(base.w, m.offEnd.dy)), scaleV(base.u, m.offEnd.dz));
  return len(sub(p1, p0));
}
