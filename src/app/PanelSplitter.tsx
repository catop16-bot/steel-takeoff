import { chrome, clampLeft, LIMITS, patchChrome, saveChrome } from './chrome';

/**
 * 左側專案瀏覽與視圖區之間的邊界：拖曳調整寬度，拖到很窄就收合；
 * 收合後變成一條細邊，點一下或往外拖就展開。雙擊切換收合。
 */
export function PanelSplitter() {
  const c = chrome.value;
  const open = c.leftOpen;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const x0 = e.clientX;
    const st = chrome.peek();
    const startOpen = st.leftOpen;
    const startW = startOpen ? st.left : 0;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 3) moved = true;
      if (!moved) return;
      const w = startW + dx;
      // 收合時記住拖曳前的寬度，下次展開回到原本大小
      if (w < LIMITS.collapseBelow) patchChrome({ leftOpen: false, left: startOpen ? startW : st.left }, false);
      else patchChrome({ leftOpen: true, left: clampLeft(w) }, false);
    };
    const end = (ev: PointerEvent) => {
      el.classList.remove('drag');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      // 收合狀態下單純點一下 = 展開
      if (!moved && !startOpen && ev.type === 'pointerup') patchChrome({ leftOpen: true, left: clampLeft(st.left) }, false);
      saveChrome();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };
  return (
    <div
      class={`panel-split left${open ? '' : ' closed'}`}
      title={open ? '拖曳調整專案瀏覽寬度・拖到最窄或雙擊收合（T）' : '展開專案瀏覽（T）：點一下或往外拖'}
      onPointerDown={onDown}
      onDblClick={() => open && patchChrome({ leftOpen: false })}
    >
      {!open && <span class="chev">›</span>}
    </div>
  );
}
