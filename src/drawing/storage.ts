import { del, get, set } from 'idb-keyval';
import type { Drawing2D } from './types';

/** 圖紙幾何很大，與專案分開存在 IndexedDB（key: drawing:<id>），記憶體另有快取 */
const cache = new Map<string, Drawing2D>();
const key = (id: string) => `drawing:${id}`;

export async function putDrawing(id: string, d: Drawing2D): Promise<void> {
  cache.set(id, d);
  await set(key(id), d);
}

export function cachedDrawing(id: string): Drawing2D | undefined {
  return cache.get(id);
}

export async function getDrawing(id: string): Promise<Drawing2D | undefined> {
  const c = cache.get(id);
  if (c) return c;
  const d = await get<Drawing2D>(key(id));
  if (d) cache.set(id, d);
  return d;
}

export async function deleteDrawing(id: string): Promise<void> {
  cache.delete(id);
  await del(key(id));
}

// ---------- 專案檔（.sqp）內嵌 ----------

function toB64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export interface SerializedDrawing {
  meta: Omit<Drawing2D, 'segs' | 'circles' | 'raster'>;
  segs: string[];
  circles: string;
  raster?: { b64: string; type: string; x0: number; y0: number; x1: number; y1: number };
}

export async function serializeDrawing(d: Drawing2D): Promise<SerializedDrawing> {
  const { segs, circles, raster, ...meta } = d;
  return {
    meta,
    segs: segs.map((s) => toB64(new Uint8Array(s.buffer, s.byteOffset, s.byteLength))),
    circles: toB64(new Uint8Array(circles.buffer, circles.byteOffset, circles.byteLength)),
    raster: raster ? { b64: toB64(new Uint8Array(await raster.blob.arrayBuffer())), type: raster.blob.type, x0: raster.x0, y0: raster.y0, x1: raster.x1, y1: raster.y1 } : undefined,
  };
}

export function deserializeDrawing(s: SerializedDrawing): Drawing2D {
  const f32 = (b64: string) => {
    const b = fromB64(b64);
    return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  };
  return {
    ...s.meta,
    segs: s.segs.map(f32),
    circles: f32(s.circles),
    raster: s.raster ? { blob: new Blob([fromB64(s.raster.b64) as BlobPart], { type: s.raster.type }), x0: s.raster.x0, y0: s.raster.y0, x1: s.raster.x1, y1: s.raster.y1 } : undefined,
  };
}
