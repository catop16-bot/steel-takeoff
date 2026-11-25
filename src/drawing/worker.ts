/// <reference lib="webworker" />
import { dwgToRaw } from './dwg';
import { parseDxf } from './dxf';
import { flatten } from './flatten';
import { decodeDxf } from './text';
import type { Drawing2D } from './types';

export interface ParseRequest {
  id: number;
  kind: 'dxf' | 'dwg';
  bytes: ArrayBuffer;
  encoding: string;
}

export type ParseResponse = { id: number; ok: true; drawing: Drawing2D } | { id: number; ok: false; error: string };

let libPromise: Promise<any> | null = null;

async function parseDwg(bytes: ArrayBuffer): Promise<Drawing2D> {
  if (!libPromise) {
    libPromise = (async () => {
      const m = await import('@mlightcad/libredwg-web');
      // wasm 由打包工具依 new URL(…, import.meta.url) 一併輸出
      return { lib: await m.LibreDwg.create(), Type: m.Dwg_File_Type };
    })();
  }
  const { lib, Type } = await libPromise;
  const head = new TextDecoder('latin1').decode(new Uint8Array(bytes, 0, 6));
  if (!head.startsWith('AC10') && !head.startsWith('AC1.')) throw new Error('不是 DWG 檔（檔頭不符）');
  if (head < 'AC1012') throw new Error(`DWG 版本太舊（${head}），請先在 AutoCAD 另存為 2000 以後的版本`);
  const ptr = lib.dwg_read_data(bytes, Type.DWG);
  if (!ptr) throw new Error('DWG 讀取失敗');
  try {
    const db = lib.convert(ptr);
    const { doc, skipped } = dwgToRaw(db);
    if (!doc.entities.length && !doc.blocks.size) throw new Error('DWG 讀不到任何物件（檔案可能損毀或版本不支援）');
    return flatten(doc, 'dwg', skipped);
  } finally {
    lib.dwg_free(ptr);
  }
}

self.onmessage = async (ev: MessageEvent<ParseRequest>) => {
  const { id, kind, bytes, encoding } = ev.data;
  try {
    let d: Drawing2D;
    if (kind === 'dxf') {
      const { text, encoding: enc } = decodeDxf(new Uint8Array(bytes), encoding);
      const { doc, skipped } = parseDxf(text, enc);
      d = flatten(doc, 'dxf', skipped);
    } else {
      d = await parseDwg(bytes);
    }
    const transfer = [...d.segs.map((s) => s.buffer), d.circles.buffer] as ArrayBuffer[];
    (self as unknown as Worker).postMessage({ id, ok: true, drawing: d } satisfies ParseResponse, transfer);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (e as Error).message || String(e) } satisfies ParseResponse);
  }
};
