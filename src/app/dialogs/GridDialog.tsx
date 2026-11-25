import { useSignal } from '@preact/signals';
import { buildAxes, gridExtent } from '../../geom/grid';
import { makeGrid } from '../../model/defaults';
import { commitGrid, deleteGrid } from '../../model/ops';
import { store } from '../../model/store';
import type { Grid } from '../../model/types';
import { toast, ui } from '../ui';
import { Modal } from './Modal';

function Preview(props: { g: Grid | null }) {
  const g = props.g;
  if (!g) return <div class="hint err" style={{ height: 220 }}>座標格式錯誤</div>;
  const e = gridExtent(g);
  const pad = g.ext + 1500;
  const w = e.u1 - e.u0 + pad * 2;
  const h = e.v1 - e.v0 + pad * 2;
  const s = Math.max(w, h) / 100;
  return (
    <svg viewBox={`${e.u0 - pad} ${-(e.v1 + pad)} ${w} ${h}`} style={{ width: '100%', height: 240, background: '#f3f6fa', borderRadius: 6 }}>
      <g transform={`rotate(${-g.rotation} 0 0)`}>
        {g.xs.map((a) => (
          <g key={`x${a.label}${a.offset}`}>
            <line x1={a.offset} x2={a.offset} y1={-(e.v1 + g.ext)} y2={-(e.v0 - g.ext)} stroke="#3d7bd9" stroke-width={s * 0.25} stroke-dasharray={`${s * 3} ${s}`} />
            <circle cx={a.offset} cy={-(e.v0 - g.ext) + s * 3} r={s * 2.6} fill="#fff" stroke="#3d7bd9" stroke-width={s * 0.25} />
            <text x={a.offset} y={-(e.v0 - g.ext) + s * 4} font-size={s * 3} text-anchor="middle" fill="#1f4f9c">
              {a.label}
            </text>
          </g>
        ))}
        {g.ys.map((a) => (
          <g key={`y${a.label}${a.offset}`}>
            <line y1={-a.offset} y2={-a.offset} x1={e.u0 - g.ext} x2={e.u1 + g.ext} stroke="#3d7bd9" stroke-width={s * 0.25} stroke-dasharray={`${s * 3} ${s}`} />
            <circle cx={e.u0 - g.ext - s * 3} cy={-a.offset} r={s * 2.6} fill="#fff" stroke="#3d7bd9" stroke-width={s * 0.25} />
            <text x={e.u0 - g.ext - s * 3} y={-a.offset + s} font-size={s * 3} text-anchor="middle" fill="#1f4f9c">
              {a.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export function GridDialog(props: { gridId?: string }) {
  const p = store.p;
  const editing = p.grids.find((g) => g.id === props.gridId) ?? (props.gridId === 'new' ? undefined : p.grids[0]);
  const base = editing ?? makeGrid('0 3*6000', '0 2*8000', '1', 'A', `軸線 ${p.grids.length + 1}`);
  const name = useSignal(base.name);
  const xText = useSignal(base.xText);
  const yText = useSignal(base.yText);
  const xLabels = useSignal(base.xLabels);
  const yLabels = useSignal(base.yLabels);
  const ox = useSignal(String(base.origin[0]));
  const oy = useSignal(String(base.origin[1]));
  const rot = useSignal(String(base.rotation));
  const ext = useSignal(String(base.ext));
  const magnetic = useSignal(true);
  const close = () => (ui.dialog.value = '');

  const xs = buildAxes(xText.value, xLabels.value, '1');
  const ys = buildAxes(yText.value, yLabels.value, 'A');
  const nums = [ox.value, oy.value, rot.value, ext.value].map(Number);
  const err = typeof xs === 'string' ? `X：${xs}` : typeof ys === 'string' ? `Y：${ys}` : nums.some((n) => !Number.isFinite(n)) ? '原點、角度或延伸長度不是數字' : '';
  const grid: Grid | null = err
    ? null
    : {
        ...base,
        name: name.value.trim() || '軸線',
        xs: xs as Grid['xs'],
        ys: ys as Grid['ys'],
        xText: xText.value,
        yText: yText.value,
        xLabels: xLabels.value,
        yLabels: yLabels.value,
        origin: [nums[0], nums[1], 0],
        rotation: nums[2],
        ext: Math.max(0, nums[3]),
      };
  const save = () => {
    if (!grid) return;
    const n = commitGrid(grid, editing ? `修改軸線 ${grid.name}` : `建立軸線 ${grid.name}`, magnetic.value);
    toast(editing ? `已修改軸線，立面視圖已同步${n ? `；${n} 支構件跟著移動` : ''}` : '已建立軸線與立面視圖');
    close();
  };
  const field = (label: string, sig: { value: string }, ph = '', hint = '') => (
    <>
      <label>{label}</label>
      <div>
        <input value={sig.value} placeholder={ph} style={{ width: '100%' }} onInput={(e) => (sig.value = (e.target as HTMLInputElement).value)} />
        {hint && <div class="hint">{hint}</div>}
      </div>
    </>
  );
  return (
    <Modal
      title={editing ? `軸線：${editing.name}` : '新增軸線'}
      onClose={close}
      width={860}
      footer={
        <>
          {editing && (
            <button
              class="danger"
              onClick={() => {
                if (confirm(`刪除軸線「${editing.name}」？構件不會被刪除。`)) {
                  deleteGrid(editing.id);
                  close();
                }
              }}
            >
              刪除軸線
            </button>
          )}
          {editing && <button onClick={() => (ui.dialog.value = 'grid:new')}>另建一組軸線</button>}
          <div class="grow hint err">{err}</div>
          <button onClick={close}>取消</button>
          <button class="primary" disabled={!grid} onClick={save}>
            {editing ? '修改' : '建立'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div class="form-grid">
          {field('名稱', name)}
          {field('X 座標', xText, '0 4*6000 7500', '第一個值是起點，其後為間距；n*d 代表 n 個 d（同 Tekla）')}
          {field('X 標籤', xLabels, '1 2 3', '不足的自動遞增')}
          {field('Y 座標', yText, '0 2*8000')}
          {field('Y 標籤', yLabels, 'A B C')}
          <label>原點 X / Y</label>
          <div class="fpair">
            <input value={ox.value} onInput={(e) => (ox.value = (e.target as HTMLInputElement).value)} />
            <input value={oy.value} onInput={(e) => (oy.value = (e.target as HTMLInputElement).value)} />
          </div>
          {field('旋轉角（度）', rot, '0', '繞 Z 軸逆時針')}
          {field('延伸長度', ext, '2000', '軸線超出最外側軸線的長度（mm）')}
          <label>結果</label>
          <div class="hint">
            {grid ? `X 向 ${grid.xs.length} 條（${grid.xs.map((a) => a.label).join(' ')}）、Y 向 ${grid.ys.length} 條（${grid.ys.map((a) => a.label).join(' ')}）` : ''}
          </div>
        </div>
        <div>
          <Preview g={grid} />
          {editing && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
              <input type="checkbox" checked={magnetic.value} onChange={(e) => (magnetic.value = (e.target as HTMLInputElement).checked)} />
              磁性軸線：端點在軸線上的構件跟著移動（依標籤對應）
            </label>
          )}
          <div class="hint" style={{ marginTop: 6 }}>
            高程（Z）請在「高程」對話框設定。
          </div>
        </div>
      </div>
    </Modal>
  );
}
