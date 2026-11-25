import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { deleteLocal, listProjects, type ProjectMeta } from '../../model/persist';
import { store } from '../../model/store';
import { loadSampleFlow, newProjectFlow, openFileFlow, openLocalFlow } from '../projectFlows';
import { ui } from '../ui';
import { Modal } from './Modal';

const close = () => (ui.dialog.value = '');

export function ProjectsDialog() {
  const list = useSignal<ProjectMeta[] | null>(null);
  const refresh = () => listProjects().then((l) => (list.value = l));
  useEffect(() => {
    void refresh();
  }, []);
  const cur = store.p.id;
  return (
    <Modal
      title="專案"
      onClose={close}
      footer={
        <>
          <button onClick={() => (close(), newProjectFlow())}>新專案</button>
          <button onClick={() => (close(), loadSampleFlow())}>載入範例</button>
          <button onClick={() => (close(), void openFileFlow())}>開啟專案檔…</button>
          <div class="grow" />
          <button onClick={close}>關閉</button>
        </>
      }
    >
      <div class="proj-list">
        <div class="hint" style={{ marginBottom: 8 }}>
          專案自動存在這台電腦的瀏覽器裡。換電腦或備份請用「檔案 → 儲存專案檔」。
        </div>
        {list.value === null && <div class="hint">讀取中…</div>}
        {list.value?.length === 0 && <div class="hint">瀏覽器內還沒有專案。</div>}
        {list.value?.map((m) => (
          <div key={m.id} class="proj-row">
            <div class="grow">
              <div>
                <b>{m.name}</b> {m.id === cur && <span class="chip on">目前</span>}
              </div>
              <div class="meta">
                {new Date(m.updatedAt).toLocaleString('zh-TW')}・{m.members} 支構件
              </div>
            </div>
            <button
              disabled={m.id === cur}
              onClick={() => {
                close();
                void openLocalFlow(m.id);
              }}
            >
              開啟
            </button>
            <button
              class="danger"
              disabled={m.id === cur}
              onClick={async () => {
                if (!confirm(`從瀏覽器刪除「${m.name}」？此動作無法復原（已存成檔案的不受影響）。`)) return;
                await deleteLocal(m.id);
                void refresh();
              }}
            >
              刪除
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function InfoDialog() {
  const p = store.p;
  const name = useSignal(p.name);
  const info = useSignal({ ...p.info });
  const ends = useSignal(p.settings.paintIncludeEnds);
  const tol = useSignal(String(p.settings.numberTolerance));
  const save = () => {
    const t = Number(tol.value);
    store.commit('修改專案資訊', [
      { coll: 'root', key: 'name', before: p.name, after: name.value.trim() || '未命名專案' },
      { coll: 'root', key: 'info', before: p.info, after: info.value },
      { coll: 'root', key: 'settings', before: p.settings, after: { ...p.settings, paintIncludeEnds: ends.value, numberTolerance: t > 0 ? t : 1 } },
    ]);
    close();
  };
  const f = (k: keyof typeof info.value, label: string) => (
    <>
      <label>{label}</label>
      <input value={info.value[k]} onInput={(e) => (info.value = { ...info.value, [k]: (e.target as HTMLInputElement).value })} />
    </>
  );
  return (
    <Modal
      title="專案資訊"
      onClose={close}
      width={520}
      footer={
        <>
          <button onClick={close}>取消</button>
          <button class="primary" onClick={save}>
            確定
          </button>
        </>
      }
    >
      <div class="form-grid">
        <label>專案名稱</label>
        <input value={name.value} onInput={(e) => (name.value = (e.target as HTMLInputElement).value)} />
        {f('company', '公司名稱')}
        {f('client', '業主')}
        {f('location', '工程地點')}
        {f('designer', '製表人')}
        {f('note', '備註')}
        <label>編號長度容差</label>
        <div class="fpair">
          <input value={tol.value} onInput={(e) => (tol.value = (e.target as HTMLInputElement).value)} />
          <span class="hint">mm，長度差在此範圍內視為同一編號</span>
        </div>
        <label>塗裝面積</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={ends.value} onChange={(e) => (ends.value = (e.target as HTMLInputElement).checked)} />
          含構件兩端斷面
        </label>
      </div>
    </Modal>
  );
}

export function HelpDialog() {
  const keys: [string, string][] = [
    ['滾輪', '以游標為中心縮放'],
    ['中鍵拖曳／空白鍵＋拖曳', '平移'],
    ['右鍵拖曳／Alt＋拖曳', '旋轉（3D 視圖；平面視圖先按 ⌘P）'],
    ['右鍵點一下', '結束目前指令（多邊形板完成）'],
    ['⌘P / Ctrl+P', '平面視圖切換 3D、3D 視圖切換透視／正交'],
    ['F', '全部縮放'],
    ['O', '正交開關'],
    ['數字＋Enter', '選了第一點後輸入長度，沿游標方向'],
    ['@dx,dy,dz＋Enter', '相對上一點（工作平面座標）'],
    ['x,y,z＋Enter', '絕對座標（兩個值時為工作平面座標）'],
    ['Esc', '中斷指令；選取模式下取消選取'],
    ['Delete', '刪除選取的構件'],
    ['⌘M / ⌘C', '移動／複製選取的構件（選基準點、目標點）'],
    ['⌘Z / ⌘⇧Z', '復原／重做'],
    ['⌘A', '全選'],
    ['Shift／⌘＋點選', '加選／切換選取'],
    ['左→右框選', '完整包含才選取'],
    ['右→左框選', '碰到就選取'],
  ];
  return (
    <Modal title="操作說明與快捷鍵" onClose={close} width={620} footer={<button onClick={close}>關閉</button>}>
      <div class="kbd-list">
        {keys.map(([k, v]) => (
          <>
            <div>
              <kbd>{k}</kbd>
            </div>
            <div>{v}</div>
          </>
        ))}
      </div>
      <h4 style={{ marginTop: 16 }}>建模流程（對照 Tekla Structures）</h4>
      <ol style={{ lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>
        <li>鋼構 → 軸線：輸入 X／Y 座標（Tekla 語法 0 4*6000）。</li>
        <li>鋼構 → 高程：輸入各樓層高程與樓地板面積。</li>
        <li>點選工具（柱、大梁…），右側屬性面板設定斷面、材質，在平面視圖點選軸線交點建立構件。</li>
        <li>選取構件可在右側修改屬性，數量欄即時顯示長度與重量。</li>
        <li>報表 → 編號，再開報表或匯出 Excel／CSV／PDF。</li>
      </ol>
      <h4 style={{ marginTop: 16 }}>對照圖紙建模</h4>
      <ol style={{ lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>
        <li>圖紙 → 匯入圖紙（DWG／DXF／PDF，也可直接拖進視窗），選擇放在哪個樓層平面或軸線立面。</li>
        <li>兩點對位：先點圖上的兩個軸線交點，再點模型上對應的交點；PDF 會一併校正比例（S 鍵切換）。點選前先放大，避免鎖到旁邊的柱框角點。</li>
        <li>建模時可鎖到圖紙的端點、中點、交點、圓心；狀態列「圖紙」可關閉圖紙鎖點。</li>
        <li>左側「圖紙」清單點名稱可調整透明度、單色、圖層開關。</li>
      </ol>
      <h4 style={{ marginTop: 16 }}>半自動辨識（功能區「辨識」）</h4>
      <ol style={{ lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>
        <li>辨識軸線：從平面圖的軸線與泡泡標籤建立軸線，並把圖紙移到原點。</li>
        <li>辨識高程：從立面、剖面圖的「2FL +4.200」等標註建立樓層。</li>
        <li>框選斷面表：框住圖上的構件表，抽出編號 → 斷面。</li>
        <li>辨識梁柱：選梁、柱圖層後按「辨識」，檢查候選（紅線＝缺斷面）後建立。</li>
        <li>建好後到「編輯 → 重複檢查」確認沒有重複構件，再出報表。</li>
      </ol>
    </Modal>
  );
}
