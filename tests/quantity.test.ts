import { describe, expect, it } from 'vitest';
import { computeAll, computeMember, type QtyContext } from '../src/quantity/compute';
import { computeNumbering } from '../src/quantity/numbering';
import { summarize } from '../src/quantity/summary';
import { makeGrid, makeLevel, newMember, defaultToolSettings } from '../src/model/defaults';
import type { Member } from '../src/model/types';
import type { V3 } from '../src/geom/vec';

const grid = makeGrid('0 3*6000', '0 2*8000', '1', 'A');
const levels = [makeLevel('1FL', 0), makeLevel('2FL', 4200), makeLevel('RFL', 8400)];
const ctx: QtyContext = { grids: [grid], levels, customMaterials: [], paintIncludeEnds: false };
const D = defaultToolSettings();

function beam(a: V3, b: V3, profile = 'H300x150x6.5x9', extra: Partial<Member> = {}): Member {
  return newMember('girder', { ...D.girder, profile, material: 'SS400' }, a, b, extra);
}

describe('單支構件算量', () => {
  it('H300x150x6.5x9 長 6 m：單位重 36.7、單重 220 kg', () => {
    const q = computeMember(beam([0, 0, 4200], [6000, 0, 4200]), ctx);
    expect(q.error).toBeUndefined();
    expect(q.length).toBe(6000);
    expect(q.unitWeight).toBeCloseTo(36.72, 1);
    expect(q.weight).toBeCloseTo(220.3, 0);
    expect(q.density).toBe(7850);
    expect(q.levelName).toBe('2FL');
    expect(q.location).toBe('A-1 → A-2');
    // 塗裝面積 = 周長 × 長
    expect(q.surface).toBeCloseTo(((2 * 300 + 4 * 150 - 2 * 6.5 - 4 * (2 - Math.PI / 2) * 13) * 6000) / 1e6, 6);
  });

  it('端部偏移影響長度（起點正值縮短、終點正值加長）', () => {
    const m = beam([0, 0, 0], [6000, 0, 0], 'H300x150x6.5x9', { offStart: { dx: 150, dy: 0, dz: 0 }, offEnd: { dx: -150, dy: 0, dz: 0 } });
    expect(computeMember(m, ctx).length).toBeCloseTo(5700);
    const m2 = beam([0, 0, 0], [6000, 0, 0], 'H300x150x6.5x9', { offEnd: { dx: 200, dy: 0, dz: 0 } });
    expect(computeMember(m2, ctx).length).toBeCloseTo(6200);
  });

  it('不鏽鋼密度 7930', () => {
    const m = beam([0, 0, 0], [1000, 0, 0], 'PL10x100', { material: 'SUS304' });
    const q = computeMember(m, ctx);
    expect(q.density).toBe(7930);
    expect(q.weight).toBeCloseTo((10 * 100 * 1000 * 7930) / 1e9, 6);
  });

  it('柱歸到底部所在樓層', () => {
    const c = newMember('column', D.column, [0, 0, 0], [0, 0, 4200]);
    expect(computeMember(c, ctx).levelName).toBe('1FL');
  });

  it('多邊形鋼板：面積 × 厚度 × 密度', () => {
    const p = newMember('plate', { ...D.plate, profile: 'PL12', material: 'SS400' }, [0, 0, 0], [0, 0, 0], {
      points: [
        [0, 0, 0],
        [600, 0, 0],
        [600, 400, 0],
        [0, 400, 0],
      ],
    });
    const q = computeMember(p, ctx);
    expect(q.error).toBeUndefined();
    expect(q.weight).toBeCloseTo((600 * 400 * 12 * 7850) / 1e9, 6);
    expect(q.size).toBe('600x400');
    expect(q.surface).toBeCloseTo((2 * 600 * 400 + 2000 * 12) / 1e6, 6);
  });

  it('斷面錯誤時回報錯誤而不計重', () => {
    const q = computeMember(beam([0, 0, 0], [1000, 0, 0], 'XYZ'), ctx);
    expect(q.error).toBeTruthy();
    expect(q.weight).toBe(0);
  });
});

describe('編號', () => {
  it('同斷面同材質同長度同號、長度差 2 mm 異號', () => {
    const ms = [
      beam([0, 0, 0], [6000, 0, 0]),
      beam([0, 8000, 0], [6000, 8000, 0]),
      beam([0, 16000, 0], [6000.5, 16000, 0]),
      beam([0, 0, 4200], [6002, 0, 4200]),
      beam([0, 0, 4200], [6000, 0, 4200], 'H400x200x8x13'),
    ];
    const marks = computeNumbering(computeAll(ms, ctx), 1);
    expect(marks.get(ms[0].id)).toBe(marks.get(ms[1].id));
    expect(marks.get(ms[0].id)).toBe(marks.get(ms[2].id));
    expect(marks.get(ms[3].id)).not.toBe(marks.get(ms[0].id));
    expect(marks.get(ms[4].id)).not.toBe(marks.get(ms[0].id));
    expect(new Set(marks.values()).size).toBe(3);
    for (const v of marks.values()) expect(v).toMatch(/^G\d+$/);
  });

  it('改一支長度後只有該支換號，其餘保留', () => {
    const ms = [beam([0, 0, 0], [6000, 0, 0]), beam([0, 8000, 0], [6000, 8000, 0]), beam([0, 16000, 0], [6000, 16000, 0])];
    const first = computeNumbering(computeAll(ms, ctx), 1);
    for (const m of ms) m.mark = first.get(m.id);
    const old = ms[0].mark;
    ms[2] = { ...ms[2], end: [5000, 16000, 0] };
    const second = computeNumbering(computeAll(ms, ctx), 1);
    expect(second.get(ms[0].id)).toBe(old);
    expect(second.get(ms[1].id)).toBe(old);
    expect(second.get(ms[2].id)).not.toBe(old);
  });
});

describe('彙總', () => {
  it('依編號、斷面、樓層、類型彙總且總重一致', () => {
    const ms = [
      beam([0, 0, 4200], [6000, 0, 4200]),
      beam([6000, 0, 4200], [12000, 0, 4200]),
      newMember('column', { ...D.column, material: 'SN490B' }, [0, 0, 0], [0, 0, 4200]),
    ];
    const rows = computeAll(ms, ctx);
    const marks = computeNumbering(rows, 1);
    for (const r of rows) r.mark = marks.get(r.id) ?? '';
    const s = summarize(rows, levels, [grid]);
    const total = rows.reduce((a, r) => a + r.weight, 0);
    expect(s.total.weight).toBeCloseTo(total, 6);
    expect(s.byMark.reduce((a, r) => a + r.totalWeight, 0)).toBeCloseTo(total, 6);
    expect(s.byProfile.reduce((a, r) => a + r.totalWeight, 0)).toBeCloseTo(total, 6);
    expect(s.byLevel.reduce((a, r) => a + r.totalWeight, 0)).toBeCloseTo(total, 6);
    expect(s.byMark.find((r) => r.profile === 'H300x150x6.5x9')?.qty).toBe(2);
    // 樓地板面積：18 m × 16 m = 288 m²，1FL、2FL 計入，RFL 視為屋頂
    const l2 = s.byLevel.find((l) => l.level === '2FL')!;
    expect(l2.floorArea).toBeCloseTo(288);
    expect(s.byLevel.find((l) => l.level === 'RFL')!.floorArea).toBe(0);
    expect(s.total.floorArea).toBeCloseTo(576);
  });
});
