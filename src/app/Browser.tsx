import { useSignal } from '@preact/signals';
import { showViewIn, shownViewIds } from './panes';
import type { JSX } from 'preact';
import { store } from '../model/store';
import { MEMBER_TYPES, MEMBER_TYPE_LABEL, type ViewDef } from '../model/types';
import { fmtElev } from '../view3d/overlay';
import { targetLabel } from '../drawing/placement';
import { importDrawingFlow } from './drawingFlows';
import { sortedViews } from '../model/ops';
import { ui } from './ui';

function Section(props: { title: string; extra?: JSX.Element; open?: boolean; children: JSX.Element | JSX.Element[] | null }) {
  const open = useSignal(props.open ?? true);
  return (
    <div class="sec">
      <div class="sec-h" onClick={() => (open.value = !open.value)}>
        <span>{open.value ? '▾' : '▸'}</span>
        <span class="grow">{props.title}</span>
        <span onClick={(e) => e.stopPropagation()}>{props.extra}</span>
      </div>
      {open.value && <div class="sec-b">{props.children}</div>}
    </div>
  );
}

export function showView(v: ViewDef) {
  showViewIn(v.id);
}

export function Browser() {
  const p = store.project.value;
  const sel = store.selection.value;
  const shown = shownViewIds();
  const levels = [...p.levels].sort((a, b) => b.elevation - a.elevation);
  const sv = sortedViews(p);
  const views3d = sv.filter((v) => v.kind === '3d');
  const plans = sv.filter((v) => v.kind === 'plan');
  const elevs = sv.filter((v) => v.kind === 'elevation');
  const byLevel = new Map<string, Map<string, string[]>>();
  for (const m of p.members) {
    const k = m.levelId ?? '';
    let lm = byLevel.get(k);
    if (!lm) byLevel.set(k, (lm = new Map()));
    let arr = lm.get(m.type);
    if (!arr) lm.set(m.type, (arr = []));
    arr.push(m.id);
  }
  const selectIds = (ids: string[], e: MouseEvent) => store.select(ids, e.shiftKey ? 'add' : e.metaKey || e.ctrlKey ? 'toggle' : 'set');
  const viewItem = (v: ViewDef) => (
    <div key={v.id} class={`tree-item${shown.has(v.id) ? ' on' : ''}`} onClick={() => showView(v)} title="在目前窗格開啟">
      {v.name}
    </div>
  );
  return (
    <div class="side">
      <Section title="軸線" extra={<button onClick={() => (ui.dialog.value = 'grid')}>編輯</button>}>
        {p.grids.length ? (
          p.grids.map((g) => (
            <div key={g.id} class="tree-item" onClick={() => (ui.dialog.value = `grid:${g.id}`)}>
              {g.name}
              <span class="meta">
                {g.xs.length}×{g.ys.length}
              </span>
            </div>
          ))
        ) : (
          <div class="empty">尚無軸線</div>
        )}
      </Section>
      <Section title="高程" extra={<button onClick={() => (ui.dialog.value = 'levels')}>編輯</button>}>
        {levels.length ? (
          levels.map((l) => (
            <div key={l.id} class="tree-item" onClick={() => (ui.dialog.value = 'levels')}>
              {l.name}
              <span class="meta">{fmtElev(l.elevation)}</span>
            </div>
          ))
        ) : (
          <div class="empty">尚無高程</div>
        )}
      </Section>
      <Section title={`圖紙（${p.drawings.length}）`} extra={<button onClick={() => void importDrawingFlow()}>匯入</button>}>
        {p.drawings.length ? (
          p.drawings.map((d) => (
            <div key={d.id} class="tree-item" onClick={() => (ui.dialog.value = `drawing:${d.id}`)} title="圖紙設定">
              <input
                type="checkbox"
                checked={d.visible}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => store.replaceSilent('drawings', [{ ...d, visible: (e.target as HTMLInputElement).checked }])}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
              <span class="meta">{targetLabel(d.target, p).replace('平面 ', '').replace('立面 ', '立')}</span>
            </div>
          ))
        ) : (
          <div class="empty">可把 DWG、DXF、PDF 拖進視窗匯入</div>
        )}
      </Section>
      <Section title="視圖">
        <>
          {views3d.map(viewItem)}
          {plans.length > 0 && <div class="empty">平面</div>}
          {plans.map(viewItem)}
          {elevs.length > 0 && <div class="empty">立面</div>}
          {elevs.map(viewItem)}
        </>
      </Section>
      <Section title={`構件（${p.members.length}）`}>
        {p.members.length ? (
          <>
            {[...levels, null].map((l) => {
              const lm = byLevel.get(l?.id ?? '');
              if (!lm) return null;
              const all = [...lm.values()].flat();
              return (
                <div key={l?.id ?? 'none'}>
                  <div class="tree-item" onClick={(e) => selectIds(all, e)}>
                    {l?.name ?? '（未分層）'}
                    <span class="meta">{all.length}</span>
                  </div>
                  {MEMBER_TYPES.filter((t) => lm.has(t)).map((t) => {
                    const ids = lm.get(t)!;
                    const on = ids.every((id) => sel.has(id));
                    return (
                      <div key={t} class={`tree-item tree-sub${on ? ' on' : ''}`} onClick={(e) => selectIds(ids, e)}>
                        {MEMBER_TYPE_LABEL[t]}
                        <span class="meta">{ids.length}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        ) : (
          <div class="empty">尚無構件。選「鋼構」頁的柱、大梁等工具開始建模。</div>
        )}
      </Section>
    </div>
  );
}
