import { parseProfile } from '../catalog/parse';
import type { DrawText } from '../drawing/types';

/** 構件編號：G1、B2a、SB1、FG3、2G1、C1、BR1、RG2… */
export const MARK_RE = /^\d?[A-Z]{1,3}\d{1,3}[A-Za-z']?$/;

export interface ScheduleEntry {
  mark: string;
  profile: string;
  /** 由編號字首推測 */
  type: 'column' | 'girder' | 'beam' | 'brace' | 'purlin' | '';
}

export function markType(mark: string): ScheduleEntry['type'] {
  const m = mark.toUpperCase().match(/^\d?([A-Z]+)/);
  const p = m?.[1] ?? '';
  if (/^(C|SC|BC|TC|PC)$/.test(p)) return 'column';
  if (/^(G|FG|RG|WG|TG|CG|SG)$/.test(p)) return 'girder';
  if (/^(B|SB|RB|FB|CB|TB|BB|J)$/.test(p)) return 'beam';
  if (/^(BR|V|VB|HB|BRC|X)$/.test(p)) return 'brace';
  if (/^(P|PU|SP|GT)$/.test(p)) return 'purlin';
  return '';
}

function tokens(s: string): string[] {
  return s
    .normalize('NFKC')
    .replace(/[，,、；;：:()（）]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function isMark(t: string): boolean {
  return MARK_RE.test(t.toUpperCase()) && !parseProfile(t).ok;
}

function asProfile(t: string): string | null {
  // 「H588x300x12x20」或被拆開的「H588 x 300 x 12 x 20」先在外面合併
  const r = parseProfile(t);
  return r.ok && !r.profile.thicknessOnly ? r.profile.name : null;
}

/**
 * 從框選範圍內的文字抽出「編號 → 斷面」。
 * 支援：同一段文字「G1 H588x300x12x20」、同一列左右排列、上下對齊（表頭一列編號、下一列斷面）。
 */
export function extractSchedule(texts: Pick<DrawText, 's' | 'x' | 'y' | 'h'>[]): { entries: ScheduleEntry[]; conflicts: string[] } {
  const map = new Map<string, string>();
  const conflicts: string[] = [];
  const put = (mark: string, profile: string) => {
    const k = mark.toUpperCase();
    const old = map.get(k);
    if (old && old !== profile) conflicts.push(`${k}：${old}／${profile}`);
    if (!old) map.set(k, profile);
  };
  type Tok = { s: string; x: number; y: number; h: number; kind: 'mark' | 'profile'; profile?: string; idx: number };
  const toks: Tok[] = [];
  texts.forEach((t, ti) => {
    // 把「H588 x 300 x 12 x 20」這類被空白拆開的尺寸接回來
    const raw = t.s
      .normalize('NFKC')
      .replace(/\s*([x×*X])\s*(?=\d)/g, 'x')
      .replace(/(^|\s)(BH|H|I|C|L|CT|PL|FB|RB|BOX|PIPE|□|口|φ|Φ|\[|∠)\s*-?\s+(?=\d)/gi, '$1$2');
    const ts = tokens(raw);
    let lastMark: string | null = null;
    ts.forEach((w, k) => {
      const p = asProfile(w);
      if (p) {
        if (lastMark) {
          put(lastMark, p);
          lastMark = null;
        } else toks.push({ s: w, x: t.x + k * t.h, y: t.y, h: t.h, kind: 'profile', profile: p, idx: ti });
      } else if (isMark(w)) {
        if (lastMark) toks.push({ s: lastMark, x: t.x, y: t.y, h: t.h, kind: 'mark', idx: ti });
        lastMark = w.toUpperCase();
      }
    });
    if (lastMark) toks.push({ s: lastMark, x: t.x, y: t.y, h: t.h, kind: 'mark', idx: ti });
  });
  const marks = toks.filter((t) => t.kind === 'mark' && !map.has(t.s));
  const profs = toks.filter((t) => t.kind === 'profile');
  const usedP = new Set<Tok>();
  // 同一列：編號右邊最近的斷面
  for (const m of marks) {
    let best: Tok | null = null;
    let bd = Infinity;
    for (const p of profs) {
      if (usedP.has(p)) continue;
      const h = Math.max(m.h, p.h);
      if (Math.abs(p.y - m.y) > h * 0.8) continue;
      const dx = p.x - m.x;
      if (dx <= 0 || dx > h * 60) continue;
      if (dx < bd) {
        bd = dx;
        best = p;
      }
    }
    if (best) {
      usedP.add(best);
      put(m.s, best.profile!);
    }
  }
  // 上下對齊：編號正下方的斷面
  for (const m of marks) {
    if (map.has(m.s)) continue;
    let best: Tok | null = null;
    let bd = Infinity;
    for (const p of profs) {
      if (usedP.has(p)) continue;
      const h = Math.max(m.h, p.h);
      const dy = m.y - p.y;
      if (dy <= 0 || dy > h * 12) continue;
      if (Math.abs(p.x - m.x) > h * 6) continue;
      const d = dy + Math.abs(p.x - m.x);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) {
      usedP.add(best);
      put(m.s, best.profile!);
    }
  }
  const entries = [...map.entries()]
    .map(([mark, profile]) => ({ mark, profile, type: markType(mark) }))
    .sort((a, b) => a.mark.localeCompare(b.mark, 'en', { numeric: true }));
  return { entries, conflicts };
}
