import { describe, expect, it } from 'vitest';
import { expandLabels, formatSpacing, gridLocation, gridToWorld, nextLabel, parseSpacing } from '../src/geom/grid';
import { makeGrid } from '../src/model/defaults';

describe('Tekla 軸線語法', () => {
  it('起點＋間距＋n*d', () => {
    const r = parseSpacing('0 4*6000 7500');
    expect(r.ok && r.values).toEqual([0, 6000, 12000, 18000, 24000, 31500]);
    const r2 = parseSpacing('1000, 2*3000');
    expect(r2.ok && r2.values).toEqual([1000, 4000, 7000]);
  });
  it('錯誤輸入', () => {
    expect(parseSpacing('').ok).toBe(false);
    expect(parseSpacing('0 abc').ok).toBe(false);
    expect(parseSpacing('0 -3000').ok).toBe(false);
  });
  it('轉回語法', () => {
    expect(formatSpacing([0, 6000, 12000, 18000, 24000, 31500])).toBe('0 4*6000 7500');
  });
  it('標籤遞增', () => {
    expect(nextLabel('A')).toBe('B');
    expect(nextLabel('Z')).toBe('AA');
    expect(nextLabel('9')).toBe('10');
    expect(nextLabel('X09')).toBe('X10');
    expect(expandLabels('A B', 4, 'A')).toEqual(['A', 'B', 'C', 'D']);
    expect(expandLabels('', 3, '1')).toEqual(['1', '2', '3']);
  });
  it('旋轉軸線的座標與位置描述', () => {
    const g = makeGrid('0 2*6000', '0 8000', '1', 'A');
    g.rotation = 90;
    const p = gridToWorld(g, 6000, 8000);
    expect(p[0]).toBeCloseTo(-8000);
    expect(p[1]).toBeCloseTo(6000);
    expect(gridLocation([g], p)).toBe('B-2');
    expect(gridLocation([g], [p[0] + 500, p[1], 0])).toBe('≈B-2');
  });
});
