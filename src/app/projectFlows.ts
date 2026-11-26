import { newProject } from '../model/defaults';
import { syncViews } from '../model/ops';
import { blobToProject, loadLocal, pickFile, saveLocal, saveProjectFile } from '../model/persist';
import { sampleProject } from '../model/sample';
import { store } from '../model/store';
import type { Project } from '../model/types';
import { toast, ui } from './ui';

/** 載入專案並設定預設窗格（左：3D、右：第一個平面） */
export function openProject(p: Project) {
  if (!p.views.length) p.views = syncViews(p);
  const v3 = p.views.find((v) => v.kind === '3d');
  const sortedPlans = p.views.filter((v) => v.kind === 'plan');
  const plan2 = sortedPlans[1] ?? sortedPlans[0];
  const elev = p.views.filter((v) => v.kind === 'elevation');
  ui.paneViews.value = [v3?.id ?? p.views[0].id, plan2?.id ?? p.views[0].id, elev[0]?.id ?? p.views[0].id, elev[elev.length - 1]?.id ?? p.views[0].id];
  ui.activePane.value = 0;
  store.load(p);
  void saveLocal(p);
}

export function newProjectFlow() {
  const name = prompt('新專案名稱', '新專案');
  if (name === null) return;
  openProject(newProject(name.trim() || '新專案'));
  toast('已建立新專案：預設 3×2 跨軸線與 3 個高程，可在「鋼構 → 軸線／高程」修改');
}

export function loadSampleFlow() {
  openProject(sampleProject());
  toast('已載入範例專案');
}

export async function openFileFlow() {
  const f = await pickFile('.sqp,.json,application/json');
  if (f) await openProjectFile(f);
}

/** 開啟專案檔（選檔、拖放、或從桌面以本程式開啟 .sqp） */
export async function openProjectFile(f: File) {
  try {
    const p = await blobToProject(f);
    openProject(p);
    toast(`已開啟 ${f.name}`);
  } catch (e) {
    alert(`無法開啟：${(e as Error).message}`);
  }
}

export async function saveFileFlow() {
  try {
    await saveProjectFile(store.p);
  } catch (e) {
    alert(`儲存失敗：${(e as Error).message}`);
  }
}

export async function openLocalFlow(id: string) {
  const p = await loadLocal(id);
  if (!p) {
    toast('找不到這個專案');
    return;
  }
  openProject(p);
}
