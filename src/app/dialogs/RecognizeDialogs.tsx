import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { parseProfile } from '../../catalog/parse';
import { cachedDrawing } from '../../drawing/storage';
import { targetLabel } from '../../drawing/placement';
import { store } from '../../model/store';
import { MEMBER_TYPE_LABEL, type MemberType } from '../../model/types';
import type { ScheduleEntry } from '../../recognize/schedule';
import { fmtElev } from '../../view3d/overlay';
import { app, fmtNum } from '../core';
import {
  applyGridDetection,
  applyLevels,
  applySchedule,
  batchPlace,
  createCandidates,
  openMembersRecog,
  planDrawings,
  previewCandidates,
  recog,
  recognizeGridFlow,
  runMembersRecog,
  startScheduleBox,
  type BatchOptions,
  type RecogState,
} from '../recognizeFlows';
import { toast } from '../ui';
import { Modal } from './Modal';
import { openProfileBrowser } from './ProfileBrowser';

const close = () => {
  recog.value = null;
  app.controller?.clearPreview();
};

function DrawingSelect(props: { value: string; onChange: (id: string) => void }) {
  const p = store.project.value;
  return (
    <select value={props.value} onChange={(e) => props.onChange((e.target as HTMLSelectElement).value)}>
      {planDrawings().map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}（{targetLabel(d.target, p)}）
        </option>
      ))}
    </select>
  );
}

// ---------- 軸線 ----------

function GridRecog(props: { st: Extract<RecogState, { kind: 'grid' }> }) {
  const p = store.project.value;
  const det = props.st.det;
  const target = useSignal(p.grids.length === 1 && !p.members.length ? p.grids[0].id : p.grids[0]?.id ?? 'new');
  const move = useSignal(true);
  const xText = useSignal(det?.xText ?? '');
  const yText = useSignal(det?.yText ?? '');
  const xLabels = useSignal(det?.xLabels ?? '');
  const yLabels = useSignal(det?.yLabels ?? '');
  return (
    <Modal
      title="辨識軸線"
      onClose={close}
      width={640}
      footer={
        <>
          <div class="grow" />
          <button onClick={close}>取消</button>
          <button
            class="primary"
            disabled={!det}
            onClick={() => det && applyGridDetection(props.st.drawingId, { ...det, xText: xText.value, yText: yText.value, xLabels: xLabels.value, yLabels: yLabels.value }, target.value, move.value)}
          >
            套用
          </button>
        </>
      }
    >
      <div class="filters">
        <label>圖紙</label>
        <DrawingSelect value={props.st.drawingId} onChange={(id) => void recognizeGridFlow(id)} />
      </div>
      {!det ? (
        <div class="warn-box">找不到軸線。請確認圖紙有軸線圖層（名稱含 AXIS、GRID、軸，或線型為 CENTER）且軸線夠長。</div>
      ) : (
        <>
          {det.warnings.map((w) => (
            <div key={w} class="warn-box">
              {w}
            </div>
          ))}
          <div class="form-grid">
            <label>來源圖層</label>
            <div class="hint">{det.layers.join('、')}</div>
            <label>X 座標</label>
            <input value={xText.value} onInput={(e) => (xText.value = (e.target as HTMLInputElement).value)} />
            <label>X 標籤</label>
            <input value={xLabels.value} onInput={(e) => (xLabels.value = (e.target as HTMLInputElement).value)} />
            <label>Y 座標</label>
            <input value={yText.value} onInput={(e) => (yText.value = (e.target as HTMLInputElement).value)} />
            <label>Y 標籤</label>
            <input value={yLabels.value} onInput={(e) => (yLabels.value = (e.target as HTMLInputElement).value)} />
            <label>圖上角度</label>
            <div class="hint">{det.angle.toFixed(3)}°</div>
            <label>套用到</label>
            <select value={target.value} onChange={(e) => (target.value = (e.target as HTMLSelectElement).value)}>
              {p.grids.map((g) => (
                <option key={g.id} value={g.id}>
                  取代「{g.name}」
                </option>
              ))}
              <option value="new">新增一組軸線</option>
            </select>
            <label>位置</label>
            <div>
              <label style={{ display: 'flex', gap: 6 }}>
                <input type="checkbox" checked={move.value} onChange={(e) => (move.value = (e.target as HTMLInputElement).checked)} />
                移動圖紙，使第一個軸線交點在原點、軸線平行 X 軸（建議）
              </label>
              <div class="hint">不勾選則保持圖紙位置，把軸線原點與角度設成圖上的位置。修改軸線不會移動既有構件。</div>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- 高程 ----------

function LevelsRecog(props: { st: Extract<RecogState, { kind: 'levels' }> }) {
  const p = store.project.value;
  const rows = useSignal(props.st.cands);
  return (
    <Modal
      title="辨識高程"
      onClose={close}
      width={620}
      footer={
        <>
          <div class="grow hint">名稱相同的樓層會更新高程，其餘新增；吸附在樓層上的構件會跟著移動。</div>
          <button onClick={close}>取消</button>
          <button class="primary" onClick={() => applyLevels(rows.value)}>
            套用
          </button>
        </>
      }
    >
      <table class="tbl">
        <thead>
          <tr>
            <th></th>
            <th>名稱</th>
            <th class="n">高程（mm）</th>
            <th>現有</th>
            <th>圖上文字</th>
          </tr>
        </thead>
        <tbody>
          {rows.value.map((c, i) => {
            const ex = p.levels.find((l) => l.name.toUpperCase() === c.name.toUpperCase());
            const upd = (patch: Partial<typeof c>) => {
              const r = [...rows.value];
              r[i] = { ...c, ...patch };
              rows.value = r;
            };
            return (
              <tr key={i}>
                <td>
                  <input type="checkbox" checked={c.use} onChange={(e) => upd({ use: (e.target as HTMLInputElement).checked })} />
                </td>
                <td>
                  <input value={c.name} onInput={(e) => upd({ name: (e.target as HTMLInputElement).value })} />
                </td>
                <td>
                  <input value={String(c.elevation)} style={{ textAlign: 'right' }} onInput={(e) => upd({ elevation: Number((e.target as HTMLInputElement).value) || 0 })} />
                </td>
                <td class="hint">{ex ? (ex.elevation === c.elevation ? '相同' : `${fmtElev(ex.elevation)} → 更新`) : '新增'}</td>
                <td class="hint">{c.source}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}

// ---------- 斷面對照表 ----------

function ScheduleDlg(props: { st: Extract<RecogState, { kind: 'schedule' }> }) {
  const rows = useSignal<ScheduleEntry[]>(props.st.entries.length ? props.st.entries : [{ mark: '', profile: '', type: '' }]);
  const replace = useSignal(false);
  const upd = (i: number, patch: Partial<ScheduleEntry>) => {
    const r = [...rows.value];
    r[i] = { ...r[i], ...patch };
    rows.value = r;
  };
  return (
    <Modal
      title={props.st.fromBox ? `框選結果：${props.st.entries.length} 筆編號 → 斷面` : '斷面對照表'}
      onClose={close}
      width={680}
      footer={
        <>
          {props.st.fromBox && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={replace.value} onChange={(e) => (replace.value = (e.target as HTMLInputElement).checked)} />
              取代整個對照表
            </label>
          )}
          <button
            onClick={() => {
              close();
              startScheduleBox();
            }}
          >
            {props.st.fromBox ? '重新框選' : '從圖紙框選…'}
          </button>
          <div class="grow" />
          <button onClick={close}>取消</button>
          <button class="primary" onClick={() => applySchedule(rows.value, !props.st.fromBox || replace.value)}>
            {props.st.fromBox ? '加入對照表' : '儲存'}
          </button>
        </>
      }
    >
      {props.st.conflicts.length > 0 && <div class="warn-box">同一編號出現不同斷面（取第一個）：{props.st.conflicts.join('；')}</div>}
      <div class="hint" style={{ marginBottom: 8 }}>
        辨識梁柱時，圖上只寫編號（如 G1）的構件依此表取得斷面。
      </div>
      <div class="report-scroll" style={{ maxHeight: '55vh' }}>
        <table class="tbl">
          <thead>
            <tr>
              <th>編號</th>
              <th>斷面</th>
              <th>類型</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.value.map((r, i) => {
              const ok = !r.profile || parseProfile(r.profile).ok;
              return (
                <tr key={i}>
                  <td>
                    <input value={r.mark} onInput={(e) => upd(i, { mark: (e.target as HTMLInputElement).value })} />
                  </td>
                  <td>
                    <div class="fpair">
                      <input class={ok ? '' : 'bad'} value={r.profile} onInput={(e) => upd(i, { profile: (e.target as HTMLInputElement).value })} />
                      <button style={{ flex: '0 0 auto' }} onClick={() => openProfileBrowser(r.profile, (n) => upd(i, { profile: n }))}>
                        …
                      </button>
                    </div>
                  </td>
                  <td>
                    <select value={r.type} onChange={(e) => upd(i, { type: (e.target as HTMLSelectElement).value as ScheduleEntry['type'] })}>
                      <option value="">（依編號）</option>
                      {(['column', 'girder', 'beam', 'brace', 'purlin'] as MemberType[]).map((t) => (
                        <option key={t} value={t}>
                          {MEMBER_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button class="danger" onClick={() => (rows.value = rows.value.filter((_, j) => j !== i))}>
                      刪除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div class="actions">
        <button onClick={() => (rows.value = [...rows.value, { mark: '', profile: '', type: '' }])}>新增一列</button>
      </div>
    </Modal>
  );
}

// ---------- 梁柱 ----------

const STATUS: Record<string, string> = { ok: '完整', noprofile: '缺斷面', nolabel: '無標註', exists: '已存在' };

function MembersRecog(props: { st: Extract<RecogState, { kind: 'members' }> }) {
  const st = props.st;
  const p = store.project.value;
  const data = cachedDrawing(st.drawingId);
  const ref = p.drawings.find((d) => d.id === st.drawingId);
  const filter = useSignal('');
  const levels = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  const set = (patch: Partial<typeof st>) => {
    recog.value = { ...st, ...patch };
  };
  useEffect(() => {
    previewCandidates();
  }, [st.result]);
  const toggleLayer = (k: 'beamLayers' | 'colLayers', name: string) => {
    const s = new Set(st[k]);
    s.has(name) ? s.delete(name) : s.add(name);
    set({ [k]: [...s] });
  };
  const pick = (k: 'beamLayers' | 'colLayers') => {
    const saved = recog.peek();
    recog.value = null;
    app.controller?.startPick(k === 'beamLayers' ? '點選圖紙上的一條梁線（取得梁圖層）；Esc 取消' : '點選圖紙上的柱框線（取得柱圖層）；Esc 取消', (_id, layer) => {
      if (saved?.kind !== 'members') return;
      const s = new Set(saved[k]);
      s.add(layer);
      recog.value = { ...saved, [k]: [...s] };
      toast(`已加入圖層 ${layer}`);
    });
  };
  const result = st.result ?? [];
  const shown = result.filter((c) => !filter.value || c.status === filter.value);
  const updRow = (id: number, patch: Partial<(typeof result)[number]>) => {
    set({ result: result.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  };
  const setMarkProfile = (mark: string, profile: string) => {
    set({ result: result.map((c) => (c.mark === mark ? { ...c, profile, status: profile ? 'ok' : c.status } : c)) });
  };
  const nChecked = result.filter((c) => c.checked && parseProfile(c.profile).ok).length;
  const layerList = (k: 'beamLayers' | 'colLayers') => (
    <div style={{ maxHeight: 120, overflow: 'auto', border: '1px solid var(--line2)', borderRadius: 4, padding: 4 }}>
      {data?.layers.map((l) => (
        <label key={l.name} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <input type="checkbox" checked={st[k].includes(l.name)} onChange={() => toggleLayer(k, l.name)} />
          <span class="swatch" style={{ background: l.color }} /> {l.name}
        </label>
      ))}
    </div>
  );
  return (
    <Modal
      title="辨識梁柱"
      onClose={close}
      width={980}
      footer={
        <>
          <div class="grow hint">{st.info || '設定圖層後按「辨識」；候選構件會以橘線預覽，紅線表示缺斷面。'}</div>
          <button onClick={close}>取消</button>
          <button onClick={() => void runMembersRecog()}>辨識</button>
          <button class="primary" disabled={!nChecked} onClick={createCandidates}>
            建立 {nChecked} 支構件
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
        <div class="form-grid" style={{ gridTemplateColumns: '70px 1fr', alignContent: 'start' }}>
          <label>圖紙</label>
          <DrawingSelect value={st.drawingId} onChange={(id) => void openMembersRecog(id)} />
          <label>樓層</label>
          <div class="hint">{ref ? targetLabel(ref.target, p) : ''}（梁放在此高程）</div>
          <label>梁圖層</label>
          <div>
            {layerList('beamLayers')}
            <button style={{ marginTop: 4 }} onClick={() => pick('beamLayers')}>
              在圖上點選梁線…
            </button>
          </div>
          <label>梁畫法</label>
          <select value={st.mode} onChange={(e) => set({ mode: (e.target as HTMLSelectElement).value as typeof st.mode })}>
            <option value="auto">自動判斷</option>
            <option value="double">雙線（取中心線）</option>
            <option value="single">單線（中心線）</option>
          </select>
          <label>柱圖層</label>
          <div>
            {layerList('colLayers')}
            <button style={{ marginTop: 4 }} onClick={() => pick('colLayers')}>
              在圖上點選柱框…
            </button>
          </div>
          <label>柱底</label>
          <select value={st.bottomLevelId} onChange={(e) => set({ bottomLevelId: (e.target as HTMLSelectElement).value })}>
            <option value="">（不建立柱）</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}（{l.elevation}）
              </option>
            ))}
          </select>
          <label>對照表</label>
          <div class="hint">{p.schedule.length} 筆編號 → 斷面</div>
        </div>
        <div>
          <div class="filters">
            <label>顯示</label>
            <select value={filter.value} onChange={(e) => (filter.value = (e.target as HTMLSelectElement).value)}>
              <option value="">全部（{result.length}）</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}（{result.filter((c) => c.status === k).length}）
                </option>
              ))}
            </select>
            <button onClick={() => set({ result: result.map((c) => ({ ...c, checked: c.status !== 'exists' && !!parseProfile(c.profile).ok })) })}>只選完整的</button>
            <button onClick={() => set({ result: result.map((c) => ({ ...c, checked: false })) })}>全不選</button>
          </div>
          <div class="report-scroll" style={{ maxHeight: '52vh' }}>
            <table class="tbl">
              <thead>
                <tr>
                  <th></th>
                  <th>類型</th>
                  <th>圖面編號</th>
                  <th>斷面</th>
                  <th class="n">長度</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const ok = parseProfile(c.profile).ok;
                  return (
                    <tr key={c.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={c.checked}
                          onChange={(e) => {
                            updRow(c.id, { checked: (e.target as HTMLInputElement).checked });
                          }}
                        />
                      </td>
                      <td>
                        <select value={c.type} onChange={(e) => updRow(c.id, { type: (e.target as HTMLSelectElement).value as MemberType })}>
                          {(['column', 'girder', 'beam', 'brace', 'purlin'] as MemberType[]).map((t) => (
                            <option key={t} value={t}>
                              {MEMBER_TYPE_LABEL[t]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{c.mark || '—'}</td>
                      <td>
                        <input
                          class={ok ? '' : 'bad'}
                          value={c.profile}
                          placeholder="輸入斷面"
                          onChange={(e) => {
                            const v = (e.target as HTMLInputElement).value;
                            if (c.mark && confirm(`把所有「${c.mark}」都設成 ${v}？（取消＝只改這一支）`)) setMarkProfile(c.mark, v);
                            else updRow(c.id, { profile: v, status: v ? 'ok' : c.status });
                          }}
                        />
                      </td>
                      <td class="n">{c.type === 'column' ? '—' : fmtNum(Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]))}</td>
                      <td class={c.status === 'ok' ? '' : 'hint err'}>{STATUS[c.status]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------- 一鍵佈梁柱 ----------

function BatchDlg() {
  const p = store.project.value;
  const g0 = p.grids[0];
  const levels = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  const d = p.settings.defaults;
  const o = useSignal<BatchOptions>({
    gridId: g0?.id ?? '',
    x0: 0,
    x1: Math.max(0, (g0?.xs.length ?? 1) - 1),
    y0: 0,
    y1: Math.max(0, (g0?.ys.length ?? 1) - 1),
    columns: true,
    colProfile: d.column.profile,
    colFrom: levels[0]?.id ?? '',
    colTo: levels[levels.length - 1]?.id ?? '',
    beamX: true,
    beamXProfile: d.girder.profile,
    beamY: true,
    beamYProfile: d.girder.profile,
    beamLevels: levels.slice(1).map((l) => l.id),
  });
  const g = p.grids.find((x) => x.id === o.value.gridId) ?? g0;
  const set = (patch: Partial<BatchOptions>) => (o.value = { ...o.value, ...patch });
  const v = o.value;
  const profOk = (s: string) => parseProfile(s).ok;
  const bad = (v.columns && !profOk(v.colProfile)) || (v.beamX && !profOk(v.beamXProfile)) || (v.beamY && !profOk(v.beamYProfile));
  const lvSel = (val: string, k: 'colFrom' | 'colTo') => (
    <select value={val} onChange={(e) => set({ [k]: (e.target as HTMLSelectElement).value })}>
      {levels.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );
  const axSel = (axes: { label: string }[], val: number, k: keyof BatchOptions) => (
    <select value={String(val)} onChange={(e) => set({ [k]: Number((e.target as HTMLSelectElement).value) })}>
      {axes.map((a, i) => (
        <option key={i} value={String(i)}>
          {a.label}
        </option>
      ))}
    </select>
  );
  const prof = (val: string, k: 'colProfile' | 'beamXProfile' | 'beamYProfile') => (
    <div class="fpair">
      <input class={profOk(val) ? '' : 'bad'} value={val} onInput={(e) => set({ [k]: (e.target as HTMLInputElement).value })} />
      <button style={{ flex: '0 0 auto' }} onClick={() => openProfileBrowser(val, (n) => set({ [k]: n }))}>
        …
      </button>
    </div>
  );
  if (!g) return null;
  return (
    <Modal
      title="一鍵佈梁柱"
      onClose={close}
      width={620}
      footer={
        <>
          <div class="grow hint">已存在的相同構件會略過。</div>
          <button onClick={close}>取消</button>
          <button
            class="primary"
            disabled={bad}
            onClick={() => {
              const n = batchPlace(o.value);
              close();
              toast(n ? `已建立 ${n} 支構件` : '沒有新增構件（可能都已存在）');
            }}
          >
            建立
          </button>
        </>
      }
    >
      <div class="form-grid" style={{ gridTemplateColumns: '120px 1fr' }}>
        <label>軸線範圍</label>
        <div class="fpair" style={{ alignItems: 'center' }}>
          X {axSel(g.xs, v.x0, 'x0')} ～ {axSel(g.xs, v.x1, 'x1')}　Y {axSel(g.ys, v.y0, 'y0')} ～ {axSel(g.ys, v.y1, 'y1')}
        </div>
        <label>
          <input type="checkbox" checked={v.columns} onChange={(e) => set({ columns: (e.target as HTMLInputElement).checked })} /> 柱
        </label>
        <div>
          {prof(v.colProfile, 'colProfile')}
          <div class="fpair" style={{ marginTop: 4, alignItems: 'center' }}>
            從 {lvSel(v.colFrom, 'colFrom')} 到 {lvSel(v.colTo, 'colTo')}（每層一支）
          </div>
        </div>
        <label>
          <input type="checkbox" checked={v.beamX} onChange={(e) => set({ beamX: (e.target as HTMLInputElement).checked })} /> X 向大梁
        </label>
        <div>
          {prof(v.beamXProfile, 'beamXProfile')}
          <div class="hint">沿 {g.ys.map((a) => a.label).join('、')} 軸，在交點間分跨</div>
        </div>
        <label>
          <input type="checkbox" checked={v.beamY} onChange={(e) => set({ beamY: (e.target as HTMLInputElement).checked })} /> Y 向大梁
        </label>
        <div>
          {prof(v.beamYProfile, 'beamYProfile')}
          <div class="hint">沿 {g.xs.map((a) => a.label).join('、')} 軸</div>
        </div>
        <label>大梁樓層</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {levels.map((l) => (
            <label key={l.id}>
              <input
                type="checkbox"
                checked={v.beamLevels.includes(l.id)}
                onChange={(e) => {
                  const s = new Set(v.beamLevels);
                  (e.target as HTMLInputElement).checked ? s.add(l.id) : s.delete(l.id);
                  set({ beamLevels: [...s] });
                }}
              />{' '}
              {l.name}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function RecogHost() {
  const st = recog.value;
  if (!st) return null;
  if (st.kind === 'grid') return <GridRecog key={`${st.drawingId}|${st.det?.xText}`} st={st} />;
  if (st.kind === 'levels') return <LevelsRecog st={st} />;
  if (st.kind === 'schedule') return <ScheduleDlg key={String(st.entries.length) + st.fromBox} st={st} />;
  if (st.kind === 'members') return <MembersRecog st={st} />;
  if (st.kind === 'batch') return <BatchDlg />;
  return null;
}
