import { signal } from '@preact/signals';
import { MEMBER_TYPES, type ToolKey } from '../model/types';
import { isTyping } from '../view3d/viewer';
import { app } from './core';

/**
 * 浮動屬性視窗（仿 Tekla 的零件屬性對話框）：雙擊構件或工具按鈕才開，可拖到任何位置、調整大小，
 * Esc 關閉；位置與大小記在 chrome.prop，下次打開回到原處。
 * 內容依目前狀態：使用構件工具時顯示該工具的預設屬性，否則顯示選取的構件。
 */
export const propOpen = signal(false);
/** 目前分頁：零件屬性／位置。每次打開都從零件屬性開始 */
export const propTab = signal<'part' | 'pos'>('part');

export function openProps() {
  propTab.value = 'part';
  propOpen.value = true;
}

export function closeProps() {
  propOpen.value = false;
}

/** 雙擊工具按鈕：切到該工具並打開它的預設屬性 */
export function openToolProps(t: ToolKey) {
  app.controller?.setTool(t);
  openProps();
}

export const isMemberTool = (t: string): t is ToolKey => (MEMBER_TYPES as readonly string[]).includes(t);

/** Esc 關閉屬性視窗（優先於其他 Esc 行為）；N 開關屬性視窗 */
export function setupPropKeys() {
  // 捕獲階段：比工具的 Esc（中斷指令、取消選取）先處理
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !propOpen.peek()) return;
      if (document.querySelector('.modal')) return; // 斷面瀏覽器等對話框自己處理 Esc
      e.preventDefault();
      e.stopPropagation();
      propOpen.value = false;
      (document.activeElement as HTMLElement | null)?.blur?.();
    },
    true,
  );
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e)) return;
    if (document.querySelector('.modal')) return;
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      if (propOpen.peek()) closeProps();
      else openProps();
    }
  });
}
