import { chrome, clampPanel, LIMITS, patchChrome, saveChrome } from './chrome';

/**
 * 側欄與視圖區之間的邊界：拖曳調整寬度，拖到很窄就收合；
 * 收合後變成一條細邊，點一下或往外拖就展開。雙擊切換收合。
 */
export function PanelSplitter(props: { side: 'left' | 'right' }) {
  const side = props.side;
  const c = chrome.value;
  const open = side === 'left' ? c.leftOpen : c.rightOpen;
  const openKey = side === 'left' ? 'leftOpen' : 'rightOpen';
  const key = side === 'left' ? 'T' : 'N';
  const name = side === 'left' ? '專案瀏覽' : '屬性面板';
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const x0 = e.clientX;
    const st = chrome.peek();
    const startOpen = side === 'left' ? st.leftOpen : st.rightOpen;
    const startW = startOpen ? st[side] : 0;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = side === 'left' ? ev.clientX - x0 : x0 - ev.clientX;
      if (Math.abs(dx) > 3) moved = true;
      if (!moved) return;
      const w = startW + dx;
      // 收合時記住拖曳前的寬度，下次展開回到原本大小
      if (w < LIMITS.collapseBelow) patchChrome({ [openKey]: false, [side]: startOpen ? startW : st[side] }, false);
      else patchChrome({ [openKey]: true, [side]: clampPanel(side, w) }, false);
    };
    const end = (ev: PointerEvent) => {
      el.classList.remove('drag');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      // 收合狀態下單純點一下 = 展開
      if (!moved && !startOpen && ev.type === 'pointerup') patchChrome({ [openKey]: true, [side]: clampPanel(side, st[side]) }, false);
      saveChrome();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };
  return (
    <div
      class={`panel-split ${side}${open ? '' : ' closed'}`}
      title={open ? `拖曳調整${name}寬度・拖到最窄或雙擊收合（${key}）` : `展開${name}（${key}）：點一下或往外拖`}
      onPointerDown={onDown}
      onDblClick={() => open && patchChrome({ [openKey]: false })}
    >
      {!open && <span class="chev">{side === 'left' ? '›' : '‹'}</span>}
    </div>
  );
}
