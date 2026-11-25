import type { Controller } from '../tools/tools';
import type { Viewer } from '../view3d/viewer';

/** 掛載後才建立的單例 */
export const app: { viewer: Viewer | null; controller: Controller | null } = {
  viewer: null,
  controller: null,
};

export function fmtNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
