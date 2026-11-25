import { gridToWorld } from '../geom/grid';
import type { V3 } from '../geom/vec';
import { makeGrid, makeLevel, newMember, newProject } from './defaults';
import { syncViews } from './ops';
import type { Member, Project } from './types';

/** 範例：兩層鋼構廠辦（3 跨 × 2 跨），含柱、大梁、小梁、斜撐 */
export function sampleProject(): Project {
  const p = newProject('範例－兩層鋼構廠辦');
  const g = makeGrid('0 3*6000', '0 2*8000', '1', 'A');
  const levels = [makeLevel('1FL', 0), makeLevel('2FL', 4200), makeLevel('RFL', 8400)];
  p.grids = [g];
  p.levels = levels;
  p.info = { company: '', client: '範例業主', location: '台中市', designer: '', note: '內建範例專案，可自由修改' };
  const d = p.settings.defaults;
  d.column.bottomLevelId = levels[0].id;
  d.column.topLevelId = levels[1].id;
  const ms: Member[] = [];
  const at = (xi: number, yi: number, z: number): V3 => gridToWorld(g, g.xs[xi].offset, g.ys[yi].offset, z);

  // 柱
  for (let li = 0; li < 2; li++) {
    for (let xi = 0; xi < g.xs.length; xi++) {
      for (let yi = 0; yi < g.ys.length; yi++) {
        const a = levels[li];
        const b = levels[li + 1];
        ms.push(
          newMember('column', d.column, at(xi, yi, a.elevation), at(xi, yi, b.elevation), {
            levelId: a.id,
            startRef: { levelId: a.id },
            endRef: { levelId: b.id },
          }),
        );
      }
    }
  }
  // 大梁、小梁
  for (const lv of levels.slice(1)) {
    const z = lv.elevation;
    const ref = { levelId: lv.id };
    const extra = { levelId: lv.id, startRef: ref, endRef: ref };
    for (let yi = 0; yi < g.ys.length; yi++) {
      for (let xi = 0; xi < g.xs.length - 1; xi++) ms.push(newMember('girder', d.girder, at(xi, yi, z), at(xi + 1, yi, z), extra));
    }
    for (let xi = 0; xi < g.xs.length; xi++) {
      for (let yi = 0; yi < g.ys.length - 1; yi++) {
        ms.push(newMember('girder', { ...d.girder, profile: 'H488x300x11x18' }, at(xi, yi, z), at(xi, yi + 1, z), extra));
      }
    }
    // 小梁：每跨中間，沿 Y 向
    for (let xi = 0; xi < g.xs.length - 1; xi++) {
      const xm = (g.xs[xi].offset + g.xs[xi + 1].offset) / 2;
      for (let yi = 0; yi < g.ys.length - 1; yi++) {
        ms.push(newMember('beam', d.beam, gridToWorld(g, xm, g.ys[yi].offset, z), gridToWorld(g, xm, g.ys[yi + 1].offset, z), extra));
      }
    }
  }
  // 斜撐：A 軸 1–2 跨，一樓 X 型
  const br = { ...d.brace, profile: '□150x150x6', material: 'STKR400' };
  const bx = { levelId: levels[0].id, startRef: { levelId: levels[0].id }, endRef: { levelId: levels[1].id } };
  ms.push(
    newMember('brace', br, at(0, 0, 0), at(1, 0, 4200), bx),
    newMember('brace', br, at(1, 0, 0), at(0, 0, 4200), bx),
    newMember('brace', br, at(2, 2, 0), at(3, 2, 4200), bx),
    newMember('brace', br, at(3, 2, 0), at(2, 2, 4200), bx),
  );
  p.members = ms;
  p.views = syncViews({ grids: p.grids, levels: p.levels, views: [] });
  return p;
}
