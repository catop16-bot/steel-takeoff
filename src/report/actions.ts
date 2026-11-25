import { toast } from '../app/ui';
import { safeFileName, downloadBlob } from '../model/persist';
import { store } from '../model/store';
import type { MemberType } from '../model/types';
import { computeAll, type MemberQty } from '../quantity/compute';
import { computeNumbering } from '../quantity/numbering';
import { summarize, type Summary } from '../quantity/summary';
import { ALL_TABLES, cellText, errorTable, totals, withHidden, type TableDef } from './tables';

export interface ReportFilter {
  levelId?: string;
  type?: MemberType | '';
}

function ctx() {
  const p = store.p;
  return { grids: p.grids, levels: p.levels, customMaterials: p.customMaterials, paintIncludeEnds: p.settings.paintIncludeEnds };
}

/** 依 Tekla 規則編號；persist 時寫回模型（可復原） */
export function runNumbering(persist: boolean, notify = persist): MemberQty[] {
  const p = store.p;
  const rows = computeAll(p.members, ctx());
  const marks = computeNumbering(rows, p.settings.numberTolerance);
  const changed = p.members.filter((m) => (marks.get(m.id) ?? '') !== (m.mark ?? ''));
  if (persist && changed.length) {
    const ids = new Set(changed.map((m) => m.id));
    store.patchMembers(ids, (m) => ({ ...m, mark: marks.get(m.id) }), `編號（${changed.length} 支）`);
  }
  for (const r of rows) r.mark = marks.get(r.id) ?? '';
  if (notify) {
    const n = new Set(marks.values()).size;
    toast(changed.length ? `編號完成：${n} 個編號，更新 ${changed.length} 支構件` : `編號沒有變動（${n} 個編號）`);
  }
  return rows;
}

/** 報表資料：先編號再彙總 */
export function buildReport(filter: ReportFilter = {}): Summary {
  const rows = runNumbering(true, false);
  const p = store.p;
  const f = rows.filter((r) => (!filter.levelId || r.levelId === filter.levelId) && (!filter.type || r.type === filter.type));
  return summarize(f, p.levels, p.grids);
}

function stamp() {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}`;
}

// ---------------- CSV ----------------

function csvEscape(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tableToCsv<T>(t: TableDef<T>, s: Summary): string {
  const rows = t.rows(s);
  const lines = [t.cols.map((c) => csvEscape(c.title)).join(',')];
  for (const r of rows) {
    lines.push(
      t.cols
        .map((c) => {
          const v = c.get(r);
          return csvEscape(typeof v === 'number' && c.dp !== undefined ? v.toFixed(c.dp) : String(v ?? ''));
        })
        .join(','),
    );
  }
  const tot = totals(t, rows);
  if (Object.keys(tot).length) {
    lines.push(t.cols.map((c, i) => (i === 0 ? '合計' : c.key in tot ? tot[c.key].toFixed(c.dp ?? 2) : '')).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function exportCsv(tableId = 'marks', filter: ReportFilter = {}) {
  const s = buildReport(filter);
  const t0 = [...ALL_TABLES, errorTable].find((x) => x.id === tableId) ?? ALL_TABLES[0];
  const t = withHidden(t0, store.p.settings.reportHidden);
  const blob = new Blob([tableToCsv(t, s)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `${safeFileName(store.p.name)}_${t.title}_${stamp()}.csv`);
}

// ---------------- Excel ----------------

export async function exportExcel(filter: ReportFilter = {}) {
  const s = buildReport(filter);
  toast('正在產生 Excel…');
  const { buildWorkbook } = await import('./xlsx');
  const blob = await buildWorkbook(s, store.p);
  downloadBlob(blob, `${safeFileName(store.p.name)}_鋼構數量表_${stamp()}.xlsx`);
  toast('Excel 已下載');
}

// ---------------- 列印 ----------------

export async function openPrint(filter: ReportFilter = {}) {
  const s = buildReport(filter);
  const { buildPrintHtml } = await import('./print');
  const html = buildPrintHtml(s, store.p);
  const w = window.open('', '_blank');
  if (!w) {
    alert('瀏覽器擋住了彈出視窗，請允許後再試');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

export { cellText };
