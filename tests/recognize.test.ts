import { describe, expect, it } from 'vitest';
import type { Drawing2D } from '../src/drawing/types';
import { detectGrid } from '../src/recognize/grids';
import { loadFixture } from './helpers';


describe('軸線辨識', () => {
  const d = loadFixture('sample-plan.dxf');
  it('間距、標籤與原點', () => {
    const g = detectGrid(d, 1)!;
    expect(g).not.toBeNull();
    expect(g.xText).toBe('0 3*6000');
    expect(g.yText).toBe('0 2*8000');
    expect(g.xLabels).toBe('1 2 3 4');
    expect(g.yLabels).toBe('A B C');
    expect(g.xs.every((x) => x.found)).toBe(true);
    expect(g.origin[0]).toBeCloseTo(100000, 0);
    expect(g.origin[1]).toBeCloseTo(50000, 0);
    expect(g.angle).toBeCloseTo(0, 3);
    expect(g.layers).toEqual(['AXIS']);
  });

  it('旋轉 30° 的圖也辨識得出', () => {
    const a = (30 * Math.PI) / 180;
    const rot = (x: number, y: number): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    const r: Drawing2D = {
      ...d,
      base: [0, 0],
      segs: d.segs.map((s) => {
        const o = new Float32Array(s.length);
        for (let i = 0; i < s.length; i += 2) {
          const [x, y] = rot(s[i] + d.base[0], s[i + 1] + d.base[1]);
          o[i] = x;
          o[i + 1] = y;
        }
        return o;
      }),
      circles: (() => {
        const o = new Float32Array(d.circles.length);
        for (let i = 0; i < d.circles.length; i += 4) {
          const [x, y] = rot(d.circles[i] + d.base[0], d.circles[i + 1] + d.base[1]);
          o.set([x, y, d.circles[i + 2], d.circles[i + 3]], i);
        }
        return o;
      })(),
      texts: d.texts.map((t) => {
        const [x, y] = rot(t.x + d.base[0], t.y + d.base[1]);
        return { ...t, x, y, rot: t.rot + 30 };
      }),
    };
    const g = detectGrid(r, 1)!;
    expect(g.angle).toBeCloseTo(30, 1);
    expect(g.xText).toBe('0 3*6000');
    expect(g.yLabels).toBe('A B C');
  });
});

import { detectLevels, parseElevation } from '../src/recognize/levels';
import { extractSchedule, markType } from '../src/recognize/schedule';

describe('高程辨識', () => {
  it('數值單位', () => {
    expect(parseElevation('+', '4.200')).toBe(4200);
    expect(parseElevation('-', '3.5')).toBe(-3500);
    expect(parseElevation('±', '0.000')).toBe(0);
    expect(parseElevation('', '4200')).toBe(4200);
    expect(parseElevation('+', '12')).toBe(12000);
  });
  it('同一段文字與分開的名稱／高程', () => {
    const t = (s: string, x: number, y: number, h = 300) => ({ s, x, y, h });
    const r = detectLevels([
      t('RFL', 0, 8400),
      t('+8.400', 1500, 8400),
      t('2FL', 0, 4200),
      t('+4.200', 1500, 4250),
      t('1FL', 0, 0),
      t('±0.000', 1600, 0),
      t('B1F -3.500', 0, -3500),
      t('二樓結構平面圖 (2FL ▽+4.20)', 0, -9000),
      t('6000', 3000, 4200),
      t('G1', 5000, 4200),
    ]);
    expect(r.map((l) => [l.name, l.elevation])).toEqual([
      ['B1F', -3500],
      ['1FL', 0],
      ['2FL', 4200],
      ['RFL', 8400],
    ]);
  });
});

describe('斷面表', () => {
  it('MTEXT 構件表（同一段文字）', () => {
    const d = loadFixture('sample-plan.dxf');
    const r = extractSchedule(d.texts);
    const m = Object.fromEntries(r.entries.map((e) => [e.mark, e.profile]));
    expect(m).toMatchObject({ G1: 'H588x300x12x20', G2: 'H488x300x11x18', B1: 'H400x200x8x13', C1: 'H400x400x13x21' });
  });
  it('左右排列與上下對齊的表格', () => {
    const t = (s: string, x: number, y: number) => ({ s, x, y, h: 250 });
    const r = extractSchedule([
      t('G1', 0, 0),
      t('H 588x300x12x20', 2000, 0),
      t('B1', 0, -600),
      t('H400 x 200 x 8 x 13', 2000, -600),
      // 上下對齊：表頭一列編號、下一列斷面
      t('SB1', 6000, 0),
      t('C2', 8000, 0),
      t('H300x150x6.5x9', 6100, -500),
      t('□400x400x16', 8050, -500),
    ]);
    const m = Object.fromEntries(r.entries.map((e) => [e.mark, e.profile]));
    expect(m).toEqual({ G1: 'H588x300x12x20', B1: 'H400x200x8x13', SB1: 'H300x150x6.5x9', C2: '□400x400x16' });
    expect(r.entries.find((e) => e.mark === 'C2')!.type).toBe('column');
  });
  it('編號字首判斷類型', () => {
    expect(markType('G1')).toBe('girder');
    expect(markType('2FG3')).toBe('girder');
    expect(markType('SB2')).toBe('beam');
    expect(markType('C1')).toBe('column');
    expect(markType('BR1')).toBe('brace');
  });
});

import { detectBeams, detectColumns, type GridRef, type PlaneText } from '../src/recognize/members';
import { segmentsOf } from '../src/recognize/lines';

describe('梁柱候選', () => {
  const d = loadFixture('sample-plan.dxf');
  const toMm = (x: number, y: number): [number, number] => [x + d.base[0], y + d.base[1]];
  const layer = (n: string) => d.layers.findIndex((l) => l.name === n);
  const OX = 100000;
  const OY = 50000;
  const xs = [0, 6000, 12000, 18000].map((x) => x + OX);
  const ys = [0, 8000, 16000].map((y) => y + OY);
  const grid: GridRef = {
    lines: [...xs.map((x) => ({ angle: Math.PI / 2, c: -x })), ...ys.map((y) => ({ angle: 0, c: y }))],
    nodes: xs.flatMap((x) => ys.map((y) => [x, y] as [number, number])),
  };
  const texts: PlaneText[] = d.texts.map((t) => {
    const [x, y] = toMm(t.x, t.y);
    return { s: t.s, x, y, h: t.h };
  });
  const schedule = new Map([
    ['G1', 'H588x300x12x20'],
    ['G2', 'H488x300x11x18'],
    ['B1', 'H400x200x8x13'],
    ['C1', 'H400x400x13x21'],
  ]);

  it('雙線梁：23 支，端點延伸到軸線／大梁中心線，編號與斷面正確', () => {
    const segs = segmentsOf(d, toMm, (li) => li === layer('BEAM'));
    const { list, mode } = detectBeams(segs, texts, grid, schedule);
    expect(mode).toBe('double');
    expect(list.length).toBe(23);
    const by = (m: string) => list.filter((c) => c.mark === m);
    expect(by('G1').length).toBe(9);
    expect(by('G2').length).toBe(8);
    expect(by('B1').length).toBe(6);
    for (const c of list) {
      expect(c.status).toBe('ok');
      const len = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
      expect([6000, 8000]).toContain(Math.round(len));
    }
    expect(by('G1').every((c) => c.type === 'girder' && c.profile === 'H588x300x12x20')).toBe(true);
    expect(by('B1').every((c) => c.type === 'beam')).toBe(true);
    // 小梁端點落在大梁中心線上
    const b1 = by('B1')[0];
    expect(ys).toContain(Math.round(Math.min(b1.a[1], b1.b[1])));
    expect(Math.round(b1.a[0] - OX) % 6000).toBe(3000);
  });

  it('柱：12 個軸線交點、編號 C1', () => {
    const segs = segmentsOf(d, toMm, (li) => li === layer('COLUMN'));
    const cols = detectColumns(segs, texts, grid, schedule);
    expect(cols.length).toBe(12);
    expect(cols.every((c) => c.mark === 'C1' && c.profile === 'H400x400x13x21')).toBe(true);
  });
});
