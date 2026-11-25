import { useSignal } from '@preact/signals';
import { expandLabels, parseSpacing } from '../../geom/grid';
import { uid } from '../../model/defaults';
import { commitLevels } from '../../model/ops';
import { store } from '../../model/store';
import type { Level } from '../../model/types';
import { autoFloorArea } from '../../quantity/summary';
import { fmtElev } from '../../view3d/overlay';
import { fmtNum } from '../core';
import { toast, ui } from '../ui';
import { Modal } from './Modal';

interface Row {
  id: string;
  name: string;
  elevation: string;
  floorArea: string;
}

export function LevelDialog() {
  const p = store.p;
  const rows = useSignal<Row[]>(
    [...p.levels]
      .sort((a, b) => a.elevation - b.elevation)
      .map((l) => ({ id: l.id, name: l.name, elevation: String(l.elevation), floorArea: l.floorArea === undefined ? '' : String(l.floorArea) })),
  );
  const gen = useSignal('0 4200 2*3600');
  const genNames = useSignal('1FL 2FL 3FL RFL');
  const close = () => (ui.dialog.value = '');
  const auto = autoFloorArea(p.grids);

  const upd = (i: number, k: keyof Row, v: string) => {
    const r = [...rows.value];
    r[i] = { ...r[i], [k]: v };
    rows.value = r;
  };
  const errors: string[] = [];
  const names = new Set<string>();
  for (const r of rows.value) {
    if (!r.name.trim()) errors.push('樓層名稱不可空白');
    if (names.has(r.name.trim())) errors.push(`樓層名稱重複：${r.name}`);
    names.add(r.name.trim());
    if (!Number.isFinite(Number(r.elevation)) || r.elevation.trim() === '') errors.push(`${r.name} 高程不是數字`);
    if (r.floorArea.trim() && !(Number(r.floorArea) >= 0)) errors.push(`${r.name} 樓地板面積錯誤`);
  }
  const sortedRows = [...rows.value].sort((a, b) => Number(a.elevation) - Number(b.elevation));
  const top = sortedRows[sortedRows.length - 1];

  const save = () => {
    if (errors.length) return;
    const levels: Level[] = rows.value.map((r) => {
      const l: Level = { id: r.id, name: r.name.trim(), elevation: Number(r.elevation) };
      if (r.floorArea.trim()) l.floorArea = Number(r.floorArea);
      return l;
    });
    commitLevels(levels, '修改高程');
    toast('已更新高程；吸附在樓層上的構件已跟著移動，平面視圖已同步');
    close();
  };

  const generate = () => {
    const r = parseSpacing(gen.value);
    if (!r.ok) {
      alert(r.error);
      return;
    }
    const nm = expandLabels(genNames.value, r.values.length, '1FL');
    const old = rows.value;
    rows.value = r.values.map((z, i) => ({ id: old[i]?.id ?? uid('l'), name: nm[i], elevation: String(z), floorArea: old[i]?.floorArea ?? '' }));
  };

  return (
    <Modal
      title="高程（樓層）"
      onClose={close}
      width={720}
      footer={
        <>
          <div class="grow hint err">{errors[0] ?? ''}</div>
          <button onClick={close}>取消</button>
          <button class="primary" disabled={errors.length > 0} onClick={save}>
            確定
          </button>
        </>
      }
    >
      <div class="filters">
        <label>快速產生</label>
        <input value={gen.value} style={{ width: 180 }} onInput={(e) => (gen.value = (e.target as HTMLInputElement).value)} title="第一個值為起始高程，其後為樓高；n*d 代表 n 層 d" />
        <label>名稱</label>
        <input value={genNames.value} style={{ width: 200 }} onInput={(e) => (genNames.value = (e.target as HTMLInputElement).value)} />
        <button onClick={generate}>產生</button>
      </div>
      <div class="hint" style={{ marginBottom: 8 }}>
        語法同軸線：「0 4200 2*3600」= 0、4200、7800、11400。名稱不足會自動遞增。
      </div>
      <table class="tbl">
        <thead>
          <tr>
            <th>名稱</th>
            <th class="n">高程（mm）</th>
            <th></th>
            <th class="n">樓地板面積（m²）</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.value.map((r, i) => (
            <tr key={r.id}>
              <td>
                <input value={r.name} onInput={(e) => upd(i, 'name', (e.target as HTMLInputElement).value)} />
              </td>
              <td>
                <input value={r.elevation} style={{ textAlign: 'right' }} onInput={(e) => upd(i, 'elevation', (e.target as HTMLInputElement).value)} />
              </td>
              <td class="hint">{Number.isFinite(Number(r.elevation)) ? fmtElev(Number(r.elevation)) : ''}</td>
              <td>
                <input
                  value={r.floorArea}
                  style={{ textAlign: 'right' }}
                  placeholder={r === top && rows.value.length > 1 ? '屋頂（不計）' : `自動 ${fmtNum(auto, 1)}`}
                  onInput={(e) => upd(i, 'floorArea', (e.target as HTMLInputElement).value)}
                />
              </td>
              <td>
                <button
                  class="danger"
                  onClick={() => {
                    rows.value = rows.value.filter((_, j) => j !== i);
                  }}
                >
                  刪除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="actions">
        <button
          onClick={() => {
            const last = sortedRows[sortedRows.length - 1];
            const z = last ? Number(last.elevation) + 3600 : 0;
            rows.value = [...rows.value, { id: uid('l'), name: `${rows.value.length + 1}FL`, elevation: String(z), floorArea: '' }];
          }}
        >
          新增樓層
        </button>
      </div>
      <div class="hint" style={{ marginTop: 10, lineHeight: 1.7 }}>
        樓地板面積用於報表的「單位面積用鋼量（kg/m²）」。空白時依軸線外框估算，最高層視為屋頂不計入。
        <br />
        修改高程時，吸附在該樓層的柱、梁會跟著移動（磁性高程）。
      </div>
    </Modal>
  );
}
