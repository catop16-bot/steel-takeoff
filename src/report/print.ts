import type { Project } from '../model/types';
import type { Summary } from '../quantity/summary';
import { cellText, levelTable, markTable, materialTable, profileTable, totals, typeTable, withHidden, type TableDef } from './tables';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function table<T>(t: TableDef<T>, s: Summary): string {
  const rows = t.rows(s);
  const tot = totals(t, rows);
  const th = t.cols.map((c) => `<th class="${c.dp !== undefined ? 'n' : ''}">${esc(c.title)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${t.cols.map((c) => `<td class="${c.dp !== undefined ? 'n' : ''}">${esc(cellText(c, c.get(r)))}</td>`).join('')}</tr>`)
    .join('');
  const foot = Object.keys(tot).length
    ? `<tr class="total">${t.cols.map((c, i) => `<td class="${c.dp !== undefined ? 'n' : ''}">${i === 0 ? '合計' : c.key in tot ? esc(cellText(c, tot[c.key])) : ''}</td>`).join('')}</tr>`
    : '';
  return `<h2>${esc(t.title)}</h2><table><thead><tr>${th}</tr></thead><tbody>${body}${foot}</tbody></table>`;
}

export function buildPrintHtml(s: Summary, p: Project): string {
  const f = (n: number, d = 0) => n.toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
  const info = [p.info.company && esc(p.info.company), p.info.client && `業主：${esc(p.info.client)}`, p.info.location && `地點：${esc(p.info.location)}`, p.info.designer && `製表：${esc(p.info.designer)}`, `日期：${new Date().toLocaleDateString('zh-TW')}`]
    .filter(Boolean)
    .join('　');
  return `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><title>${esc(p.name)} 鋼構數量表</title>
<style>
@page { size: A4 landscape; margin: 12mm; }
body { font-family: -apple-system, 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif; font-size: 10pt; color: #111; }
h1 { font-size: 16pt; margin: 0 0 4px; }
h2 { font-size: 12pt; margin: 18px 0 6px; break-after: avoid; }
.info { color: #555; margin-bottom: 10px; }
.cards { display: flex; gap: 10px; margin: 8px 0 4px; }
.card { border: 1px solid #ccd; border-radius: 6px; padding: 6px 12px; }
.card b { display: block; font-size: 13pt; }
table { border-collapse: collapse; width: 100%; break-inside: auto; }
th, td { border: 1px solid #aab; padding: 3px 5px; white-space: nowrap; }
th { background: #e4ecf7; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
tr.total td { font-weight: bold; background: #f1f6fd; }
.note { color: #777; font-size: 8.5pt; margin-top: 12px; }
</style></head><body>
<h1>${esc(p.name)}　鋼構數量表</h1>
<div class="info">${info}</div>
<div class="cards">
<div class="card">構件總數<b>${f(s.total.qty)} 支</b></div>
<div class="card">總重量<b>${f(s.total.weight / 1000, 3)} t</b></div>
<div class="card">塗裝面積<b>${f(s.total.surface, 1)} m²</b></div>
<div class="card">樓地板面積<b>${f(s.total.floorArea, 1)} m²</b></div>
<div class="card">單位面積用鋼量<b>${s.total.floorArea ? f(s.total.kgPerM2, 1) + ' kg/m²' : '—'}</b></div>
</div>
${table(withHidden(markTable, p.settings.reportHidden), s)}
${table(withHidden(profileTable, p.settings.reportHidden), s)}
${table(withHidden(levelTable, p.settings.reportHidden), s)}
${table(withHidden(typeTable, p.settings.reportHidden), s)}
${table(withHidden(materialTable, p.settings.reportHidden), s)}
${s.errors.length ? `<p class="note" style="color:#c00">另有 ${s.errors.length} 支構件斷面錯誤，未計入。</p>` : ''}
<p class="note">重量 = 斷面積 × 長度 × 材質密度；斷面積依 JIS G 3192／3444／3466／3350 公式計算。不含接頭、螺栓、銲道。</p>
</body></html>`;
}
