import { catalogByName, catalogFind, FAMILY, makeProfile, profileName } from './catalog';
import type { ParseResult, Profile, ProfileDims, ProfileKind } from './types';

/** 前綴（長的放前面，避免 PL 被當成 P、BOX 被當成 B） */
const PREFIXES: [RegExp, string][] = [
  [/^(PIPE|STK(?!R))/, 'PIPE'],
  [/^(BOX)/, 'WBOX'],
  [/^(STKR|SHS|RHS|TUBE|□|口|◻|■)/, 'BOX'],
  [/^(BH|WH)/, 'BH'],
  [/^(HW|HM|HN|HT|H)/, 'H'],
  [/^(CT|T)/, 'T'],
  [/^(LC|LGC|SSC)/, 'LC'],
  [/^(PLT|PL|FL)/, 'PL'],
  [/^(FB)/, 'FB'],
  [/^(RB|RD|ROD)/, 'RB'],
  [/^(\[|C|U)/, 'C'],
  [/^(L|∠|∟)/, 'L'],
  [/^(I)/, 'I'],
  [/^(Z)/, 'Z'],
  [/^(Φ|Ø|○|◯|⌀|D|P)/, 'ROUND'],
];

const cache = new Map<string, ParseResult>();

/** 把各種寫法正規化：全形轉半形、去空白、統一乘號 */
export function normalizeProfileText(input: string): string {
  return input
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s　]+/g, '')
    .replace(/Ф/g, 'Φ');
}

function fail(error: string): ParseResult {
  return { ok: false, error };
}

function ok(profile: Profile): ParseResult {
  return { ok: true, profile };
}

function param(kind: ProfileKind, dims: ProfileDims, family: string, welded = false): Profile {
  const p = makeProfile(kind, dims, { family, standard: '參數化', catalog: false, welded });
  return p;
}

/** 型錄有同名就用型錄（帶圓角），否則依尺寸參數化 */
function catalogOr(kind: ProfileKind, dims: ProfileDims, family: string): Profile {
  return catalogByName(profileName(kind, dims)) ?? param(kind, dims, family);
}

/**
 * 解析斷面字串。
 * 支援：H400x200x8x13、H-400*200*8*13、H400x200（查型錄）、BH600x300x12x25、
 * [150x75x6.5x10、C150x75x6.5x10、C100x50x20x2.3（帶唇）、C100x50x2.3（輕型槽鋼）、
 * L100x100x10、L100x10、∠65x65x6、CT150x300x10x15、□150x150x6、□150x6、BOX500x500x25x25、
 * φ216.3x8.2、PIPE216.3x8.2、φ25（圓鋼）、PL12x300、PL12、FB50x6、Z150x65x20x2.3
 */
export function parseProfile(input: string): ParseResult {
  const cached = cache.get(input);
  if (cached) return cached;
  const r = parseUncached(input);
  cache.set(input, r);
  return r;
}

function parseUncached(input: string): ParseResult {
  const s = normalizeProfileText(input);
  if (!s) return fail('請輸入斷面');
  let tag = '';
  let rest = '';
  for (const [re, t] of PREFIXES) {
    const m = s.match(re);
    if (m) {
      tag = t;
      rest = s.slice(m[0].length);
      break;
    }
  }
  if (!tag) return fail(`無法辨識斷面「${input}」`);
  rest = rest.replace(/^[-_.:]/, '');
  if (!/^\d+(\.\d+)?([X×*]\d+(\.\d+)?)*$/.test(rest)) return fail(`斷面尺寸格式錯誤「${input}」`);
  const n = rest.split(/[X×*]/).map(Number);
  if (n.some((v) => !(v > 0))) return fail(`斷面尺寸必須大於 0「${input}」`);
  const count = n.length;

  switch (tag) {
    case 'H':
    case 'BH': {
      const welded = tag === 'BH';
      if (count === 2 && !welded) {
        const found = catalogFind('H', { h: n[0], b: n[1] }, ['h', 'b']);
        if (found.length === 1) return ok(found[0]);
        if (found.length > 1) return fail(`H${n[0]}x${n[1]} 有多種規格，請輸入完整尺寸（如 H${n[0]}x${n[1]}x腹板x翼板）`);
        return fail(`型錄沒有 H${n[0]}x${n[1]}，請輸入完整尺寸`);
      }
      if (count !== 4 && count !== 5) return fail('H 型鋼格式：H 高x寬x腹板厚x翼板厚');
      const [h, b, tw, tf] = n;
      if (2 * tf >= h || tw >= b) return fail('H 型鋼尺寸不合理');
      if (welded) return ok(param('H', { h, b, tw, tf, r1: 0 }, FAMILY.BH, true));
      const cat = catalogByName(profileName('H', { h, b, tw, tf }));
      if (cat && count === 4) return ok(cat);
      return ok(param('H', { h, b, tw, tf, r1: count === 5 ? n[4] : 0 }, FAMILY.H));
    }
    case 'I': {
      if (count === 2) {
        const found = catalogFind('I', { h: n[0], b: n[1] }, ['h', 'b']);
        if (found.length === 1) return ok(found[0]);
        if (found.length > 1) return fail(`I${n[0]}x${n[1]} 有多種規格，請輸入完整尺寸`);
        return fail(`型錄沒有 I${n[0]}x${n[1]}`);
      }
      if (count !== 4) return fail('I 型鋼格式：I 高x寬x腹板厚x翼板厚');
      const [h, b, tw, tf] = n;
      return ok(catalogOr('I', { h, b, tw, tf }, FAMILY.I));
    }
    case 'C': {
      if (count === 4) {
        const [h, b, p3, p4] = n;
        // 熱軋槽鋼腹板必小於翼板厚；第 3 參數較大者為唇高 → 帶唇 C 型鋼
        if (p3 > p4) return ok(catalogOr('LC', { h, b, c: p3, t: p4 }, FAMILY.LC));
        return ok(catalogOr('C', { h, b, tw: p3, tf: p4 }, FAMILY.C));
      }
      if (count === 3) {
        const [h, b, t] = n;
        const hot = catalogFind('C', { h, b, tw: t }, ['h', 'b', 'tw']);
        if (hot.length >= 1) return ok(hot[0]);
        return ok(catalogOr('LCH', { h, b, t }, FAMILY.LCH));
      }
      if (count === 2) {
        const found = catalogFind('C', { h: n[0], b: n[1] }, ['h', 'b']);
        if (found.length === 1) return ok(found[0]);
        if (found.length > 1) return fail(`槽鋼 ${n[0]}x${n[1]} 有多種規格，請輸入完整尺寸`);
        return fail(`型錄沒有槽鋼 ${n[0]}x${n[1]}`);
      }
      return fail('槽鋼格式：[高x寬x腹板厚x翼板厚；C 型鋼：C 高x寬x唇高x厚');
    }
    case 'LC': {
      if (count !== 4) return fail('帶唇 C 型鋼格式：C 高x寬x唇高x厚');
      const [h, b, c, t] = n;
      return ok(catalogOr('LC', { h, b, c, t }, FAMILY.LC));
    }
    case 'Z': {
      if (count !== 4) return fail('Z 型鋼格式：Z 高x寬x唇高x厚');
      const [h, b, c, t] = n;
      return ok(catalogOr('Z', { h, b, c, t }, FAMILY.Z));
    }
    case 'L': {
      if (count !== 2 && count !== 3) return fail('角鋼格式：L 邊長x邊長x厚 或 L 邊長x厚');
      let a = n[0];
      let b = count === 2 ? n[0] : n[1];
      const t = n[count - 1];
      // 長邊放高度方向
      if (b > a) [a, b] = [b, a];
      if (t >= b) return fail('角鋼厚度不合理');
      const cat = catalogByName(profileName('L', { h: a, b, t }));
      if (cat) return ok(cat);
      return ok(param('L', { h: a, b, t, r1: 0, r2: 0 }, a === b ? FAMILY.L : FAMILY.LU));
    }
    case 'T': {
      if (count !== 4) return fail('T 型鋼格式：CT 高x寬x腹板厚x翼板厚');
      const [h, b, tw, tf] = n;
      return ok(catalogByName(profileName('T', { h, b, tw, tf })) ?? param('T', { h, b, tw, tf, r1: 0 }, FAMILY.T));
    }
    case 'BOX': {
      if (count !== 2 && count !== 3) return fail('方管格式：□高x寬x厚 或 □邊長x厚');
      const h = n[0];
      const b = count === 2 ? n[0] : n[1];
      const t = n[count - 1];
      if (4 * t >= Math.min(h, b)) return fail('方管厚度過大，焊接箱型請用 BOX 高x寬x厚');
      return ok(catalogOr('BOX', { h, b, t }, h === b ? FAMILY.SQ : FAMILY.RECT));
    }
    case 'WBOX': {
      if (count < 2 || count > 4) return fail('焊接箱型格式：BOX 高x寬x腹板厚x翼板厚');
      const h = n[0];
      const b = count === 2 ? n[0] : n[1];
      const tw = n[count === 2 ? 1 : 2];
      const tf = count === 4 ? n[3] : tw;
      if (2 * tw >= b || 2 * tf >= h) return fail('箱型厚度不合理');
      return ok(param('WBOX', { h, b, tw, tf }, FAMILY.WBOX));
    }
    case 'PIPE':
    case 'ROUND': {
      if (count === 2) {
        const [D, t] = n;
        if (2 * t >= D) return fail('圓管厚度不合理');
        return ok(catalogOr('PIPE', { h: D, b: D, t }, FAMILY.PIPE));
      }
      if (count === 1 && tag === 'ROUND') return ok(param('RB', { h: n[0], b: n[0] }, FAMILY.RB));
      return fail('圓管格式：φ外徑x厚；圓鋼：φ直徑');
    }
    case 'RB':
      if (count !== 1) return fail('圓鋼格式：RB 直徑');
      return ok(param('RB', { h: n[0], b: n[0] }, FAMILY.RB));
    case 'PL':
    case 'FB': {
      const family = tag === 'PL' ? FAMILY.PL : FAMILY.FB;
      if (count === 1 && tag === 'PL') {
        const p = param('PL', { h: 0, b: n[0], t: n[0] }, family);
        p.thicknessOnly = true;
        return ok(p);
      }
      if (count !== 2) return fail(tag === 'PL' ? '鋼板格式：PL 厚x寬 或 PL 厚' : '扁鋼格式：FB 寬x厚');
      const t = Math.min(n[0], n[1]);
      const w = Math.max(n[0], n[1]);
      // 斷面直立：高 = 寬度、寬 = 厚度
      return ok(param(tag as ProfileKind, { h: w, b: t, t }, family));
    }
  }
  return fail(`無法辨識斷面「${input}」`);
}

/** 單位重 kg/m */
export function unitWeight(p: Profile, density: number): number {
  return (p.area * density) / 1e6;
}
