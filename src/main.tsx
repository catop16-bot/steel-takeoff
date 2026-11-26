import { render } from 'preact';
import './styles.css';
import { App } from './app/App';
import { app } from './app/core';
import { openProject, saveFileFlow } from './app/projectFlows';
import { setupPwa } from './app/pwa';
import { ui } from './app/ui';
import { lastProjectId, loadLocal, startAutosave } from './model/persist';
import { store } from './model/store';
import { sampleProject } from './model/sample';
import { Controller } from './tools/tools';
import { Viewer } from './view3d/viewer';

async function boot() {
  const viewer = new Viewer();
  app.viewer = viewer;
  app.controller = new Controller(viewer);
  startAutosave((s) => (ui.saveState.value = s));

  // 先載入專案再畫介面，避免窗格先綁到空專案
  let p = null;
  try {
    const id = await lastProjectId();
    if (id) p = await loadLocal(id);
  } catch (e) {
    console.warn('讀取瀏覽器內的專案失敗', e);
  }
  openProject(p ?? sampleProject());

  render(<App />, document.getElementById('app')!);
  setupPwa();

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      void saveFileFlow();
    }
  });
  window.addEventListener('beforeunload', () => {
    // 自動存檔有 0.8 秒延遲；離開前不另外阻擋
  });
  // 開發用：測試腳本透過這裡取得與介面相同的模組實例
  if (import.meta.env.DEV) {
    (window as any).__app = {
      app,
      ui,
      store,
      drawingFlows: await import('./app/drawingFlows'),
      recognizeFlows: await import('./app/recognizeFlows'),
      projectFlows: await import('./app/projectFlows'),
      defaults: await import('./model/defaults'),
      ops: await import('./model/ops'),
    };
  }
}

void boot();
