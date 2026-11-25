import type { DrawText } from '../drawing/types';

export interface LevelCandidate {
  name: string;
  elevation: number;
  /** 來源文字 */
  source: string;
}

/** 樓層名稱：1F、2FL、B1F、RF、RFL、R1F、PRF、GL、屋頂… */
const NAME = String.raw`(?:B\d{1,2}F?L?|\d{1,3}F(?:L)?|R\d?F(?:L)?|RFL|RF|PRF|PH\d?F?|M\d?F|GL|屋頂層?|屋突\d*層?)`;
const NAME_ONLY = new RegExp(`^${NAME}$`, 'i');
/** 高程值：+4.200、-3.5、±0.000、4200、EL+4200、FL+4.2、▽+12.500 */
const ELEV = String.raw`(?:▽|▼|EL\.?|FL|SL|TOS|GL)?\s*([+\-±﹢－]?)\s*(\d+(?:\.\d+)?)`;
const ELEV_ONLY = new RegExp(`^${ELEV}$`, 'i');
const COMBINED = new RegExp(`(${NAME})[^\\d+\\-±﹢－]{0,8}${ELEV}`, 'i');

/** 解析高程數值為 mm：有小數點或小於 300 視為公尺 */
export function parseElevation(sign: string, num: string): number | null {
  const v = Number(num);
  if (!Number.isFinite(v)) return null;
  const neg = sign === '-' || sign === '－';
  const m = num.includes('.') || v < 300;
  const mm = m ? v * 1000 : v;
  if (mm > 1_000_000) return null;
  return Math.round((neg ? -mm : mm) * 10) / 10;
}

function normName(n: string): string {
  return n.replace(/\s+/g, '').toUpperCase().replace(/屋頂層?/, 'RFL');
}

/**
 * 從圖面文字辨識樓層與高程。
 * 1. 同一段文字含名稱與高程（「2FL +4.200」「RFL(▽+8.40)」）
 * 2. 名稱與高程分開但在同一水平線上相鄰（立面圖、剖面圖常見）
 */
export function detectLevels(texts: Pick<DrawText, 's' | 'x' | 'y' | 'h'>[]): LevelCandidate[] {
  const found = new Map<string, LevelCandidate>();
  const add = (name: string, elevation: number, source: string) => {
    const k = normName(name);
    if (!found.has(k)) found.set(k, { name: k, elevation, source });
  };
  const names: { s: string; x: number; y: number; h: number }[] = [];
  const elevs: { v: number; s: string; x: number; y: number; h: number }[] = [];
  for (const t of texts) {
    const s = t.s.normalize('NFKC').trim();
    if (!s) continue;
    const c = s.match(COMBINED);
    if (c) {
      const v = parseElevation(c[2], c[3]);
      if (v !== null) {
        add(c[1], v, s);
        continue;
      }
    }
    if (NAME_ONLY.test(s)) names.push({ s, x: t.x, y: t.y, h: t.h });
    else {
      const e = s.match(ELEV_ONLY);
      // 純數字至少要有正負號或小數點，避免誤抓尺寸標註
      if (e && (e[1] || e[2].includes('.') || /^(▽|▼|EL|FL|SL|TOS|GL)/i.test(s))) {
        const v = parseElevation(e[1], e[2]);
        if (v !== null) elevs.push({ v, s, x: t.x, y: t.y, h: t.h });
      }
    }
  }
  // 名稱配最近、同一水平線（或正下方）的高程
  const used = new Set<number>();
  for (const n of names) {
    let best = -1;
    let bd = Infinity;
    elevs.forEach((e, i) => {
      if (used.has(i)) return;
      const h = Math.max(n.h, e.h, 1e-6);
      const dy = Math.abs(e.y - n.y);
      const dx = Math.abs(e.x - n.x);
      const sameRow = dy < h * 1.5 && dx < h * 40;
      const below = e.y < n.y && n.y - e.y < h * 3 && dx < h * 6;
      if (!sameRow && !below) return;
      const d = dx + dy * 4;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0) {
      used.add(best);
      add(n.s, elevs[best].v, `${n.s} ${elevs[best].s}`);
    }
  }
  return [...found.values()].sort((a, b) => a.elevation - b.elevation);
}
