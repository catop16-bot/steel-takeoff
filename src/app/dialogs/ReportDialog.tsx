import { useSignal } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import { store } from '../../model/store';
import { MEMBER_TYPES, MEMBER_TYPE_LABEL, type MemberType } from '../../model/types';
import { buildReport, exportCsv, exportExcel, openPrint, type ReportFilter } from '../../report/actions';
import { ALL_TABLES, cellText, errorTable, totals, withHidden, type TableDef } from '../../report/tables';
import { fmtNum } from '../core';
import { ui } from '../ui';
import { Modal } from './Modal';

function Table(props: { t: TableDef<any>; rows: any[]; onRow?: (r: any) => void }) {
  const sortKey = useSignal('');
  const asc = useSignal(true);
  const t = props.t;
  const rows = useMemo(() => {
    if (!sortKey.value) return props.rows;
    const c = t.cols.find((x) => x.key === sortKey.value)!;
    return [...props.rows].sort((a, b) => {
      const x = c.get(a);
      const y = c.get(b);
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'zh-Hant', { numeric: true });
      return asc.value ? r : -r;
    });
  }, [props.rows, sortKey.value, asc.value]);
  const tot = totals(t, props.rows);
  return (
    <div class="report-scroll">
      <table class="tbl">
        <thead>
          <tr>
            {t.cols.map((c) => (
              <th
                key={c.key}
                class={`sort${c.dp !== undefined ? ' n' : ''}`}
                onClick={() => {
                  if (sortKey.value === c.key) asc.value = !asc.value;
                  else {
                    sortKey.value = c.key;
                    asc.value = true;
                  }
                }}
              >
                {c.title}
                {sortKey.value === c.key ? (asc.value ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} onClick={() => props.onRow?.(r)} style={props.onRow ? { cursor: 'pointer' } : undefined}>
              {t.cols.map((c) => (
                <td key={c.key} class={c.dp !== undefined ? 'n' : ''}>
                  {cellText(c, c.get(r))}
                </td>
              ))}
            </tr>
          ))}
          {Object.keys(tot).length > 0 && rows.length > 0 && (
            <tr class="total">
              {t.cols.map((c, i) => (
                <td key={c.key} class={c.dp !== undefined ? 'n' : ''}>
                  {i === 0 ? '合計' : c.key in tot ? cellText(c, tot[c.key]) : ''}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ReportDialog() {
  const tab = useSignal('marks');
  const levelId = useSignal('');
  const type = useSignal<MemberType | ''>('');
  const rev = store.rev.value;
  const filter: ReportFilter = { levelId: levelId.value || undefined, type: type.value };
  const s = useMemo(() => buildReport(filter), [rev, levelId.value, type.value]);
  const close = () => (ui.dialog.value = '');
  const tables = s.errors.length ? [...ALL_TABLES, errorTable] : ALL_TABLES;
  const t0 = tables.find((x) => x.id === tab.value) ?? tables[0];
  const p = store.project.value;
  const t = withHidden(t0, p.settings.reportHidden);
  const colsOpen = useSignal(false);
  const hidden = new Set(p.settings.reportHidden[t0.id] ?? []);
  const toggleCol = (key: string) => {
    const h = new Set(hidden);
    h.has(key) ? h.delete(key) : h.add(key);
    store.setRootSilent('settings', { ...p.settings, reportHidden: { ...p.settings.reportHidden, [t0.id]: [...h] } });
  };
  const levels = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  const selectRow = (r: any) => {
    if (t.id === 'marks') store.select(s.rows.filter((q) => !q.error && (q.mark || '（未編號）') === r.mark).map((q) => q.id));
    else if (t.id === 'members' || t.id === 'errors') store.select([r.id]);
    else if (t.id === 'profiles') store.select(s.rows.filter((q) => q.profile === r.profile && q.material === r.material).map((q) => q.id));
  };
  return (
    <Modal
      title="報表"
      onClose={close}
      width={1180}
      footer={
        <>
          <div class="grow hint">點表格列可在模型中選取對應構件。編號依「同前綴、類型、斷面、材質、長度」自動更新。</div>
          <button onClick={() => exportCsv(t.id, filter)}>匯出 CSV（此表）</button>
          <button onClick={() => void exportExcel(filter)}>匯出 Excel（全部）</button>
          <button onClick={() => void openPrint(filter)}>列印／存 PDF</button>
          <button class="primary" onClick={close}>
            關閉
          </button>
        </>
      }
    >
      <div class="stat-cards">
        <div class="stat">
          <div class="k">構件總數</div>
          <div class="v">{fmtNum(s.total.qty)} 支</div>
        </div>
        <div class="stat">
          <div class="k">總重量</div>
          <div class="v">{fmtNum(s.total.weight / 1000, 3)} t</div>
        </div>
        <div class="stat">
          <div class="k">塗裝面積</div>
          <div class="v">{fmtNum(s.total.surface, 1)} m²</div>
        </div>
        <div class="stat">
          <div class="k">樓地板面積</div>
          <div class="v">{fmtNum(s.total.floorArea, 1)} m²</div>
        </div>
        <div class="stat">
          <div class="k">單位面積用鋼量</div>
          <div class="v">{s.total.floorArea ? `${fmtNum(s.total.kgPerM2, 1)} kg/m²` : '—'}</div>
        </div>
      </div>
      {s.errors.length > 0 && <div class="warn-box">有 {s.errors.length} 支構件斷面錯誤，未計入數量（見「無法計算的構件」）。</div>}
      <div class="filters">
        <label>樓層</label>
        <select value={levelId.value} onChange={(e) => (levelId.value = (e.target as HTMLSelectElement).value)}>
          <option value="">全部</option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button onClick={() => (colsOpen.value = !colsOpen.value)}>欄位…</button>
        <label>類型</label>
        <select value={type.value} onChange={(e) => (type.value = (e.target as HTMLSelectElement).value as MemberType | '')}>
          <option value="">全部</option>
          {MEMBER_TYPES.map((x) => (
            <option key={x} value={x}>
              {MEMBER_TYPE_LABEL[x]}
            </option>
          ))}
        </select>
      </div>
      {colsOpen.value && (
        <div class="filters" style={{ background: 'var(--panel2)', padding: 8, borderRadius: 6 }}>
          <b>顯示欄位：</b>
          {t0.cols.slice(1).map((c) => (
            <label key={c.key} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleCol(c.key)} />
              {c.title}
            </label>
          ))}
          <span class="hint">（Excel、CSV、列印都套用）</span>
        </div>
      )}
      <div class="tabs">
        {tables.map((x) => (
          <button key={x.id} class={x.id === t.id ? 'on' : ''} onClick={() => (tab.value = x.id)}>
            {x.title}
          </button>
        ))}
      </div>
      <Table t={t} rows={t.rows(s)} onRow={selectRow} />
    </Modal>
  );
}
