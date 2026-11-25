import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/catalog/catalog';
import { parseProfile, unitWeight } from '../src/catalog/parse';
import { polygonArea, sectionOutline } from '../src/catalog/shapes';
import type { Profile } from '../src/catalog/types';

function get(s: string): Profile {
  const r = parseProfile(s);
  if (!r.ok) throw new Error(r.error);
  return r.profile;
}

describe('型錄資料檢核', () => {
  it('所有表列單位重與公式計算值相差 < 0.6%（抓尺寸打錯）', () => {
    const bad: string[] = [];
    for (const p of CATALOG) {
      if (p.tableWeight === undefined) continue;
      const w = unitWeight(p, 7850);
      const err = Math.abs(w - p.tableWeight) / p.tableWeight;
      if (err > 0.006) bad.push(`${p.name}: 公式 ${w.toFixed(3)} vs 表列 ${p.tableWeight}`);
    }
    expect(bad).toEqual([]);
  });

  it('型錄名稱不重複', () => {
    const names = CATALOG.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('外形多邊形面積與公式面積接近（3D 外形沒畫錯）', () => {
    const bad: string[] = [];
    for (const p of CATALOG) {
      const o = sectionOutline(p.kind, p.dims);
      const a = polygonArea(o.outer) - o.holes.reduce((s, h) => s + polygonArea(h), 0);
      // 圓角、斜翼板以簡化外形表示，容許 4%；薄壁輕型鋼外形是尖角，容許 6%
      const tol = p.kind === 'LC' || p.kind === 'LCH' || p.kind === 'Z' ? 0.06 : 0.04;
      if (Math.abs(a - p.area) / p.area > tol) bad.push(`${p.name}: 外形 ${a.toFixed(0)} vs ${p.area.toFixed(0)}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('規範單位重', () => {
  const cases: [string, number][] = [
    ['H300x150x6.5x9', 36.7],
    ['H400x200x8x13', 65.4],
    ['H588x300x12x20', 147],
    ['H400x400x13x21', 172],
    ['L100x100x10', 14.9],
    ['[150x75x6.5x10', 18.6],
    ['I300x150x8x13', 48.3],
  ];
  for (const [name, w] of cases) {
    it(name, () => {
      expect(unitWeight(get(name), 7850)).toBeCloseTo(w, 0);
      expect(Math.abs(unitWeight(get(name), 7850) - w) / w).toBeLessThan(0.006);
    });
  }

  it('STK 圓管 φ216.3x8.2 = 0.02466·t·(D−t) = 42.1 kg/m', () => {
    expect(unitWeight(get('φ216.3x8.2'), 7850)).toBeCloseTo(0.02466 * 8.2 * (216.3 - 8.2), 1);
  });

  it('STKR 方管 □150x150x6 = 0.0157·t·(A+B−3.287t) kg/m', () => {
    expect(unitWeight(get('□150x150x6'), 7850)).toBeCloseTo(0.0157 * 6 * (300 - 3.287 * 6), 1);
  });

  it('SSC 帶唇 C 型鋼 C100x50x20x2.3 斷面積 5.172 cm²、4.06 kg/m', () => {
    const p = get('C100x50x20x2.3');
    expect(p.kind).toBe('LC');
    expect(p.area / 100).toBeCloseTo(5.172, 2);
    expect(unitWeight(p, 7850)).toBeCloseTo(4.06, 1);
  });

  it('鋼板 PL12x300 = 28.26 kg/m', () => {
    expect(unitWeight(get('PL12x300'), 7850)).toBeCloseTo(28.26, 2);
  });
});

describe('斷面字串解析', () => {
  it('各種 H 寫法都指到同一個型錄規格', () => {
    for (const s of ['H300x150x6.5x9', 'H-300*150*6.5*9', 'h 300×150×6.5×9', 'Ｈ３００ｘ１５０ｘ６．５ｘ９', 'H300x150', 'HN300x150x6.5x9']) {
      const p = get(s);
      expect(p.name, s).toBe('H300x150x6.5x9');
      expect(p.catalog).toBe(true);
      expect(p.dims.r1).toBe(13);
    }
  });

  it('型錄外的 H 為參數化、BH 無圓角', () => {
    const p = get('H500x250x10x16');
    expect(p.catalog).toBe(false);
    expect(p.area).toBeCloseTo(10 * (500 - 32) + 2 * 250 * 16);
    const bh = get('BH600x300x12x25');
    expect(bh.name).toBe('BH600x300x12x25');
    expect(bh.area).toBe(12 * 550 + 2 * 300 * 25);
  });

  it('H 只給高寬但有多種規格時要求完整尺寸', () => {
    expect(parseProfile('I300x150').ok).toBe(false);
    expect(parseProfile('H400x400').ok).toBe(true);
  });

  it('槽鋼與 C 型鋼區分', () => {
    expect(get('C150x75x6.5x10').kind).toBe('C');
    expect(get('[150x75x6.5x10').name).toBe('[150x75x6.5x10');
    expect(get('C100x50x20x2.3').kind).toBe('LC');
    expect(get('C100x50x2.3').kind).toBe('LCH');
    expect(get('C100x50x5').kind).toBe('C');
  });

  it('角鋼', () => {
    expect(get('L65x65x6').name).toBe('L65x65x6');
    expect(get('∠65x6').name).toBe('L65x65x6');
    expect(get('L75x100x10').name).toBe('L100x75x10');
  });

  it('管與圓鋼', () => {
    expect(get('PIPE216.3x8.2').name).toBe('φ216.3x8.2');
    expect(get('Φ216.3x8.2').kind).toBe('PIPE');
    expect(get('φ25').kind).toBe('RB');
    expect(get('□150x6').name).toBe('□150x150x6');
    expect(get('口200x100x6').name).toBe('□200x100x6');
    expect(get('STKR200x200x9').name).toBe('□200x200x9');
    expect(get('BOX500x500x25').name).toBe('BOX500x500x25x25');
    expect(get('BOX500x500x25').area).toBe(500 * 500 - 450 * 450);
  });

  it('鋼板與扁鋼', () => {
    expect(get('PL300x12').name).toBe('PL12x300');
    expect(get('PL12').thicknessOnly).toBe(true);
    expect(get('FB6x50').name).toBe('FB50x6');
  });

  it('錯誤輸入', () => {
    expect(parseProfile('').ok).toBe(false);
    expect(parseProfile('XYZ123').ok).toBe(false);
    expect(parseProfile('H300x').ok).toBe(false);
    expect(parseProfile('H100x100x6x60').ok).toBe(false);
  });
});
