import type { MemberQty } from './compute';

/**
 * 仿 Tekla Numbering：同前綴、同類型、同斷面、同材質、長度差在容差內者為同一編號。
 * 盡量保留既有編號：每一群沿用群內最多數的舊編號（若該編號還沒被別群用掉），
 * 其餘群依前綴接續最大號配新號。
 * 回傳 構件 id → 編號。
 */
export function computeNumbering(rows: MemberQty[], tolerance = 1): Map<string, string> {
  const valid = rows.filter((r) => !r.error);
  // 先依「非長度」鍵分組，再依長度排序後分群
  const groups = new Map<string, MemberQty[]>();
  for (const r of valid) {
    const k = [r.prefix, r.type, r.profile, r.material.toUpperCase(), r.shapeKey ?? ''].join('|');
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(r);
  }
  const clusters: MemberQty[][] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.length - b.length || a.id.localeCompare(b.id));
    let cur: MemberQty[] = [];
    let start = -Infinity;
    for (const r of g) {
      if (cur.length && r.length - start > tolerance) {
        clusters.push(cur);
        cur = [];
      }
      if (!cur.length) start = r.length;
      cur.push(r);
    }
    if (cur.length) clusters.push(cur);
  }

  const result = new Map<string, string>();
  const used = new Set<string>();
  // 大群優先保留舊編號
  const order = [...clusters].sort((a, b) => b.length - a.length);
  const pending: MemberQty[][] = [];
  for (const c of order) {
    const count = new Map<string, number>();
    for (const r of c) if (r.mark && markPrefix(r.mark) === r.prefix) count.set(r.mark, (count.get(r.mark) ?? 0) + 1);
    const best = [...count.entries()].filter(([m]) => !used.has(m)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best) {
      used.add(best[0]);
      for (const r of c) result.set(r.id, best[0]);
    } else pending.push(c);
  }

  // 新號：依前綴接續
  const maxNo = new Map<string, number>();
  for (const m of used) {
    const p = markPrefix(m);
    const n = markNumber(m);
    maxNo.set(p, Math.max(maxNo.get(p) ?? 0, n));
  }
  pending.sort((a, b) => {
    const x = a[0];
    const y = b[0];
    return x.prefix.localeCompare(y.prefix) || x.profile.localeCompare(y.profile, 'en', { numeric: true }) || y.length - x.length;
  });
  for (const c of pending) {
    const p = c[0].prefix;
    const n = (maxNo.get(p) ?? 0) + 1;
    maxNo.set(p, n);
    const mark = makeMark(p, n);
    used.add(mark);
    for (const r of c) result.set(r.id, mark);
  }
  return result;
}

export function makeMark(prefix: string, n: number): string {
  return /\d$/.test(prefix) ? `${prefix}-${n}` : `${prefix}${n}`;
}

export function markPrefix(mark: string): string {
  const m = mark.match(/^(.*?)-?(\d+)$/);
  return m ? m[1] : mark;
}

export function markNumber(mark: string): number {
  const m = mark.match(/(\d+)$/);
  return m ? Number(m[1]) : 0;
}
