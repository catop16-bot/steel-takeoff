import { gridExtent } from '../geom/grid';
import { MEMBER_TYPES, MEMBER_TYPE_LABEL, type Grid, type Level, type MemberType } from '../model/types';
import type { MemberQty } from './compute';
import { markNumber, markPrefix } from './numbering';

export interface MarkRow {
  mark: string;
  type: MemberType;
  typeLabel: string;
  name: string;
  profile: string;
  material: string;
  density: number;
  /** 長度 mm（鋼板為尺寸說明） */
  length: number;
  size: string;
  qty: number;
  unitWeight: number;
  /** 單支重 kg */
  weight: number;
  totalWeight: number;
  /** 單支塗裝面積 m² */
  surface: number;
  totalSurface: number;
  levels: string;
}

export interface ProfileRow {
  profile: string;
  family: string;
  material: string;
  density: number;
  unitWeight: number;
  qty: number;
  totalLength: number;
  totalWeight: number;
  totalSurface: number;
}

export interface LevelRow {
  levelId: string;
  level: string;
  elevation: number;
  qty: number;
  totalWeight: number;
  floorArea: number;
  /** 單位面積用鋼量 kg/m² */
  kgPerM2: number;
}

export interface TypeRow {
  type: MemberType;
  typeLabel: string;
  qty: number;
  totalLength: number;
  totalWeight: number;
  totalSurface: number;
}

export interface MaterialRow {
  material: string;
  density: number;
  qty: number;
  totalWeight: number;
}

export interface Summary {
  rows: MemberQty[];
  errors: MemberQty[];
  byMark: MarkRow[];
  byProfile: ProfileRow[];
  byLevel: LevelRow[];
  byType: TypeRow[];
  byMaterial: MaterialRow[];
  total: { qty: number; weight: number; surface: number; length: number; floorArea: number; kgPerM2: number };
}

function compareMark(a: string, b: string): number {
  return markPrefix(a).localeCompare(markPrefix(b)) || markNumber(a) - markNumber(b) || a.localeCompare(b);
}

/** 依軸線外框估算的樓地板面積 m² */
export function autoFloorArea(grids: Grid[]): number {
  let total = 0;
  for (const g of grids) {
    const e = gridExtent(g);
    total += ((e.u1 - e.u0) * (e.v1 - e.v0)) / 1e6;
  }
  return total;
}

export function summarize(rows: MemberQty[], levels: Level[], grids: Grid[]): Summary {
  const ok = rows.filter((r) => !r.error);
  const errors = rows.filter((r) => r.error);

  // 依編號
  const markMap = new Map<string, MemberQty[]>();
  for (const r of ok) {
    const k = r.mark || `（未編號）${r.id}`;
    let g = markMap.get(k);
    if (!g) markMap.set(k, (g = []));
    g.push(r);
  }
  const byMark: MarkRow[] = [];
  for (const [mark, g] of markMap) {
    const f = g[0];
    const lv = [...new Set(g.map((r) => r.levelName).filter(Boolean))];
    const totalWeight = g.reduce((s, r) => s + r.weight, 0);
    const totalSurface = g.reduce((s, r) => s + r.surface, 0);
    byMark.push({
      mark: f.mark || '（未編號）',
      type: f.type,
      typeLabel: f.typeLabel,
      name: f.name,
      profile: f.profile,
      material: f.material,
      density: f.density,
      length: g.reduce((s, r) => s + r.length, 0) / g.length,
      size: f.size,
      qty: g.length,
      unitWeight: f.unitWeight,
      weight: totalWeight / g.length,
      totalWeight,
      surface: totalSurface / g.length,
      totalSurface,
      levels: lv.join('、'),
    });
    void mark;
  }
  byMark.sort((a, b) => MEMBER_TYPES.indexOf(a.type) - MEMBER_TYPES.indexOf(b.type) || compareMark(a.mark, b.mark));

  // 依斷面＋材質
  const profMap = new Map<string, ProfileRow>();
  for (const r of ok) {
    const k = `${r.profile}|${r.material}`;
    let row = profMap.get(k);
    if (!row) {
      profMap.set(
        k,
        (row = { profile: r.profile, family: r.family, material: r.material, density: r.density, unitWeight: r.unitWeight, qty: 0, totalLength: 0, totalWeight: 0, totalSurface: 0 }),
      );
    }
    row.qty++;
    row.totalLength += r.length;
    row.totalWeight += r.weight;
    row.totalSurface += r.surface;
  }
  const byProfile = [...profMap.values()].sort(
    (a, b) => a.family.localeCompare(b.family) || a.profile.localeCompare(b.profile, 'en', { numeric: true }) || a.material.localeCompare(b.material),
  );

  // 依樓層
  const auto = autoFloorArea(grids);
  const sortedLevels = [...levels].sort((a, b) => a.elevation - b.elevation);
  const top = sortedLevels[sortedLevels.length - 1];
  const byLevel: LevelRow[] = sortedLevels.map((l) => {
    const g = ok.filter((r) => r.levelId === l.id);
    const w = g.reduce((s, r) => s + r.weight, 0);
    // 未填面積：依軸線外框估算；最高層視為屋頂，不計入樓地板面積
    const area = l.floorArea ?? (l === top && sortedLevels.length > 1 ? 0 : auto);
    return { levelId: l.id, level: l.name, elevation: l.elevation, qty: g.length, totalWeight: w, floorArea: area, kgPerM2: area > 0 ? w / area : 0 };
  });
  const noLevel = ok.filter((r) => !levels.some((l) => l.id === r.levelId));
  if (noLevel.length) {
    const w = noLevel.reduce((s, r) => s + r.weight, 0);
    byLevel.push({ levelId: '', level: '（未分層）', elevation: NaN, qty: noLevel.length, totalWeight: w, floorArea: 0, kgPerM2: 0 });
  }

  // 依類型
  const byType: TypeRow[] = [];
  for (const t of MEMBER_TYPES) {
    const g = ok.filter((r) => r.type === t);
    if (!g.length) continue;
    byType.push({
      type: t,
      typeLabel: MEMBER_TYPE_LABEL[t],
      qty: g.length,
      totalLength: g.reduce((s, r) => s + r.length, 0),
      totalWeight: g.reduce((s, r) => s + r.weight, 0),
      totalSurface: g.reduce((s, r) => s + r.surface, 0),
    });
  }

  // 依材質
  const matMap = new Map<string, MaterialRow>();
  for (const r of ok) {
    let row = matMap.get(r.material);
    if (!row) matMap.set(r.material, (row = { material: r.material, density: r.density, qty: 0, totalWeight: 0 }));
    row.qty++;
    row.totalWeight += r.weight;
  }
  const byMaterial = [...matMap.values()].sort((a, b) => b.totalWeight - a.totalWeight);

  const weight = ok.reduce((s, r) => s + r.weight, 0);
  const floorArea = byLevel.reduce((s, l) => s + (l.levelId ? l.floorArea : 0), 0);
  return {
    rows,
    errors,
    byMark,
    byProfile,
    byLevel,
    byType,
    byMaterial,
    total: {
      qty: ok.length,
      weight,
      surface: ok.reduce((s, r) => s + r.surface, 0),
      length: ok.reduce((s, r) => s + r.length, 0),
      floorArea,
      kgPerM2: floorArea > 0 ? weight / floorArea : 0,
    },
  };
}
