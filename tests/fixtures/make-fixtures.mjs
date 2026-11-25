// 產生測試用的結構平面圖（DXF 與 PDF），格線與內建範例專案相同但原點偏移
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OX = 100000;
const OY = 50000;
const xs = [0, 6000, 12000, 18000];
const ys = [0, 8000, 16000];
const XL = ['1', '2', '3', '4'];
const YL = ['A', 'B', 'C'];

const P = [];
const add = (...a) => P.push(...a);
add(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1027', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC');
add(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, 5);
for (const [n, c, lt] of [['AXIS', 1, 'CENTER'], ['COLUMN', 4, 'CONTINUOUS'], ['BEAM', 3, 'CONTINUOUS'], ['TEXT', 7, 'CONTINUOUS'], ['DIM', 2, 'CONTINUOUS']]) add(0, 'LAYER', 2, n, 70, 0, 62, c, 6, lt);
add(0, 'ENDTAB', 0, 'ENDSEC');
add(0, 'SECTION', 2, 'BLOCKS', 0, 'BLOCK', 8, '0', 2, 'AXISBUB', 70, 2, 10, 0, 20, 0, 0, 'CIRCLE', 8, '0', 10, 0, 20, 0, 40, 500, 0, 'ATTDEF', 8, '0', 1, '?', 2, 'LABEL', 10, 0, 20, 0, 40, 450, 0, 'ENDBLK', 0, 'ENDSEC');
add(0, 'SECTION', 2, 'ENTITIES');
const line = (layer, x1, y1, x2, y2) => add(0, 'LINE', 8, layer, 10, x1 + OX, 20, y1 + OY, 11, x2 + OX, 21, y2 + OY);
const text = (layer, s, x, y, h, ha = 0, va = 0, rot = 0) => add(0, 'TEXT', 8, layer, 10, x + OX, 20, y + OY, 11, x + OX, 21, y + OY, 40, h, 1, s, 50, rot, 72, ha, 73, va);
const bubble = (label, x, y) => {
  add(0, 'INSERT', 8, 'AXIS', 66, 1, 2, 'AXISBUB', 10, x + OX, 20, y + OY);
  add(0, 'ATTRIB', 8, 'AXIS', 1, label, 2, 'LABEL', 10, x + OX, 20, y + OY, 11, x + OX, 21, y + OY, 40, 450, 72, 1, 74, 2, 70, 0);
  add(0, 'SEQEND', 8, 'AXIS');
};
for (let i = 0; i < xs.length; i++) {
  line('AXIS', xs[i], -2000, xs[i], 18000);
  bubble(XL[i], xs[i], -2500);
  bubble(XL[i], xs[i], 18500);
}
for (let j = 0; j < ys.length; j++) {
  line('AXIS', -2000, ys[j], 20000, ys[j]);
  bubble(YL[j], -2500, ys[j]);
  bubble(YL[j], 20500, ys[j]);
}
for (const x of xs) for (const y of ys) {
  add(0, 'LWPOLYLINE', 8, 'COLUMN', 90, 4, 70, 1, 10, x - 200 + OX, 20, y - 200 + OY, 10, x + 200 + OX, 20, y - 200 + OY, 10, x + 200 + OX, 20, y + 200 + OY, 10, x - 200 + OX, 20, y + 200 + OY);
  text('TEXT', 'C1', x + 300, y + 300, 250);
}
// 大梁：X 向（雙線）
for (const y of ys) for (let i = 0; i < 3; i++) {
  line('BEAM', xs[i] + 200, y - 150, xs[i + 1] - 200, y - 150);
  line('BEAM', xs[i] + 200, y + 150, xs[i + 1] - 200, y + 150);
  text('TEXT', 'G1', (xs[i] + xs[i + 1]) / 2, y + 400, 250, 1, 0);
}
for (const x of xs) for (let j = 0; j < 2; j++) {
  line('BEAM', x - 150, ys[j] + 200, x - 150, ys[j + 1] - 200);
  line('BEAM', x + 150, ys[j] + 200, x + 150, ys[j + 1] - 200);
  text('TEXT', 'G2', x - 400, (ys[j] + ys[j + 1]) / 2, 250, 1, 0, 90);
}
for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
  const x = (xs[i] + xs[i + 1]) / 2;
  line('BEAM', x - 100, ys[j] + 150, x - 100, ys[j + 1] - 150);
  line('BEAM', x + 100, ys[j] + 150, x + 100, ys[j + 1] - 150);
  text('TEXT', 'B1', x + 300, (ys[j] + ys[j + 1]) / 2, 250);
}
text('TEXT', '二樓結構平面圖  S=1:100', 9000, -4500, 600, 1, 0);
add(0, 'MTEXT', 8, 'TEXT', 10, 22000 + OX, 20, 16000 + OY, 40, 300, 71, 1, 1, '構件表\\PG1  H588x300x12x20\\PG2  H488x300x11x18\\PB1  H400x200x8x13\\PC1  H400x400x13x21');
add(0, 'ENDSEC', 0, 'EOF');
writeFileSync(resolve(here, 'sample-plan.dxf'), P.map(String).join('\r\n') + '\r\n', 'utf8');

// ---- PDF（1:100，A3 橫式 1190×842 pt），只有線與英數文字 ----
const mm2pt = (v) => (v / 100) * (72 / 25.4);
const PX = 120;
const PY = 150;
const ops = [];
const L = (x1, y1, x2, y2) => ops.push(`${(PX + mm2pt(x1)).toFixed(2)} ${(PY + mm2pt(y1)).toFixed(2)} m ${(PX + mm2pt(x2)).toFixed(2)} ${(PY + mm2pt(y2)).toFixed(2)} l S`);
ops.push('1 0 0 RG 0.3 w');
for (const x of xs) L(x, -2000, x, 18000);
for (const y of ys) L(-2000, y, 20000, y);
ops.push('0 0.6 0 RG 0.5 w');
for (const y of ys) for (let i = 0; i < 3; i++) {
  L(xs[i] + 200, y - 150, xs[i + 1] - 200, y - 150);
  L(xs[i] + 200, y + 150, xs[i + 1] - 200, y + 150);
}
ops.push('0 0 1 RG');
for (const x of xs) for (const y of ys) {
  L(x - 200, y - 200, x + 200, y - 200); L(x + 200, y - 200, x + 200, y + 200); L(x + 200, y + 200, x - 200, y + 200); L(x - 200, y + 200, x - 200, y - 200);
}
ops.push('BT /F1 9 Tf');
for (let i = 0; i < 4; i++) ops.push(`1 0 0 1 ${(PX + mm2pt(xs[i]) - 3).toFixed(2)} ${(PY + mm2pt(-2600)).toFixed(2)} Tm (${XL[i]}) Tj`);
for (let j = 0; j < 3; j++) ops.push(`1 0 0 1 ${(PX + mm2pt(-2700)).toFixed(2)} ${(PY + mm2pt(ys[j]) - 3).toFixed(2)} Tm (${YL[j]}) Tj`);
ops.push(`1 0 0 1 ${PX + 100} ${PY - 60} Tm (2F STRUCTURAL PLAN  S=1:100) Tj ET`);
const content = ops.join('\n');
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1190 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
let out = '%PDF-1.4\n';
const offs = [];
objs.forEach((o, i) => {
  offs.push(out.length);
  out += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xref = out.length;
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
for (const o of offs) out += `${String(o).padStart(10, '0')} 00000 n \n`;
out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(resolve(here, 'sample-plan.pdf'), out, 'latin1');
console.log('ok');
