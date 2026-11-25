import { useEffect, useRef } from 'preact/hooks';
import { store } from '../model/store';
import { sortedViews } from '../model/ops';
import { app } from './core';
import { ui } from './ui';

const KIND: Record<string, string> = { plan: '平面', elevation: '立面', '3d': '3D' };

function PaneView(props: { index: number }) {
  const body = useRef<HTMLDivElement>(null);
  const i = props.index;
  useEffect(() => {
    app.viewer?.setPaneElement(i, body.current);
    return () => app.viewer?.setPaneElement(i, null);
  }, []);
  const p = store.project.value;
  const id = ui.paneViews.value[i];
  const def = p.views.find((v) => v.id === id) ?? p.views[0];
  const active = ui.activePane.value === i;
  const setView = (vid: string) => {
    const ids = [...ui.paneViews.peek()];
    ids[i] = vid;
    ui.paneViews.value = ids;
    app.viewer?.bindPanes();
  };
  return (
    <div class={`pane${active ? ' active' : ''}`} onPointerDown={() => (ui.activePane.value = i)}>
      <div class="pane-head">
        <span class="kind">{def ? KIND[def.kind] : ''}</span>
        <select value={def?.id} onChange={(e) => setView((e.target as HTMLSelectElement).value)}>
          {sortedViews(p).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <span class="grow" />
        <button title="全部縮放 (F)" onClick={() => app.viewer?.fitAll(app.viewer.allPanes().find((x) => x.index === i))}>
          全部
        </button>
        <button title="3D／平面 (⌘P)" onClick={() => app.viewer?.toggleRotatable(app.viewer.allPanes().find((x) => x.index === i))}>
          {def?.kind === '3d' ? '透視/正交' : '3D/平面'}
        </button>
      </div>
      <div class="pane-body" ref={body}>
        {active && <div class="view-hint">滾輪縮放・中鍵或空白鍵＋拖曳平移・右鍵或 Alt＋拖曳旋轉</div>}
      </div>
    </div>
  );
}

export function ViewsArea() {
  const n = ui.layout.value;
  useEffect(() => {
    app.viewer?.bindPanes();
    // 版面改變後窗格大小不同，等版面套用再全部縮放
    requestAnimationFrame(() => {
      for (const pane of app.viewer?.allPanes() ?? []) app.viewer?.fitAll(pane);
    });
  }, [n]);
  return (
    <div class="views" ref={(el) => {
      if (el) app.viewer?.mount(el);
    }}>
      <div class={`panes l${n}`}>
        {Array.from({ length: n }, (_, i) => (
          <PaneView key={`${n}-${i}`} index={i} />
        ))}
      </div>
    </div>
  );
}
