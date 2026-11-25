import * as THREE from 'three';
import { parseProfile } from '../catalog/parse';
import { sectionOutline } from '../catalog/shapes';
import type { Profile } from '../catalog/types';
import { memberFrame } from '../geom/frame';
import { add, addScaled, cross, dot, norm, polygonNormal, sub, type V3 } from '../geom/vec';
import type { Member, Project } from '../model/types';
import { classColor, COLORS } from './colors';

/** 拾取與鎖點用的構件幾何 */
export interface MemberGeom {
  id: string;
  /** 參考線起訖（使用者點選的點） */
  start: V3;
  end: V3;
  /** 實際起訖（含偏移） */
  p0: V3;
  p1: V3;
  /** 定向包圍盒 */
  center: V3;
  axes: [V3, V3, V3];
  half: [number, number, number];
  plate?: V3[];
  error?: boolean;
}

export type DisplayMode = 'solid' | 'wire' | 'line';

const edgeVertex = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
attribute mat4 iMatrix;
attribute vec3 iColor;
varying vec3 vColor;
void main() {
  vColor = iColor;
  vec4 mvPosition = modelViewMatrix * iMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;

const edgeFragment = /* glsl */ `
#include <clipping_planes_pars_fragment>
varying vec3 vColor;
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(vColor, 1.0);
  #include <colorspace_fragment>
}`;

interface ProfileGeom {
  mesh: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  edges: THREE.LineSegments;
  ids: string[];
}

const tmpC = new THREE.Color();

function buildProfileGeom(p: Profile): ProfileGeom {
  const o = sectionOutline(p.kind, p.dims);
  const shape = new THREE.Shape(o.outer.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of o.holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const mesh = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1, curveSegments: 1 });
  const edges = new THREE.EdgesGeometry(mesh, 25);
  return { mesh, edges };
}

export class MemberLayer {
  readonly root = new THREE.Group();
  readonly geoms = new Map<string, MemberGeom>();
  private batches = new Map<string, Batch>();
  private profileGeoms = new Map<string, ProfileGeom | null>();
  private plates = new Map<string, THREE.Group>();
  private memberProfile = new Map<string, string>();
  private members = new Map<string, Member>();
  private lines: THREE.LineSegments;
  private errorLines: THREE.LineSegments;
  private solidMat: THREE.MeshLambertMaterial;
  private edgeMat: THREE.ShaderMaterial;
  private plateMats = new Map<string, THREE.MeshLambertMaterial>();
  private plateEdgeMat = new THREE.LineBasicMaterial({ color: COLORS.edge });
  private selected: ReadonlySet<string> = new Set();
  private hover = '';
  mode: DisplayMode = 'solid';

  constructor() {
    this.solidMat = new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.edgeMat = new THREE.ShaderMaterial({ vertexShader: edgeVertex, fragmentShader: edgeFragment, clipping: true });
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }));
    this.lines.frustumCulled = false;
    this.errorLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLORS.error }));
    this.errorLines.frustumCulled = false;
    this.root.add(this.lines, this.errorLines);
  }

  private profileGeom(name: string): ProfileGeom | null {
    if (this.profileGeoms.has(name)) return this.profileGeoms.get(name)!;
    const r = parseProfile(name);
    const g = r.ok && !r.profile.thicknessOnly ? buildProfileGeom(r.profile) : null;
    this.profileGeoms.set(name, g);
    return g;
  }

  /** 全部重建 */
  rebuild(p: Project) {
    for (const b of this.batches.values()) this.disposeBatch(b);
    this.batches.clear();
    for (const g of this.plates.values()) this.disposePlate(g);
    this.plates.clear();
    this.geoms.clear();
    this.members.clear();
    this.memberProfile.clear();
    for (const m of p.members) this.members.set(m.id, m);
    const profiles = new Set<string>();
    for (const m of p.members) {
      const key = this.keyOf(m);
      this.memberProfile.set(m.id, key);
      profiles.add(key);
    }
    for (const k of profiles) this.rebuildProfile(k);
    this.rebuildLines();
  }

  /** 增量更新：只重建受影響的斷面批次 */
  update(changed: { id: string; before?: Member; after?: Member }[]) {
    const dirty = new Set<string>();
    for (const c of changed) {
      const old = this.memberProfile.get(c.id);
      if (old) dirty.add(old);
      if (c.after) {
        this.members.set(c.id, c.after);
        const k = this.keyOf(c.after);
        this.memberProfile.set(c.id, k);
        dirty.add(k);
      } else {
        this.members.delete(c.id);
        this.memberProfile.delete(c.id);
        this.geoms.delete(c.id);
      }
    }
    for (const k of dirty) this.rebuildProfile(k);
    this.rebuildLines();
  }

  private keyOf(m: Member): string {
    return m.type === 'plate' || m.points?.length ? `plate:${m.id}` : m.profile;
  }

  private rebuildProfile(key: string) {
    if (key.startsWith('plate:')) {
      const id = key.slice(6);
      const old = this.plates.get(id);
      if (old) this.disposePlate(old);
      this.plates.delete(id);
      const m = this.members.get(id);
      if (m && this.memberProfile.get(id) === key) this.buildPlate(m);
      return;
    }
    const old = this.batches.get(key);
    if (old) this.disposeBatch(old);
    this.batches.delete(key);
    const list = [...this.members.values()].filter((m) => this.memberProfile.get(m.id) === key);
    if (!list.length) return;
    const pg = this.profileGeom(key);
    const prof = parseProfile(key);
    const W = prof.ok ? prof.profile.width : 0;
    const H = prof.ok ? prof.profile.height : 0;
    const ok: { m: Member; mat: THREE.Matrix4 }[] = [];
    for (const m of list) {
      const f = memberFrame(m, W, H);
      if (!f || !pg) {
        this.geoms.set(m.id, this.lineGeom(m, true));
        continue;
      }
      const origin = add(f.p0, f.offset);
      const zL = [f.x[0] * f.length, f.x[1] * f.length, f.x[2] * f.length];
      const mat = new THREE.Matrix4().set(
        f.w[0], f.u[0], zL[0], origin[0],
        f.w[1], f.u[1], zL[1], origin[1],
        f.w[2], f.u[2], zL[2], origin[2],
        0, 0, 0, 1,
      );
      ok.push({ m, mat });
      this.geoms.set(m.id, {
        id: m.id,
        start: m.start,
        end: m.end,
        p0: f.p0,
        p1: f.p1,
        center: addScaled(origin, f.x, f.length / 2),
        axes: [f.w, f.u, f.x],
        half: [W / 2, H / 2, f.length / 2],
      });
    }
    if (!ok.length || !pg) return;
    const n = ok.length;
    const mesh = new THREE.InstancedMesh(pg.mesh, this.solidMat, n);
    mesh.frustumCulled = false;
    const eg = new THREE.InstancedBufferGeometry();
    eg.setAttribute('position', pg.edges.getAttribute('position'));
    const iMat = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
    const iCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    eg.setAttribute('iMatrix', iMat);
    eg.setAttribute('iColor', iCol);
    eg.instanceCount = n;
    const edges = new THREE.LineSegments(eg, this.edgeMat);
    edges.frustumCulled = false;
    const ids: string[] = [];
    ok.forEach(({ m, mat }, i) => {
      mesh.setMatrixAt(i, mat);
      mat.toArray(iMat.array as Float32Array, i * 16);
      ids.push(m.id);
    });
    const batch: Batch = { mesh, edges, ids };
    mesh.userData.batch = batch;
    this.batches.set(key, batch);
    this.colorBatch(batch);
    this.applyMode(batch);
    this.root.add(mesh, edges);
  }

  private lineGeom(m: Member, error: boolean): MemberGeom {
    const mid: V3 = [(m.start[0] + m.end[0]) / 2, (m.start[1] + m.end[1]) / 2, (m.start[2] + m.end[2]) / 2];
    const x = norm(sub(m.end, m.start));
    const L = Math.hypot(...sub(m.end, m.start));
    const u: V3 = Math.abs(x[2]) < 0.99 ? [0, 0, 1] : [1, 0, 0];
    const w = norm(cross(u, x));
    return { id: m.id, start: m.start, end: m.end, p0: m.start, p1: m.end, center: mid, axes: [w, norm(cross(x, w)), x], half: [50, 50, L / 2], error };
  }

  private buildPlate(m: Member) {
    const pts = m.points ?? [];
    const r = parseProfile(m.profile);
    const t = r.ok ? (r.profile.dims.t ?? r.profile.dims.b) : NaN;
    if (pts.length < 3 || !(t > 0)) {
      this.geoms.set(m.id, { ...this.lineGeom(m, true), plate: pts, error: true });
      return;
    }
    const n = polygonNormal(pts);
    let ex = norm(sub(pts[1], pts[0]));
    if (Math.abs(dot(ex, n)) > 0.99) ex = [1, 0, 0];
    const ey = norm(cross(n, ex));
    const local = pts.map((p) => {
      const d = sub(p, pts[0]);
      return new THREE.Vector2(dot(d, ex), dot(d, ey));
    });
    const z0 = m.pos.depth === 'front' ? 0 : m.pos.depth === 'behind' ? -t : -t / 2;
    const zOff = z0 + (m.pos.depthOffset || 0);
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(local), { depth: t, bevelEnabled: false, curveSegments: 1 });
    const origin = addScaled(pts[0], n, zOff);
    const mat = new THREE.Matrix4().makeBasis(new THREE.Vector3(...ex), new THREE.Vector3(...ey), new THREE.Vector3(...n));
    mat.setPosition(...origin);
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geo, this.plateMat(classColor(m.cls), false));
    mesh.applyMatrix4(mat);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), this.plateEdgeMat);
    edges.applyMatrix4(mat);
    group.add(mesh, edges);
    group.userData = { id: m.id, cls: m.cls, mesh };
    this.plates.set(m.id, group);
    this.root.add(group);
    // 包圍盒
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const v of local) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    const c = add(add(addScaled(pts[0], ex, (minX + maxX) / 2), [ey[0] * ((minY + maxY) / 2), ey[1] * ((minY + maxY) / 2), ey[2] * ((minY + maxY) / 2)]), [
      n[0] * (zOff + t / 2),
      n[1] * (zOff + t / 2),
      n[2] * (zOff + t / 2),
    ]);
    this.geoms.set(m.id, {
      id: m.id,
      start: pts[0],
      end: pts[1],
      p0: pts[0],
      p1: pts[1],
      center: c,
      axes: [ex, ey, n],
      half: [(maxX - minX) / 2, (maxY - minY) / 2, t / 2],
      plate: pts,
    });
    this.applyPlateState(m.id);
  }

  private plateMat(color: string, sel: boolean): THREE.MeshLambertMaterial {
    const k = sel ? 'sel' : color;
    let m = this.plateMats.get(k);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: sel ? COLORS.selected : color, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
      this.plateMats.set(k, m);
    }
    return m;
  }

  private rebuildLines() {
    const pos: number[] = [];
    const col: number[] = [];
    const err: number[] = [];
    for (const m of this.members.values()) {
      const g = this.geoms.get(m.id);
      if (g?.error) {
        err.push(...m.start, ...m.end);
        continue;
      }
      if (m.points?.length) {
        const pts = m.points;
        for (let i = 0; i < pts.length; i++) {
          pos.push(...pts[i], ...pts[(i + 1) % pts.length]);
          tmpC.set(this.selected.has(m.id) ? COLORS.selected : classColor(m.cls));
          col.push(tmpC.r, tmpC.g, tmpC.b, tmpC.r, tmpC.g, tmpC.b);
        }
        continue;
      }
      pos.push(...m.start, ...m.end);
      tmpC.set(this.selected.has(m.id) ? COLORS.selected : classColor(m.cls));
      col.push(tmpC.r, tmpC.g, tmpC.b, tmpC.r, tmpC.g, tmpC.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.lines.geometry.dispose();
    this.lines.geometry = g;
    const e = new THREE.BufferGeometry();
    e.setAttribute('position', new THREE.Float32BufferAttribute(err, 3));
    this.errorLines.geometry.dispose();
    this.errorLines.geometry = e;
    this.lines.visible = this.mode === 'line';
  }

  private colorBatch(b: Batch) {
    const iCol = b.edges.geometry.getAttribute('iColor') as THREE.InstancedBufferAttribute;
    b.ids.forEach((id, i) => {
      const m = this.members.get(id)!;
      const sel = this.selected.has(id);
      const hov = !sel && this.hover === id;
      tmpC.set(sel ? COLORS.selected : hov ? COLORS.hover : classColor(m.cls));
      b.mesh.setColorAt(i, tmpC);
      tmpC.set(sel ? COLORS.edgeSelected : hov ? '#b08800' : this.mode === 'wire' ? classColor(m.cls) : COLORS.edge);
      tmpC.toArray(iCol.array as Float32Array, i * 3);
    });
    if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    iCol.needsUpdate = true;
  }

  private applyPlateState(id: string) {
    const g = this.plates.get(id);
    if (!g) return;
    const sel = this.selected.has(id) || this.hover === id;
    (g.userData.mesh as THREE.Mesh).material = this.plateMat(classColor(g.userData.cls), sel);
    (g.userData.mesh as THREE.Mesh).visible = this.mode === 'solid';
    g.visible = this.mode !== 'line';
  }

  private applyMode(b: Batch) {
    b.mesh.visible = this.mode === 'solid';
    b.edges.visible = this.mode !== 'line';
  }

  setMode(mode: DisplayMode) {
    this.mode = mode;
    for (const b of this.batches.values()) {
      this.applyMode(b);
      this.colorBatch(b);
    }
    for (const id of this.plates.keys()) this.applyPlateState(id);
    this.lines.visible = mode === 'line';
  }

  setSelection(sel: ReadonlySet<string>) {
    const prev = this.selected;
    this.selected = sel;
    this.recolor(new Set([...prev, ...sel]));
    this.rebuildLines();
  }

  setHover(id: string) {
    if (id === this.hover) return;
    const prev = this.hover;
    this.hover = id;
    this.recolor(new Set([prev, id].filter(Boolean)));
  }

  private recolor(ids: Set<string>) {
    const touched = new Set<string>();
    for (const id of ids) {
      const k = this.memberProfile.get(id);
      if (!k) continue;
      if (k.startsWith('plate:')) this.applyPlateState(id);
      else touched.add(k);
    }
    for (const k of touched) {
      const b = this.batches.get(k);
      if (b) this.colorBatch(b);
    }
  }

  private disposeBatch(b: Batch) {
    this.root.remove(b.mesh, b.edges);
    b.mesh.dispose();
    b.edges.geometry.dispose();
  }

  private disposePlate(g: THREE.Group) {
    this.root.remove(g);
    g.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
  }

  memberOf(id: string): Member | undefined {
    return this.members.get(id);
  }

  /** 構件包圍盒（全部） */
  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const g of this.geoms.values()) {
      box.expandByPoint(new THREE.Vector3(...g.p0));
      box.expandByPoint(new THREE.Vector3(...g.p1));
    }
    return box;
  }
}

/** 射線與定向包圍盒相交，回傳距離或 null */
export function rayOBB(origin: V3, dir: V3, g: MemberGeom): number | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  const d = sub(g.center, origin);
  for (let i = 0; i < 3; i++) {
    const a = g.axes[i];
    const e = dot(a, d);
    const f = dot(a, dir);
    const h = Math.max(g.half[i], 1);
    if (Math.abs(f) > 1e-9) {
      let t1 = (e + h) / f;
      let t2 = (e - h) / f;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax || tMax < 0) return null;
    } else if (-e - h > 0 || -e + h < 0) return null;
  }
  return tMin > 0 ? tMin : tMax;
}

/** 包圍盒 8 個角點 */
export function obbCorners(g: MemberGeom): V3[] {
  const out: V3[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        let p = g.center;
        p = addScaled(p, g.axes[0], sx * g.half[0]);
        p = addScaled(p, g.axes[1], sy * g.half[1]);
        p = addScaled(p, g.axes[2], sz * g.half[2]);
        out.push(p);
      }
  return out;
}


const ghostCache = new Map<string, ProfileGeom | null>();
const ghostMat = new THREE.MeshLambertMaterial({ color: COLORS.preview, transparent: true, opacity: 0.45, depthWrite: false });
const ghostEdgeMat = new THREE.LineBasicMaterial({ color: COLORS.preview });

/** 繪製中的構件預覽（半透明實體＋外框） */
export function ghostMember(m: Pick<Member, 'profile' | 'start' | 'end' | 'pos' | 'offStart' | 'offEnd'>): THREE.Object3D | null {
  let pg = ghostCache.get(m.profile);
  const prof = parseProfile(m.profile);
  if (pg === undefined) {
    pg = prof.ok && !prof.profile.thicknessOnly ? buildProfileGeom(prof.profile) : null;
    ghostCache.set(m.profile, pg);
  }
  if (!pg || !prof.ok) return null;
  const f = memberFrame(m, prof.profile.width, prof.profile.height);
  if (!f) return null;
  const o = add(f.p0, f.offset);
  const mat = new THREE.Matrix4().set(
    f.w[0], f.u[0], f.x[0] * f.length, o[0],
    f.w[1], f.u[1], f.x[1] * f.length, o[1],
    f.w[2], f.u[2], f.x[2] * f.length, o[2],
    0, 0, 0, 1,
  );
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(pg.mesh, ghostMat);
  const edges = new THREE.LineSegments(pg.edges, ghostEdgeMat);
  g.add(mesh, edges);
  g.matrixAutoUpdate = false;
  g.matrix.copy(mat);
  g.userData.shared = true;
  return g;
}
