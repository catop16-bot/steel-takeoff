import ExcelJS from 'exceljs';
import type { Project } from '../model/types';
import type { Summary } from '../quantity/summary';
import { ALL_TABLES, errorTable, totals, withHidden, type TableDef } from './tables';

const HEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE8F7' } };
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F6FD' } };
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB8C4D2' } },
  left: { style: 'thin', color: { argb: 'FFB8C4D2' } },
  bottom: { style: 'thin', color: { argb: 'FFB8C4D2' } },
  right: { style: 'thin', color: { argb: 'FFB8C4D2' } },
};

function numFmt(dp: number) {
  return dp === 0 ? '#,##0' : `#,##0.${'0'.repeat(dp)}`;
}

function colLetter(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function addSheet<T>(wb: ExcelJS.Workbook, t: TableDef<T>, s: Summary, p: Project) {
  const ws = wb.addWorksheet(t.title.replace(/[\\/?*[\]:]/g, ''), { views: [{ state: 'frozen', ySplit: 4 }] });
  const n = t.cols.length;
  // 表頭資訊
  ws.mergeCells(1, 1, 1, n);
  const title = ws.getCell(1, 1);
  title.value = `${p.name}　${t.title}`;
  title.font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, n);
  const info = [p.info.company, p.info.client && `業主：${p.info.client}`, p.info.location && `地點：${p.info.location}`, p.info.designer && `製表：${p.info.designer}`, `日期：${new Date().toLocaleDateString('zh-TW')}`]
    .filter(Boolean)
    .join('　');
  ws.getCell(2, 1).value = info;
  ws.getCell(2, 1).font = { color: { argb: 'FF55606C' } };
  // 欄名
  const head = ws.getRow(4);
  t.cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.title;
    cell.font = { bold: true };
    cell.fill = HEAD_FILL;
    cell.border = BORDER;
    cell.alignment = { vertical: 'middle', horizontal: c.dp !== undefined ? 'right' : 'left' };
    ws.getColumn(i + 1).width = c.width ?? 12;
  });
  const rows = t.rows(s);
  rows.forEach((r, ri) => {
    const row = ws.getRow(5 + ri);
    t.cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = c.get(r);
      cell.value = v === '' ? null : v;
      cell.border = BORDER;
      if (typeof v === 'number' && c.dp !== undefined) {
        cell.numFmt = numFmt(c.dp);
        cell.alignment = { horizontal: 'right' };
      }
    });
  });
  const tot = totals(t, rows);
  if (Object.keys(tot).length && rows.length) {
    const tr = ws.getRow(5 + rows.length);
    const first = 5;
    const last = 4 + rows.length;
    t.cols.forEach((c, i) => {
      const cell = tr.getCell(i + 1);
      cell.fill = TOTAL_FILL;
      cell.border = BORDER;
      cell.font = { bold: true };
      if (i === 0) cell.value = '合計';
      else if (c.sum) {
        const L = colLetter(i);
        cell.value = { formula: `SUM(${L}${first}:${L}${last})`, result: tot[c.key] };
        cell.numFmt = numFmt(c.dp ?? 2);
      } else if (c.key in tot) {
        cell.value = tot[c.key];
        cell.numFmt = numFmt(c.dp ?? 2);
      }
    });
  }
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:4' };
}

export async function buildWorkbook(s: Summary, p: Project): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '鋼構算量';
  wb.created = new Date();
  // 總表
  const sum = wb.addWorksheet('總表');
  sum.getColumn(1).width = 22;
  sum.getColumn(2).width = 20;
  sum.getCell('A1').value = p.info.company ? `${p.info.company}　${p.name}` : p.name;
  sum.getCell('A1').font = { bold: true, size: 16 };
  const lines: [string, string | number, string?][] = [
    ['業主', p.info.client],
    ['工程地點', p.info.location],
    ['製表人', p.info.designer],
    ['製表日期', new Date().toLocaleDateString('zh-TW')],
    ['', ''],
    ['構件總數（支）', s.total.qty, '#,##0'],
    ['總重量（kg）', s.total.weight, '#,##0.00'],
    ['總重量（t）', s.total.weight / 1000, '#,##0.000'],
    ['塗裝面積（m²）', s.total.surface, '#,##0.00'],
    ['樓地板面積（m²）', s.total.floorArea, '#,##0.0'],
    ['單位面積用鋼量（kg/m²）', s.total.kgPerM2, '#,##0.0'],
    ['無法計算的構件（支）', s.errors.length, '#,##0'],
  ];
  lines.forEach(([k, v, fmtS], i) => {
    const r = sum.getRow(3 + i);
    r.getCell(1).value = k;
    r.getCell(1).font = { color: { argb: 'FF55606C' } };
    r.getCell(2).value = v;
    if (fmtS) r.getCell(2).numFmt = fmtS;
  });
  sum.getCell(`A${3 + lines.length + 1}`).value = '重量 = 斷面積 × 長度 × 材質密度；斷面積依 JIS G 3192／3444／3466／3350 公式計算。';
  sum.getCell(`A${3 + lines.length + 1}`).font = { italic: true, color: { argb: 'FF8A949F' } };
  for (const t of ALL_TABLES) addSheet(wb, withHidden(t, p.settings.reportHidden), s, p);
  if (s.errors.length) addSheet(wb, errorTable, s, p);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
