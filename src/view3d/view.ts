import * as THREE from 'three';
import { gridExtent, gridToWorld } from '../geom/grid';
import { add, addScaled, cross, dot, norm, scale, sub, type V3 } from '../geom/vec';
import type { CameraState, Project, ViewDef } from '../model/types';

export interface WorkPlane {
  origin: V3;
  normal: V3;
  /** 螢幕右方、上方在平面上的方向 */
  right: V3;
  up: V3;
}

export interface Ray {
  origin: V3;
  dir: V3;
}

const DEG = Math.PI / 180;
const FOV = 40;

/** 單一視圖的相機、工作平面與裁切 */
export class ViewState {
  def: ViewDef;
  cam: CameraState;
  /** Ctrl+P：平面視圖改為可旋轉 */
  rotatable = false;
  /** 已依實際窗格大小縮放到全部 */
  fitted = false;
  readonly persp = new THREE.PerspectiveCamera(FOV, 1, 10, 1e7);
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4e6);
  width = 1;
  height = 1;
  plane: WorkPlane = { origin: [0, 0, 0], normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] };
  readonly clip = [new THREE.Plane(), new THREE.Plane()];
  /** 平面視圖的高程、立面視圖的軸線位置 */
  baseYaw = -90;
  basePitch = 90;

  constructor(def: ViewDef, p: Project) {
    this.def = def;
    this.cam = def.camera ? { ...def.camera } : { target: [0, 0, 0], distance: 30000, yaw: -60, pitch: 30, ortho: false };
    this.sync(p, !def.camera);
  }

  get camera(): THREE.Camera {
    return this.cam.ortho ? this.ortho : this.persp;
  }

  get is3d(): boolean {
    return this.def.kind === '3d' || this.rotatable;
  }

  /** 專案變動後重新計算工作平面與裁切；fit=true 時重設相機 */
  sync(p: Project, fit = false) {
    const def = this.def;
    if (def.kind === 'plan') {
      const lvl = p.levels.find((l) => l.id === def.levelId);
      const z = lvl?.elevation ?? 0;
      const rot = (p.grids[0]?.rotation ?? 0) * DEG;
      const right: V3 = [Math.cos(rot), Math.sin(rot), 0];
      const up: V3 = [-Math.sin(rot), Math.cos(rot), 0];
      this.plane = { origin: [0, 0, z], normal: [0, 0, 1], right, up };
      this.baseYaw = (rot / DEG) - 90;
      this.basePitch = 90;
      this.setClip([0, 0, 1], z, def.depthUp, def.depthDown);
    } else if (def.kind === 'elevation' && def.gridRef) {
      const g = p.grids.find((x) => x.id === def.gridRef!.gridId);
      const ax = g && (def.gridRef.dir === 'x' ? g.xs : g.ys).find((a) => a.label === def.gridRef!.label);
      if (g && ax) {
        const rot = g.rotation * DEG;
        const gu: V3 = [Math.cos(rot), Math.sin(rot), 0];
        const gv: V3 = [-Math.sin(rot), Math.cos(rot), 0];
        // X 向軸線（x 為定值）：從 +u 側看；Y 向軸線：從 −v 側看
        const normal = def.gridRef.dir === 'x' ? gu : scale(gv, -1);
        const origin = def.gridRef.dir === 'x' ? gridToWorld(g, ax.offset, 0) : gridToWorld(g, 0, ax.offset);
        // 螢幕右方 = 上 × 視線（指向相機）
        const right = norm(cross([0, 0, 1], normal));
        this.plane = { origin, normal, right, up: [0, 0, 1] };
        this.baseYaw = Math.atan2(normal[1], normal[0]) / DEG;
        this.basePitch = 0;
        this.setClip(normal, dot(normal, origin), def.depthUp, def.depthDown);
      }
    } else {
      const lvl = p.levels.find((l) => l.id === def.levelId) ?? [...p.levels].sort((a, b) => a.elevation - b.elevation)[0];
      const z = lvl?.elevation ?? 0;
      this.plane = { origin: [0, 0, z], normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] };
      this.clip[0].set(new THREE.Vector3(0, 0, 1), 1e9);
      this.clip[1].set(new THREE.Vector3(0, 0, -1), 1e9);
    }
    if (fit) this.fit(p);
    if (!this.is3d) {
      this.cam.yaw = this.baseYaw;
      this.cam.pitch = this.basePitch;
      this.cam.ortho = true;
    }
    this.updateCamera();
  }

  private setClip(n: V3, d: number, up: number, down: number) {
    // 保留 d − down ≤ n·p ≤ d + up
    this.clip[0].set(new THREE.Vector3(-n[0], -n[1], -n[2]), d + up);
    this.clip[1].set(new THREE.Vector3(n[0], n[1], n[2]), -(d - down));
  }

  /** 依軸線、樓層與構件範圍縮放到全部 */
  fit(p: Project, extra?: THREE.Box3) {
    const box = new THREE.Box3();
    const levels = p.levels.map((l) => l.elevation);
    const zMin = levels.length ? Math.min(...levels) : 0;
    const zMax = levels.length ? Math.max(...levels) : 0;
    for (const g of p.grids) {
      const e = gridExtent(g);
      for (const [u, v] of [
        [e.u0 - g.ext * 0.5, e.v0 - g.ext * 0.5],
        [e.u1 + g.ext * 0.5, e.v0 - g.ext * 0.5],
        [e.u0 - g.ext * 0.5, e.v1 + g.ext * 0.5],
        [e.u1 + g.ext * 0.5, e.v1 + g.ext * 0.5],
      ]) {
        const w = gridToWorld(g, u, v);
        box.expandByPoint(new THREE.Vector3(w[0], w[1], zMin));
        box.expandByPoint(new THREE.Vector3(w[0], w[1], zMax));
      }
    }
    if (extra && !extra.isEmpty()) box.union(extra);
    if (box.isEmpty()) box.set(new THREE.Vector3(-5000, -5000, 0), new THREE.Vector3(5000, 5000, 3000));
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const aspect = this.width / Math.max(1, this.height);
    if (this.def.kind === 'plan' && !this.rotatable) {
      const pz = this.plane.origin[2];
      // 投影到螢幕方向
      const corners = boxCorners(box);
      let w = 0;
      let h = 0;
      for (const k of corners) {
        w = Math.max(w, Math.abs(dot(sub(k, [c.x, c.y, k[2]]), this.plane.right)));
        h = Math.max(h, Math.abs(dot(sub(k, [c.x, c.y, k[2]]), this.plane.up)));
      }
      this.cam.target = [c.x, c.y, pz];
      this.cam.distance = Math.max(2 * h, (2 * w) / aspect) * 1.12;
    } else if (this.def.kind === 'elevation' && !this.rotatable) {
      const corners = boxCorners(box);
      let w = 0;
      let h = 0;
      const o = this.plane.origin;
      const cc: V3 = [c.x, c.y, c.z];
      const center = addScaled(cc, this.plane.normal, dot(sub(o, cc), this.plane.normal));
      for (const k of corners) {
        w = Math.max(w, Math.abs(dot(sub(k, center), this.plane.right)));
        h = Math.max(h, Math.abs(dot(sub(k, center), this.plane.up)));
      }
      this.cam.target = center;
      this.cam.distance = Math.max(2 * h, (2 * w) / aspect) * 1.15;
    } else {
      const r = size.length() / 2;
      this.cam.target = [c.x, c.y, c.z];
      if (this.cam.ortho) this.cam.distance = 2 * r * Math.max(1, 1 / aspect) * 1.02;
      else {
        const vf = FOV * DEG;
        const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
        this.cam.distance = (r / Math.sin(Math.min(vf, hf) / 2)) * 1.02;
      }
    }
    this.updateCamera();
  }

  setSize(w: number, h: number) {
    const nh = Math.max(1, h);
    // 正交視圖改變窗格大小時保持比例尺（每像素的 mm 不變），只露出更多或更少範圍，
    // 不會因為窗格變高就整個放大（同 CAD／Tekla）
    if (this.cam.ortho && this.height > 1) this.cam.distance *= nh / this.height;
    this.width = Math.max(1, w);
    this.height = nh;
    this.updateCamera();
  }

  /** 相機方向（目標指向相機） */
  eyeDir(): V3 {
    const y = this.cam.yaw * DEG;
    const p = this.cam.pitch * DEG;
    return [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)];
  }

  screenUp(): V3 {
    const y = this.cam.yaw * DEG;
    const p = this.cam.pitch * DEG;
    return [-Math.sin(p) * Math.cos(y), -Math.sin(p) * Math.sin(y), Math.cos(p)];
  }

  /** 正交時可視高度；透視時目標處可視高度 */
  viewHeight(): number {
    return this.cam.ortho ? this.cam.distance : 2 * this.cam.distance * Math.tan((FOV / 2) * DEG);
  }

  updateCamera() {
    const aspect = this.width / this.height;
    const eye = this.eyeDir();
    const up = this.screenUp();
    const t = this.cam.target;
    if (this.cam.ortho) {
      const h = this.cam.distance / 2;
      const o = this.ortho;
      o.left = -h * aspect;
      o.right = h * aspect;
      o.top = h;
      o.bottom = -h;
      const far = 2e6;
      o.position.set(t[0] + eye[0] * far * 0.5, t[1] + eye[1] * far * 0.5, t[2] + eye[2] * far * 0.5);
      o.up.set(up[0], up[1], up[2]);
      o.lookAt(t[0], t[1], t[2]);
      o.near = 1;
      o.far = far * 2;
      o.updateProjectionMatrix();
      o.updateMatrixWorld();
    } else {
      const c = this.persp;
      const d = this.cam.distance;
      c.aspect = aspect;
      c.position.set(t[0] + eye[0] * d, t[1] + eye[1] * d, t[2] + eye[2] * d);
      c.up.set(up[0], up[1], up[2]);
      c.lookAt(t[0], t[1], t[2]);
      c.near = Math.max(1, d / 500);
      c.far = d * 50 + 1e6;
      c.updateProjectionMatrix();
      c.updateMatrixWorld();
    }
  }

  /** 視窗像素座標 → 射線 */
  ray(px: number, py: number): Ray {
    const nx = (px / this.width) * 2 - 1;
    const ny = -(py / this.height) * 2 + 1;
    const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    const a = new THREE.Vector3(nx, ny, -1).unproject(cam);
    const b = new THREE.Vector3(nx, ny, 1).unproject(cam);
    const dir = norm([b.x - a.x, b.y - a.y, b.z - a.z]);
    return { origin: [a.x, a.y, a.z], dir };
  }

  /** 世界座標 → 視窗像素（z<1 才在相機前） */
  project(p: V3): [number, number, number] {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
    return [((v.x + 1) / 2) * this.width, ((1 - v.y) / 2) * this.height, v.z];
  }

  /** 射線與工作平面交點 */
  rayPlane(r: Ray, plane: WorkPlane = this.plane): V3 | null {
    const d = dot(r.dir, plane.normal);
    if (Math.abs(d) < 1e-9) return null;
    const t = dot(sub(plane.origin, r.origin), plane.normal) / d;
    return addScaled(r.origin, r.dir, t);
  }

  /** 每像素代表的世界長度（在目標深度） */
  worldPerPixel(): number {
    return this.viewHeight() / this.height;
  }

  /** 點是否在視圖深度範圍內 */
  inDepth(p: V3): boolean {
    if (this.def.kind === '3d') return true;
    const v = new THREE.Vector3(p[0], p[1], p[2]);
    return this.clip[0].distanceToPoint(v) >= -1 && this.clip[1].distanceToPoint(v) >= -1;
  }

  /** 以游標下的點為中心縮放 */
  zoomAt(px: number, py: number, factor: number, pivot?: V3) {
    const r = this.ray(px, py);
    let p = pivot;
    if (!p) {
      const eye = this.eyeDir();
      const plane: WorkPlane = { origin: this.cam.target, normal: eye, right: [1, 0, 0], up: [0, 0, 1] };
      p = this.rayPlane(r, plane) ?? this.cam.target;
    }
    if (this.cam.ortho) {
      // 正交：保持游標下的點不動（在垂直視線方向的平面上）
      const eye = this.eyeDir();
      const t = this.cam.target;
      const off = sub(t, p);
      const along = dot(off, eye);
      const lateral = sub(off, scale(eye, along));
      this.cam.target = add(add(p, scale(lateral, factor)), scale(eye, along));
      this.cam.distance = clampDist(this.cam.distance * factor);
    } else {
      const t = this.cam.target;
      this.cam.target = add(p, scale(sub(t, p), factor));
      this.cam.distance = clampDist(this.cam.distance * factor);
    }
    this.updateCamera();
  }

  pan(dx: number, dy: number) {
    const wpp = this.worldPerPixel();
    const eye = this.eyeDir();
    const up = this.screenUp();
    const right = norm(cross(up, eye));
    this.cam.target = add(this.cam.target, add(scale(right, -dx * wpp), scale(up, dy * wpp)));
    this.updateCamera();
  }

  /** 繞 pivot 旋轉（只在 3D 或 Ctrl+P 後） */
  orbit(dx: number, dy: number, pivot?: V3) {
    if (!this.is3d) return;
    const dYaw = -dx * 0.4;
    let dPitch = dy * 0.4;
    const newPitch = Math.max(-89.5, Math.min(89.5, this.cam.pitch + dPitch));
    dPitch = newPitch - this.cam.pitch;
    const pv = pivot ?? this.cam.target;
    // 以 pivot 為中心旋轉目標點
    const eyeOld = this.eyeDir();
    const camPos = addScaled(this.cam.target, eyeOld, this.cam.distance);
    this.cam.yaw += dYaw;
    this.cam.pitch = newPitch;
    const rot = (v: V3): V3 => {
      const y = dYaw * DEG;
      const c = Math.cos(y);
      const s = Math.sin(y);
      let r: V3 = [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
      // 繞新的右方向轉 pitch
      const eye = this.eyeDir();
      const right = norm(cross(this.screenUp(), eye));
      r = rotateAxis(r, right, -dPitch * DEG);
      return r;
    };
    const newCam = add(pv, rot(sub(camPos, pv)));
    const eye = this.eyeDir();
    this.cam.target = addScaled(newCam, eye, -this.cam.distance);
    this.updateCamera();
  }

  /** 3D 視圖切換透視／正交，維持畫面大小 */
  toggleOrtho() {
    const k = 2 * Math.tan((FOV / 2) * DEG);
    if (this.cam.ortho) this.cam.distance = this.cam.distance / k;
    else this.cam.distance = this.cam.distance * k;
    this.cam.ortho = !this.cam.ortho;
    this.updateCamera();
  }

  /** 存回 ViewDef 用 */
  snapshot(): CameraState {
    return { ...this.cam, target: [...this.cam.target] as V3 };
  }
}

function clampDist(d: number) {
  return Math.max(200, Math.min(5e6, d));
}

function rotateAxis(v: V3, k: V3, a: number): V3 {
  // Rodrigues
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kv = cross(k, v);
  const kd = dot(k, v);
  return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
}

function boxCorners(b: THREE.Box3): V3[] {
  const out: V3[] = [];
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push([x, y, z]);
  return out;
}
