import { signal } from '@preact/signals';
import type { V3 } from '../geom/vec';
import type { MemberType, ToolKey } from '../model/types';
import type { DisplayMode } from '../view3d/members';

export type Layout = 1 | 2 | 4;
export type ToolId = 'select' | ToolKey | 'measure' | 'align' | 'pick' | 'box' | 'move' | 'copy' | 'mirror' | 'rotate' | 'split';

export interface SnapSettings {
  end: boolean;
  mid: boolean;
  grid: boolean;
  line: boolean;
  free: boolean;
  drawing: boolean;
}

export const ui = {
  layout: signal<Layout>(2),
  /** 每個窗格顯示的視圖 id */
  paneViews: signal<string[]>([]),
  activePane: signal(0),
  tool: signal<ToolId>('select'),
  prompt: signal('選取構件，或從上方功能區選擇工具'),
  cursor: signal<V3 | null>(null),
  snapKind: signal(''),
  snaps: signal<SnapSettings>({ end: true, mid: true, grid: true, line: true, free: true, drawing: true }),
  /** 兩點對位時是否一併調整比例 */
  alignScale: signal(false),
  ortho: signal(false),
  displayMode: signal<DisplayMode>('solid'),
  /** 數值輸入（選第一點後直接打數字） */
  numeric: signal(''),
  trackpad: signal(false),
  saveState: signal<'saved' | 'saving' | 'error' | ''>(''),
  toast: signal(''),
  dialog: signal<string>(''),
  /** 顯示構件標註（編號或斷面） */
  labels: signal<'none' | 'mark' | 'profile'>('none'),
  showStart: signal(true),
  /** 選取篩選：可被選取的構件類型 */
  selectable: signal<ReadonlySet<MemberType>>(new Set(['column', 'girder', 'beam', 'brace', 'purlin', 'plate'])),
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, ms = 2600) {
  ui.toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast.value = ''), ms);
}
