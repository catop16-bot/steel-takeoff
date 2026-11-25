import * as THREE from 'three';
import { drawingMatrix, targetFrame, type PlaneFrame } from '../drawing/placement';
import { SnapIndex } from '../drawing/snapIndex';
import { getDrawing } from '../drawing/storage';
import type { Drawing2D } from '../drawing/types';
import { dot, sub, type V3 } from '../geom/vec';
import type { DrawingRef, Project } from '../model/types';
import { buildTextMeshes, pageTexture } from './glyphs';
import { disposeGroup } from './overlay';
import type { ViewState } from './view';

const MONO = '#56606b';

export interface DrawingItem {
  ref: DrawingRef;
  data?: Drawing2D;
  group: THREE.Group;
  lines: (THREE.LineSegments | null)[];
  texts: THREE.Mesh[];
  raster?: THREE.Mesh;
  frame: PlaneFrame | null;
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  textKey: string;
  snapKey: string;
  snap?: SnapIndex;
  loading: boolean;
  missing?: boolean;
}

/** 底圖：每張圖紙一個 group（局部座標 → 世界矩陣），圖層各一組線段 */
export class DrawingLayer {
  readonly root = new THREE.Group();
  readonly items = new Map<string, DrawingItem>();
  private lineMats = new Map<string, THREE.LineBasicMaterial>();
  private textMats = new Map<string, THREE.MeshBasicMaterial>();
  private rasterMats: THREE.MeshBasicMaterial[] = [];
  private onLoaded: () => void;
  private project: Project | null = null;

  constructor(onLoaded: () => void) {
    this.onLoaded = onLoaded;
  }

  sync(p: Project) {
    this.project = p;
    const ids = new Set(p.drawings.map((d) => d.id));
    for (const [id, it] of this.items) {
      if (!ids.has(id)) {
        this.root.remove(it.group);
        disposeGroup(it.group);
        this.items.delete(id);
      }
    }
    for (const ref of p.drawings) {
      let it = this.items.get(ref.id);
      if (!it) {
        it = { ref, group: new THREE.Group(), lines: [], texts: [], frame: null, matrix: new THREE.Matrix4(), inverse: new THREE.Matrix4(), textKey: '', snapKey: '', loading: false };
        it.group.matrixAutoUpdate = false;
        this.items.set(ref.id, it);
        this.root.add(it.group);
      }
      it.ref = ref;
      if (!it.data && !it.loading && !it.missing) {
        it.loading = true;
        const item = it;
        void getDrawing(ref.id).then((d) => {
          item.loading = false;
          if (!d) {
            item.missing = true;
            return;
          }
          item.data = d;
          this.build(item);
          if (this.project) this.update(item, this.project);
          this.onLoaded();
        });
      }
      if (it.data) this.update(it, p);
    }
  }

  private lineMat(color: string, opacity: number): THREE.LineBasicMaterial {
    const k = `${color}|${opacity}`;
    let m = this.lineMats.get(k);
    if (!m) {
      m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      this.lineMats.set(k, m);
    }
    return m;
  }

  private textMat(page: number, opacity: number): THREE.MeshBasicMaterial {
    const k = `${page}|${opacity}`;
    let m = this.textMats.get(k);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ map: pageTexture(page), vertexColors: true, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
      this.textMats.set(k, m);
    }
    return m;
  }

  private build(it: DrawingItem) {
    const d = it.data!;
    it.lines = d.segs.map((s) => {
      if (!s.length) return null;
      const pos = new Float32Array((s.length / 2) * 3);
      for (let i = 0, j = 0; i < s.length; i += 2, j += 3) {
        pos[j] = s[i];
        pos[j + 1] = s[i + 1];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const l = new THREE.LineSegments(g, this.lineMat('#000', 1));
      l.frustumCulled = false;
      l.renderOrder = 5;
      it.group.add(l);
      return l;
    });
    if (d.raster) {
      const r = d.raster;
      void createImageBitmap(r.blob).then((bmp) => {
        const tex = new THREE.Texture(bmp);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
        this.rasterMats.push(mat);
        const geo = new THREE.PlaneGeometry(r.x1 - r.x0, r.y1 - r.y0);
        geo.translate((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, -0.01);
        it.raster = new THREE.Mesh(geo, mat);
        it.raster.renderOrder = 4;
        it.raster.frustumCulled = false;
        it.group.add(it.raster);
        if (this.project) this.update(it, this.project);
        this.onLoaded();
      });
    }
  }

  private update(it: DrawingItem, p: Project) {
    const d = it.data!;
    const ref = it.ref;
    it.frame = targetFrame(ref.target, p);
    it.group.visible = ref.visible && !!it.frame;
    if (!it.frame) return;
    it.matrix = drawingMatrix(ref, d.base, it.frame);
    it.inverse = it.matrix.clone().invert();
    it.group.matrix.copy(it.matrix);
    it.group.matrixWorldNeedsUpdate = true;
    const hidden = new Set(ref.hiddenLayers);
    const op = Math.max(0.05, Math.min(1, ref.opacity));
    d.layers.forEach((l, i) => {
      const line = it.lines[i];
      if (!line) return;
      line.visible = !hidden.has(l.name);
      line.material = this.lineMat(ref.mono ? MONO : l.color, op);
    });
    if (it.raster) {
      it.raster.visible = ref.raster;
      (it.raster.material as THREE.MeshBasicMaterial).opacity = op * 0.8;
    }
    const tk = `${ref.showText}|${ref.mono}|${op}|${ref.hiddenLayers.join('\u0001')}`;
    if (tk !== it.textKey) {
      it.textKey = tk;
      for (const m of it.texts) {
        it.group.remove(m);
        m.geometry.dispose();
      }
      it.texts = [];
      if (ref.showText && d.texts.length) {
        const cols = d.layers.map((l) => new THREE.Color(ref.mono ? MONO : l.color));
        it.texts = buildTextMeshes(
          d.texts,
          (li) => cols[li] ?? new THREE.Color(MONO),
          (li) => !hidden.has(d.layers[li]?.name),
          (page) => this.textMat(page, op),
        );
        for (const m of it.texts) {
          m.renderOrder = 6;
          it.group.add(m);
        }
      }
    }
  }

  /** 每個窗格繪製前呼叫：平面／立面視圖圖紙畫在最上層，3D 視圖照深度 */
  setPass(is3d: boolean) {
    for (const m of this.lineMats.values()) m.depthTest = is3d;
    for (const m of this.textMats.values()) m.depthTest = is3d;
    for (const m of this.rasterMats) m.depthTest = is3d;
  }

  /** 可供這個視圖鎖點的圖紙（平面／立面須與視圖同一平面） */
  snappable(vs: ViewState): DrawingItem[] {
    const out: DrawingItem[] = [];
    for (const it of this.items.values()) {
      if (!it.data || !it.frame || !it.ref.visible) continue;
      if (vs.def.kind !== '3d' && !vs.rotatable) {
        const n = it.frame.normal;
        if (Math.abs(dot(n, vs.plane.normal)) < 0.999) continue;
        if (Math.abs(dot(sub(it.frame.origin, vs.plane.origin), vs.plane.normal)) > 1) continue;
      }
      out.push(it);
    }
    return out;
  }

  snapIndex(it: DrawingItem): SnapIndex {
    const key = it.ref.hiddenLayers.join('\u0001');
    if (!it.snap || it.snapKey !== key) {
      const hidden = new Set<number>();
      it.data!.layers.forEach((l, i) => {
        if (it.ref.hiddenLayers.includes(l.name)) hidden.add(i);
      });
      it.snap = new SnapIndex(it.data!, hidden);
      it.snapKey = key;
    }
    return it.snap;
  }

  toLocal(it: DrawingItem, p: V3): [number, number] {
    const v = new THREE.Vector3(...p).applyMatrix4(it.inverse);
    return [v.x, v.y];
  }

  toWorld(it: DrawingItem, x: number, y: number): V3 {
    const v = new THREE.Vector3(x, y, 0).applyMatrix4(it.matrix);
    return [v.x, v.y, v.z];
  }

  /** 全部可見圖紙的世界外框 */
  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const it of this.items.values()) {
      if (!it.data || !it.frame || !it.ref.visible) continue;
      const [x0, y0, x1, y1] = it.data.bounds;
      for (const [x, y] of [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ]) box.expandByPoint(new THREE.Vector3(x, y, 0).applyMatrix4(it.matrix));
    }
    return box;
  }
}
