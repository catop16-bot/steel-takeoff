import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { sampleProject } from '../src/model/sample';
import { store } from '../src/model/store';
import { buildReport, tableToCsv } from '../src/report/actions';
import { markTable, levelTable } from '../src/report/tables';
import { buildWorkbook } from '../src/report/xlsx';

describe('報表匯出', () => {
  store.load(sampleProject());
  const s = buildReport();

  it('範例專案總重與各彙總一致', () => {
    // 柱 24 × 4.2 m × H400x400x13x21
    const col = s.byType.find((r) => r.type === 'column')!;
    expect(col.qty).toBe(24);
    expect(col.totalWeight).toBeCloseTo(24 * 4.2 * ((21869.4 * 7850) / 1e6), -1);
    expect(s.byMark.reduce((a, r) => a + r.totalWeight, 0)).toBeCloseTo(s.total.weight, 6);
    expect(store.p.members.every((m) => m.mark)).toBe(true);
  });

  it('Excel 讀回：工作表、數值與合計公式', async () => {
    const blob = await buildWorkbook(s, store.p);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(['總表', '構件明細（依編號）', '斷面材料彙總', '樓層彙總', '類型彙總', '材質彙總', '全部構件清單']);
    const ws = wb.getWorksheet('構件明細（依編號）')!;
    expect(ws.getRow(4).getCell(1).value).toBe('編號');
    const last = ws.getRow(ws.rowCount);
    expect(last.getCell(1).value).toBe('合計');
    const totalCol = markTable.cols.findIndex((c) => c.key === 'total') + 1;
    const cell = last.getCell(totalCol).value as { formula: string; result: number };
    expect(cell.formula).toMatch(/^SUM\(K5:K\d+\)$/);
    expect(cell.result).toBeCloseTo(s.total.weight, 4);
    const all = wb.getWorksheet('全部構件清單')!;
    expect(all.rowCount).toBe(4 + store.p.members.length + 1);
  });

  it('CSV 有 BOM、表頭與合計列', () => {
    const csv = tableToCsv(markTable, s);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toContain('編號');
    expect(lines[lines.length - 1].startsWith('合計')).toBe(true);
    expect(lines.length).toBe(s.byMark.length + 2);
    const lv = tableToCsv(levelTable, s);
    expect(lv).toContain('用鋼量 kg/m²');
  });
});
