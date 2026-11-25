import { describe, expect, it } from 'vitest';
import { localToPlane, planeToLocal, solveAlignment } from '../src/drawing/placement';

describe('圖紙對位', () => {
  const ref = { scale: 1, rotation: 0, offset: [0, 0] as [number, number] };
  it('兩點對位（含比例）', () => {
    // PDF：圖上 (100,100)→(0,0)、(300,100)→(6000,0)，比例 30、無旋轉
    const r = solveAlignment(ref, [
      { z: [100, 100], w: [0, 0] },
      { z: [300, 100], w: [6000, 0] },
    ], false);
    expect(r.scale).toBeCloseTo(30);
    expect(r.rotation).toBeCloseTo(0);
    const p = localToPlane(r, [0, 0], 300, 400);
    expect(p[0]).toBeCloseTo(6000);
    expect(p[1]).toBeCloseTo(9000);
  });
  it('兩點對位（固定比例，只旋轉平移）', () => {
    const r = solveAlignment({ ...ref, scale: 1 }, [
      { z: [0, 0], w: [1000, 1000] },
      { z: [0, 6000], w: [-5000, 1000] },
    ], true);
    expect(r.scale).toBe(1);
    expect(r.rotation).toBeCloseTo(90);
    const p = localToPlane(r, [0, 0], 0, 6000);
    expect(p[0]).toBeCloseTo(-5000);
    expect(p[1]).toBeCloseTo(1000);
  });
  it('一點對位只平移；局部↔平面互逆', () => {
    const r = solveAlignment({ scale: 2, rotation: 30, offset: [5, 5] }, [{ z: [10, 20], w: [100, 200] }], true);
    const base: [number, number] = [7, -3];
    const p = localToPlane(r, [0, 0], 10, 20);
    expect(p[0]).toBeCloseTo(100);
    expect(p[1]).toBeCloseTo(200);
    const q = planeToLocal(r, base, ...localToPlane(r, base, 3, 4));
    expect(q[0]).toBeCloseTo(3);
    expect(q[1]).toBeCloseTo(4);
  });
});

import { SnapIndex, segIntersect } from '../src/drawing/snapIndex';
import type { Drawing2D } from '../src/drawing/types';

describe('圖紙鎖點索引', () => {
  const d = {
    bounds: [-500, -500, 500, 500],
    layers: [{ name: 'A', color: '#000', linetype: '', off: false }, { name: 'B', color: '#000', linetype: '', off: false }],
    segs: [new Float32Array([-400, 0, 400, 0, 0, -400, 0, 400]), new Float32Array([100, 100, 200, 100])],
    circles: new Float32Array([300, 300, 20, 0]),
  } as unknown as Drawing2D;
  it('查得到端點、中點、圓心、線段；隱藏圖層排除', () => {
    const idx = new SnapIndex(d, new Set([1]));
    const q = idx.query(-400, 0, 5);
    expect(q.points.some((p) => p.kind === 'end' && p.x === -400)).toBe(true);
    expect(idx.query(150, 100, 5).points.length).toBe(0);
    expect(idx.query(300, 300, 5).points[0].kind).toBe('cen');
    const near = idx.query(0, 0, 5);
    expect(near.segs.length).toBe(2);
    expect(segIntersect(near.segs[0], near.segs[1])).toEqual([0, 0]);
  });
  it('查詢半徑很大（縮小檢視）時仍查得到', () => {
    const idx = new SnapIndex(d, new Set());
    const q = idx.query(-390, 10, 300);
    expect(q.points.length).toBeGreaterThan(0);
    expect(q.segs.length).toBeGreaterThan(0);
  });
});
