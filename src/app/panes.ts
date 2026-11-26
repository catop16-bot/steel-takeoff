import * as L from '../model/layout';
import type { LayoutNode } from '../model/layout';
import { sortedViews } from '../model/ops';
import { store } from '../model/store';
import type { Project } from '../model/types';
import { isTyping } from '../view3d/viewer';
import { app } from './core';
import { toast, ui } from './ui';

/** 窗格最小尺寸（px） */
export const MIN_W = 140;
export const MIN_H = 110;

export type Preset = 'one' | 'two' | 'three' | 'four';

/** 預設視圖順序：3D、第二個平面、第一與最後一個立面，再來其他視圖 */
function defaultViewOrder(p: Project): string[] {
  const v3 = p.views.find((v) => v.kind === '3d');
  const plans = p.views.filter((v) => v.kind === 'plan');
  const elev = p.views.filter((v) => v.kind === 'elevation');
  const ids = [v3, plans[1] ?? plans[0], elev[0], elev[elev.length - 1], ...plans, ...elev, ...p.views].filter((v) => !!v).map((v) => v!.id);
  return [...new Set(ids)];
}

export function buildPreset(kind: Preset, views: string[]): LayoutNode {
  const v = (i: number) => views[i] ?? views[views.length - 1];
  switch (kind) {
    case 'one':
      return L.pane(v(0));
    case 'two':
      return L.split('row', [L.pane(v(0)), L.pane(v(1))]);
    case 'three':
      return L.split('row', [L.pane(v(0)), L.split('col', [L.pane(v(1)), L.pane(v(2))])], [0.58, 0.42]);
    case 'four':
      return L.split('col', [L.split('row', [L.pane(v(0)), L.pane(v(1))]), L.split('row', [L.pane(v(2)), L.pane(v(3))])]);
  }
}

/** 開專案時：用專案存的版面，沒有或無效就用左右兩格 */
export function initLayout(p: Project) {
  const fallback = p.views[0]?.id ?? '';
  const saved = p.layout ? L.sanitizeLayout(p.layout, new Set(p.views.map((v) => v.id)), fallback) : null;
  const tree = saved ?? buildPreset('two', defaultViewOrder(p));
  ui.layout.value = tree;
  ui.maximized.value = null;
  ui.activePane.value = L.leaves(tree)[0].id;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** 版面存回專案（不進 Undo，觸發自動存檔） */
export function persistLayout(delay = 400) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.setRootSilent('layout', ui.layout.peek()), delay);
}

/** 套用新版面；fit 列出的窗格等版面排好後全部縮放 */
export function setLayout(tree: LayoutNode, opts: { fit?: string[] | 'all'; persist?: boolean } = {}) {
  ui.layout.value = tree;
  const ids = L.leaves(tree).map((p) => p.id);
  if (!ids.includes(ui.activePane.peek())) ui.activePane.value = ids[0];
  if (ui.maximized.peek() && !ids.includes(ui.maximized.peek()!)) ui.maximized.value = null;
  if (opts.persist !== false) persistLayout();
  requestAnimationFrame(() => {
    const v = app.viewer;
    if (!v) return;
    v.bindPanes();
    if (!opts.fit) return;
    for (const pane of v.allPanes()) if (opts.fit === 'all' || opts.fit.includes(pane.id)) v.fitAll(pane);
  });
}

export function activeViewId(): string | undefined {
  const t = ui.layout.peek();
  return (L.findPane(t, ui.activePane.peek()) ?? L.leaves(t)[0])?.view;
}

export function shownViewIds(): Set<string> {
  return new Set(L.leaves(ui.layout.value).map((p) => p.view));
}

/** 在指定（預設：目前）窗格顯示視圖 */
export function showViewIn(viewId: string, paneId = ui.activePane.peek()) {
  const t = ui.layout.peek();
  const id = L.findPane(t, paneId) ? paneId : L.leaves(t)[0].id;
  setLayout(L.setPaneView(t, id, viewId));
}

/** 分割出新窗格時挑一個還沒顯示的視圖（3D 旁邊放平面，平面旁邊放 3D） */
function pickNewView(src: string): string {
  const p = store.p;
  const shown = shownViewIds();
  const sv = sortedViews(p);
  const kind = p.views.find((v) => v.id === src)?.kind;
  const order = kind === '3d' ? ['plan', 'elevation', '3d'] : ['3d', 'plan', 'elevation'];
  for (const k of order) {
    const v = sv.find((x) => x.kind === k && !shown.has(x.id));
    if (v) return v.id;
  }
  return src;
}

function paneEl(id: string): HTMLElement | null {
  return document.querySelector(`.pane[data-pane="${id}"]`);
}

/**
 * 分割窗格。dir：row 左右、col 上下；ratio：原窗格保留的比例；newFirst：新窗格在左／上
 */
export function splitPaneFlow(id: string, dir: 'row' | 'col', ratio = 0.5, newFirst = false): string | null {
  const t = ui.layout.peek();
  const src = L.findPane(t, id);
  if (!src) return null;
  const r = paneEl(id)?.getBoundingClientRect();
  if (r) {
    const len = dir === 'row' ? r.width : r.height;
    const min = dir === 'row' ? MIN_W : MIN_H;
    if (len * Math.min(ratio, 1 - ratio) < min) {
      toast('窗格太小，無法再分割');
      return null;
    }
  }
  if (ui.maximized.peek()) ui.maximized.value = null;
  const res = L.splitPane(t, id, dir, pickNewView(src.view), ratio, newFirst);
  if (!res) return null;
  ui.activePane.value = res.id;
  setLayout(res.tree, { fit: [res.id] });
  return res.id;
}

export function closePaneFlow(id: string) {
  const t = L.closePane(ui.layout.peek(), id);
  if (!t) {
    toast('至少要保留一個窗格');
    return;
  }
  setLayout(t);
}

/** keep 擴大蓋過 remove */
export function joinPaneFlow(keep: string, remove: string): boolean {
  const t = L.joinPanes(ui.layout.peek(), keep, remove);
  if (!t) {
    toast('無法合併：兩個窗格要共用一整條邊界（可先關閉或調整其他窗格）');
    return false;
  }
  ui.activePane.value = keep;
  setLayout(t);
  return true;
}

export function swapPaneFlow(a: string, b: string) {
  setLayout(L.swapPanes(ui.layout.peek(), a, b));
}

export function toggleMaximize(id = ui.activePane.peek()) {
  ui.maximized.value = ui.maximized.peek() ? null : id;
  ui.activePane.value = id;
  requestAnimationFrame(() => app.viewer?.bindPanes());
}

/** 版面預設：保留目前窗格的視圖當第一格，其餘沿用目前或預設的視圖 */
export function applyPreset(kind: Preset) {
  const t = ui.layout.peek();
  const cur = L.leaves(t).map((p) => p.view);
  const first = activeViewId();
  const views = [...new Set([first, ...cur, ...defaultViewOrder(store.p)].filter((v): v is string => !!v))];
  ui.maximized.value = null;
  const tree = buildPreset(kind, views);
  ui.activePane.value = L.leaves(tree)[0].id;
  setLayout(tree, { fit: 'all' });
}

/** Ctrl+Space：目前窗格最大化／還原（同 Blender） */
export function setupPaneKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.ctrlKey && !e.metaKey && !isTyping(e)) {
      e.preventDefault();
      toggleMaximize();
    }
  });
}
