import { useSignal } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import { cachedDrawing } from '../../drawing/storage';
import { ENCODINGS } from '../../drawing/text';
import { targetLabel } from '../../drawing/placement';
import { store } from '../../model/store';
import type { DrawingRef, DrawingTarget } from '../../model/types';
import { fmtNum, app } from '../core';
import { commitImport, defaultTarget, importState, overlapsGrid, parseCadFile, PDF_PT_MM, pickPdfPage, removeDrawing } from '../drawingFlows';
import { toast, ui } from '../ui';
import { Modal } from './Modal';

// ---------- 目標平面選單 ----------

function encodeTarget(t: DrawingTarget): string {
  return t.kind === 'plan' ? `plan:${t.levelId}` : `elev:${t.gridId}:${t.dir}:${t.label}`;
}

function decodeTarget(s: string): DrawingTarget | null {
  const [k, a, b, ...rest] = s.split(':');
  if (k === 'plan') return { kind: 'plan', levelId: a };
  if (k === 'elev') return { kind: 'elevation', gridId: a, dir: b as 'x' | 'y', label: rest.join(':') };
  return null;
}

function TargetSelect(props: { value: DrawingTarget | null; onChange: (t: DrawingTarget) => void }) {
  const p = store.project.value;
  const levels = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  return (
    <select value={props.value ? encodeTarget(props.value) : ''} onChange={(e) => {
      const t = decodeTarget((e.target as HTMLSelectElement).value);
      if (t) props.onChange(t);
    }}>
      <optgroup label="平面">
        {levels.map((l) => (
          <option key={l.id} value={`plan:${l.id}`}>
            平面 {l.name}（{l.elevation}）
          </option>
        ))}
      </optgroup>
      {p.grids.map((g) => (
        <optgroup key={g.id} label={`立面（${g.name}）`}>
          {[...g.ys.map((a) => ['y', a.label] as const), ...g.xs.map((a) => ['x', a.label] as const)].map(([dir, label]) => (
            <option key={`${dir}${label}`} value={`elev:${g.id}:${dir}:${label}`}>
              立面 {label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

const UNIT_OPTS: [number, string][] = [
  [1, 'mm'],
  [10, 'cm'],
  [1000, 'm'],
  [25.4, '英寸'],
];

// ---------- 匯入 ----------

export function ImportDialog() {
  const st = importState.value;
  const name = useSignal('');
  const target = useSignal<DrawingTarget | null>(defaultTarget());
  const unit = useSignal<number | null>(null);
  const pdfN = useSignal('100');
  const center = useSignal<boolean | null>(null);
  const alignAfter = useSignal<boolean | null>(null);
  if (!st) return null;
  const close = () => (importState.value = null);
  const d = st.data;
  const fileBase = st.file.name.replace(/\.[^.]+$/, '');
  const scale = st.kind === 'pdf' ? PDF_PT_MM * (Number(pdfN.value) || 100) : (unit.value ?? d?.unitScale ?? 1);
  const t = target.value;
  const overlaps = d && t ? overlapsGrid(d, scale, t) : false;
  const doCenter = center.value ?? !overlaps;
  const doAlign = alignAfter.value ?? (st.kind === 'pdf' || !overlaps);

  const body = () => {
    if (st.stage === 'parsing') return <div class="hint" style={{ padding: 30, textAlign: 'center' }}>解析中…（大型圖檔需要幾秒鐘{st.kind === 'dwg' ? '，第一次開 DWG 要載入約 8 MB 的解析元件' : ''}）</div>;
    if (st.stage === 'error')
      return (
        <div>
          <div class="warn-box">{st.error}</div>
          {st.kind === 'dwg' && <div class="hint">若 DWG 讀不出來，可在 AutoCAD 另存成 DXF 再匯入。</div>}
        </div>
      );
    if (st.stage === 'pages')
      return (
        <div>
          <div class="filters">
            <label>出圖比例 1:</label>
            <input value={pdfN.value} style={{ width: 80 }} onInput={(e) => (pdfN.value = (e.target as HTMLInputElement).value)} />
            <span class="hint">不確定可先填 100，匯入後用兩點對位校正比例</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, maxHeight: '60vh', overflow: 'auto' }}>
            {st.pages?.map((pg) => (
              <button key={pg.n} style={{ padding: 6 }} onClick={() => void pickPdfPage(pg.n, Number(pdfN.value) || 100)}>
                <img src={pg.thumb} style={{ width: '100%', display: 'block', border: '1px solid #ddd' }} />
                <div>第 {pg.n} 頁</div>
              </button>
            ))}
          </div>
          {(st.pages?.length ?? 0) < (st.pdf?.numPages ?? 0) && <div class="hint">縮圖載入中…（共 {st.pdf.numPages} 頁）</div>}
        </div>
      );
    if (!d) return null;
    const skipped = Object.entries(d.stats.skipped);
    return (
      <div class="form-grid" style={{ gridTemplateColumns: '110px 1fr' }}>
        <label>檔案</label>
        <div>
          {st.file.name}
          {st.page ? `　第 ${st.page} 頁` : ''}
          <div class="hint">
            {d.layers.length} 個圖層、{fmtNum(d.stats.segments)} 條線段、{fmtNum(d.stats.texts)} 個文字
            {skipped.length > 0 && `；略過 ${skipped.map(([k, v]) => `${k}×${v}`).join('、')}`}
          </div>
        </div>
        <label>名稱</label>
        <input value={name.value || fileBase} onInput={(e) => (name.value = (e.target as HTMLInputElement).value)} />
        <label>放到</label>
        <TargetSelect value={t} onChange={(v) => (target.value = v)} />
        {st.kind === 'pdf' ? (
          <>
            <label>出圖比例</label>
            <div class="fpair">
              <span style={{ flex: '0 0 auto', alignSelf: 'center' }}>1 :</span>
              <input value={pdfN.value} onInput={(e) => (pdfN.value = (e.target as HTMLInputElement).value)} />
            </div>
          </>
        ) : (
          <>
            <label>圖面單位</label>
            <div>
              <select value={String(unit.value ?? d.unitScale)} onChange={(e) => (unit.value = Number((e.target as HTMLSelectElement).value))}>
                {UNIT_OPTS.map(([v, l]) => (
                  <option key={v} value={String(v)}>
                    {l}
                  </option>
                ))}
              </select>
              <div class="hint">檔案記錄：{d.unitName}</div>
            </div>
            <label>文字編碼</label>
            <div>
              <select value={st.encoding} onChange={(e) => void parseCadFile((e.target as HTMLSelectElement).value)}>
                {ENCODINGS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                    {v === 'auto' && st.encoding === 'auto' ? `（偵測為 ${d.encoding}）` : ''}
                  </option>
                ))}
              </select>
              <div class="hint">中文變亂碼時改成 Big5 或 UTF-8 重新解析</div>
            </div>
          </>
        )}
        <label>位置</label>
        <div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={doCenter} onChange={(e) => (center.value = (e.target as HTMLInputElement).checked)} />
            圖紙中心對齊軸線中心
          </label>
          <div class="hint">{overlaps ? '圖紙原座標已落在軸線範圍內，建議保持原座標' : '圖紙原座標離軸線很遠，建議先置中'}</div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
            <input type="checkbox" checked={doAlign} onChange={(e) => (alignAfter.value = (e.target as HTMLInputElement).checked)} />
            匯入後立即兩點對位（點圖上兩個軸線交點，再點模型對應的交點）
          </label>
        </div>
        {d.texts.length > 0 && (
          <>
            <label>文字範例</label>
            <div class="hint" style={{ whiteSpace: 'normal' }}>
              {d.texts
                .slice(0, 12)
                .map((x) => x.s)
                .join('　')}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <Modal
      title={`匯入圖紙（${st.kind.toUpperCase()}）`}
      onClose={close}
      width={720}
      footer={
        <>
          <div class="grow" />
          <button onClick={close}>取消</button>
          {st.stage === 'place' && (
            <button
              class="primary"
              disabled={!t}
              onClick={async () => {
                if (!t) return;
                if (st.kind === 'pdf') ui.alignScale.value = true;
                const ref = await commitImport({ name: (name.value || fileBase).trim(), target: t, scale, center: doCenter });
                if (ref && doAlign) {
                  app.controller?.startAlign(ref.id);
                  toast('兩點對位：先點圖紙上的軸線交點，再點模型上對應的交點', 6000);
                }
              }}
            >
              匯入
            </button>
          )}
        </>
      }
    >
      {body()}
    </Modal>
  );
}

// ---------- 圖紙設定 ----------

export function DrawingSettings(props: { id: string }) {
  const p = store.project.value;
  const ref = p.drawings.find((d) => d.id === props.id);
  const data = cachedDrawing(props.id);
  const name = useSignal(ref?.name ?? '');
  const target = useSignal<DrawingTarget | null>(ref?.target ?? null);
  const scale = useSignal(String(ref?.scale ?? 1));
  const rot = useSignal(String(ref?.rotation ?? 0));
  const ou = useSignal(String(ref?.offset[0] ?? 0));
  const ov = useSignal(String(ref?.offset[1] ?? 0));
  const filter = useSignal('');
  const counts = useMemo(() => {
    if (!data) return [] as { segs: number; texts: number }[];
    const c = data.layers.map((_, i) => ({ segs: data.segs[i].length / 4, texts: 0 }));
    for (const t of data.texts) if (c[t.layer]) c[t.layer].texts++;
    return c;
  }, [data]);
  const close = () => (ui.dialog.value = '');
  if (!ref) return null;
  const live = (patch: Partial<DrawingRef>) => store.replaceSilent('drawings', [{ ...ref, ...patch }]);
  const nums = [scale.value, rot.value, ou.value, ov.value].map(Number);
  const bad = nums.some((n) => !Number.isFinite(n)) || !(nums[0] > 0);
  const save = () => {
    if (bad || !target.value) return;
    store.replace('drawings', [{ ...ref, name: name.value.trim() || ref.name, target: target.value, scale: nums[0], rotation: nums[1], offset: [nums[2], nums[3]] }], `修改圖紙 ${ref.name}`);
    close();
  };
  const hidden = new Set(ref.hiddenLayers);
  const layers = (data?.layers ?? []).map((l, i) => ({ ...l, i })).filter((l) => !filter.value || l.name.toLowerCase().includes(filter.value.toLowerCase()));
  const setHidden = (names: string[], hide: boolean) => {
    const h = new Set(ref.hiddenLayers);
    for (const n of names) hide ? h.add(n) : h.delete(n);
    live({ hiddenLayers: [...h] });
  };
  return (
    <Modal
      title={`圖紙：${ref.name}`}
      onClose={close}
      width={860}
      footer={
        <>
          <button
            class="danger"
            onClick={() => {
              if (!confirm(`從專案移除圖紙「${ref.name}」？（可用復原找回）`)) return;
              removeDrawing(ref);
              close();
            }}
          >
            移除圖紙
          </button>
          <button
            onClick={() => {
              close();
              app.controller?.startAlign(ref.id);
            }}
          >
            兩點對位
          </button>
          <div class="grow hint err">{bad ? '比例、角度或位置不是有效數字' : ''}</div>
          <button onClick={close}>取消</button>
          <button class="primary" disabled={bad} onClick={save}>
            確定
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div class="form-grid" style={{ alignContent: 'start' }}>
          <label>名稱</label>
          <input value={name.value} onInput={(e) => (name.value = (e.target as HTMLInputElement).value)} />
          <label>來源</label>
          <div class="hint">
            {ref.fileName}
            {ref.page ? `　第 ${ref.page} 頁` : ''}
            {data && `　${data.layers.length} 圖層・${fmtNum(data.stats.segments)} 線段・${fmtNum(data.stats.texts)} 文字`}
          </div>
          <label>放到</label>
          <TargetSelect value={target.value} onChange={(v) => (target.value = v)} />
          <label>比例</label>
          <div>
            <input value={scale.value} onInput={(e) => (scale.value = (e.target as HTMLInputElement).value)} />
            <div class="hint">每個圖紙單位 = 幾 mm{ref.format === 'pdf' ? `（1:${fmtNum(Number(scale.value) / PDF_PT_MM, 1)}）` : ''}</div>
          </div>
          <label>旋轉（度）</label>
          <input value={rot.value} onInput={(e) => (rot.value = (e.target as HTMLInputElement).value)} />
          <label>原點位置</label>
          <div class="fpair">
            <input value={ou.value} onInput={(e) => (ou.value = (e.target as HTMLInputElement).value)} title={ref.target.kind === 'plan' ? 'X' : '水平'} />
            <input value={ov.value} onInput={(e) => (ov.value = (e.target as HTMLInputElement).value)} title={ref.target.kind === 'plan' ? 'Y' : '高程'} />
          </div>
          <label>透明度</label>
          <input type="range" min="0.1" max="1" step="0.05" value={ref.opacity} onInput={(e) => live({ opacity: Number((e.target as HTMLInputElement).value) })} />
          <label>顯示</label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label>
              <input type="checkbox" checked={ref.visible} onChange={(e) => live({ visible: (e.target as HTMLInputElement).checked })} /> 顯示
            </label>
            <label>
              <input type="checkbox" checked={ref.mono} onChange={(e) => live({ mono: (e.target as HTMLInputElement).checked })} /> 單色
            </label>
            <label>
              <input type="checkbox" checked={ref.showText} onChange={(e) => live({ showText: (e.target as HTMLInputElement).checked })} /> 文字
            </label>
            {data?.raster && (
              <label>
                <input type="checkbox" checked={ref.raster} onChange={(e) => live({ raster: (e.target as HTMLInputElement).checked })} /> 點陣底圖
              </label>
            )}
          </div>
          <label>目前位置</label>
          <div class="hint">{targetLabel(ref.target, p)}</div>
        </div>
        <div>
          <div class="filters">
            <b>圖層</b>
            <input placeholder="篩選" value={filter.value} style={{ width: 120 }} onInput={(e) => (filter.value = (e.target as HTMLInputElement).value)} />
            <button onClick={() => setHidden(layers.map((l) => l.name), false)}>全開</button>
            <button onClick={() => setHidden(layers.map((l) => l.name), true)}>全關</button>
          </div>
          <div class="report-scroll" style={{ maxHeight: 380 }}>
            <table class="tbl">
              <thead>
                <tr>
                  <th></th>
                  <th>圖層</th>
                  <th class="n">線段</th>
                  <th class="n">文字</th>
                </tr>
              </thead>
              <tbody>
                {layers.map((l) => (
                  <tr key={l.name}>
                    <td>
                      <input type="checkbox" checked={!hidden.has(l.name)} onChange={(e) => setHidden([l.name], !(e.target as HTMLInputElement).checked)} />
                    </td>
                    <td>
                      <span class="swatch" style={{ background: l.color }} /> {l.name}
                      {l.linetype && l.linetype !== 'CONTINUOUS' ? <span class="hint"> {l.linetype}</span> : null}
                    </td>
                    <td class="n">{fmtNum(counts[l.i]?.segs ?? 0)}</td>
                    <td class="n">{fmtNum(counts[l.i]?.texts ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data && <div class="hint">圖紙資料載入中…</div>}
        </div>
      </div>
    </Modal>
  );
}
