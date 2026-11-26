import { signal } from '@preact/signals';
import { isTyping } from '../view3d/viewer';

/**
 * 介面外框大小：左側專案瀏覽、右側屬性面板的寬度與收合，上方工具列（功能區）的縮放與收合。
 * 屬於每台電腦的個人偏好，存在瀏覽器 localStorage（不隨專案）。
 */
export interface ChromeState {
  left: number;
  right: number;
  leftOpen: boolean;
  rightOpen: boolean;
  /** 工具列內容縮放比例 */
  ribbonScale: number;
  ribbonOpen: boolean;
}

export const CHROME_DEFAULTS: ChromeState = { left: 230, right: 300, leftOpen: true, rightOpen: true, ribbonScale: 1, ribbonOpen: true };
export const LIMITS = {
  left: [160, 560] as const,
  right: [220, 640] as const,
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
    return {
      left: clamp(num(s.left, CHROME_DEFAULTS.left), LIMITS.left),
      right: clamp(num(s.right, CHROME_DEFAULTS.right), LIMITS.right),
      leftOpen: bool(s.leftOpen, true),
      rightOpen: bool(s.rightOpen, true),
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

/** 側欄最大寬度：視圖區至少保留 LIMITS.viewsMin */
export function maxPanelWidth(side: 'left' | 'right'): number {
  const c = chrome.peek();
  const other = side === 'left' ? (c.rightOpen ? c.right : 0) : c.leftOpen ? c.left : 0;
  return Math.max(LIMITS[side][0], Math.min(LIMITS[side][1], window.innerWidth - other - LIMITS.viewsMin - 12));
}

export function clampPanel(side: 'left' | 'right', w: number): number {
  return Math.min(maxPanelWidth(side), Math.max(LIMITS[side][0], w));
}

export function togglePanel(side: 'left' | 'right') {
  const k = side === 'left' ? 'leftOpen' : 'rightOpen';
  patchChrome({ [k]: !chrome.peek()[k] });
}

export function toggleRibbon() {
  patchChrome({ ribbonOpen: !chrome.peek().ribbonOpen });
}

export function resetChrome() {
  patchChrome({ ...CHROME_DEFAULTS });
}

/** T：左側欄、N：右側欄（同 Blender 的工具列／側欄快捷鍵） */
export function setupChromeKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e)) return;
    if (document.querySelector('.modal')) return;
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      togglePanel('left');
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      togglePanel('right');
    }
  });
}
