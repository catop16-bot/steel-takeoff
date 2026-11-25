import { densityOf, type Material } from '../catalog/materials';
import { parseProfile } from '../catalog/parse';
import type { Profile } from '../catalog/types';
import { memberLength } from '../geom/frame';
import { gridLocation, levelBelow } from '../geom/grid';
import { cross, dot, norm, polygonArea3, polygonNormal, polygonPerimeter3, sub, type V3 } from '../geom/vec';
import { MEMBER_TYPE_LABEL, type Grid, type Level, type Member, type MemberType } from '../model/types';

export interface MemberQty {
  id: string;
  type: MemberType;
  typeLabel: string;
  name: string;
  /** 正規化斷面名稱（無法解析時為原字串） */
  profile: string;
  family: string;
  material: string;
  /** 密度 kg/m³ */
  density: number;
  /** 長度 mm（鋼板為 0） */
  length: number;
  /** 斷面積 mm²；鋼板為板面積 mm² */
  area: number;
  /** 單位重 kg/m（鋼板為 kg/m²） */
  unitWeight: number;
  /** 單支重量 kg */
  weight: number;
  /** 單支塗裝面積 m² */
  surface: number;
  /** 尺寸說明（鋼板：外框長x寬） */
  size: string;
  levelId: string;
  levelName: string;
  prefix: string;
  mark: string;
  location: string;
  /** 鋼板形狀簽名（編號用） */
  shapeKey?: string;
  error?: string;
}

export interface QtyContext {
  grids: Grid[];
  levels: Level[];
  customMaterials: Material[];
  paintIncludeEnds: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function resolveProfile(m: Pick<Member, 'profile'>): Profile | null {
  const r = parseProfile(m.profile);
  return r.ok ? r.profile : null;
}

function memberLevel(m: Member, ctx: QtyContext): Level | undefined {
  if (m.levelId) {
    const l = ctx.levels.find((x) => x.id === m.levelId);
    if (l) return l;
  }
  const z = m.points?.length ? Math.min(...m.points.map((p) => p[2])) : m.type === 'column' || m.type === 'brace' ? Math.min(m.start[2], m.end[2]) : Math.max(m.start[2], m.end[2]);
  return levelBelow(ctx.levels, z);
}

/** 鋼板在自身平面上的外框尺寸 */
function plateBox(pts: V3[]): { a: number; b: number } {
  const n = polygonNormal(pts);
  let ex = norm(sub(pts[1], pts[0]));
  if (Math.abs(dot(ex, n)) > 0.99) ex = [1, 0, 0];
  const ey = norm(cross(n, ex));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    const d = sub(p, pts[0]);
    const x = dot(d, ex);
    const y = dot(d, ey);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const a = maxX - minX;
  const b = maxY - minY;
  return a >= b ? { a, b } : { a: b, b: a };
}

export function computeMember(m: Member, ctx: QtyContext): MemberQty {
  const level = memberLevel(m, ctx);
  const density = densityOf(m.material, ctx.customMaterials);
  const base: MemberQty = {
    id: m.id,
    type: m.type,
    typeLabel: MEMBER_TYPE_LABEL[m.type],
    name: m.name,
    profile: m.profile,
    family: '',
    material: m.material,
    density,
    length: 0,
    area: 0,
    unitWeight: 0,
    weight: 0,
    surface: 0,
    size: '',
    levelId: level?.id ?? '',
    levelName: level?.name ?? '',
    prefix: m.prefix,
    mark: m.mark ?? '',
    location: '',
  };
  const prof = resolveProfile(m);
  if (!prof) return { ...base, error: `斷面無法解析：${m.profile}` };
  base.profile = prof.name;
  base.family = prof.family;

  if (m.type === 'plate' || m.points?.length) {
    const pts = m.points ?? [];
    if (pts.length < 3) return { ...base, error: '鋼板頂點不足' };
    const t = prof.kind === 'PL' || prof.kind === 'FB' ? (prof.dims.t ?? prof.dims.b) : NaN;
    if (!(t > 0)) return { ...base, error: '鋼板斷面需為 PL厚度（如 PL12）' };
    const area = polygonArea3(pts);
    const per = polygonPerimeter3(pts);
    const box = plateBox(pts);
    const sides = pts.map((p, i) => Math.round(Math.hypot(...sub(pts[(i + 1) % pts.length], p)))).sort((a, b) => a - b);
    return {
      ...base,
      area,
      unitWeight: (t * density) / 1e3,
      weight: (area * t * density) / 1e9,
      surface: (2 * area + per * t) / 1e6,
      size: `${r1(box.a)}x${r1(box.b)}`,
      location: gridLocation(ctx.grids, pts[0]),
      shapeKey: `${t}|${Math.round(area)}|${sides.join(',')}`,
    };
  }

  if (prof.thicknessOnly) return { ...base, error: `線形構件需要完整斷面（${m.profile} 只有厚度）` };
  const length = memberLength(m);
  if (!(length > 0)) return { ...base, error: '構件長度為 0' };
  const ends = ctx.paintIncludeEnds ? (2 * prof.area) / 1e6 : 0;
  const a = gridLocation(ctx.grids, m.start);
  const b = gridLocation(ctx.grids, m.end);
  return {
    ...base,
    length,
    area: prof.area,
    unitWeight: (prof.area * density) / 1e6,
    weight: (prof.area * length * density) / 1e9,
    surface: (prof.perimeter * length) / 1e6 + ends,
    size: String(Math.round(length)),
    location: a === b ? a : `${a} → ${b}`,
  };
}

export function computeAll(members: Member[], ctx: QtyContext): MemberQty[] {
  return members.map((m) => computeMember(m, ctx));
}
