import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { store } from '../model/store';
import { MEMBER_TYPES, MEMBER_TYPE_LABEL } from '../model/types';
import { syncViews } from '../model/ops';
import { app } from './core';
import { Icon } from './Icons';
import { ui, toast, type ToolId } from './ui';
import { installApp, pwa } from './pwa';
import { exportCsv, exportExcel, openPrint, runNumbering } from '../report/actions';
import { newProjectFlow, openFileFlow, saveFileFlow, loadSampleFlow } from './projectFlows';
import { importDrawingFlow } from './drawingFlows';
import { openMembersRecog, openScheduleTable, recog, recognizeGridFlow, recognizeLevelsFlow, startScheduleBox } from './recognizeFlows';

type Tab = 'steel' | 'drawing' | 'recog' | 'edit' | 'view' | 'report';

function Btn(props: { icon: string; label: string; on?: boolean; disabled?: boolean; title?: string; onClick: () => void }) {
  const I = Icon[props.icon];
  return (
    <button class={`rbtn${props.on ? ' on' : ''}`} disabled={props.disabled} title={props.title ?? props.label} onClick={props.onClick}>
      {I && <I />}
      <span>{props.label}</span>
    </button>
  );
}

function Small(props: { icon?: string; label: string; on?: boolean; disabled?: boolean; title?: string; onClick: () => void }) {
  const I = props.icon ? Icon[props.icon] : null;
  return (
    <button class={`rsmall${props.on ? ' on' : ''}`} disabled={props.disabled} title={props.title ?? props.label} onClick={props.onClick}>
      {I && (
        <span style={{ width: 16, height: 16, display: 'inline-flex' }}>
          <I />
        </span>
      )}
      {props.label}
    </button>
  );
}

function Group(props: { title: string; children: JSX.Element | JSX.Element[] }) {
  return (
    <div class="rgroup">
      <div class="rgroup-items">{props.children}</div>
      <div class="rgroup-title">{props.title}</div>
    </div>
  );
}

function tool(id: ToolId) {
  app.controller?.setTool(id);
}

function FileMenu(props: { onClose: () => void }) {
  const run = (fn: () => void) => () => {
    props.onClose();
    fn();
  };
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.menu, .file-btn')) props.onClose();
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, []);
  return (
    <div class="menu" style={{ top: 30, left: 110 }}>
      <button onClick={run(newProjectFlow)}>新專案</button>
      <button onClick={run(() => (ui.dialog.value = 'projects'))}>開啟瀏覽器內的專案…</button>
      <button onClick={run(openFileFlow)}>開啟專案檔（.sqp）…</button>
      <button onClick={run(saveFileFlow)}>
        儲存專案檔（.sqp）<kbd>⌘S</kbd>
      </button>
      <hr />
      <button onClick={run(() => (ui.dialog.value = 'info'))}>專案資訊…</button>
      <button onClick={run(loadSampleFlow)}>載入範例專案</button>
      <hr />
      <button onClick={run(() => (ui.dialog.value = 'help'))}>操作說明與快捷鍵</button>
      {!pwa.standalone.value && <button onClick={run(() => void installApp())}>安裝為應用程式…</button>}
    </div>
  );
}

export function Ribbon() {
  const tab = useSignal<Tab>('steel');
  const menu = useSignal(false);
  const t = ui.tool.value;
  const sel = store.selection.value.size;
  const p = store.project.value;
  const mode = ui.displayMode.value;
  const layout = ui.layout.value;
  return (
    <div class="ribbon">
      <div class="ribbon-top">
        <div class="brand">
          <svg width="18" height="18" viewBox="0 0 32 32">
            <path d="M4 5h24v5H19v12h9v5H4v-5h9V10H4z" fill="#5aa0ff" />
          </svg>
          鋼構算量 <small>建模算量</small>
        </div>
        <button class={`ribbon-tab file-btn${menu.value ? ' on' : ''}`} onClick={() => (menu.value = !menu.value)}>
          檔案
        </button>
        {(
          [
            ['steel', '鋼構'],
            ['drawing', '圖紙'],
            ['recog', '辨識'],
            ['edit', '編輯'],
            ['view', '視圖'],
            ['report', '報表'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} class={`ribbon-tab${tab.value === k ? ' on' : ''}`} onClick={() => (tab.value = k)}>
            {label}
          </button>
        ))}
        <div class="spacer" />
        {!pwa.standalone.value && (
          <button class="ribbon-tab install-btn" title="安裝成應用程式：自己的視窗與圖示，離線也能用" onClick={() => void installApp()}>
            ⤓ 安裝
          </button>
        )}
        <span class="proj-name" title="專案名稱">
          {p.name}
        </span>
        <button class="ribbon-tab" title="復原 (⌘Z)" disabled={!store.canUndo.value} onClick={() => store.undo()}>
          ↶
        </button>
        <button class="ribbon-tab" title="重做 (⌘⇧Z)" disabled={!store.canRedo.value} onClick={() => store.redo()}>
          ↷
        </button>
      </div>
      {menu.value && <FileMenu onClose={() => (menu.value = false)} />}
      <div class="ribbon-body">
        {tab.value === 'steel' && (
          <>
            <Group title="構件">
              <Btn icon="column" label="柱" on={t === 'column'} onClick={() => tool('column')} />
              <Btn icon="girder" label="大梁" on={t === 'girder'} onClick={() => tool('girder')} />
              <Btn icon="beam" label="小梁" on={t === 'beam'} onClick={() => tool('beam')} />
              <Btn icon="brace" label="斜撐" on={t === 'brace'} onClick={() => tool('brace')} />
              <Btn icon="purlin" label="桁條" on={t === 'purlin'} onClick={() => tool('purlin')} />
              <Btn icon="plate" label="多邊形板" on={t === 'plate'} onClick={() => tool('plate')} />
            </Group>
            <Group title="基準">
              <Btn icon="grid" label="軸線" onClick={() => (ui.dialog.value = 'grid')} />
              <Btn icon="level" label="高程" onClick={() => (ui.dialog.value = 'levels')} />
            </Group>
            <Group title="選取">
              <Btn icon="select" label="選取" on={t === 'select'} onClick={() => tool('select')} />
              <Btn icon="del" label="刪除" disabled={!sel} onClick={() => store.remove('members', store.selection.peek(), `刪除 ${sel} 支構件`)} />
            </Group>
          </>
        )}
        {tab.value === 'drawing' && (
          <>
            <Group title="圖紙">
              <Btn icon="file" label="匯入圖紙" title="匯入 DWG／DXF／PDF（也可直接拖進視窗）" onClick={() => void importDrawingFlow()} />
              <Btn icon="fit" label="兩點對位" on={t === 'align'} disabled={!p.drawings.length} title="點圖上兩點、再點模型對應兩點" onClick={() => tool('align')} />
              <Btn icon="measure" label="量測" on={t === 'measure'} onClick={() => tool('measure')} />
            </Group>
            <Group title="顯示">
              <div class="rcol">
                <Small
                  label="全部顯示"
                  disabled={!p.drawings.length}
                  onClick={() => store.replaceSilent('drawings', store.p.drawings.map((d) => ({ ...d, visible: true })))}
                />
                <Small
                  label="全部隱藏"
                  disabled={!p.drawings.length}
                  onClick={() => store.replaceSilent('drawings', store.p.drawings.map((d) => ({ ...d, visible: false })))}
                />
                <Small
                  label={`圖紙鎖點：${ui.snaps.value.drawing ? '開' : '關'}`}
                  on={ui.snaps.value.drawing}
                  onClick={() => (ui.snaps.value = { ...ui.snaps.value, drawing: !ui.snaps.value.drawing })}
                />
              </div>
            </Group>
            <Group title="說明">
              <div class="hint" style={{ maxWidth: 380, whiteSpace: 'normal', lineHeight: 1.6, padding: '2px 6px' }}>
                平面圖放在樓層平面、立面圖放在軸線立面。用「兩點對位」把圖上的軸線交點對到模型軸線交點；之後建模時可鎖點到圖紙的端點、交點、圓心。
              </div>
            </Group>
          </>
        )}
        {tab.value === 'recog' && (
          <>
            <Group title="基準">
              <Btn icon="grid" label="辨識軸線" disabled={!p.drawings.length} title="從平面圖的軸線與軸線泡泡辨識" onClick={() => void recognizeGridFlow()} />
              <Btn icon="level" label="辨識高程" disabled={!p.drawings.length} title="從圖面的「2FL +4.200」等標註辨識" onClick={() => void recognizeLevelsFlow()} />
            </Group>
            <Group title="斷面">
              <Btn icon="report" label="框選斷面表" disabled={!p.drawings.length} title="在圖上框選構件表，抽出編號 → 斷面" onClick={startScheduleBox} />
              <Btn icon="number" label="斷面對照表" title={`${p.schedule.length} 筆`} onClick={openScheduleTable} />
            </Group>
            <Group title="構件">
              <Btn icon="girder" label="辨識梁柱" disabled={!p.drawings.length} title="依圖層與標註產生梁柱候選，確認後建立" onClick={() => void openMembersRecog()} />
              <Btn icon="column" label="一鍵佈梁柱" disabled={!p.grids.length} title="在軸線交點放柱、沿軸線佈大梁" onClick={() => (recog.value = { kind: 'batch' })} />
            </Group>
            <Group title="流程">
              <div class="hint" style={{ maxWidth: 360, whiteSpace: 'normal', lineHeight: 1.6, padding: '2px 6px' }}>
                ① 匯入平面圖 → ② 辨識軸線 → ③ 辨識高程（立面／剖面圖）→ ④ 框選斷面表 → ⑤ 辨識梁柱，勾選確認後建立。
              </div>
            </Group>
          </>
        )}
        {tab.value === 'edit' && (
          <>
            <Group title="選取">
              <Btn icon="select" label="選取" on={t === 'select'} onClick={() => tool('select')} />
              <div class="rcol">
                <Small label="全選 ⌘A" onClick={() => store.select(store.p.members.map((m) => m.id))} />
                <Small label="取消選取 Esc" disabled={!sel} onClick={() => store.select([])} />
                <Small
                  label="選同斷面"
                  disabled={!sel}
                  onClick={() => {
                    const prof = new Set(store.p.members.filter((m) => store.selection.peek().has(m.id)).map((m) => m.profile));
                    store.select(store.p.members.filter((m) => prof.has(m.profile)).map((m) => m.id));
                  }}
                />
              </div>
            </Group>
            <Group title="移動複製">
              <Btn icon="move" label="移動" on={t === 'move'} disabled={!sel} title="移動 (⌘M)：選基準點、目標點" onClick={() => tool('move')} />
              <Btn icon="copy" label="複製" on={t === 'copy'} disabled={!sel} title="複製 (⌘C)：選基準點、目標點" onClick={() => tool('copy')} />
              <Btn icon="array" label="陣列複製" disabled={!sel} onClick={() => (ui.dialog.value = 'array')} />
              <Btn icon="mirror" label="鏡射複製" on={t === 'mirror'} disabled={!sel} onClick={() => tool('mirror')} />
              <Btn icon="rotate" label="旋轉" on={t === 'rotate'} disabled={!sel} onClick={() => tool('rotate')} />
            </Group>
            <Group title="修改">
              <Btn icon="split" label="分割" on={t === 'split'} onClick={() => tool('split')} />
              <Btn icon="del" label="刪除" disabled={!sel} onClick={() => store.remove('members', store.selection.peek(), `刪除 ${sel} 支構件`)} />
              <Btn icon="undo" label="復原" disabled={!store.canUndo.value} onClick={() => store.undo()} />
              <Btn icon="redo" label="重做" disabled={!store.canRedo.value} onClick={() => store.redo()} />
            </Group>
            <Group title="可選取">
              <div class="rcol" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
                {MEMBER_TYPES.map((mt) => (
                  <Small
                    key={mt}
                    label={MEMBER_TYPE_LABEL[mt]}
                    on={ui.selectable.value.has(mt)}
                    title="選取篩選：只能選到勾選的類型"
                    onClick={() => {
                      const s = new Set(ui.selectable.value);
                      s.has(mt) ? s.delete(mt) : s.add(mt);
                      ui.selectable.value = s;
                    }}
                  />
                ))}
              </div>
            </Group>
            <Group title="檢查">
              <Btn icon="measure" label="量測" on={t === 'measure'} onClick={() => tool('measure')} />
              <Btn icon="dups" label="重複檢查" title="找出完全重複或重疊的構件，避免重複算量" onClick={() => (ui.dialog.value = 'dups')} />
            </Group>
          </>
        )}
        {tab.value === 'view' && (
          <>
            <Group title="版面">
              <Btn icon="layout1" label="單一" on={layout === 1} onClick={() => (ui.layout.value = 1)} />
              <Btn icon="layout2" label="左右" on={layout === 2} onClick={() => (ui.layout.value = 2)} />
              <Btn icon="layout4" label="四格" on={layout === 4} onClick={() => (ui.layout.value = 4)} />
            </Group>
            <Group title="顯示">
              <Btn icon="solid" label="實體" on={mode === 'solid'} onClick={() => (ui.displayMode.value = 'solid')} />
              <Btn icon="wire" label="線框" on={mode === 'wire'} onClick={() => (ui.displayMode.value = 'wire')} />
              <Btn icon="line" label="中心線" on={mode === 'line'} onClick={() => (ui.displayMode.value = 'line')} />
            </Group>
            <Group title="視圖">
              <Btn icon="fit" label="全部縮放" title="全部縮放 (F)" onClick={() => app.viewer?.fitAll()} />
              <Btn icon="cube" label="3D／平面" title="切換 3D／平面 (⌘P)" onClick={() => app.viewer?.toggleRotatable()} />
              <Btn
                icon="views"
                label="沿軸線建立視圖"
                onClick={() => {
                  const p = store.p;
                  const views = syncViews(p);
                  const before = new Map(p.views.map((v) => [v.id, v]));
                  const added = views.filter((v) => !before.has(v.id));
                  if (!added.length) toast('每個樓層與軸線都已有視圖');
                  else {
                    store.add('views', added, '沿軸線建立視圖');
                    toast(`新增 ${added.length} 個視圖`);
                  }
                }}
              />
            </Group>
            <Group title="構件標註">
              <div class="rcol">
                <Small label="不標註" on={ui.labels.value === 'none'} onClick={() => (ui.labels.value = 'none')} />
                <Small label="編號" on={ui.labels.value === 'mark'} title="平面／立面視圖顯示構件編號（先執行報表 → 編號）" onClick={() => (ui.labels.value = 'mark')} />
                <Small label="斷面" on={ui.labels.value === 'profile'} onClick={() => (ui.labels.value = 'profile')} />
              </div>
            </Group>
            <Group title="操作">
              <div class="rcol">
                <Small label={`觸控板模式：${ui.trackpad.value ? '開' : '關'}`} on={ui.trackpad.value} title="開啟後兩指滑動平移、捏合縮放" onClick={() => (ui.trackpad.value = !ui.trackpad.value)} />
                <Small label={`正交 O：${ui.ortho.value ? '開' : '關'}`} on={ui.ortho.value} onClick={() => (ui.ortho.value = !ui.ortho.value)} />
              </div>
            </Group>
          </>
        )}
        {tab.value === 'report' && (
          <>
            <Group title="編號">
              <Btn icon="number" label="編號" title="依斷面、材質、長度給構件編號" onClick={() => runNumbering(true)} />
            </Group>
            <Group title="報表">
              <Btn icon="report" label="報表" onClick={() => (ui.dialog.value = 'report')} />
              <Btn icon="excel" label="匯出 Excel" onClick={() => exportExcel()} />
              <Btn icon="file" label="匯出 CSV" onClick={() => exportCsv('marks')} />
              <Btn icon="print" label="列印／PDF" onClick={() => openPrint()} />
            </Group>
          </>
        )}
      </div>
    </div>
  );
}
