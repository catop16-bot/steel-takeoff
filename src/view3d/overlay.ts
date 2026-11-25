import * as THREE from 'three';
import { gridExtent, gridLines, gridToWorld } from '../geom/grid';
import { addScaled, type V3 } from '../geom/vec';
import type { Project } from '../model/types';
import { COLORS } from './colors';
import type { ViewState } from './view';

export interface Label {
  text: string;
  pos: V3;
  kind: 'grid' | 'level';
}

export interface SnapLine {
  a: V3;
  b: V3;
  kind: 'gridline';
}

export interface ViewOverlay {
  group: THREE.Group;
  labels: Label[];
  /** 可鎖點的軸線交點與線 */
  nodes: V3[];
  lines: SnapLine[];
}

function dashed(points: number[], color: string, opacity = 1): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const line = new THREE.LineSegments(g, new THREE.LineDashedMaterial({ color, dashSize: 900, gapSize: 250, transparent: opacity < 1, opacity, depthWrite: false }));
  line.computeLineDistances();
  line.frustumCulled = false;
  line.renderOrder = -1;
  return line;
}

/** 依視圖種類產生軸線、高程線與標籤 */
export function buildOverlay(vs: ViewState, p: Project): ViewOverlay {
  const group = new THREE.Group();
  const labels: Label[] = [];
  const nodes: V3[] = [];
  const lines: SnapLine[] = [];
  const levels = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  const zs = levels.length ? levels.map((l) => l.elevation) : [0];
  const zMin = zs[0];
  const zMax = zs[zs.length - 1];
  const def = vs.def;

  if (def.kind === 'plan') {
    const z = vs.plane.origin[2];
    const pts: number[] = [];
    for (const g of p.grids) {
      for (const l of gridLines(g, z)) {
        pts.push(...l.a, ...l.b);
        lines.push({ a: l.a, b: l.b, kind: 'gridline' });
        labels.push({ text: l.label, pos: l.a, kind: 'grid' }, { text: l.label, pos: l.b, kind: 'grid' });
      }
      for (const x of g.xs) for (const y of g.ys) nodes.push(gridToWorld(g, x.offset, y.offset, z));
    }
    group.add(dashed(pts, COLORS.grid));
  } else if (def.kind === 'elevation' && def.gridRef) {
    const g = p.grids.find((x) => x.id === def.gridRef!.gridId);
    if (g) {
      const ax = (def.gridRef.dir === 'x' ? g.xs : g.ys).find((a) => a.label === def.gridRef!.label);
      const cross = def.gridRef.dir === 'x' ? g.ys : g.xs;
      const e = gridExtent(g);
      const ext = g.ext;
      const pts: number[] = [];
      const lv: number[] = [];
      if (ax) {
        for (const c of cross) {
          const base = def.gridRef.dir === 'x' ? gridToWorld(g, ax.offset, c.offset) : gridToWorld(g, c.offset, ax.offset);
          const a: V3 = [base[0], base[1], zMin - ext * 0.75];
          const b: V3 = [base[0], base[1], zMax + ext * 0.75];
          pts.push(...a, ...b);
          lines.push({ a, b, kind: 'gridline' });
          labels.push({ text: c.label, pos: a, kind: 'grid' }, { text: c.label, pos: b, kind: 'grid' });
          for (const z of zs) nodes.push([base[0], base[1], z]);
        }
        // 樓層線
        const s0 = def.gridRef.dir === 'x' ? gridToWorld(g, ax.offset, e.v0 - ext) : gridToWorld(g, e.u0 - ext, ax.offset);
        const s1 = def.gridRef.dir === 'x' ? gridToWorld(g, ax.offset, e.v1 + ext) : gridToWorld(g, e.u1 + ext, ax.offset);
        for (const l of levels) {
          const a: V3 = [s0[0], s0[1], l.elevation];
          const b: V3 = [s1[0], s1[1], l.elevation];
          lv.push(...a, ...b);
          lines.push({ a, b, kind: 'gridline' });
          const left = vs.plane.right;
          const pa = dotSign(a, b, left) ? a : b;
          labels.push({ text: `${l.name}  ${fmtElev(l.elevation)}`, pos: addScaled(pa, left, 0), kind: 'level' });
        }
      }
      group.add(dashed(pts, COLORS.grid));
      group.add(dashed(lv, COLORS.level));
    }
  } else {
    const pts: number[] = [];
    const faint: number[] = [];
    for (const g of p.grids) {
      for (const z of zs) {
        for (const l of gridLines(g, z)) {
          (z === zMin ? pts : faint).push(...l.a, ...l.b);
          lines.push({ a: l.a, b: l.b, kind: 'gridline' });
          if (z === zMin) labels.push({ text: l.label, pos: l.a, kind: 'grid' }, { text: l.label, pos: l.b, kind: 'grid' });
        }
        for (const x of g.xs) for (const y of g.ys) nodes.push(gridToWorld(g, x.offset, y.offset, z));
      }
    }
    group.add(dashed(pts, COLORS.grid));
    group.add(dashed(faint, COLORS.gridFaint, 0.55));
  }
  return { group, labels, nodes, lines };
}

/** a 是否在 dir 方向較小的一端（標籤放左側） */
function dotSign(a: V3, b: V3, dir: V3): boolean {
  return a[0] * dir[0] + a[1] * dir[1] + a[2] * dir[2] <= b[0] * dir[0] + b[1] * dir[1] + b[2] * dir[2];
}

export function fmtElev(z: number): string {
  const v = (z / 1000).toFixed(3);
  return z > 0 ? `+${v}` : z < 0 ? v : '±0.000';
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
