import type { Drawing2D } from './types';
import type { ParseRequest, ParseResponse } from './worker';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (d: Drawing2D) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<ParseResponse>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.drawing);
      else p.reject(new Error(ev.data.error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || '解析執行緒錯誤'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** 在背景執行緒解析 DXF／DWG */
export function parseCad(kind: 'dxf' | 'dwg', bytes: ArrayBuffer, encoding = 'auto'): Promise<Drawing2D> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: ParseRequest = { id, kind, bytes, encoding };
    getWorker().postMessage(req, [bytes]);
  });
}
