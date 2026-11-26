import { signal } from '@preact/signals';
import { Fragment } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { canJoin, findPane, leaves, resizeSplit, type LayoutNode, type LayoutPane, type LayoutSplit } from '../model/layout';
import { sortedViews } from '../model/ops';
import { store } from '../model/store';
import { app } from './core';
import { closePaneFlow, joinPaneFlow, MIN_H, MIN_W, persistLayout, setLayout, showViewIn, splitPaneFlow, swapPaneFlow, toggleMaximize } from './panes';
import { ui } from './ui';

const KIND: Record<string, string> = { plan: '平面', elevation: '立面', '3d': '3D' };
/** 窗格間邊界寬度（px），與 CSS .divider 一致 */
const DIV = 5;

type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** 從窗格角落拖曳中的狀態（Blender：往內拖＝分割，拖進相鄰窗格＝合併，加 ⌘／Ctrl＝交換） */
interface CornerDrag {
  from: string;
  corner: Corner;
  mode: 'none' | 'split' | 'join' | 'swap';
  target?: string;
  ok?: boolean;
  dir?: 'row' | 'col';
  /** 分割線位置（從左／上算的比例） */
  cut?: number;
}
const cornerDrag = signal<CornerDrag | null>(null);
const edgeMenu = signal<{ x: number; y: number; split: LayoutSplit; index: number } | null>(null);
let container: HTMLElement | null = null;

const paneEl = (id: string) => document.querySelector<HTMLElement>(`.pane[data-pane="${id}"]`);

function Svg(props: { children: preact.ComponentChildren }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      {props.children}
    </svg>
  );
}

function PaneView(props: { node: LayoutPane; single: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  const id = props.node.id;
  useEffect(() => {
    const el = body.current!;
    app.viewer?.attachPane(id, el);
    return () => app.viewer?.detachPane(id, el);
  }, [id]);
  const p = store.project.value;
  const def = p.views.find((v) => v.id === props.node.view) ?? p.views[0];
  const active = ui.activePane.value === id;
  const maxed = ui.maximized.value === id;
  const me = () => app.viewer?.allPanes().find((x) => x.id === id);
  const cd = cornerDrag.value;
  return (
    <div class={`pane${active ? ' active' : ''}`} data-pane={id} onPointerDown={() => (ui.activePane.value = id)}>
      <div class="pane-head" onDblClick={(e) => (e.target as HTMLElement).classList.contains('pane-head') && toggleMaximize(id)}>
        <span class="kind">{def ? KIND[def.kind] : ''}</span>
        <select value={def?.id} title="這個窗格顯示的視圖" onChange={(e) => showViewIn((e.target as HTMLSelectElement).value, id)}>
          {sortedViews(p).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <span class="grow" />
        <button class="txt" title="全部縮放 (F)" onClick={() => app.viewer?.fitAll(me())}>
          全部
        </button>
        <button class="txt" title="3D／平面 (⌘P)" onClick={() => app.viewer?.toggleRotatable(me())}>
          {def?.kind === '3d' ? '透視/正交' : '3D/平面'}
        </button>
        <span class="pane-tools">
          <button class="ico" title="左右分割" onClick={() => splitPaneFlow(id, 'row')}>
            <Svg>
              <rect x="2" y="2.5" width="12" height="11" rx="1.2" />
              <path d="M8 2.5v11" />
            </Svg>
          </button>
          <button class="ico" title="上下分割" onClick={() => splitPaneFlow(id, 'col')}>
            <Svg>
              <rect x="2" y="2.5" width="12" height="11" rx="1.2" />
              <path d="M2 8h12" />
            </Svg>
          </button>
          <button class={`ico${maxed ? ' on' : ''}`} title={maxed ? '還原 (Ctrl+Space)' : '最大化 (Ctrl+Space，或雙擊標題列)'} onClick={() => toggleMaximize(id)}>
            <Svg>{maxed ? <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" /> : <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />}</Svg>
          </button>
          <button class="ico" title="關閉窗格" disabled={props.single} onClick={() => closePaneFlow(id)}>
            <Svg>
              <path d="M4 4l8 8M12 4l-8 8" />
            </Svg>
          </button>
        </span>
      </div>
      <div class="pane-body" ref={body}>
        {active && !cd && <div class="view-hint">滾輪縮放・中鍵或空白鍵＋拖曳平移・右鍵或 Alt＋拖曳旋轉</div>}
      </div>
      {!ui.maximized.value &&
        (['tl', 'tr', 'bl', 'br'] as Corner[]).map((c) => <div key={c} class={`corner ${c}`} title="拖曳：往內＝分割窗格；拖進相鄰窗格＝合併；按住 ⌘／Ctrl＝交換" onPointerDown={(e) => startCornerDrag(e, id, c)} />)}
    </div>
  );
}

function startCornerDrag(e: PointerEvent, id: string, corner: Corner) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const x0 = e.clientX;
  const y0 = e.clientY;
  ui.activePane.value = id;
  cornerDrag.value = { from: id, corner, mode: 'none' };
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (Math.hypot(dx, dy) < 10) {
      cornerDrag.value = { from: id, corner, mode: 'none' };
      return;
    }
    const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.pane')?.dataset.pane;
    if (under && under !== id) {
      const swap = ev.metaKey || ev.ctrlKey;
      cornerDrag.value = { from: id, corner, mode: swap ? 'swap' : 'join', target: under, ok: swap || canJoin(ui.layout.peek(), id, under) };
      return;
    }
    const r = paneEl(id)?.getBoundingClientRect();
    if (!r) return;
    const dir = Math.abs(dx) >= Math.abs(dy) ? 'row' : 'col';
    const len = dir === 'row' ? r.width : r.height;
    const min = (dir === 'row' ? MIN_W : MIN_H) / len;
    const raw = dir === 'row' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
    const cut = Math.min(1 - min, Math.max(min, raw));
    cornerDrag.value = { from: id, corner, mode: 'split', dir, cut, ok: min < 0.5 };
  };
  const end = (ev: PointerEvent) => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
    const d = cornerDrag.peek();
    cornerDrag.value = null;
    // 被系統中斷（手勢、切換視窗）時不做任何事
    if (ev.type === 'pointercancel' || !d || d.mode === 'none') return;
    if (d.mode === 'swap' && d.target) swapPaneFlow(d.from, d.target);
    else if (d.mode === 'join' && d.target) joinPaneFlow(d.from, d.target);
    else if (d.mode === 'split' && d.dir && d.cut !== undefined && d.ok) {
      // 新窗格出現在角落那一側（像從角落拉出一塊新區域）
      const newFirst = d.dir === 'row' ? d.corner === 'tl' || d.corner === 'bl' : d.corner === 'tl' || d.corner === 'tr';
      splitPaneFlow(d.from, d.dir, newFirst ? 1 - d.cut : d.cut, newFirst);
    }
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/** 兩個子節點之間的邊界：拖曳調整大小、雙擊平均分配、右鍵選單 */
function Divider(props: { split: LayoutSplit; index: number }) {
  const { split, index } = props;
  const row = split.dir === 'row';
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const pr = el.parentElement!.getBoundingClientRect();
    const avail = (row ? pr.width : pr.height) - (split.children.length - 1) * DIV;
    const start = [...split.sizes];
    const p0 = row ? e.clientX : e.clientY;
    const minFrac = (row ? MIN_W : MIN_H) / avail;
    const move = (ev: PointerEvent) => {
      const d = ((row ? ev.clientX : ev.clientY) - p0) / avail;
      ui.layout.value = resizeSplit(ui.layout.peek(), split.id, index, start, d, minFrac);
    };
    const up = () => {
      el.classList.remove('drag');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      persistLayout();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div
      class="divider"
      title="拖曳調整大小・雙擊平均分配・右鍵更多選項"
      onPointerDown={onDown}
      onDblClick={() => equalize(split)}
      onContextMenu={(e) => {
        e.preventDefault();
        edgeMenu.value = { x: e.clientX, y: e.clientY, split, index };
      }}
    />
  );
}

function equalize(split: LayoutSplit) {
  const walk = (n: LayoutNode): LayoutNode => (n.t === 'pane' ? n : n.id === split.id ? { ...n, sizes: n.children.map(() => 1 / n.children.length) } : { ...n, children: n.children.map(walk) });
  setLayout(walk(ui.layout.peek()));
}

function EdgeMenu() {
  const m = edgeMenu.value;
  useEffect(() => {
    if (!m) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.edge-menu')) edgeMenu.value = null;
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [m]);
  if (!m) return null;
  const a = m.split.children[m.index];
  const b = m.split.children[m.index + 1];
  const row = m.split.dir === 'row';
  const both = a?.t === 'pane' && b?.t === 'pane';
  const run = (fn: () => void) => () => {
    edgeMenu.value = null;
    fn();
  };
  return (
    <div class="menu edge-menu" style={{ left: m.x, top: m.y }}>
      <button disabled={!both} onClick={run(() => joinPaneFlow(a.id, b.id))}>
        合併窗格（保留{row ? '左' : '上'}側）
      </button>
      <button disabled={!both} onClick={run(() => joinPaneFlow(b.id, a.id))}>
        合併窗格（保留{row ? '右' : '下'}側）
      </button>
      <button disabled={!both} onClick={run(() => swapPaneFlow(a.id, b.id))}>
        交換兩側視圖
      </button>
      <hr />
      <button onClick={run(() => equalize(m.split))}>平均分配大小</button>
      {!both && <div class="hint" style={{ padding: '4px 10px', maxWidth: 220 }}>兩側都是單一窗格時才能合併或交換。</div>}
    </div>
  );
}

function Node(props: { n: LayoutNode; single: boolean }) {
  const n = props.n;
  if (n.t === 'pane') return <PaneView node={n} single={props.single} />;
  return (
    <div class={`split ${n.dir}`}>
      {n.children.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 && <Divider split={n} index={i - 1} />}
          <div class="cell" style={{ flex: `${n.sizes[i]} 1 0px` }}>
            <Node n={c} single={props.single} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/** 角落拖曳時的提示：分割線、合併／交換目標 */
function DragOverlay() {
  const d = cornerDrag.value;
  if (!d || d.mode === 'none' || !container) return null;
  const cr = container.getBoundingClientRect();
  const rel = (r: DOMRect) => ({ left: r.left - cr.left, top: r.top - cr.top, width: r.width, height: r.height });
  if (d.mode === 'split') {
    const r = paneEl(d.from)?.getBoundingClientRect();
    if (!r || d.cut === undefined) return null;
    const box = rel(r);
    const style =
      d.dir === 'row'
        ? { left: box.left + box.width * d.cut - 1, top: box.top, width: 2, height: box.height }
        : { left: box.left, top: box.top + box.height * d.cut - 1, width: box.width, height: 2 };
    return (
      <div class="layout-overlay">
        <div class={`split-line${d.ok ? '' : ' bad'}`} style={style} />
      </div>
    );
  }
  const r = d.target ? paneEl(d.target)?.getBoundingClientRect() : null;
  if (!r) return null;
  const text = d.mode === 'swap' ? '放開以交換視圖' : d.ok ? '放開以合併（此窗格會被取代）' : '無法合併：需共用一整條邊界';
  return (
    <div class="layout-overlay">
      <div class={`join-box${d.ok ? '' : ' bad'}${d.mode === 'swap' ? ' swap' : ''}`} style={rel(r)}>
        <span>{text}</span>
      </div>
    </div>
  );
}

export function ViewsArea() {
  const tree = ui.layout.value;
  const maxId = ui.maximized.value;
  const maxPane = maxId ? findPane(tree, maxId) : undefined;
  const single = leaves(tree).length === 1;
  useEffect(() => {
    app.viewer?.requestRender();
  }, [tree, maxId]);
  return (
    <div
      class="views"
      ref={(el) => {
        container = el;
        if (el) app.viewer?.mount(el);
      }}
    >
      <div class="panes">{maxPane ? <PaneView node={maxPane} single={single} /> : <Node n={tree} single={single} />}</div>
      <DragOverlay />
      <EdgeMenu />
    </div>
  );
}
