import { ANGLE, CHANNEL, H_MEDIUM, H_NARROW, H_WIDE, I_BEAM, type HRow } from './jis/hot-rolled';
import { BOX, LIGHT_C, LIPPED_C, LIPPED_Z, PIPE } from './jis/tubes';
import { sectionArea, sectionExtent, sectionPerimeter } from './shapes';
import type { Profile, ProfileDims, ProfileKind } from './types';

/** 數字轉字串，去掉多餘的 0（12.0 → 12、6.50 → 6.5） */
export function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** 依種類與尺寸產生正規化名稱 */
export function profileName(kind: ProfileKind, d: ProfileDims, welded = false): string {
  const j = (...v: (number | undefined)[]) => v.map((x) => fmt(x ?? 0)).join('x');
  switch (kind) {
    case 'H':
      return (welded ? 'BH' : 'H') + j(d.h, d.b, d.tw, d.tf);
    case 'I':
      return 'I' + j(d.h, d.b, d.tw, d.tf);
    case 'C':
      return '[' + j(d.h, d.b, d.tw, d.tf);
    case 'L':
      return 'L' + j(d.h, d.b, d.t);
    case 'T':
      return 'CT' + j(d.h, d.b, d.tw, d.tf);
    case 'BOX':
      return '□' + j(d.h, d.b, d.t);
    case 'WBOX':
      return 'BOX' + j(d.h, d.b, d.tw, d.tf);
    case 'PIPE':
      return 'φ' + j(d.h, d.t);
    case 'RB':
      return 'φ' + fmt(d.h);
    case 'LC':
      return 'C' + j(d.h, d.b, d.c, d.t);
    case 'LCH':
      return 'C' + j(d.h, d.b, d.t);
    case 'Z':
      return 'Z' + j(d.h, d.b, d.c, d.t);
    case 'PL':
      return d.h > 0 ? 'PL' + j(d.b, d.h) : 'PL' + fmt(d.b);
    case 'FB':
      return 'FB' + j(d.h, d.b);
  }
}

export function makeProfile(
  kind: ProfileKind,
  dims: ProfileDims,
  opts: { family: string; standard: string; catalog: boolean; welded?: boolean; tableWeight?: number },
): Profile {
  const ext = sectionExtent(kind, dims);
  return {
    name: profileName(kind, dims, opts.welded),
    kind,
    dims,
    area: sectionArea(kind, dims),
    perimeter: sectionPerimeter(kind, dims),
    width: ext.width,
    height: ext.height,
    family: opts.family,
    standard: opts.standard,
    catalog: opts.catalog,
    tableWeight: opts.tableWeight,
  };
}

export const FAMILY = {
  H: 'H 型鋼',
  HW: 'H 型鋼（寬翼 HW）',
  HM: 'H 型鋼（中翼 HM）',
  HN: 'H 型鋼（細翼 HN）',
  BH: '焊接 H 型鋼（BH）',
  I: 'I 型鋼',
  C: '槽鋼',
  L: '等邊角鋼',
  LU: '不等邊角鋼',
  CT: 'CT 剖分 T 型鋼',
  PIPE: '圓管（STK）',
  SQ: '方管（STKR）',
  RECT: '矩形管（STKR）',
  WBOX: '焊接箱型（BOX）',
  LC: '帶唇 C 型鋼（SSC）',
  LCH: '輕型槽鋼（SSC）',
  Z: '帶唇 Z 型鋼（SSC）',
  PL: '鋼板（PL）',
  FB: '扁鋼（FB）',
  RB: '圓鋼',
  T: 'T 型鋼',
} as const;

const G3192 = 'JIS G 3192 / CNS 1490';

function buildCatalog(): Profile[] {
  const out: Profile[] = [];
  const addH = (rows: HRow[], family: string) => {
    for (const [h, b, tw, tf, r, w] of rows) {
      out.push(makeProfile('H', { h, b, tw, tf, r1: r }, { family, standard: G3192, catalog: true, tableWeight: w }));
    }
  };
  addH(H_WIDE, FAMILY.HW);
  addH(H_MEDIUM, FAMILY.HM);
  addH(H_NARROW, FAMILY.HN);
  for (const [h, b, tw, tf, r1, r2, w] of I_BEAM) {
    out.push(makeProfile('I', { h, b, tw, tf, r1, r2 }, { family: FAMILY.I, standard: G3192, catalog: true, tableWeight: w }));
  }
  for (const [h, b, tw, tf, r1, r2, w] of CHANNEL) {
    out.push(makeProfile('C', { h, b, tw, tf, r1, r2 }, { family: FAMILY.C, standard: G3192, catalog: true, tableWeight: w }));
  }
  for (const [h, b, t, r1, r2, w] of ANGLE) {
    out.push(
      makeProfile('L', { h, b, t, r1, r2 }, { family: h === b ? FAMILY.L : FAMILY.LU, standard: G3192, catalog: true, tableWeight: w }),
    );
  }
  // CT 為 H 型鋼對剖（寬翼與中翼）
  for (const [h, b, tw, tf, r] of [...H_WIDE, ...H_MEDIUM]) {
    out.push(makeProfile('T', { h: h / 2, b, tw, tf, r1: r }, { family: FAMILY.CT, standard: G3192, catalog: true }));
  }
  for (const [D, ts] of PIPE) {
    for (const t of ts) out.push(makeProfile('PIPE', { h: D, b: D, t }, { family: FAMILY.PIPE, standard: 'JIS G 3444', catalog: true }));
  }
  for (const [h, b, ts] of BOX) {
    for (const t of ts) {
      out.push(makeProfile('BOX', { h, b, t }, { family: h === b ? FAMILY.SQ : FAMILY.RECT, standard: 'JIS G 3466', catalog: true }));
    }
  }
  for (const [h, b, c, ts] of LIPPED_C) {
    for (const t of ts) out.push(makeProfile('LC', { h, b, c, t }, { family: FAMILY.LC, standard: 'JIS G 3350', catalog: true }));
  }
  for (const [h, b, ts] of LIGHT_C) {
    for (const t of ts) out.push(makeProfile('LCH', { h, b, t }, { family: FAMILY.LCH, standard: 'JIS G 3350', catalog: true }));
  }
  for (const [h, b, c, ts] of LIPPED_Z) {
    for (const t of ts) out.push(makeProfile('Z', { h, b, c, t }, { family: FAMILY.Z, standard: 'JIS G 3350', catalog: true }));
  }
  return out;
}

export const CATALOG: Profile[] = buildCatalog();

const byName = new Map<string, Profile>();
for (const p of CATALOG) if (!byName.has(p.name)) byName.set(p.name, p);

export function catalogByName(name: string): Profile | undefined {
  return byName.get(name);
}

const near = (a: number | undefined, b: number | undefined) => Math.abs((a ?? 0) - (b ?? 0)) < 0.01;

/** 依種類與部分尺寸查型錄；keys 為要比對的欄位 */
export function catalogFind(kind: ProfileKind, d: Partial<ProfileDims>, keys: (keyof ProfileDims)[]): Profile[] {
  return CATALOG.filter((p) => p.kind === kind && keys.every((k) => near(p.dims[k], d[k])));
}

/** 斷面瀏覽器用：依類別分組 */
export function catalogFamilies(): { family: string; items: Profile[] }[] {
  const m = new Map<string, Profile[]>();
  for (const p of CATALOG) {
    let arr = m.get(p.family);
    if (!arr) m.set(p.family, (arr = []));
    arr.push(p);
  }
  return [...m.entries()].map(([family, items]) => ({ family, items }));
}
