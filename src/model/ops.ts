import { uid, view3d } from './defaults';
import { magneticGridUpdate } from './edit';
import { store, type Change } from './store';
import type { Grid, Level, Member, Project, ViewDef } from './types';

/**
 * 讓視圖與軸線、高程一致：每個樓層一個平面視圖、每條軸線一個立面視圖。
 * 保留使用者已有的視圖（含相機），移除對應不到的平面／立面視圖。
 */
export function syncViews(p: Pick<Project, 'grids' | 'levels' | 'views'>): ViewDef[] {
  const out: ViewDef[] = [];
  const has3d = p.views.filter((v) => v.kind === '3d');
  out.push(...(has3d.length ? has3d : [view3d()]));
  const sorted = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  sorted.forEach((l, i) => {
    const below = i > 0 ? l.elevation - sorted[i - 1].elevation : 1000;
    const old = p.views.find((v) => v.kind === 'plan' && v.levelId === l.id);
    const depthDown = Math.max(500, below - 1);
    out.push(old ? { ...old, name: `平面 ${l.name}`, depthDown: old.depthDown === undefined ? depthDown : old.depthDown } : { id: uid('v'), name: `平面 ${l.name}`, kind: 'plan', levelId: l.id, depthUp: 500, depthDown });
  });
  for (const g of p.grids) {
    for (const [dir, axes] of [
      ['y', g.ys],
      ['x', g.xs],
    ] as const) {
      for (const ax of axes) {
        const old = p.views.find((v) => v.kind === 'elevation' && v.gridRef?.gridId === g.id && v.gridRef.dir === dir && v.gridRef.label === ax.label);
        out.push(old ?? { id: uid('v'), name: `立面 ${ax.label}`, kind: 'elevation', gridRef: { gridId: g.id, dir, label: ax.label }, depthUp: 500, depthDown: 500 });
      }
    }
  }
  return out;
}

export function viewChanges(before: ViewDef[], after: ViewDef[]): Change[] {
  const changes: Change[] = [];
  const b = new Map(before.map((v) => [v.id, v]));
  const a = new Map(after.map((v) => [v.id, v]));
  for (const [id, v] of b) if (!a.has(id)) changes.push({ coll: 'views', id, before: v });
  for (const [id, v] of a) {
    const old = b.get(id);
    if (old !== v) changes.push({ coll: 'views', id, before: old, after: v });
  }
  return changes;
}

/** 修改（或新增）軸線，並同步立面視圖；magnetic 時落在軸線上的構件端點跟著移動 */
export function commitGrid(grid: Grid, label: string, magnetic = true): number {
  const p = store.p;
  const before = p.grids.find((g) => g.id === grid.id);
  const grids = before ? p.grids.map((g) => (g.id === grid.id ? grid : g)) : [...p.grids, grid];
  const views = syncViews({ ...p, grids });
  const moved = before && magnetic ? magneticGridUpdate(p.members, before, grid) : [];
  const byId = new Map(p.members.map((m) => [m.id, m]));
  store.commit(label, [
    { coll: 'grids', id: grid.id, before, after: grid },
    ...viewChanges(p.views, views),
    ...moved.map((m) => ({ coll: 'members' as const, id: m.id, before: byId.get(m.id), after: m })),
  ]);
  return moved.length;
}

export function deleteGrid(id: string) {
  const p = store.p;
  const before = p.grids.find((g) => g.id === id);
  if (!before) return;
  const grids = p.grids.filter((g) => g.id !== id);
  const views = syncViews({ ...p, grids });
  store.commit(`刪除軸線 ${before.name}`, [{ coll: 'grids', id, before }, ...viewChanges(p.views, views)]);
}

/**
 * 整批更新樓層（新增、修改、刪除），同步平面視圖；
 * 磁性高程：起訖點參考該樓層的構件跟著高程變化移動。
 */
export function commitLevels(levels: Level[], label: string) {
  const p = store.p;
  const changes: Change[] = [];
  const oldMap = new Map(p.levels.map((l) => [l.id, l]));
  const newMap = new Map(levels.map((l) => [l.id, l]));
  for (const [id, l] of oldMap) if (!newMap.has(id)) changes.push({ coll: 'levels', id, before: l });
  const delta = new Map<string, number>();
  for (const l of levels) {
    const old = oldMap.get(l.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(l)) changes.push({ coll: 'levels', id: l.id, before: old, after: l });
    if (old && old.elevation !== l.elevation) delta.set(l.id, l.elevation - old.elevation);
  }
  if (delta.size) {
    for (const m of p.members) {
      const ds = m.startRef?.levelId ? (delta.get(m.startRef.levelId) ?? 0) : 0;
      const de = m.endRef?.levelId ? (delta.get(m.endRef.levelId) ?? 0) : 0;
      if (!ds && !de) continue;
      const n: Member = { ...m, start: [m.start[0], m.start[1], m.start[2] + ds], end: [m.end[0], m.end[1], m.end[2] + de] };
      if (m.points) {
        const d = ds || de;
        n.points = m.points.map((q) => [q[0], q[1], q[2] + d]);
      }
      changes.push({ coll: 'members', id: m.id, before: m, after: n });
    }
  }
  const views = syncViews({ ...p, levels });
  changes.push(...viewChanges(p.views, views));
  // 工具預設的柱上下樓層若被刪除則改指最接近的樓層
  const sorted = [...levels].sort((a, b) => a.elevation - b.elevation);
  const d = p.settings.defaults.column;
  const fix = (id?: string, idx = 0) => (id && newMap.has(id) ? id : sorted[Math.min(idx, sorted.length - 1)]?.id);
  const col = { ...d, bottomLevelId: fix(d.bottomLevelId, 0), topLevelId: fix(d.topLevelId, 1) };
  if (col.bottomLevelId !== d.bottomLevelId || col.topLevelId !== d.topLevelId) {
    changes.push({ coll: 'root', key: 'settings', before: p.settings, after: { ...p.settings, defaults: { ...p.settings.defaults, column: col } } });
  }
  store.commit(label, changes);
}

/** 視圖清單的顯示順序：3D、平面（依高程）、立面（依軸線順序） */
export function sortedViews(p: Pick<Project, 'grids' | 'levels' | 'views'>): ViewDef[] {
  const lv = new Map(p.levels.map((l) => [l.id, l.elevation]));
  const axisOrder = new Map<string, number>();
  let k = 0;
  for (const g of p.grids) {
    for (const a of g.ys) axisOrder.set(`${g.id}|y|${a.label}`, k++);
    for (const a of g.xs) axisOrder.set(`${g.id}|x|${a.label}`, k++);
  }
  const rank = (v: ViewDef) => (v.kind === '3d' ? 0 : v.kind === 'plan' ? 1 : 2);
  const key = (v: ViewDef) =>
    v.kind === 'plan' ? (lv.get(v.levelId ?? '') ?? 0) : v.kind === 'elevation' && v.gridRef ? (axisOrder.get(`${v.gridRef.gridId}|${v.gridRef.dir}|${v.gridRef.label}`) ?? 1e9) : 0;
  return [...p.views].sort((a, b) => rank(a) - rank(b) || key(a) - key(b));
}
