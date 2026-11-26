import { signal } from '@preact/signals';
import { flushSave } from '../model/persist';
import { importDrawingFlow } from './drawingFlows';
import { openProjectFile } from './projectFlows';
import { toast, ui } from './ui';

/** 安裝成應用程式（PWA）相關狀態 */
export const pwa = {
  /** 瀏覽器支援一鍵安裝（Chrome／Edge） */
  canInstall: signal(false),
  /** 目前是以應用程式視窗開啟 */
  standalone: signal(matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true),
  /** 新版本已下載，重新整理即可套用 */
  updateReady: signal(false),
};

let deferred: any = null;
let waiting: ServiceWorker | null = null;

/** 開啟檔案：.sqp 當專案、DWG/DXF/PDF 當圖紙 */
export async function openAnyFile(f: File) {
  if (/\.(sqp|json)$/i.test(f.name)) await openProjectFile(f);
  else if (/\.(dxf|dwg|pdf)$/i.test(f.name)) await importDrawingFlow(f);
  else toast('只支援 .sqp 專案檔，或 DWG、DXF、PDF 圖紙');
}

export async function installApp() {
  if (deferred) {
    deferred.prompt();
    const r = await deferred.userChoice.catch(() => null);
    deferred = null;
    pwa.canInstall.value = false;
    if (r?.outcome === 'accepted') toast('已安裝，之後可從 Dock、開始選單或桌面開啟');
    return;
  }
  ui.dialog.value = 'install';
}

export function applyUpdate() {
  flushSave();
  if (waiting) {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    waiting.postMessage('skipWaiting');
    // 保險：若沒觸發 controllerchange，稍後仍重新整理
    setTimeout(() => location.reload(), 1500);
  } else location.reload();
}

export function setupPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    pwa.canInstall.value = true;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    pwa.canInstall.value = false;
  });
  matchMedia('(display-mode: standalone)').addEventListener('change', (e) => (pwa.standalone.value = e.matches));

  // 從桌面以本程式開啟檔案（manifest 的 file_handlers，Chrome／Edge 安裝後）
  const lq = (window as any).launchQueue;
  if (lq?.setConsumer) {
    lq.setConsumer(async (params: { files?: FileSystemFileHandle[] }) => {
      const handles = params.files ?? [];
      if (!handles.length) return;
      const files = await Promise.all(handles.map((h) => h.getFile()));
      // 有專案檔先開專案，再匯入第一張圖紙
      const proj = files.find((f) => /\.sqp$/i.test(f.name));
      if (proj) await openProjectFile(proj);
      const dwg = files.find((f) => /\.(dxf|dwg|pdf)$/i.test(f.name));
      if (dwg) await importDrawingFlow(dwg);
    });
  }

  // 只在正式版註冊（開發模式下會干擾 Vite 熱更新）
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const watch = (w: ServiceWorker | null) => {
        if (!w) return;
        const check = () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = w;
            pwa.updateReady.value = true;
          }
        };
        check();
        w.addEventListener('statechange', check);
      };
      watch(reg.waiting);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      // 長時間開著的視窗每小時檢查一次新版
      setInterval(() => void reg.update().catch(() => {}), 3600_000);
    })
    .catch((e) => console.warn('離線功能註冊失敗', e));
}
