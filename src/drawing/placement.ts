import * as THREE from 'three';
import { gridToWorld } from '../geom/grid';
import { add, cross, dot, norm, scale, sub, type V3 } from '../geom/vec';
import type { DrawingRef, DrawingTarget, Project } from '../model/types';

export interface PlaneFrame {
  origin: V3;
  right: V3;
  up: V3;
  normal: V3;
}

/**
 * 圖紙目標平面：
 * - 平面：原點 (0,0,樓層高程)，右 = 世界 X、上 = 世界 Y
 * - 立面：與立面視圖同方向；水平座標 = 沿軸線的格線座標、垂直 = 高程
 */
export function targetFrame(t: DrawingTarget, p: Pick<Project, 'grids' | 'levels'>): PlaneFrame | null {
  if (t.kind === 'plan') {
    const l = p.levels.find((x) => x.id === t.levelId);
    if (!l) return null;
    return { origin: [0, 0, l.elevation], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1] };
  }
  const g = p.grids.find((x) => x.id === t.gridId);
  const ax = g && (t.dir === 'x' ? g.xs : g.ys).find((a) => a.label === t.label);
  if (!g || !ax) return null;
  const r = (g.rotation * Math.PI) / 180;
  const gu: V3 = [Math.cos(r), Math.sin(r), 0];
  const gv: V3 = [-Math.sin(r), Math.cos(r), 0];
  const normal = t.dir === 'x' ? gu : scale(gv, -1);
  const origin = t.dir === 'x' ? gridToWorld(g, ax.offset, 0) : gridToWorld(g, 0, ax.offset);
  return { origin, right: norm(cross([0, 0, 1], normal)), up: [0, 0, 1], normal };
}

export function targetLabel(t: DrawingTarget, p: Pick<Project, 'grids' | 'levels'>): string {
  if (t.kind === 'plan') return `平面 ${p.levels.find((l) => l.id === t.levelId)?.name ?? '（已刪除）'}`;
  return `立面 ${t.label}`;
}

/** 圖紙局部座標 → 平面座標（mm） */
export function localToPlane(ref: Pick<DrawingRef, 'scale' | 'rotation' | 'offset'>, base: [number, number], x: number, y: number): [number, number] {
  const a = (ref.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const X = (x + base[0]) * ref.scale;
  const Y = (y + base[1]) * ref.scale;
  return [ref.offset[0] + X * c - Y * s, ref.offset[1] + X * s + Y * c];
}

export function planeToLocal(ref: Pick<DrawingRef, 'scale' | 'rotation' | 'offset'>, base: [number, number], u: number, v: number): [number, number] {
  const a = (ref.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const du = u - ref.offset[0];
  const dv = v - ref.offset[1];
  return [(du * c + dv * s) / ref.scale - base[0], (-du * s + dv * c) / ref.scale - base[1]];
}

export function planeToWorld(f: PlaneFrame, u: number, v: number): V3 {
  return add(add(f.origin, scale(f.right, u)), scale(f.up, v));
}

export function worldToPlane(f: PlaneFrame, p: V3): [number, number] {
  const d = sub(p, f.origin);
  return [dot(d, f.right), dot(d, f.up)];
}

/** 局部座標 → 世界座標的 4×4 矩陣 */
export function drawingMatrix(ref: DrawingRef, base: [number, number], f: PlaneFrame): THREE.Matrix4 {
  const frame = new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.right), new THREE.Vector3(...f.up), new THREE.Vector3(...f.normal));
  frame.setPosition(...f.origin);
  const inPlane = new THREE.Matrix4()
    .makeTranslation(ref.offset[0], ref.offset[1], 0)
    .multiply(new THREE.Matrix4().makeRotationZ((ref.rotation * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeScale(ref.scale, ref.scale, ref.scale))
    .multiply(new THREE.Matrix4().makeTranslation(base[0], base[1], 0));
  return frame.multiply(inPlane);
}

type C = [number, number];
const csub = (a: C, b: C): C => [a[0] - b[0], a[1] - b[1]];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};

/**
 * 兩點對位：圖紙原始座標 z1、z2 對到平面座標 w1、w2。
 * keepScale 時只解旋轉與平移（DXF／DWG 單位已知）；否則一併求比例（PDF）。
 * 只給一組點時只平移。
 */
export function solveAlignment(
  ref: Pick<DrawingRef, 'scale' | 'rotation' | 'offset'>,
  pairs: { z: C; w: C }[],
  keepScale: boolean,
): { scale: number; rotation: number; offset: [number, number] } {
  const a = (ref.rotation * Math.PI) / 180;
  let k: C = [ref.scale * Math.cos(a), ref.scale * Math.sin(a)];
  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    const dz = csub(p2.z, p1.z);
    if (Math.hypot(...dz) > 1e-9) {
      k = cdiv(csub(p2.w, p1.w), dz);
      if (keepScale) {
        const ang = Math.atan2(k[1], k[0]);
        k = [ref.scale * Math.cos(ang), ref.scale * Math.sin(ang)];
      }
      const zm: C = [(p1.z[0] + p2.z[0]) / 2, (p1.z[1] + p2.z[1]) / 2];
      const wm: C = [(p1.w[0] + p2.w[0]) / 2, (p1.w[1] + p2.w[1]) / 2];
      const o = csub(wm, cmul(k, zm));
      return { scale: Math.hypot(...k), rotation: (Math.atan2(k[1], k[0]) * 180) / Math.PI, offset: o };
    }
  }
  const p1 = pairs[0];
  const o = csub(p1.w, cmul(k, p1.z));
  return { scale: ref.scale, rotation: ref.rotation, offset: o };
}
