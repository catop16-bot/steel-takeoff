import * as THREE from 'three';
import { toast, ui, type ToolId } from '../app/ui';
import { levelAt, levelBelow } from '../geom/grid';
import { add, addScaled, dist, norm, round3, scale, sub, type V3 } from '../geom/vec';
import { newMember } from '../model/defaults';
import { store } from '../model/store';
import { MEMBER_TYPE_LABEL, type Member, type MemberType } from '../model/types';
import { COLORS } from '../view3d/colors';
import { ghostMember } from '../view3d/members';
import { disposeGroup } from '../view3d/overlay';
import { isTyping, type Pane, type PaneEvent, type PointerHandler, type Viewer } from '../view3d/viewer';
import { findSnap, SNAP_LABEL, type Snap } from './snap';
import { mirrorFn, rotateFn, splitMember, transformMember, translate } from '../model/edit';
import { solveAlignment, worldToPlane } from '../drawing/placement';

interface Tool {
  id: ToolId;
  start(): void;
  pointer(e: PaneEvent, snap: Snap | null): void;
  /** 右鍵或 Enter：完成 */
  finish(): void;
  /** Esc：中斷 */
  cancel(): void;
  /** 數值輸入產生的點 */
  point?(p: V3, pane: Pane): void;
  /** 目前的參考點（數值輸入的相對基準） */
  base?(): V3 | undefined;
  /** 限制鎖點來源 */
  snapOnly?(): 'model' | 'drawing' | undefined;
  /** 工具專用按鍵，回傳 true 表示已處理 */
  key?(k: string): boolean;
  /** 工具自行處理數值輸入（例如旋轉角度），回傳 true 表示已處理 */
  numericInput?(text: string): boolean;
  usesSnap: boolean;
}

export class Controller implements PointerHandler {
  private viewer: Viewer;
  private tool: Tool;
  private tools: Record<ToolId, Tool>;
  lastSnap: Snap | null = null;
  lastPane: Pane | null = null;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    viewer.handler = this;
    this.tools = {
      select: new SelectTool(this, viewer),
      column: new ColumnTool(this, viewer),
      girder: new LinearTool(this, viewer, 'girder'),
      beam: new LinearTool(this, viewer, 'beam'),
      brace: new LinearTool(this, viewer, 'brace'),
      purlin: new LinearTool(this, viewer, 'purlin'),
      plate: new PlateTool(this, viewer),
      measure: new MeasureTool(this, viewer),
      align: new AlignTool(this, viewer),
      pick: new PickTool(this, viewer),
      box: new BoxTool(this, viewer),
      move: new MoveCopyTool(this, viewer, false),
      copy: new MoveCopyTool(this, viewer, true),
      mirror: new MirrorTool(this, viewer),
      rotate: new RotateTool(this, viewer),
      split: new SplitTool(this, viewer),
    };
    this.tool = this.tools.select;
    this.tool.start();
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  setTool(id: ToolId) {
    this.tool.cancel();
    this.clearPreview();
    this.tool = this.tools[id];
    ui.tool.value = id;
    ui.numeric.value = '';
    this.tool.start();
    this.viewer.requestRender();
  }

  /** 點選圖紙上的一條線，回傳圖層名稱 */
  startPick(prompt: string, cb: (drawingId: string, layer: string) => void) {
    this.setTool('pick');
    const t = this.tools.pick as PickTool;
    t.cb = cb;
    ui.prompt.value = prompt;
  }

  /** 在視圖上框選一個範圍 */
  startBox(prompt: string, cb: (pane: Pane, x0: number, y0: number, x1: number, y1: number) => void) {
    this.setTool('box');
    const t = this.tools.box as BoxTool;
    t.cb = cb;
    ui.prompt.value = prompt;
  }

  /** 從圖紙面板開始兩點對位 */
  startAlign(drawingId: string) {
    this.setTool('align');
    (this.tools.align as AlignTool).drawingId = drawingId;
  }

  get current(): ToolId {
    return this.tool.id;
  }

  onPointer(e: PaneEvent) {
    this.lastPane = e.pane;
    let snap: Snap | null = null;
    if (this.tool.usesSnap && e.type !== 'leave') {
      snap = findSnap(this.viewer, e.pane, e.px, e.py, { prev: this.tool.base?.(), only: this.tool.snapOnly?.() });
      this.lastSnap = snap;
      this.showMarker(e.pane, snap);
      ui.cursor.value = snap?.p ?? null;
      ui.snapKind.value = snap ? SNAP_LABEL[snap.kind] : '';
    } else if (e.type === 'leave') {
      e.pane.markerEl.style.display = 'none';
    } else {
      const p = e.pane.vs?.rayPlane(e.pane.vs.ray(e.px, e.py));
      ui.cursor.value = p ?? null;
      ui.snapKind.value = '';
    }
    if (e.type === 'up' && e.button === 2) {
      this.tool.finish();
      this.viewer.requestRender();
      return;
    }
    this.tool.pointer(e, snap);
    this.viewer.requestRender();
  }

  private showMarker(pane: Pane, s: Snap | null) {
    const el = pane.markerEl;
    for (const p of this.viewer.allPanes()) if (p !== pane) p.markerEl.style.display = 'none';
    if (!s) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.className = `snap-marker snap-${s.kind}`;
    el.style.transform = `translate(${s.sx}px, ${s.sy}px)`;
  }

  // ---- 預覽 ----

  setPreview(objs: THREE.Object3D[]) {
    this.clearPreview();
    for (const o of objs) this.viewer.preview.add(o);
    this.viewer.requestRender();
  }

  clearPreview() {
    for (const c of [...this.viewer.preview.children]) {
      this.viewer.preview.remove(c);
      if (!c.userData.shared) disposeGroup(c);
    }
  }

  // ---- 鍵盤 ----

  private onKey(e: KeyboardEvent) {
    if (isTyping(e) || ui.dialog.peek() || document.querySelector('.modal-back')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && (k === 'y' || k === 'Y')) {
      e.preventDefault();
      store.redo();
      return;
    }
    if (mod && (k === 'p' || k === 'P')) {
      e.preventDefault();
      this.viewer.toggleRotatable();
      return;
    }
    if (mod && (k === 'm' || k === 'M')) {
      e.preventDefault();
      this.setTool('move');
      return;
    }
    if (mod && (k === 'c' || k === 'C') && store.selection.peek().size) {
      e.preventDefault();
      this.setTool('copy');
      return;
    }
    if (mod && (k === 'a' || k === 'A')) {
      e.preventDefault();
      store.select(store.p.members.map((m) => m.id));
      return;
    }
    if (mod) return;
    const num = ui.numeric.peek();
    if (k === 'Escape') {
      if (num) ui.numeric.value = '';
      else if (this.tool.id !== 'select') this.setTool('select');
      else {
        this.tool.cancel();
        store.select([]);
      }
      return;
    }
    if (k === 'Enter') {
      if (num) this.applyNumeric(num);
      else this.tool.finish();
      e.preventDefault();
      return;
    }
    if (num && k === 'Backspace') {
      ui.numeric.value = num.slice(0, -1);
      e.preventDefault();
      return;
    }
    if ((k === 'Delete' || k === 'Backspace') && !num) {
      const sel = store.selection.peek();
      if (sel.size) store.remove('members', sel, `刪除 ${sel.size} 支構件`);
      e.preventDefault();
      return;
    }
    if ((this.tool.point || this.tool.numericInput) && /^[0-9.,@\-]$/.test(k)) {
      ui.numeric.value = num + k;
      e.preventDefault();
      return;
    }
    if (this.tool.key?.(k)) {
      e.preventDefault();
      return;
    }
    if (k === 'o' || k === 'O') {
      ui.ortho.value = !ui.ortho.peek();
      toast(ui.ortho.peek() ? '正交：開' : '正交：關');
      return;
    }
    if (k === 'f' || k === 'F') {
      this.viewer.fitAll();
      return;
    }
  }

  /** 解析數值輸入：6000（沿游標方向）、@dx,dy,dz（相對）、x,y（工作平面）、x,y,z（全域） */
  applyNumeric(text: string) {
    ui.numeric.value = '';
    if (this.tool.numericInput?.(text)) {
      this.viewer.requestRender();
      return;
    }
    const pane = this.lastPane ?? this.viewer.activePane();
    const vs = pane?.vs;
    if (!pane || !vs || !this.tool.point) return;
    const base = this.tool.base?.();
    const t = text.trim();
    const rel = t.startsWith('@');
    const nums = t
      .replace(/^@/, '')
      .split(',')
      .map((s) => (s.trim() === '' ? 0 : Number(s)));
    if (nums.some((n) => !Number.isFinite(n))) {
      toast(`無法解析數值「${text}」`);
      return;
    }
    const pl = vs.plane;
    let p: V3;
    if (nums.length === 1 && !rel) {
      if (!base) {
        toast('請先選第一點，再輸入長度');
        return;
      }
      const cur = this.lastSnap?.p;
      let dir = cur ? sub(cur, base) : pl.right;
      if (Math.hypot(...dir) < 1e-6) dir = pl.right;
      p = addScaled(base, norm(dir), nums[0]);
    } else if (rel) {
      if (!base) {
        toast('相對座標需要先選一點');
        return;
      }
      const [dx = 0, dy = 0, dz = 0] = nums;
      p = add(add(add(base, scale(pl.right, dx)), scale(pl.up, dy)), scale(pl.normal, dz));
    } else if (nums.length === 2) {
      p = add(add(pl.origin, scale(pl.right, nums[0])), scale(pl.up, nums[1]));
      if (vs.def.kind === 'plan') p = [nums[0], nums[1], pl.origin[2]];
    } else {
      p = [nums[0], nums[1], nums[2]];
    }
    this.tool.point(round3(p), pane);
    this.viewer.requestRender();
  }
}

// ---------------- 選取 ----------------

class SelectTool implements Tool {
  id: ToolId = 'select';
  usesSnap = false;
  private down: { x: number; y: number; pane: Pane; shift: boolean; ctrl: boolean } | null = null;
  constructor(
    _c: Controller,
    private v: Viewer,
  ) {}
  start() {
    ui.prompt.value = '點選構件；左→右框選完整包含、右→左框選相交；Shift 加選、Ctrl 切換';
  }
  pointer(e: PaneEvent) {
    if (e.type === 'down') {
      this.down = { x: e.px, y: e.py, pane: e.pane, shift: e.shift, ctrl: e.ctrl };
      return;
    }
    if (e.type === 'move') {
      if (this.down && this.down.pane === e.pane) {
        const r = e.pane.rubberEl;
        const x0 = Math.min(this.down.x, e.px);
        const y0 = Math.min(this.down.y, e.py);
        const w = Math.abs(e.px - this.down.x);
        const h = Math.abs(e.py - this.down.y);
        if (w + h > 4) {
          r.style.display = 'block';
          r.className = e.px >= this.down.x ? 'rubber window' : 'rubber crossing';
          r.style.transform = `translate(${x0}px, ${y0}px)`;
          r.style.width = `${w}px`;
          r.style.height = `${h}px`;
        }
        return;
      }
      const hit = this.v.pick(e.pane, e.px, e.py);
      this.v.members.setHover(hit?.id ?? '');
      e.pane.el.style.cursor = hit ? 'pointer' : 'default';
      return;
    }
    if (e.type === 'up' && this.down) {
      const d = this.down;
      this.down = null;
      d.pane.rubberEl.style.display = 'none';
      const mode = d.shift ? 'add' : d.ctrl ? 'toggle' : 'set';
      if (Math.abs(e.px - d.x) + Math.abs(e.py - d.y) > 4) {
        const ids = this.v.boxSelect(d.pane, d.x, d.y, e.px, e.py, e.px >= d.x);
        store.select(ids, mode);
      } else {
        const hit = this.v.pick(d.pane, e.px, e.py);
        if (hit) store.select([hit.id], mode);
        else if (mode === 'set') store.select([]);
      }
    }
    if (e.type === 'leave') this.v.members.setHover('');
  }
  finish() {}
  cancel() {
    this.down = null;
    for (const p of this.v.allPanes()) p.rubberEl.style.display = 'none';
  }
}

// ---------------- 共用 ----------------

function defaultsOf(t: MemberType) {
  return store.p.settings.defaults[t];
}

function previewLine(a: V3, b: V3): THREE.Object3D {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b], 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: COLORS.preview, depthTest: false, transparent: true }));
  l.renderOrder = 20;
  l.frustumCulled = false;
  return l;
}

function previewPolyline(pts: V3[], closed = false): THREE.Object3D {
  const arr: number[] = [];
  for (const p of pts) arr.push(...p);
  if (closed && pts.length) arr.push(...pts[0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: COLORS.preview, depthTest: false, transparent: true }));
  l.renderOrder = 20;
  l.frustumCulled = false;
  return l;
}

function levelZ(id: string | undefined, fallback: number): number {
  const l = store.p.levels.find((x) => x.id === id);
  return l ? l.elevation : fallback;
}

// ---------------- 柱 ----------------

class ColumnTool implements Tool {
  id: ToolId = 'column';
  usesSnap = true;
  constructor(
    private c: Controller,
    _v: Viewer,
  ) {}
  start() {
    ui.prompt.value = '柱：點選柱位置（底部、頂部高程依屬性面板設定）';
  }
  private range(): [number, number] {
    const d = defaultsOf('column');
    const levels = [...store.p.levels].sort((a, b) => a.elevation - b.elevation);
    const z0 = levelZ(d.bottomLevelId, levels[0]?.elevation ?? 0) + (d.bottomOffset ?? 0);
    const z1 = levelZ(d.topLevelId, levels[1]?.elevation ?? z0 + 4000) + (d.topOffset ?? 0);
    return [z0, z1];
  }
  private make(p: V3): Member | null {
    const d = defaultsOf('column');
    const [z0, z1] = this.range();
    if (!(z1 > z0)) {
      toast('柱頂部高程必須高於底部，請在屬性面板調整');
      return null;
    }
    return newMember('column', d, round3([p[0], p[1], z0]), round3([p[0], p[1], z1]), {
      levelId: d.bottomLevelId ?? levelBelow(store.p.levels, z0)?.id,
      startRef: { levelId: d.bottomLevelId },
      endRef: { levelId: d.topLevelId },
    });
  }
  pointer(e: PaneEvent, snap: Snap | null) {
    if (!snap) {
      this.c.clearPreview();
      return;
    }
    if (e.type === 'move') {
      const m = this.make(snap.p);
      const g = m && ghostMember(m);
      this.c.setPreview(g ? [g] : []);
    }
    if (e.type === 'up' && e.button === 0) this.point(snap.p);
  }
  point(p: V3) {
    const m = this.make(p);
    if (!m) return;
    store.add('members', [m], `建立柱 ${m.profile}`);
  }
  finish() {}
  cancel() {
    this.c.clearPreview();
  }
}

// ---------------- 梁、斜撐、桁條 ----------------

class LinearTool implements Tool {
  id: ToolId;
  usesSnap = true;
  private p1: V3 | null = null;
  constructor(
    private c: Controller,
    _v: Viewer,
    private type: MemberType,
  ) {
    this.id = type;
  }
  start() {
    this.p1 = null;
    this.prompt();
  }
  private prompt() {
    const name = MEMBER_TYPE_LABEL[this.type];
    ui.prompt.value = this.p1 ? `${name}：選終點（可直接輸入長度後按 Enter；O 切換正交）` : `${name}：選起點`;
  }
  base() {
    return this.p1 ?? undefined;
  }
  private make(a: V3, b: V3): Member {
    const d = defaultsOf(this.type);
    const zTop = Math.max(a[2], b[2]);
    const zBot = Math.min(a[2], b[2]);
    const levels = store.p.levels;
    const lvl = this.type === 'brace' ? levelBelow(levels, zBot) : (levelAt(levels, zTop, 1) ?? levelBelow(levels, zTop));
    return newMember(this.type, d, round3(a), round3(b), {
      levelId: lvl?.id,
      startRef: { levelId: levelAt(levels, a[2], 1)?.id },
      endRef: { levelId: levelAt(levels, b[2], 1)?.id },
    });
  }
  pointer(e: PaneEvent, snap: Snap | null) {
    if (e.type === 'move') {
      if (this.p1 && snap) {
        const m = this.make(this.p1, snap.p);
        const g = dist(this.p1, snap.p) > 1 ? ghostMember(m) : null;
        const len = dist(this.p1, snap.p);
        ui.snapKind.value = `${SNAP_LABEL[snap.kind]}　長度 ${Math.round(len)}`;
        this.c.setPreview(g ? [g, previewLine(this.p1, snap.p)] : [previewLine(this.p1, snap.p)]);
      } else this.c.clearPreview();
      return;
    }
    if (e.type === 'up' && e.button === 0 && snap) this.point(snap.p);
  }
  point(p: V3) {
    if (!this.p1) {
      this.p1 = p;
      this.prompt();
      return;
    }
    if (dist(this.p1, p) < 1) {
      toast('起點與終點相同');
      return;
    }
    const m = this.make(this.p1, p);
    store.add('members', [m], `建立${MEMBER_TYPE_LABEL[this.type]} ${m.profile}`);
    this.p1 = null;
    this.c.clearPreview();
    this.prompt();
  }
  finish() {
    this.cancel();
  }
  cancel() {
    this.p1 = null;
    this.c.clearPreview();
    this.prompt();
  }
}

// ---------------- 多邊形鋼板 ----------------

class PlateTool implements Tool {
  id: ToolId = 'plate';
  usesSnap = true;
  private pts: V3[] = [];
  constructor(
    private c: Controller,
    _v: Viewer,
  ) {}
  start() {
    this.pts = [];
    this.prompt();
  }
  private prompt() {
    ui.prompt.value = this.pts.length < 3 ? `鋼板：依序點選角點（已選 ${this.pts.length} 點）` : `鋼板：繼續點選，右鍵或 Enter 完成（已選 ${this.pts.length} 點）`;
  }
  base() {
    return this.pts[this.pts.length - 1];
  }
  pointer(e: PaneEvent, snap: Snap | null) {
    if (e.type === 'move') {
      if (this.pts.length && snap) this.c.setPreview([previewPolyline([...this.pts, snap.p], this.pts.length >= 2)]);
      return;
    }
    if (e.type === 'up' && e.button === 0 && snap) {
      if (this.pts.length >= 3 && dist(snap.p, this.pts[0]) < 1) {
        this.finish();
        return;
      }
      this.point(snap.p);
    }
  }
  point(p: V3) {
    const last = this.pts[this.pts.length - 1];
    if (last && dist(last, p) < 1) return;
    this.pts.push(p);
    this.prompt();
  }
  finish() {
    if (this.pts.length < 3) {
      this.cancel();
      return;
    }
    const d = defaultsOf('plate');
    const z = Math.min(...this.pts.map((p) => p[2]));
    const m = newMember('plate', d, this.pts[0], this.pts[1], {
      points: this.pts.map(round3),
      levelId: levelBelow(store.p.levels, z + 1)?.id,
    });
    store.add('members', [m], `建立鋼板 ${m.profile}`);
    this.pts = [];
    this.c.clearPreview();
    this.prompt();
  }
  cancel() {
    this.pts = [];
    this.c.clearPreview();
    this.prompt();
  }
}

// ---------------- 量測 ----------------

class MeasureTool implements Tool {
  id: ToolId = 'measure';
  usesSnap = true;
  private p1: V3 | null = null;
  constructor(
    private c: Controller,
    _v: Viewer,
  ) {}
  start() {
    this.p1 = null;
    ui.prompt.value = '量測：選第一點';
  }
  base() {
    return this.p1 ?? undefined;
  }
  pointer(e: PaneEvent, snap: Snap | null) {
    if (e.type === 'move' && this.p1 && snap) {
      this.c.setPreview([previewLine(this.p1, snap.p)]);
      ui.snapKind.value = `${SNAP_LABEL[snap.kind]}　距離 ${dist(this.p1, snap.p).toFixed(1)}`;
    }
    if (e.type === 'up' && e.button === 0 && snap) this.point(snap.p);
  }
  point(p: V3) {
    if (!this.p1) {
      this.p1 = p;
      ui.prompt.value = '量測：選第二點';
      return;
    }
    const d = sub(p, this.p1);
    toast(`距離 ${dist(this.p1, p).toFixed(1)} mm（ΔX ${d[0].toFixed(1)}、ΔY ${d[1].toFixed(1)}、ΔZ ${d[2].toFixed(1)}）`, 6000);
    this.c.setPreview([previewLine(this.p1, p)]);
    this.p1 = null;
    ui.prompt.value = '量測：選第一點';
  }
  finish() {
    this.cancel();
  }
  cancel() {
    this.p1 = null;
    this.c.clearPreview();
  }
}

// ---------------- 圖紙兩點對位 ----------------

class AlignTool implements Tool {
  id: ToolId = 'align';
  usesSnap = true;
  drawingId = '';
  private pairs: { z: [number, number]; w: V3 }[] = [];
  private pending: { z: [number, number]; world: V3 } | null = null;
  constructor(
    private c: Controller,
    private v: Viewer,
  ) {}
  start() {
    this.pairs = [];
    this.pending = null;
    this.drawingId = '';
    this.prompt();
  }
  private prompt() {
    const sc = `（S：${ui.alignScale.peek() ? '同時調整比例' : '比例不變'}）`;
    const n = this.pairs.length + 1;
    ui.prompt.value = this.pending
      ? `圖紙對位：選模型上對應的第 ${n} 點（例如軸線交點）${sc}`
      : n === 1
        ? `圖紙對位：在圖紙上選第 1 點（例如圖上的軸線交點）${sc}`
        : `圖紙對位：在圖紙上選第 2 點，或按 Enter 只平移${sc}`;
  }
  snapOnly() {
    return this.pending ? ('model' as const) : ('drawing' as const);
  }
  base() {
    return this.pending?.world;
  }
  key(k: string) {
    if (k === 's' || k === 'S') {
      ui.alignScale.value = !ui.alignScale.peek();
      this.prompt();
      return true;
    }
    return false;
  }
  pointer(e: PaneEvent, snap: Snap | null) {
    if (e.type === 'move') {
      if (this.pending && snap) this.c.setPreview([previewLine(this.pending.world, snap.p)]);
      return;
    }
    if (e.type !== 'up' || e.button !== 0 || !snap) return;
    if (!this.pending) {
      if (!snap.drawingId || !snap.local) {
        toast('請點在圖紙的線段端點、交點或圓心上');
        return;
      }
      if (this.drawingId && snap.drawingId !== this.drawingId) {
        toast('第 2 點要點在同一張圖紙上');
        return;
      }
      this.drawingId = snap.drawingId;
      const it = this.v.drawings.items.get(snap.drawingId);
      if (!it?.data) return;
      this.pending = { z: [snap.local[0] + it.data.base[0], snap.local[1] + it.data.base[1]], world: snap.p };
    } else {
      this.pairs.push({ z: this.pending.z, w: snap.p });
      this.pending = null;
      this.c.clearPreview();
      if (this.pairs.length >= 2) {
        this.apply();
        return;
      }
    }
    this.prompt();
  }
  point() {}
  private apply() {
    const it = this.v.drawings.items.get(this.drawingId);
    if (!it?.frame || !this.pairs.length) return;
    const ref = it.ref;
    const pairs = this.pairs.map((p) => ({ z: p.z, w: worldToPlane(it.frame!, p.w) }));
    const keep = !ui.alignScale.peek() || pairs.length < 2;
    const r = solveAlignment(ref, pairs, keep);
    store.replace('drawings', [{ ...ref, scale: r.scale, rotation: Math.round(r.rotation * 1e6) / 1e6, offset: [Math.round(r.offset[0] * 100) / 100, Math.round(r.offset[1] * 100) / 100] }], `圖紙對位：${ref.name}`);
    toast(
      pairs.length >= 2
        ? `已對位：旋轉 ${r.rotation.toFixed(3)}°${keep ? '' : `、比例 ${(r.scale).toPrecision(6)} mm／單位`}`
        : '已平移對位',
      5000,
    );
    this.c.setTool('select');
  }
  finish() {
    if (this.pairs.length) this.apply();
    else this.cancel();
  }
  cancel() {
    this.pairs = [];
    this.pending = null;
    this.c.clearPreview();
    this.prompt();
  }
}

// ---------------- 點選圖紙線段（取圖層） ----------------

class PickTool implements Tool {
  id: ToolId = 'pick';
  usesSnap = false;
  cb: ((drawingId: string, layer: string) => void) | null = null;
  constructor(
    private c: Controller,
    private v: Viewer,
  ) {}
  start() {
    this.cb = null;
  }
  pointer(e: PaneEvent) {
    if (e.type !== 'up' || e.button !== 0) return;
    const vs = e.pane.vs;
    if (!vs) return;
    const ray = vs.ray(e.px, e.py);
    let best: { id: string; layer: string; d: number } | null = null;
    for (const it of this.v.drawings.snappable(vs)) {
      const f = it.frame!;
      const hit = vs.rayPlane(ray, { origin: f.origin, normal: f.normal, right: f.right, up: f.up });
      if (!hit) continue;
      const [lx, ly] = this.v.drawings.toLocal(it, hit);
      const r = (10 * vs.worldPerPixel()) / it.ref.scale;
      const n = this.v.drawings.snapIndex(it).nearestSeg(lx, ly, r);
      if (n && (!best || n.dist * it.ref.scale < best.d)) best = { id: it.ref.id, layer: it.data!.layers[n.layer].name, d: n.dist * it.ref.scale };
    }
    if (!best) {
      toast('請點在圖紙的線上');
      return;
    }
    const cb = this.cb;
    this.c.setTool('select');
    cb?.(best.id, best.layer);
  }
  finish() {
    this.c.setTool('select');
  }
  cancel() {}
}

// ---------------- 框選範圍 ----------------

class BoxTool implements Tool {
  id: ToolId = 'box';
  usesSnap = false;
  cb: ((pane: Pane, x0: number, y0: number, x1: number, y1: number) => void) | null = null;
  private down: { x: number; y: number; pane: Pane } | null = null;
  constructor(
    private c: Controller,
    _v: Viewer,
  ) {}
  start() {
    this.cb = null;
    this.down = null;
  }
  pointer(e: PaneEvent) {
    if (e.type === 'down') {
      this.down = { x: e.px, y: e.py, pane: e.pane };
      return;
    }
    if (e.type === 'move' && this.down && this.down.pane === e.pane) {
      const r = e.pane.rubberEl;
      r.style.display = 'block';
      r.className = 'rubber window';
      r.style.transform = `translate(${Math.min(this.down.x, e.px)}px, ${Math.min(this.down.y, e.py)}px)`;
      r.style.width = `${Math.abs(e.px - this.down.x)}px`;
      r.style.height = `${Math.abs(e.py - this.down.y)}px`;
      return;
    }
    if (e.type === 'up' && this.down) {
      const d = this.down;
      this.down = null;
      d.pane.rubberEl.style.display = 'none';
      if (Math.abs(e.px - d.x) + Math.abs(e.py - d.y) < 6) return;
      const cb = this.cb;
      this.c.setTool('select');
      cb?.(d.pane, d.x, d.y, e.px, e.py);
    }
  }
  finish() {
    this.c.setTool('select');
  }
  cancel() {
    this.down = null;
    for (const p of this.c.lastPane ? [this.c.lastPane] : []) p.rubberEl.style.display = 'none';
  }
}

// ---------------- 移動、複製、鏡射、旋轉、分割 ----------------

function selectedMembers(): Member[] {
  const sel = store.selection.peek();
  return store.p.members.filter((m) => sel.has(m.id));
}

function previewMembers(ms: Member[], fn: (p: V3) => V3): THREE.Object3D {
  const arr: number[] = [];
  for (const m of ms.slice(0, 2000)) {
    if (m.points?.length) {
      for (let i = 0; i < m.points.length; i++) arr.push(...fn(m.points[i]), ...fn(m.points[(i + 1) % m.points.length]));
    } else arr.push(...fn(m.start), ...fn(m.end));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: COLORS.preview, depthTest: false, transparent: true }));
  l.renderOrder = 20;
  l.frustumCulled = false;
  return l;
}

class MoveCopyTool implements Tool {
  id: ToolId;
  usesSnap = true;
  private p1: V3 | null = null;
  constructor(
    private c: Controller,
    _v: Viewer,
    private copy: boolean,
  ) {
    this.id = copy ? 'copy' : 'move';
  }
  start() {
    this.p1 = null;
    const n = store.selection.peek().size;
    ui.prompt.value = n ? `${this.copy ? '複製' : '移動'} ${n} 支構件：選基準點` : '請先選取要' + (this.copy ? '複製' : '移動') + '的構件（Esc 結束）';
  }
  base() {
    return this.p1 ?? undefined;
  }
  pointer(e: PaneEvent, snap: Snap | null) {
    if (!store.selection.peek().size) return;
    if (e.type === 'move' && this.p1 && snap) {
      const d = sub(snap.p, this.p1);
      this.c.setPreview([previewMembers(selectedMembers(), (p) => add(p, d)), previewLine(this.p1, snap.p)]);
      ui.snapKind.value = `${SNAP_LABEL[snap.kind]}　位移 ${Math.round(dist(this.p1, snap.p))}`;
    }
    if (e.type === 'up' && e.button === 0 && snap) this.point(snap.p);
  }
  point(p: V3) {
    const ms = selectedMembers();
    if (!ms.length) return;
    if (!this.p1) {
      this.p1 = p;
      ui.prompt.value = `${this.copy ? '複製' : '移動'}：選目標點（或輸入 @dx,dy,dz、距離後按 Enter）`;
      return;
    }
    const d = sub(p, this.p1);
    if (Math.hypot(...d) < 0.01) return;
    if (this.copy) {
      const cs = ms.map((m) => transformMember(m, translate(d), { copy: true }));
      store.add('members', cs, `複製 ${cs.length} 支構件`);
      store.select(cs.map((m) => m.id));
    } else {
      const ids = new Set(ms.map((m) => m.id));
      store.patchMembers(ids, (m) => transformMember(m, translate(d)), `移動 ${ms.length} 支構件`);
    }
    this.c.clearPreview();
    this.c.setTool('select');
  }
  finish() {
    this.cancel();
  }
  cancel() {
    this.p1 = null;
    this.c.clearPreview();
  }
}

class MirrorTool implements Tool {
  id: ToolId = 'mirror';
  usesSnap = true;
  private p1: V3 | null = null;
  private pane: Pane | null = null;
  constructor(
    private c: Controller,
    _v: Viewer,
  ) {}
  start() {
    this.p1 = null;
    const n = store.selection.peek().size;
    ui.prompt.value = n ? `鏡射複製 ${n} 支構件：選鏡射線第 1 點（在平面或立面視圖）` : '請先選取要鏡射的構件';
  }
  base() {
    return this.p1 ?? undefined;
  }
  pointer(e: PaneEvent, snap: Snap | null) {
    this.pane = e.pane;
    if (!store.selection.peek().size) return;
    if (e.type === 'move' && this.p1 && snap && dist(this.p1, snap.p) > 1) {
      const f = mirrorFn(this.p1, snap.p, e.pane.vs!.plane.normal);
      this.c.setPreview([previewMembers(selectedMembers(), f), previewLine(this.p1, snap.p)]);
    }
    if (e.type === 'up' && e.button === 0 && snap) this.point(snap.p, e.pane);
  }
  point(p: V3, pane?: Pane) {
    if (!this.p1) {
      this.p1 = p;
      ui.prompt.value = '鏡射複製：選鏡射線第 2 點';
      return;
    }
    if (dist(this.p1, p) < 1) return;
    const vs = (pane ?? this.pane)?.vs;
    if (!vs) return;
    const f = mirrorFn(this.p1, p, vs.plane.normal);
    const cs = selectedMembers().map((m) => transformMember(m, f, { copy: true, mirror: true }));
    store.add('members', cs, `鏡射複製 ${cs.length} 支構件`);
    store.select(cs.map((m) => m.id));
    this.c.clearPreview();
    this.c.setTool('select');
  }
  finish() {
    this.cancel();
  }
  cancel() {
    this.p1 = null;
    this.c.clearPreview();
  }
}

class RotateTool implements Tool {
  id: ToolId = 'rotate';
  usesSnap = true;
  private center: V3 | null = null;
  private axis: V3 = [0, 0, 1];
  constructor(
    private c: Controller,
    _v: Viewer,
  ) {}
  start() {
    this.center = null;
    const n = store.selection.peek().size;
    ui.prompt.value = n ? `旋轉 ${n} 支構件：選旋轉中心（繞目前視圖的法向）` : '請先選取要旋轉的構件';
  }
  pointer(e: PaneEvent, snap: Snap | null) {
    if (e.type === 'up' && e.button === 0 && snap && !this.center) {
      this.center = snap.p;
      this.axis = e.pane.vs?.plane.normal ?? [0, 0, 1];
      ui.prompt.value = '旋轉：輸入角度（度，逆時針為正）後按 Enter；在 3D 視圖繞 Z 軸';
      if (e.pane.vs?.is3d) this.axis = [0, 0, 1];
    }
  }
  numericInput(text: string): boolean {
    if (!this.center) return false;
    const deg = Number(text);
    if (!Number.isFinite(deg)) {
      toast(`角度錯誤「${text}」`);
      return true;
    }
    const f = rotateFn(this.center, this.axis, deg);
    const ms = selectedMembers();
    store.patchMembers(new Set(ms.map((m) => m.id)), (m) => transformMember(m, f), `旋轉 ${ms.length} 支構件 ${deg}°`);
    this.c.setTool('select');
    return true;
  }
  finish() {
    this.cancel();
  }
  cancel() {
    this.center = null;
  }
}

class SplitTool implements Tool {
  id: ToolId = 'split';
  usesSnap = true;
  constructor(
    private c: Controller,
    private v: Viewer,
  ) {}
  start() {
    ui.prompt.value = '分割：點選構件上要切開的位置（可鎖軸線交點、中點）；Esc 結束';
  }
  pointer(e: PaneEvent, snap: Snap | null) {
    if (e.type !== 'up' || e.button !== 0) return;
    const hit = this.v.pick(e.pane, e.px, e.py);
    if (!hit) {
      toast('請點在構件上');
      return;
    }
    const m = store.p.members.find((x) => x.id === hit.id);
    if (!m) return;
    const parts = splitMember(m, snap?.p ?? hit.point);
    if (!parts) {
      toast('無法在此處分割（太靠近端點或為鋼板）');
      return;
    }
    store.commit('分割構件', [
      { coll: 'members', id: m.id, before: m },
      { coll: 'members', id: parts[0].id, after: parts[0] },
      { coll: 'members', id: parts[1].id, after: parts[1] },
    ]);
    void this.c;
  }
  finish() {
    this.c.setTool('select');
  }
  cancel() {}
}
