import { describe, expect, it } from 'vitest';
import { parseDxf } from '../src/drawing/dxf';
import { flatten } from '../src/drawing/flatten';
import { decodeDxf, decodeEscapes, stripMText } from '../src/drawing/text';
import type { Drawing2D } from '../src/drawing/types';

/** 用群組碼陣列組 DXF；字串中的 {BIG5:xxxx} 換成原始位元組 */
function dxfBytes(pairs: (string | number)[]): Uint8Array {
  const text = pairs.map((v) => String(v)).join('\r\n') + '\r\n';
  const out: number[] = [];
  const re = /\{BIG5:([0-9A-F]+)\}/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    for (const ch of text.slice(last, m.index)) out.push(ch.charCodeAt(0) & 0xff);
    for (let i = 0; i < m[1].length; i += 2) out.push(parseInt(m[1].slice(i, i + 2), 16));
    last = m.index! + m[0].length;
  }
  for (const ch of text.slice(last)) out.push(ch.charCodeAt(0) & 0xff);
  return new Uint8Array(out);
}

const SAMPLE = [
  0, 'SECTION', 2, 'HEADER',
  9, '$ACADVER', 1, 'AC1015',
  9, '$DWGCODEPAGE', 3, 'ANSI_950',
  9, '$INSUNITS', 70, 4,
  0, 'ENDSEC',
  0, 'SECTION', 2, 'TABLES',
  0, 'TABLE', 2, 'LAYER', 70, 3,
  0, 'LAYER', 2, 'AXIS', 70, 0, 62, 1, 6, 'CENTER',
  0, 'LAYER', 2, 'BEAM', 70, 0, 62, 7, 6, 'CONTINUOUS',
  0, 'LAYER', 2, 'TEXT', 70, 0, 62, 2, 6, 'CONTINUOUS',
  0, 'LAYER', 2, 'HIDE', 70, 1, 62, 3, 6, 'CONTINUOUS',
  0, 'ENDTAB',
  0, 'ENDSEC',
  0, 'SECTION', 2, 'BLOCKS',
  0, 'BLOCK', 8, '0', 2, 'BUBBLE', 70, 0, 10, 0, 20, 0,
  0, 'CIRCLE', 8, '0', 10, 0, 20, 0, 40, 500,
  0, 'ATTDEF', 8, '0', 1, '?', 2, 'NO', 10, 0, 20, 0, 40, 400,
  0, 'ENDBLK', 8, '0',
  0, 'ENDSEC',
  0, 'SECTION', 2, 'ENTITIES',
  0, 'LINE', 8, 'AXIS', 10, 0, 20, 0, 11, 10000, 21, 0,
  0, 'LINE', 8, 'AXIS', 67, 1, 10, 0, 20, 0, 11, 99999, 21, 0,
  0, 'LWPOLYLINE', 8, 'BEAM', 90, 2, 70, 0, 10, 0, 20, 0, 42, 1, 10, 2000, 20, 0,
  0, 'INSERT', 8, 'AXIS', 66, 1, 2, 'BUBBLE', 10, -1000, 20, 0, 41, 1, 42, 1, 50, 0,
  0, 'ATTRIB', 8, 'AXIS', 1, 'A', 2, 'NO', 10, -1100, 20, -200, 11, -1000, 21, 0, 40, 400, 70, 0, 72, 1, 74, 2,
  0, 'SEQEND', 8, 'AXIS',
  0, 'TEXT', 8, 'TEXT', 10, 100, 20, 200, 40, 300, 1, '{BIG5:A4A4A4E5}',
  0, 'TEXT', 8, 'TEXT', 10, 0, 20, 900, 40, 300, 1, '\\U+4E2D\\M+2A4E5%%c25',
  0, 'MTEXT', 8, 'TEXT', 10, 5000, 20, 8000, 40, 250, 71, 1, 1, '{\\fArial|b1;G1}\\PH588x300',
  0, 'ARC', 8, 'BEAM', 10, 5000, 20, 5000, 40, 1000, 50, 0, 51, 90,
  0, 'CIRCLE', 8, 'NEWLAYER', 10, 3000, 20, 3000, 40, 200,
  0, 'HATCH', 8, 'BEAM',
  0, 'ENDSEC',
  0, 'EOF',
];

function load(): Drawing2D {
  const { text, encoding } = decodeDxf(dxfBytes(SAMPLE));
  const { doc, skipped } = parseDxf(text, encoding);
  return flatten(doc, 'dxf', skipped);
}

function worldTexts(d: Drawing2D) {
  return d.texts.map((t) => ({ ...t, x: t.x + d.base[0], y: t.y + d.base[1], layerName: d.layers[t.layer].name }));
}

function worldSegs(d: Drawing2D, layer: string): [number, number][] {
  const i = d.layers.findIndex((l) => l.name === layer);
  const out: [number, number][] = [];
  const s = d.segs[i];
  for (let k = 0; k < s.length; k += 2) out.push([s[k] + d.base[0], s[k + 1] + d.base[1]]);
  return out;
}

describe('DXF 文字編碼', () => {
  it('依 $DWGCODEPAGE 用 Big5 解碼', () => {
    const r = decodeDxf(dxfBytes(SAMPLE));
    expect(r.encoding).toBe('big5');
    expect(r.text).toContain('中文');
  });
  it('控制碼', () => {
    expect(decodeEscapes('\\U+4E2D\\M+2A4E5')).toBe('中文');
    expect(decodeEscapes('%%c25 %%d %%p5')).toBe('⌀25 ° ±5');
    expect(stripMText('{\\fArial|b1|i0;G1}\\PH588x300\\S1^2;')).toBe('G1\nH588x300' + '1/2');
    expect(stripMText('\\H2.5x;\\C1;B1\\~(2)')).toBe('B1 (2)');
  });
});

describe('DXF 解析與展開', () => {
  const d = load();

  it('單位與圖層', () => {
    expect(d.unitScale).toBe(1);
    expect(d.unitsKnown).toBe(true);
    const names = d.layers.map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(['AXIS', 'BEAM', 'TEXT', 'HIDE', 'NEWLAYER']));
    expect(d.layers.find((l) => l.name === 'AXIS')!.color).toBe('#ff0000');
    expect(d.layers.find((l) => l.name === 'BEAM')!.color).toBe('#2b2f33');
    expect(d.layers.find((l) => l.name === 'HIDE')!.off).toBe(true);
    expect(d.layers.find((l) => l.name === 'AXIS')!.linetype).toBe('CENTER');
  });

  it('圖紙空間的線不展開、HATCH 列入略過', () => {
    const axis = worldSegs(d, 'AXIS');
    expect(axis.every(([x]) => x < 20000)).toBe(true);
    expect(d.stats.skipped.HATCH).toBe(1);
  });

  it('凸度 1 的多段線是半圓，最低點在 (1000, −1000)', () => {
    const pts = worldSegs(d, 'BEAM');
    const low = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(low[0]).toBeCloseTo(1000, 0);
    expect(low[1]).toBeCloseTo(-1000, 0);
  });

  it('圖塊：0 層的圓沿用插入點圖層、屬性文字', () => {
    const c = d.circles;
    const circles: { x: number; y: number; r: number; layer: string }[] = [];
    for (let i = 0; i < c.length; i += 4) circles.push({ x: c[i] + d.base[0], y: c[i + 1] + d.base[1], r: c[i + 2], layer: d.layers[c[i + 3]].name });
    expect(circles).toContainEqual({ x: -1000, y: 0, r: 500, layer: 'AXIS' });
    const a = worldTexts(d).find((t) => t.s === 'A')!;
    expect(a.layerName).toBe('AXIS');
    expect(a.x).toBeCloseTo(-1000);
    expect(a.ha).toBe(1);
    expect(a.va).toBe(2);
  });

  it('文字：Big5、控制碼、MTEXT 分行', () => {
    const ts = worldTexts(d);
    const zh = ts.find((t) => t.s === '中文')!;
    expect(zh.x).toBeCloseTo(100);
    expect(zh.y).toBeCloseTo(200);
    expect(zh.h).toBeCloseTo(300);
    expect(ts.map((t) => t.s)).toEqual(expect.arrayContaining(['中文⌀25', 'G1', 'H588x300']));
    const g1 = ts.find((t) => t.s === 'G1')!;
    const h = ts.find((t) => t.s === 'H588x300')!;
    expect(g1.va).toBe(3);
    expect(g1.y - h.y).toBeCloseTo((250 * 5) / 3);
  });

  it('弧：四分之一圓端點', () => {
    const pts = worldSegs(d, 'BEAM');
    expect(pts.some(([x, y]) => Math.abs(x - 6000) < 0.5 && Math.abs(y - 5000) < 0.5)).toBe(true);
    expect(pts.some(([x, y]) => Math.abs(x - 5000) < 0.5 && Math.abs(y - 6000) < 0.5)).toBe(true);
  });

  it('座標以 base 平移後存成 Float32', () => {
    expect(d.segs.every((s) => s instanceof Float32Array)).toBe(true);
    expect(Math.abs(d.bounds[0])).toBeLessThan(20000);
  });
});

describe('大座標精度', () => {
  it('TWD97 量級座標（mm）不失真', () => {
    const big = [
      0, 'SECTION', 2, 'ENTITIES',
      0, 'LINE', 8, '0', 10, 250000000.5, 20, 2700000000.25, 11, 250006000.5, 21, 2700000000.25,
      0, 'ENDSEC', 0, 'EOF',
    ];
    const { text, encoding } = decodeDxf(dxfBytes(big));
    const { doc, skipped } = parseDxf(text, encoding);
    const d = flatten(doc, 'dxf', skipped);
    const s = d.segs[0];
    expect(s[2] - s[0]).toBeCloseTo(6000, 1);
    expect(s[0] + d.base[0]).toBeCloseTo(250000000.5, 0);
  });
});
