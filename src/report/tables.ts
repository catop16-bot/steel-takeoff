import type { MemberQty } from '../quantity/compute';
import type { LevelRow, MarkRow, MaterialRow, ProfileRow, Summary, TypeRow } from '../quantity/summary';
import { fmtElev } from '../view3d/overlay';

export interface Col<T> {
  key: string;
  title: string;
  /** 小數位數；undefined 表示文字 */
  dp?: number;
  get: (r: T) => string | number;
  /** 合計列要加總 */
  sum?: boolean;
  width?: number;
}

export interface TableDef<T> {
  id: string;
  title: string;
  cols: Col<T>[];
  rows: (s: Summary) => T[];
  /** 合計列的特殊欄位（例如 kg/m² = 總重 / 總面積） */
  totalFix?: (t: Record<string, number>) => Record<string, number>;
}

export const markTable: TableDef<MarkRow> = {
  id: 'marks',
  title: '構件明細（依編號）',
  rows: (s) => s.byMark,
  cols: [
    { key: 'mark', title: '編號', get: (r) => r.mark, width: 10 },
    { key: 'type', title: '類型', get: (r) => r.typeLabel, width: 8 },
    { key: 'name', title: '名稱', get: (r) => r.name, width: 10 },
    { key: 'profile', title: '斷面', get: (r) => r.profile, width: 22 },
    { key: 'material', title: '材質', get: (r) => r.material, width: 10 },
    { key: 'density', title: '密度 kg/m³', dp: 0, get: (r) => r.density, width: 11 },
    { key: 'length', title: '長度 mm', dp: 0, get: (r) => (r.type === 'plate' ? r.size : r.length), width: 11 },
    { key: 'qty', title: '數量', dp: 0, get: (r) => r.qty, sum: true, width: 7 },
    { key: 'unit', title: '單位重 kg/m', dp: 2, get: (r) => r.unitWeight, width: 12 },
    { key: 'weight', title: '單重 kg', dp: 2, get: (r) => r.weight, width: 11 },
    { key: 'total', title: '總重 kg', dp: 2, get: (r) => r.totalWeight, sum: true, width: 12 },
    { key: 'surface', title: '單支塗裝 m²', dp: 3, get: (r) => r.surface, width: 12 },
    { key: 'tsurface', title: '總塗裝 m²', dp: 2, get: (r) => r.totalSurface, sum: true, width: 12 },
    { key: 'levels', title: '樓層', get: (r) => r.levels, width: 14 },
  ],
};

export const profileTable: TableDef<ProfileRow> = {
  id: 'profiles',
  title: '斷面材料彙總',
  rows: (s) => s.byProfile,
  cols: [
    { key: 'family', title: '類別', get: (r) => r.family, width: 20 },
    { key: 'profile', title: '斷面', get: (r) => r.profile, width: 22 },
    { key: 'material', title: '材質', get: (r) => r.material, width: 10 },
    { key: 'density', title: '密度 kg/m³', dp: 0, get: (r) => r.density, width: 11 },
    { key: 'unit', title: '單位重 kg/m', dp: 2, get: (r) => r.unitWeight, width: 12 },
    { key: 'qty', title: '數量', dp: 0, get: (r) => r.qty, sum: true, width: 7 },
    { key: 'len', title: '總長 m', dp: 2, get: (r) => r.totalLength / 1000, sum: true, width: 11 },
    { key: 'total', title: '總重 kg', dp: 2, get: (r) => r.totalWeight, sum: true, width: 12 },
    { key: 'ton', title: '總重 t', dp: 3, get: (r) => r.totalWeight / 1000, sum: true, width: 10 },
    { key: 'tsurface', title: '塗裝 m²', dp: 2, get: (r) => r.totalSurface, sum: true, width: 11 },
  ],
};

export const levelTable: TableDef<LevelRow> = {
  id: 'levels',
  title: '樓層彙總',
  rows: (s) => s.byLevel,
  cols: [
    { key: 'level', title: '樓層', get: (r) => r.level, width: 12 },
    { key: 'elev', title: '高程', get: (r) => (Number.isFinite(r.elevation) ? fmtElev(r.elevation) : ''), width: 10 },
    { key: 'qty', title: '數量', dp: 0, get: (r) => r.qty, sum: true, width: 7 },
    { key: 'total', title: '總重 kg', dp: 2, get: (r) => r.totalWeight, sum: true, width: 12 },
    { key: 'ton', title: '總重 t', dp: 3, get: (r) => r.totalWeight / 1000, sum: true, width: 10 },
    { key: 'area', title: '樓地板面積 m²', dp: 1, get: (r) => r.floorArea, sum: true, width: 14 },
    { key: 'kgm2', title: '用鋼量 kg/m²', dp: 1, get: (r) => (r.floorArea > 0 ? r.kgPerM2 : ''), width: 13 },
  ],
  totalFix: (t) => ({ kgm2: t.area > 0 ? t.total / t.area : 0 }),
};

export const typeTable: TableDef<TypeRow> = {
  id: 'types',
  title: '類型彙總',
  rows: (s) => s.byType,
  cols: [
    { key: 'type', title: '類型', get: (r) => r.typeLabel, width: 10 },
    { key: 'qty', title: '數量', dp: 0, get: (r) => r.qty, sum: true, width: 7 },
    { key: 'len', title: '總長 m', dp: 2, get: (r) => r.totalLength / 1000, sum: true, width: 11 },
    { key: 'total', title: '總重 kg', dp: 2, get: (r) => r.totalWeight, sum: true, width: 12 },
    { key: 'ton', title: '總重 t', dp: 3, get: (r) => r.totalWeight / 1000, sum: true, width: 10 },
    { key: 'tsurface', title: '塗裝 m²', dp: 2, get: (r) => r.totalSurface, sum: true, width: 11 },
  ],
};

export const materialTable: TableDef<MaterialRow> = {
  id: 'materials',
  title: '材質彙總',
  rows: (s) => s.byMaterial,
  cols: [
    { key: 'material', title: '材質', get: (r) => r.material, width: 12 },
    { key: 'density', title: '密度 kg/m³', dp: 0, get: (r) => r.density, width: 11 },
    { key: 'qty', title: '數量', dp: 0, get: (r) => r.qty, sum: true, width: 7 },
    { key: 'total', title: '總重 kg', dp: 2, get: (r) => r.totalWeight, sum: true, width: 12 },
    { key: 'ton', title: '總重 t', dp: 3, get: (r) => r.totalWeight / 1000, sum: true, width: 10 },
  ],
};

export const memberTable: TableDef<MemberQty> = {
  id: 'members',
  title: '全部構件清單',
  rows: (s) => s.rows.filter((r) => !r.error),
  cols: [
    { key: 'mark', title: '編號', get: (r) => r.mark, width: 9 },
    { key: 'type', title: '類型', get: (r) => r.typeLabel, width: 7 },
    { key: 'name', title: '名稱', get: (r) => r.name, width: 10 },
    { key: 'profile', title: '斷面', get: (r) => r.profile, width: 22 },
    { key: 'material', title: '材質', get: (r) => r.material, width: 10 },
    { key: 'density', title: '密度 kg/m³', dp: 0, get: (r) => r.density, width: 11 },
    { key: 'length', title: '長度 mm', dp: 1, get: (r) => (r.type === 'plate' ? r.size : r.length), width: 11 },
    { key: 'unit', title: '單位重', dp: 2, get: (r) => r.unitWeight, width: 10 },
    { key: 'weight', title: '重量 kg', dp: 2, get: (r) => r.weight, sum: true, width: 11 },
    { key: 'surface', title: '塗裝 m²', dp: 3, get: (r) => r.surface, sum: true, width: 10 },
    { key: 'level', title: '樓層', get: (r) => r.levelName, width: 8 },
    { key: 'loc', title: '位置', get: (r) => r.location, width: 16 },
  ],
};

export const errorTable: TableDef<MemberQty> = {
  id: 'errors',
  title: '無法計算的構件',
  rows: (s) => s.errors,
  cols: [
    { key: 'type', title: '類型', get: (r) => r.typeLabel },
    { key: 'name', title: '名稱', get: (r) => r.name },
    { key: 'profile', title: '斷面', get: (r) => r.profile },
    { key: 'level', title: '樓層', get: (r) => r.levelName },
    { key: 'error', title: '原因', get: (r) => r.error ?? '' },
  ],
};

export const ALL_TABLES = [markTable, profileTable, levelTable, typeTable, materialTable, memberTable] as TableDef<any>[];

export function cellText(c: Col<any>, v: string | number): string {
  if (typeof v === 'number' && c.dp !== undefined) return v.toLocaleString('zh-TW', { minimumFractionDigits: c.dp, maximumFractionDigits: c.dp });
  return String(v ?? '');
}

export function totals<T>(t: TableDef<T>, rows: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of t.cols) if (c.sum) out[c.key] = rows.reduce((s, r) => s + (Number(c.get(r)) || 0), 0);
  return t.totalFix ? { ...out, ...t.totalFix(out) } : out;
}

/** 套用使用者隱藏的欄位（第一欄一律保留） */
export function withHidden<T>(t: TableDef<T>, hidden?: Record<string, string[]>): TableDef<T> {
  const h = new Set(hidden?.[t.id] ?? []);
  if (!h.size) return t;
  return { ...t, cols: t.cols.filter((c, i) => i === 0 || !h.has(c.key)) };
}
