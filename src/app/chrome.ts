import { signal } from '@preact/signals';
import { isTyping } from '../view3d/viewer';

/**
 * 介面外框大小：左側專案瀏覽的寬度與收合、浮動屬性視窗的位置與大小、上方工具列（功能區）的縮放與收合。
 * 屬於每台電腦的個人偏好，存在瀏覽器 localStorage（不隨專案）。
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChromeState {
  left: number;
  leftOpen: boolean;
  /** 屬性視窗上次的位置與大小；null＝還沒開過，用預設位置 */
  prop: Rect | null;
  /** 工具列內容縮放比例 */
  ribbonScale: number;
  ribbonOpen: boolean;
}

export const CHROME_DEFAULTS: ChromeState = { left: 230, leftOpen: true, prop: null, ribbonScale: 1, ribbonOpen: true };
export const LIMITS = {
  left: [160, 560] as const,
  /** 屬性視窗最小寬高 */
  propMin: [260, 200] as const,
  ribbonScale: [0.75, 1.35] as const,
  /** 拖到比這更窄就收合 */
  collapseBelow: 110,
  /** 視圖區至少保留的寬度 */
  viewsMin: 320,
};

const KEY = 'steel-takeoff:chrome';
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

function load(): ChromeState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!s || typeof s !== 'object') return { ...CHROME_DEFAULTS };
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
    const r = s.prop;
    const prop = r && typeof r === 'object' && [r.x, r.y, r.w, r.h].every((v) => typeof v === 'number' && Number.isFinite(v)) ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
    return {
      left: clamp(num(s.left, CHROME_DEFAULTS.left), LIMITS.left),
      leftOpen: bool(s.leftOpen, true),
      prop,
      ribbonScale: clamp(num(s.ribbonScale, 1), LIMITS.ribbonScale),
      ribbonOpen: bool(s.ribbonOpen, true),
    };
  } catch {
    return { ...CHROME_DEFAULTS };
  }
}

export const chrome = signal<ChromeState>(load());

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(chrome.peek()));
    } catch {
      // 私密瀏覽等情況存不了就算了，下次用預設值
    }
  }, 300);
}

/** 更新外框大小；拖曳中 persist=false，放開時再存 */
export function patchChrome(p: Partial<ChromeState>, persist = true) {
  chrome.value = { ...chrome.peek(), ...p };
  if (persist) save();
}

export const saveChrome = save;

/** 左側欄寬度限制：視圖區至少保留 LIMITS.viewsMin */
export function clampLeft(w: number): number {
  const max = Math.max(LIMITS.left[0], Math.min(LIMITS.left[1], window.innerWidth - LIMITS.viewsMin - 12));
  return Math.min(max, Math.max(LIMITS.left[0], w));
}

export function toggleLeft() {
  patchChrome({ leftOpen: !chrome.peek().leftOpen });
}

/** 屬性視窗位置：上次的位置（拉回視窗範圍內），沒有就放在右上 */
export function propRect(): Rect {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const r = chrome.peek().prop ?? { x: W - 336, y: 130, w: 320, h: Math.min(640, H - 170) };
  const w = Math.min(Math.max(r.w, LIMITS.propMin[0]), W - 16);
  const h = Math.min(Math.max(r.h, LIMITS.propMin[1]), H - 16);
  // 至少留標題列在畫面內，才拖得回來
  const x = Math.min(Math.max(r.x, 8 - w + 120), W - 120);
  const y = Math.min(Math.max(r.y, 0), H - 40);
  return { x, y, w, h };
}

export function toggleRibbon() {
  patchChrome({ ribbonOpen: !chrome.peek().ribbonOpen });
}

export function resetChrome() {
  patchChrome({ ...CHROME_DEFAULTS });
}

/** T：左側欄（同 Blender 的工具列快捷鍵）；N（屬性視窗）在 propWindow.ts */
export function setupChromeKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e)) return;
    if (document.querySelector('.modal')) return;
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      toggleLeft();
    }
  });
}
