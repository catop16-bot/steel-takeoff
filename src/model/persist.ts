import { del, get, set } from 'idb-keyval';
import { deserializeDrawing, getDrawing, putDrawing, serializeDrawing, type SerializedDrawing } from '../drawing/storage';
import { migrateProject } from './defaults';
import { store } from './store';
import type { Project } from './types';

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  members: number;
}

const LIST_KEY = 'projects';
const LAST_KEY = 'lastProject';
const key = (id: string) => `project:${id}`;

export async function listProjects(): Promise<ProjectMeta[]> {
  return ((await get<ProjectMeta[]>(LIST_KEY)) ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveLocal(p: Project): Promise<void> {
  await set(key(p.id), p);
  const list = await listProjects();
  const meta: ProjectMeta = { id: p.id, name: p.name, updatedAt: p.updatedAt, members: p.members.length };
  const i = list.findIndex((m) => m.id === p.id);
  if (i >= 0) list[i] = meta;
  else list.push(meta);
  await set(LIST_KEY, list);
  await set(LAST_KEY, p.id);
}

export async function loadLocal(id: string): Promise<Project | undefined> {
  const raw = await get(key(id));
  return raw ? migrateProject(raw) : undefined;
}

export async function deleteLocal(id: string): Promise<void> {
  await del(key(id));
  const list = (await listProjects()).filter((m) => m.id !== id);
  await set(LIST_KEY, list);
}

export async function lastProjectId(): Promise<string | undefined> {
  return get<string>(LAST_KEY);
}

let timer: ReturnType<typeof setTimeout> | undefined;
export const saveState = { pending: false, error: '' };

let pendingProject: Project | null = null;

/** 立即寫入尚未存檔的修改（離開頁面、切到背景時） */
export function flushSave() {
  if (!pendingProject) return;
  clearTimeout(timer);
  const p = pendingProject;
  pendingProject = null;
  void saveLocal(p);
}

/** 每次修改後 0.8 秒自動存到瀏覽器；離開頁面時立即存 */
export function startAutosave(onState?: (s: 'saving' | 'saved' | 'error', msg?: string) => void) {
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  store.subscribe((_c, p) => {
    clearTimeout(timer);
    saveState.pending = true;
    pendingProject = p;
    timer = setTimeout(async () => {
      pendingProject = null;
      onState?.('saving');
      try {
        await saveLocal(p);
        saveState.pending = false;
        onState?.('saved');
      } catch (e) {
        saveState.error = String(e);
        onState?.('error', String(e));
      }
    }, 800);
  });
}

// ---- 專案檔（.sqp = gzip 壓縮的 JSON） ----

export async function projectToBlob(p: Project): Promise<Blob> {
  // 圖紙幾何另存在 IndexedDB，存檔時一併嵌入
  const drawingData: Record<string, SerializedDrawing> = {};
  for (const d of p.drawings) {
    const data = await getDrawing(d.id);
    if (data) drawingData[d.id] = await serializeDrawing(data);
  }
  const json = JSON.stringify({ ...p, drawingData });
  const stream = new Blob([json], { type: 'application/json' }).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export async function blobToProject(file: Blob): Promise<Project> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  let text: string;
  if (head[0] === 0x1f && head[1] === 0x8b) {
    text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else {
    text = await file.text();
  }
  const raw = JSON.parse(text);
  const data: Record<string, SerializedDrawing> = raw.drawingData ?? {};
  delete raw.drawingData;
  for (const [id, sd] of Object.entries(data)) await putDrawing(id, deserializeDrawing(sd));
  return migrateProject(raw);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || '專案';
}

export async function saveProjectFile(p: Project) {
  const blob = await projectToBlob(p);
  const name = `${safeFileName(p.name)}.sqp`;
  const w = window as any;
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: '鋼構算量專案', accept: { 'application/octet-stream': ['.sqp'] } }],
      });
      const ws = await handle.createWritable();
      await ws.write(blob);
      await ws.close();
      return;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
    }
  }
  downloadBlob(blob, name);
}

export function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0]);
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}
