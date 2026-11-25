import * as THREE from 'three';
import { effect } from '@preact/signals';
import { addScaled, dot, type V3 } from '../geom/vec';
import { store, type Change } from '../model/store';
import type { Member, Project, ViewDef } from '../model/types';
import { ui } from '../app/ui';
import { COLORS } from './colors';
import { DrawingLayer } from './drawings';
import { MemberLayer, obbCorners, type MemberGeom } from './members';
import { buildOverlay, disposeGroup, type ViewOverlay } from './overlay';
import { ViewState, type Ray } from './view';

export interface PaneEvent {
  pane: Pane;
  type: 'down' | 'move' | 'up' | 'dbl' | 'leave';
  px: number;
  py: number;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface PointerHandler {
  onPointer(e: PaneEvent): void;
}

export class Pane {
  index: number;
  el: HTMLElement;
  vs: ViewState | null = null;
  overlay: ViewOverlay | null = null;
  labelsEl: HTMLDivElement;
  markerEl: HTMLDivElement;
  rubberEl: HTMLDivElement;
  labelPool: HTMLDivElement[] = [];

  constructor(index: number, el: HTMLElement) {
    this.index = index;
    this.el = el;
    this.labelsEl = div('pane-labels');
    this.markerEl = div('snap-marker');
    this.rubberEl = div('rubber');
    el.append(this.labelsEl, this.rubberEl, this.markerEl);
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

/** 射線與構件拾取結果 */
export interface Hit {
  id: string;
  t: number;
  point: V3;
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly members = new MemberLayer();
  readonly drawings = new DrawingLayer(() => this.requestRender());
  /** 繪製中的預覽（橡皮筋構件） */
  readonly preview = new THREE.Group();
  /** 選取構件的參考線與端點把手 */
  private handles = new THREE.Group();
  private light = new THREE.DirectionalLight(0xffffff, 1.6);
  private panes: Pane[] = [];
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement;
  private resizeObs = new ResizeObserver(() => this.requestRender());
  private dirty = true;
  private views = new Map<string, ViewState>();
  handler: PointerHandler | null = null;
  private drag: { pane: Pane; mode: 'pan' | 'orbit'; x: number; y: number; pivot?: V3; moved: boolean } | null = null;
  private spaceDown = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gl';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;
    this.renderer.localClippingEnabled = false;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.5));
    this.scene.add(this.light, this.light.target);
    this.scene.add(this.members.root, this.drawings.root, this.preview, this.handles);

    store.subscribe((c, p) => this.onProject(c, p));
    effect(() => {
      this.members.setSelection(store.selection.value);
      this.updateHandles();
      this.requestRender();
    });
    effect(() => {
      this.members.setMode(ui.displayMode.value);
      this.requestRender();
    });
    effect(() => {
      void ui.labels.value;
      this.requestRender();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e)) this.spaceDown = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
    this.loop();
  }

  /** 掛到視圖區 DOM（可重複呼叫） */
  mount(container: HTMLElement) {
    if (this.container === container) return;
    if (this.container) this.resizeObs.unobserve(this.container);
    this.container = container;
    container.prepend(this.canvas);
    this.resizeObs.observe(container);
    this.requestRender();
  }

  // ---------- 專案同步 ----------

  private onProject(changes: Change[] | 'reset', p: Project) {
    if (changes === 'reset') {
      this.members.rebuild(p);
      this.drawings.sync(p);
      for (const vs of this.views.values()) this.disposeOverlayFor(vs);
      this.views.clear();
      for (const pane of this.panes) {
        pane.vs = null;
        pane.overlay = null;
      }
      this.bindPanes();
    } else {
      const mem = changes.filter((c): c is { coll: 'members'; id: string; before?: Member; after?: Member } => c.coll === 'members');
      if (mem.length) this.members.update(mem.map((c) => ({ id: c.id, before: c.before, after: c.after })));
      const structural = changes.some((c) => c.coll === 'grids' || c.coll === 'levels' || c.coll === 'views');
      if (structural || changes.some((c) => c.coll === 'drawings')) this.drawings.sync(p);
      if (structural) {
        // 視圖定義更新
        for (const [id, vs] of this.views) {
          const def = p.views.find((v) => v.id === id);
          if (!def) {
            this.disposeOverlayFor(vs);
            this.views.delete(id);
            continue;
          }
          vs.def = def;
          vs.sync(p);
        }
        for (const pane of this.panes) this.rebuildOverlay(pane);
        this.bindPanes();
      }
    }
    this.updateHandles();
    this.requestRender();
  }

  private disposeOverlayFor(vs: ViewState) {
    for (const pane of this.panes) {
      if (pane.vs === vs && pane.overlay) {
        this.scene.remove(pane.overlay.group);
        disposeGroup(pane.overlay.group);
        pane.overlay = null;
      }
    }
  }

  viewState(def: ViewDef): ViewState {
    let vs = this.views.get(def.id);
    if (!vs) {
      vs = new ViewState(def, store.p);
      this.views.set(def.id, vs);
    }
    return vs;
  }

  // ---------- 窗格 ----------

  /** Preact 掛上或卸下窗格元素 */
  setPaneElement(i: number, el: HTMLElement | null) {
    const old = this.panes[i];
    if (old && old.el === el) return;
    if (old) {
      old.labelsEl.remove();
      old.markerEl.remove();
      old.rubberEl.remove();
      if (old.overlay) {
        this.scene.remove(old.overlay.group);
        disposeGroup(old.overlay.group);
      }
    }
    if (!el) {
      delete this.panes[i];
      this.requestRender();
      return;
    }
    const pane = new Pane(i, el);
    this.panes[i] = pane;
    this.attachEvents(pane);
    this.bindPanes();
    this.requestRender();
  }

  /** 依 ui.paneViews 綁定各窗格的視圖 */
  bindPanes() {
    const p = store.p;
    const ids = ui.paneViews.peek();
    for (const pane of this.panes) {
      if (!pane) continue;
      const def = p.views.find((v) => v.id === ids[pane.index]) ?? p.views[0];
      if (!def) continue;
      const vs = this.viewState(def);
      if (pane.vs !== vs) {
        pane.vs = vs;
        const r = pane.el.getBoundingClientRect();
        vs.setSize(r.width, r.height);
        if (!def.camera && !vs.fitted && r.width > 2) {
          vs.fit(p, this.members.bounds());
          vs.fitted = true;
        }
        this.rebuildOverlay(pane);
      }
    }
    this.requestRender();
  }

  private rebuildOverlay(pane: Pane) {
    if (pane.overlay) {
      this.scene.remove(pane.overlay.group);
      disposeGroup(pane.overlay.group);
      pane.overlay = null;
    }
    if (!pane.vs) return;
    pane.overlay = buildOverlay(pane.vs, store.p);
    pane.overlay.group.visible = false;
    this.scene.add(pane.overlay.group);
  }

  activePane(): Pane | undefined {
    return this.panes[ui.activePane.peek()] ?? this.panes.find(Boolean);
  }

  allPanes(): Pane[] {
    return this.panes.filter(Boolean);
  }

  fitAll(pane = this.activePane()) {
    if (!pane?.vs) return;
    const r = pane.el.getBoundingClientRect();
    if (r.width > 2) pane.vs.setSize(r.width, r.height);
    pane.vs.fit(store.p, this.members.bounds().union(this.drawings.bounds()));
    this.requestRender();
  }

  /** Ctrl+P：平面／立面視圖切換可旋轉 */
  toggleRotatable(pane = this.activePane()) {
    const vs = pane?.vs;
    if (!vs || vs.def.kind === '3d') {
      if (vs) {
        vs.toggleOrtho();
        this.requestRender();
      }
      return;
    }
    vs.rotatable = !vs.rotatable;
    if (vs.rotatable) {
      vs.cam.pitch = vs.def.kind === 'plan' ? 55 : 20;
      vs.cam.yaw = vs.baseYaw + (vs.def.kind === 'plan' ? 0 : -25);
      vs.cam.ortho = false;
      vs.cam.distance = vs.cam.distance * 1.4;
    } else {
      vs.sync(store.p);
      vs.fit(store.p, this.members.bounds());
    }
    vs.updateCamera();
    this.requestRender();
  }

  // ---------- 事件 ----------

  private attachEvents(pane: Pane) {
    const el = pane.el;
    const pos = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const send = (type: PaneEvent['type'], e: MouseEvent) => {
      const [px, py] = pos(e);
      this.handler?.onPointer({ pane, type, px, py, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
    };
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (ui.activePane.peek() !== pane.index) ui.activePane.value = pane.index;
      const [px, py] = pos(e);
      const vs = pane.vs;
      if (!vs) return;
      const wantPan = e.button === 1 || (e.button === 0 && this.spaceDown);
      const wantOrbit = e.button === 2 || (e.button === 0 && e.altKey) || (e.button === 1 && (e.ctrlKey || e.metaKey));
      if (wantOrbit && vs.is3d) {
        const hit = this.pick(pane, px, py);
        this.drag = { pane, mode: 'orbit', x: px, y: py, pivot: hit?.point, moved: false };
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (wantPan || (e.button === 2 && !vs.is3d)) {
        this.drag = { pane, mode: 'pan', x: px, y: py, moved: false };
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (e.button === 0) {
        el.setPointerCapture(e.pointerId);
        send('down', e);
      }
    });
    el.addEventListener('pointermove', (e) => {
      const [px, py] = pos(e);
      if (this.drag && this.drag.pane === pane) {
        const dx = px - this.drag.x;
        const dy = py - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.drag.moved = true;
        this.drag.x = px;
        this.drag.y = py;
        if (this.drag.mode === 'pan') pane.vs?.pan(dx, dy);
        else pane.vs?.orbit(dx, dy, this.drag.pivot);
        this.requestRender();
        return;
      }
      send('move', e);
    });
    el.addEventListener('pointerup', (e) => {
      if (this.drag && this.drag.pane === pane) {
        const d = this.drag;
        this.drag = null;
        el.releasePointerCapture(e.pointerId);
        this.saveCamera(pane);
        // 右鍵沒拖曳 = 結束／中斷（同 Tekla 中鍵完成多邊形）
        if (!d.moved && e.button === 2) send('up', e);
        if (!d.moved && e.button === 1) send('up', e);
        return;
      }
      if (e.button === 0) send('up', e);
    });
    el.addEventListener('dblclick', (e) => send('dbl', e));
    el.addEventListener('pointerleave', (e) => send('leave', e));
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const vs = pane.vs;
        if (!vs) return;
        const [px, py] = pos(e);
        const scaleDelta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        if (e.ctrlKey) {
          vs.zoomAt(px, py, Math.exp(scaleDelta * 0.01));
        } else if (ui.trackpad.peek()) {
          vs.pan(-e.deltaX, -e.deltaY);
        } else {
          const hit = vs.is3d && !vs.cam.ortho ? this.pick(pane, px, py)?.point : undefined;
          vs.zoomAt(px, py, Math.exp(Math.max(-1, Math.min(1, scaleDelta * 0.0018))), hit);
        }
        this.requestRender();
        clearTimeout((pane as any)._camTimer);
        (pane as any)._camTimer = setTimeout(() => this.saveCamera(pane), 600);
      },
      { passive: false },
    );
  }

  /** 相機位置存回視圖定義（不進 Undo） */
  private saveCamera(pane: Pane) {
    const vs = pane.vs;
    if (!vs) return;
    vs.def = { ...vs.def, camera: vs.snapshot() };
    const p = store.p;
    const i = p.views.findIndex((v) => v.id === vs.def.id);
    if (i >= 0) p.views[i] = vs.def;
  }

  // ---------- 拾取 ----------

  /** 射線在視圖深度範圍內的參數區間 */
  private depthRange(vs: ViewState, r: Ray): [number, number] {
    let lo = -Infinity;
    let hi = Infinity;
    if (vs.def.kind === '3d') return [lo, hi];
    for (const pl of vs.clip) {
      const n: V3 = [pl.normal.x, pl.normal.y, pl.normal.z];
      const a = dot(n, r.origin) + pl.constant;
      const b = dot(n, r.dir);
      if (Math.abs(b) < 1e-12) {
        if (a < 0) return [1, 0];
        continue;
      }
      const t = -a / b;
      if (b > 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
    }
    return [lo, hi];
  }

  pick(pane: Pane, px: number, py: number): Hit | null {
    const vs = pane.vs;
    if (!vs) return null;
    const r = vs.ray(px, py);
    const [lo, hi] = this.depthRange(vs, r);
    let best: Hit | null = null;
    const lineMode = ui.displayMode.peek() === 'line';
    const allow = ui.selectable.peek();
    for (const g of this.members.geoms.values()) {
      const mt = this.members.memberOf(g.id)?.type;
      if (mt && !allow.has(mt)) continue;
      if (lineMode || g.error) {
        const d = this.screenDistToSegment(vs, px, py, g.start, g.end);
        if (d !== null && d.dist < 6) {
          const pt = d.point;
          const t = dot([pt[0] - r.origin[0], pt[1] - r.origin[1], pt[2] - r.origin[2]], r.dir);
          if (t >= lo - 1 && t <= hi + 1 && (!best || t < best.t)) best = { id: g.id, t, point: pt };
        }
        continue;
      }
      const span = rayOBBSpan(r, g);
      if (!span) continue;
      const t0 = Math.max(span[0], lo);
      const t1 = Math.min(span[1], hi);
      if (t0 > t1 || t1 < 0) continue;
      const t = Math.max(t0, 0);
      if (!best || t < best.t) best = { id: g.id, t, point: addScaled(r.origin, r.dir, t) };
    }
    return best;
  }

  private screenDistToSegment(vs: ViewState, px: number, py: number, a: V3, b: V3): { dist: number; point: V3 } | null {
    const pa = vs.project(a);
    const pb = vs.project(b);
    if (pa[2] > 1 || pb[2] > 1) return null;
    const dx = pb[0] - pa[0];
    const dy = pb[1] - pa[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - pa[0]) * dx + (py - pa[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const sx = pa[0] + dx * t;
    const sy = pa[1] + dy * t;
    return { dist: Math.hypot(px - sx, py - sy), point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] };
  }

  /** 框選：window=true 須整支在框內（左→右），否則相交即選（右→左） */
  boxSelect(pane: Pane, x0: number, y0: number, x1: number, y1: number, window: boolean): string[] {
    const vs = pane.vs;
    if (!vs) return [];
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const out: string[] = [];
    const allow = ui.selectable.peek();
    for (const g of this.members.geoms.values()) {
      const mt = this.members.memberOf(g.id)?.type;
      if (mt && !allow.has(mt)) continue;
      if (!this.segmentInDepth(vs, g)) continue;
      const pts = ui.displayMode.peek() === 'line' || g.error ? [g.start, g.end] : obbCorners(g);
      let ax = Infinity;
      let bx = -Infinity;
      let ay = Infinity;
      let by = -Infinity;
      let behind = false;
      for (const p of pts) {
        const s = vs.project(p);
        if (s[2] > 1) behind = true;
        ax = Math.min(ax, s[0]);
        bx = Math.max(bx, s[0]);
        ay = Math.min(ay, s[1]);
        by = Math.max(by, s[1]);
      }
      if (behind) continue;
      const inside = ax >= minX && bx <= maxX && ay >= minY && by <= maxY;
      const overlap = ax <= maxX && bx >= minX && ay <= maxY && by >= minY;
      if (window ? inside : overlap) out.push(g.id);
    }
    return out;
  }

  /** 構件包圍盒是否有部分在視圖深度內（兩裁切面平行，各自檢查最大值即可） */
  segmentInDepth(vs: ViewState, g: MemberGeom): boolean {
    if (vs.def.kind === '3d') return true;
    for (const pl of vs.clip) {
      const n: V3 = [pl.normal.x, pl.normal.y, pl.normal.z];
      const ext = Math.abs(dot(n, g.axes[0])) * g.half[0] + Math.abs(dot(n, g.axes[1])) * g.half[1] + Math.abs(dot(n, g.axes[2])) * g.half[2];
      if (dot(n, g.center) + pl.constant + ext < 0) return false;
    }
    return true;
  }

  // ---------- 選取把手 ----------

  private updateHandles() {
    for (const c of [...this.handles.children]) {
      this.handles.remove(c);
      disposeGroup(c);
    }
    const sel = store.selection.peek();
    if (!sel.size || sel.size > 300) return;
    const line: number[] = [];
    const s: number[] = [];
    const e: number[] = [];
    for (const id of sel) {
      const g = this.members.geoms.get(id);
      if (!g) continue;
      if (g.plate) {
        for (let i = 0; i < g.plate.length; i++) line.push(...g.plate[i], ...g.plate[(i + 1) % g.plate.length]);
        s.push(...g.plate[0]);
        continue;
      }
      line.push(...g.start, ...g.end);
      s.push(...g.start);
      e.push(...g.end);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
    const l = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: COLORS.edgeSelected, depthTest: false, transparent: true }));
    l.renderOrder = 10;
    l.frustumCulled = false;
    const mk = (arr: number[], color: string) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 9, sizeAttenuation: false, depthTest: false, transparent: true }));
      pts.renderOrder = 11;
      pts.frustumCulled = false;
      return pts;
    };
    this.handles.add(l, mk(s, '#f2d600'), mk(e, '#d63bd6'));
  }

  // ---------- 繪製 ----------

  requestRender() {
    this.dirty = true;
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    if (!this.dirty) return;
    this.dirty = false;
    this.render();
  };

  private render() {
    if (!this.container) return;
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width));
    const h = Math.max(1, Math.floor(r.height));
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const rd = this.renderer;
    rd.setScissorTest(false);
    rd.setClearColor(0xc9d2dc, 1);
    rd.clear();
    rd.setScissorTest(true);
    for (const pane of this.panes) {
      if (!pane?.vs || !pane.overlay) continue;
      const pr = pane.el.getBoundingClientRect();
      const x = pr.left - r.left;
      const y = pr.top - r.top;
      const pw = pr.width;
      const ph = pr.height;
      if (pw < 2 || ph < 2) continue;
      const vs = pane.vs;
      if (Math.abs(vs.width - pw) > 0.5 || Math.abs(vs.height - ph) > 0.5) vs.setSize(pw, ph);
      if (!vs.fitted && !vs.def.camera) {
        vs.fit(store.p, this.members.bounds());
        vs.fitted = true;
      }
      rd.setViewport(x, h - y - ph, pw, ph);
      rd.setScissor(x, h - y - ph, pw, ph);
      rd.setClearColor(vs.is3d ? COLORS.bg3d : COLORS.bgPlan, 1);
      rd.clear();
      rd.clippingPlanes = vs.clip;
      this.drawings.setPass(vs.is3d);
      for (const p of this.panes) if (p?.overlay) p.overlay.group.visible = p === pane;
      // 頭燈：跟著相機方向，略偏左上
      const eye = vs.eyeDir();
      const up = vs.screenUp();
      const t = vs.cam.target;
      this.light.position.set(t[0] + (eye[0] + up[0] * 0.5) * 1e5, t[1] + (eye[1] + up[1] * 0.5) * 1e5, t[2] + (eye[2] + up[2] * 0.5 + 0.3) * 1e5);
      this.light.target.position.set(t[0], t[1], t[2]);
      this.light.target.updateMatrixWorld();
      rd.render(this.scene, vs.camera);
      this.updateLabels(pane);
    }
    rd.clippingPlanes = [];
  }

  private updateLabels(pane: Pane) {
    const vs = pane.vs!;
    const labels = pane.overlay?.labels ?? [];
    let used = 0;
    for (const l of labels) {
      const s = vs.project(l.pos);
      if (s[2] > 1 || s[0] < -40 || s[1] < -40 || s[0] > vs.width + 40 || s[1] > vs.height + 40) continue;
      let el = pane.labelPool[used];
      if (!el) {
        el = document.createElement('div');
        pane.labelsEl.appendChild(el);
        pane.labelPool[used] = el;
      }
      el.className = l.kind === 'grid' ? 'lbl-grid' : 'lbl-level';
      if (el.textContent !== l.text) el.textContent = l.text;
      el.style.transform = `translate(${s[0].toFixed(1)}px, ${s[1].toFixed(1)}px)`;
      el.style.display = '';
      used++;
    }
    // 構件標註（平面、立面視圖）：編號或斷面
    const mode = ui.labels.peek();
    if (mode !== 'none' && !vs.is3d) {
      let n = 0;
      for (const g of this.members.geoms.values()) {
        if (n >= 600) break;
        const m = this.members.memberOf(g.id);
        if (!m || !this.segmentInDepth(vs, g)) continue;
        let pos: V3;
        if (g.plate) {
          const c = g.plate.reduce<V3>((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
          pos = [c[0] / g.plate.length, c[1] / g.plate.length, c[2] / g.plate.length];
        } else pos = [(g.start[0] + g.end[0]) / 2, (g.start[1] + g.end[1]) / 2, (g.start[2] + g.end[2]) / 2];
        const s = vs.project(pos);
        if (s[2] > 1 || s[0] < 0 || s[1] < 0 || s[0] > vs.width || s[1] > vs.height) continue;
        const text = mode === 'mark' ? m.mark || '?' : m.profile;
        let el = pane.labelPool[used];
        if (!el) {
          el = document.createElement('div');
          pane.labelsEl.appendChild(el);
          pane.labelPool[used] = el;
        }
        el.className = 'lbl-member';
        if (el.textContent !== text) el.textContent = text;
        el.style.transform = `translate(${s[0].toFixed(1)}px, ${s[1].toFixed(1)}px)`;
        el.style.display = '';
        used++;
        n++;
      }
    }
    for (let i = used; i < pane.labelPool.length; i++) pane.labelPool[i].style.display = 'none';
  }
}

/** 射線與定向包圍盒的進出參數 */
export function rayOBBSpan(r: Ray, g: MemberGeom): [number, number] | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  const d: V3 = [g.center[0] - r.origin[0], g.center[1] - r.origin[1], g.center[2] - r.origin[2]];
  for (let i = 0; i < 3; i++) {
    const a = g.axes[i];
    const e = dot(a, d);
    const f = dot(a, r.dir);
    const h = Math.max(g.half[i], 2);
    if (Math.abs(f) > 1e-9) {
      let t1 = (e + h) / f;
      let t2 = (e - h) / f;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return null;
    } else if (-e - h > 0 || -e + h < 0) return null;
  }
  return [tMin, tMax];
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
