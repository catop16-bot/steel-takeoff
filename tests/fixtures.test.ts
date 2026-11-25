import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDxf } from '../src/drawing/dxf';
import { flatten } from '../src/drawing/flatten';
import { decodeDxf } from '../src/drawing/text';

describe('範例結構平面圖 DXF', () => {
  const bytes = new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample-plan.dxf')));
  const { text, encoding } = decodeDxf(bytes);
  const { doc, skipped } = parseDxf(text, encoding);
  const d = flatten(doc, 'dxf', skipped);

  it('R2013 為 UTF-8，中文標題正確', () => {
    expect(encoding).toBe('utf-8');
    expect(d.texts.some((t) => t.s.includes('二樓結構平面圖'))).toBe(true);
  });

  it('軸線泡泡：14 個圓、標籤文字在 AXIS 層', () => {
    const axis = d.layers.findIndex((l) => l.name === 'AXIS');
    let n = 0;
    for (let i = 0; i < d.circles.length; i += 4) if (d.circles[i + 3] === axis) n++;
    expect(n).toBe(14);
    const labels = d.texts.filter((t) => t.layer === axis).map((t) => t.s).sort();
    expect(labels).toEqual(['1', '1', '2', '2', '3', '3', '4', '4', 'A', 'A', 'B', 'B', 'C', 'C']);
  });

  it('構件表 MTEXT 分行', () => {
    const lines = d.texts.map((t) => t.s);
    expect(lines).toEqual(expect.arrayContaining(['構件表', 'G1  H588x300x12x20', 'C1  H400x400x13x21']));
  });

  it('原座標偏移保留在 base', () => {
    const x0 = d.bounds[0] + d.base[0];
    expect(x0).toBeGreaterThan(90000);
  });
});
