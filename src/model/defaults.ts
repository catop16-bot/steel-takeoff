import { buildAxes } from '../geom/grid';
import type { V3 } from '../geom/vec';
import type { Grid, Level, Member, MemberDefaults, MemberPosition, MemberType, Project, ProjectSettings, ToolKey, ViewDef } from './types';

let counter = 0;
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1679616;
  return prefix + Date.now().toString(36) + counter.toString(36).padStart(4, '0') + Math.random().toString(36).slice(2, 6);
}

export const POS_MIDDLE: MemberPosition = {
  plane: 'middle',
  planeOffset: 0,
  rotation: 'top',
  rotationAngle: 0,
  depth: 'middle',
  depthOffset: 0,
};

export const POS_BEAM: MemberPosition = { ...POS_MIDDLE, depth: 'behind' };

export function defaultToolSettings(): Record<ToolKey, MemberDefaults> {
  return {
    column: { name: '柱', profile: 'H400x400x13x21', material: 'SN490B', cls: 4, prefix: 'C', pos: { ...POS_MIDDLE }, bottomOffset: 0, topOffset: 0 },
    girder: { name: '大梁', profile: 'H588x300x12x20', material: 'SN490B', cls: 3, prefix: 'G', pos: { ...POS_BEAM } },
    beam: { name: '小梁', profile: 'H400x200x8x13', material: 'SN400B', cls: 5, prefix: 'B', pos: { ...POS_BEAM } },
    brace: { name: '斜撐', profile: 'H200x200x8x12', material: 'SN400B', cls: 7, prefix: 'BR', pos: { ...POS_MIDDLE } },
    purlin: { name: '桁條', profile: 'C150x65x20x2.3', material: 'SSC400', cls: 6, prefix: 'P', pos: { ...POS_BEAM } },
    plate: { name: '鋼板', profile: 'PL12', material: 'SS400', cls: 8, prefix: 'PL', pos: { ...POS_MIDDLE, depth: 'behind' } },
  };
}

export function defaultSettings(): ProjectSettings {
  return { paintIncludeEnds: false, numberTolerance: 1, defaults: defaultToolSettings(), reportHidden: {} };
}

export function makeGrid(xText: string, yText: string, xLabels: string, yLabels: string, name = '軸線'): Grid {
  const xs = buildAxes(xText, xLabels, '1');
  const ys = buildAxes(yText, yLabels, 'A');
  if (typeof xs === 'string') throw new Error(xs);
  if (typeof ys === 'string') throw new Error(ys);
  return { id: uid('g'), name, origin: [0, 0, 0], rotation: 0, xs, ys, ext: 2000, xText, yText, xLabels, yLabels };
}

export function makeLevel(name: string, elevation: number): Level {
  return { id: uid('l'), name, elevation };
}

export function newMember(type: MemberType, d: MemberDefaults, start: V3, end: V3, extra: Partial<Member> = {}): Member {
  return {
    id: uid('m'),
    type,
    name: d.name,
    profile: d.profile,
    material: d.material,
    cls: d.cls,
    prefix: d.prefix,
    start,
    end,
    pos: { ...d.pos },
    offStart: { dx: 0, dy: 0, dz: 0 },
    offEnd: { dx: 0, dy: 0, dz: 0 },
    ...extra,
  };
}

export function view3d(name = '3D 視圖'): ViewDef {
  return { id: uid('v'), name, kind: '3d', depthUp: 1e7, depthDown: 1e7 };
}

export function newProject(name = '新專案'): Project {
  const grid = makeGrid('0 3*6000', '0 2*8000', '1', 'A');
  const levels = [makeLevel('1FL', 0), makeLevel('2FL', 4200), makeLevel('RFL', 8400)];
  const p: Project = {
    format: 'steel-takeoff',
    version: 1,
    id: uid('p'),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    info: { company: '', client: '', location: '', designer: '', note: '' },
    settings: defaultSettings(),
    grids: [grid],
    levels,
    members: [],
    views: [],
    drawings: [],
    schedule: [],
    customMaterials: [],
  };
  p.views = defaultViews(p);
  for (const k of Object.keys(p.settings.defaults) as ToolKey[]) {
    if (k === 'column') {
      p.settings.defaults[k].bottomLevelId = levels[0].id;
      p.settings.defaults[k].topLevelId = levels[1].id;
    }
  }
  return p;
}

/** 依軸線與高程產生視圖：3D、每個樓層平面、每條軸線立面（仿 Tekla「沿軸線建立視圖」） */
export function defaultViews(p: Pick<Project, 'grids' | 'levels'>): ViewDef[] {
  const views: ViewDef[] = [view3d()];
  const sorted = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i];
    const below = i > 0 ? l.elevation - sorted[i - 1].elevation : 1000;
    views.push({ id: uid('v'), name: `平面 ${l.name}`, kind: 'plan', levelId: l.id, depthUp: 500, depthDown: Math.max(500, below - 1) });
  }
  for (const g of p.grids) {
    for (const ax of g.ys) views.push({ id: uid('v'), name: `立面 ${ax.label}`, kind: 'elevation', gridRef: { gridId: g.id, dir: 'y', label: ax.label }, depthUp: 500, depthDown: 500 });
    for (const ax of g.xs) views.push({ id: uid('v'), name: `立面 ${ax.label}`, kind: 'elevation', gridRef: { gridId: g.id, dir: 'x', label: ax.label }, depthUp: 500, depthDown: 500 });
  }
  return views;
}

/** 讀入舊檔或外部檔案時補齊欄位 */
export function migrateProject(raw: any): Project {
  if (!raw || raw.format !== 'steel-takeoff') throw new Error('不是鋼構算量專案檔');
  const p = raw as Project;
  p.info ??= { company: '', client: '', location: '', designer: '', note: '' };
  p.info.company ??= '';
  p.settings ??= defaultSettings();
  const def = defaultToolSettings();
  p.settings.defaults ??= def;
  for (const k of Object.keys(def) as ToolKey[]) p.settings.defaults[k] ??= def[k];
  p.settings.numberTolerance ??= 1;
  p.settings.reportHidden ??= {};
  p.grids ??= [];
  p.levels ??= [];
  p.members ??= [];
  p.views ??= defaultViews(p);
  p.customMaterials ??= [];
  p.drawings ??= [];
  p.schedule ??= [];
  for (const m of p.members) {
    m.pos ??= { ...POS_MIDDLE };
    m.offStart ??= { dx: 0, dy: 0, dz: 0 };
    m.offEnd ??= { dx: 0, dy: 0, dz: 0 };
  }
  return p;
}
