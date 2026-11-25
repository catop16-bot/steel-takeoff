import { describe, expect, it } from 'vitest';
import { defaultToolSettings, makeGrid, newMember } from '../src/model/defaults';
import { findDuplicates, magneticGridUpdate, mirrorFn, rotateFn, splitMember, transformMember, translate } from '../src/model/edit';
import type { V3 } from '../src/geom/vec';

const D = defaultToolSettings();
const beam = (a: V3, b: V3, profile = 'H300x150x6.5x9') => newMember('girder', { ...D.girder, profile }, a, b);

describe('編輯運算', () => {
  it('移動與複製', () => {
    const m = beam([0, 0, 0], [6000, 0, 0]);
    m.mark = 'G1';
    const c = transformMember(m, translate([0, 8000, 0]), { copy: true });
    expect(c.id).not.toBe(m.id);
    expect(c.mark).toBeUndefined();
    expect(c.start).toEqual([0, 8000, 0]);
    const mv = transformMember(m, translate([100, 0, 0]));
    expect(mv.id).toBe(m.id);
  });
  it('鏡射（沿 x=3000 的線）與旋轉 90°', () => {
    const m = beam([0, 0, 0], [2000, 1000, 0]);
    m.pos = { ...m.pos, plane: 'left', planeOffset: 50 };
    const f = mirrorFn([3000, 0, 0], [3000, 1, 0], [0, 0, 1]);
    const r = transformMember(m, f, { mirror: true });
    expect(r.start[0]).toBeCloseTo(6000);
    expect(r.end[0]).toBeCloseTo(4000);
    expect(r.pos.plane).toBe('right');
    expect(r.pos.planeOffset).toBe(-50);
    const rot = transformMember(m, rotateFn([0, 0, 0], [0, 0, 1], 90));
    expect(rot.end[0]).toBeCloseTo(-1000);
    expect(rot.end[1]).toBeCloseTo(2000);
  });
  it('分割', () => {
    const m = beam([0, 0, 0], [6000, 0, 0]);
    m.offStart = { dx: 100, dy: 0, dz: 0 };
    m.offEnd = { dx: 50, dy: 0, dz: 0 };
    const [a, b] = splitMember(m, [2500, 300, 0])!;
    expect(a.end).toEqual([2500, 0, 0]);
    expect(b.start).toEqual([2500, 0, 0]);
    expect(a.offStart.dx).toBe(100);
    expect(a.offEnd.dx).toBe(0);
    expect(b.offEnd.dx).toBe(50);
    expect(splitMember(m, [3, 0, 0])).toBeNull();
  });
  it('重複與重疊', () => {
    const a = beam([0, 0, 0], [6000, 0, 0]);
    const b = beam([6000, 0, 0], [0, 0, 0]);
    const c = beam([3000, 0, 0], [9000, 0, 0]);
    const d = beam([0, 8000, 0], [6000, 8000, 0]);
    const e = beam([6000, 8000, 0], [12000, 8000, 0]);
    const g = findDuplicates([a, b, c, d, e]);
    expect(g.find((x) => x.kind === 'same')!.ids.sort()).toEqual([a.id, b.id].sort());
    expect(g.filter((x) => x.kind === 'overlap').length).toBe(0 + (g.some((x) => x.ids.includes(c.id)) ? 1 : 0));
    // 相接（d、e）不算重疊
    expect(g.some((x) => x.ids.includes(d.id) && x.ids.includes(e.id))).toBe(false);
    const only = findDuplicates([c, d, beam([0, 0, 0], [6000, 0, 0])]);
    expect(only.some((x) => x.kind === 'overlap')).toBe(true);
  });
  it('磁性軸線：改間距後構件端點跟著軸線', () => {
    const old = makeGrid('0 3*6000', '0 2*8000', '1', 'A');
    const next = { ...old, ...makeGrid('0 3*7000', '0 2*8000', '1', 'A'), id: old.id };
    const m = beam([6000, 0, 4200], [12000, 0, 4200]);
    const free = beam([1000, 1000, 0], [2000, 1000, 0]);
    const moved = magneticGridUpdate([m, free], old, next);
    expect(moved.length).toBe(1);
    expect(moved[0].start).toEqual([7000, 0, 4200]);
    expect(moved[0].end).toEqual([14000, 0, 4200]);
  });
});
