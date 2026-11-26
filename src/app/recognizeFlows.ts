import { signal } from '@preact/signals';
import { activeViewId } from './panes';
import * as THREE from 'three';
import { parseProfile } from '../catalog/parse';
import { localToPlane, planeToWorld, targetFrame } from '../drawing/placement';
import { cachedDrawing, getDrawing } from '../drawing/storage';
import type { Drawing2D } from '../drawing/types';
import { buildAxes, gridNodes, gridToWorld } from '../geom/grid';
import { dist, round3, type V3 } from '../geom/vec';
import { makeGrid, newMember, uid } from '../model/defaults';
import { commitLevels, syncViews, viewChanges } from '../model/ops';
import { store, type Change } from '../model/store';
import type { DrawingRef, Grid, Level, Member, MemberType, ScheduleRow } from '../model/types';
import { detectGrid, type GridDetection } from '../recognize/grids';
import { segmentsOf } from '../recognize/lines';
import { detectLevels, type LevelCandidate } from '../recognize/levels';
import { detectBeams, detectColumns, type GridRef, type MemberCandidate, type PlaneText } from '../recognize/members';
import { extractSchedule, markType, type ScheduleEntry } from '../recognize/schedule';
import { COLORS } from '../view3d/colors';
import { app } from './core';
import { toast } from './ui';

export const BEAM_LAYER_RE = /BEAM|BM|梁|樑|GIRDER|FRAME|S-B|STEEL|STL/i;
export const COL_LAYER_RE = /COL|柱|S-C/i;

export type RecogState =
  | { kind: 'grid'; drawingId: string; det: GridDetection | null }
  | { kind: 'levels'; cands: (LevelCandidate & { use: boolean })[] }
  | { kind: 'schedule'; entries: ScheduleEntry[]; conflicts: string[]; fromBox: boolean }
  | {
      kind: 'members';
      drawingId: string;
      beamLayers: string[];
      colLayers: string[];
      mode: 'auto' | 'double' | 'single';
      bottomLevelId: string;
      result: MemberCandidate[] | null;
      info: string;
    }
  | { kind: 'batch' };

export const recog = signal<RecogState | null>(null);

// ---------- 共用 ----------

export function planDrawings(): DrawingRef[] {
  return store.p.drawings.filter((d) => d.target.kind === 'plan');
}

/** 預設圖紙：目前窗格平面視圖同樓層的圖紙，否則第一張平面圖 */
export function defaultPlanDrawing(): DrawingRef | undefined {
  const p = store.p;
  const vid = activeViewId();
  const v = p.views.find((x) => x.id === vid);
  const list = planDrawings();
  if (v?.kind === 'plan') {
    const d = list.find((x) => x.target.kind === 'plan' && x.target.levelId === v.levelId && x.visible);
    if (d) return d;
  }
  return list.find((d) => d.visible) ?? list[0];
}

async function dataOf(id: string): Promise<Drawing2D | undefined> {
  return cachedDrawing(id) ?? (await getDrawing(id));
}

function levelOfDrawing(ref: DrawingRef): Level | undefined {
  return ref.target.kind === 'plan' ? store.p.levels.find((l) => l.id === (ref.target as { levelId: string }).levelId) : undefined;
}

// ---------- 軸線 ----------

export async function recognizeGridFlow(drawingId?: string) {
  const ref = drawingId ? store.p.drawings.find((d) => d.id === drawingId) : defaultPlanDrawing();
  if (!ref) {
    toast('請先匯入一張平面圖（圖紙 → 匯入圖紙）');
    return;
  }
  const d = await dataOf(ref.id);
  if (!d) return;
  recog.value = { kind: 'grid', drawingId: ref.id, det: detectGrid(d, ref.scale) };
}

/**
 * 套用辨識出的軸線。
 * moveDrawing：把圖紙旋轉、平移，使第一個軸線交點落在原點、軸線與 X 軸平行（建議）；
 * 否則保持圖紙位置，把軸線原點與角度設成圖上的位置。
 */
export function applyGridDetection(drawingId: string, det: GridDetection, target: string, moveDrawing: boolean) {
  const p = store.p;
  const ref = p.drawings.find((d) => d.id === drawingId);
  const data = cachedDrawing(drawingId);
  if (!ref || !data) return;
  const xs = buildAxes(det.xText, det.xLabels, '1');
  const ys = buildAxes(det.yText, det.yLabels, 'A');
  if (typeof xs === 'string' || typeof ys === 'string') {
    toast('軸線資料錯誤');
    return;
  }
  const old = p.grids.find((g) => g.id === target);
  const grid: Grid = old ? { ...old } : makeGrid(det.xText, det.yText, det.xLabels, det.yLabels, `軸線 ${p.grids.length + 1}`);
  Object.assign(grid, { xs, ys, xText: det.xText, yText: det.yText, xLabels: det.xLabels, yLabels: det.yLabels });
  const changes: Change[] = [];
  if (moveDrawing) {
    grid.origin = [0, 0, 0];
    grid.rotation = 0;
    const rot = -det.angle;
    const a = (rot * Math.PI) / 180;
    const [ox, oy] = det.origin;
    const offset: [number, number] = [-(ox * Math.cos(a) - oy * Math.sin(a)), -(ox * Math.sin(a) + oy * Math.cos(a))];
    changes.push({ coll: 'drawings', id: ref.id, before: ref, after: { ...ref, rotation: Math.round(rot * 1e6) / 1e6, offset: [Math.round(offset[0] * 100) / 100, Math.round(offset[1] * 100) / 100] } });
  } else {
    const [u, v] = localToPlane(ref, data.base, det.origin[0] / ref.scale - data.base[0], det.origin[1] / ref.scale - data.base[1]);
    grid.origin = [Math.round(u * 100) / 100, Math.round(v * 100) / 100, 0];
    grid.rotation = Math.round((det.angle + ref.rotation) * 1e6) / 1e6;
  }
  const grids = old ? p.grids.map((g) => (g.id === grid.id ? grid : g)) : [...p.grids, grid];
  changes.push({ coll: 'grids', id: grid.id, before: old, after: grid });
  changes.push(...viewChanges(p.views, syncViews({ ...p, grids })));
  store.commit('辨識軸線', changes);
  recog.value = null;
  toast(`已${old ? '更新' : '建立'}軸線：X ${xs.length} 條、Y ${ys.length} 條`);
  setTimeout(() => app.viewer?.fitAll(), 50);
}

// ---------- 高程 ----------

export async function recognizeLevelsFlow() {
  const all: LevelCandidate[] = [];
  for (const ref of store.p.drawings) {
    const d = await dataOf(ref.id);
    if (!d) continue;
    for (const c of detectLevels(d.texts)) if (!all.some((x) => x.name === c.name)) all.push(c);
  }
  if (!all.length) {
    toast('圖紙中找不到樓層高程標註（如「2FL +4.200」「RFL ▽+8.40」）');
    return;
  }
  recog.value = { kind: 'levels', cands: all.sort((a, b) => a.elevation - b.elevation).map((c) => ({ ...c, use: true })) };
}

export function applyLevels(cands: (LevelCandidate & { use: boolean })[]) {
  const p = store.p;
  const levels: Level[] = p.levels.map((l) => ({ ...l }));
  let added = 0;
  let updated = 0;
  for (const c of cands) {
    if (!c.use) continue;
    const ex = levels.find((l) => l.name.toUpperCase() === c.name.toUpperCase());
    if (ex) {
      if (ex.elevation !== c.elevation) {
        ex.elevation = c.elevation;
        updated++;
      }
    } else {
      levels.push({ id: uid('l'), name: c.name, elevation: c.elevation });
      added++;
    }
  }
  commitLevels(levels, '辨識高程');
  recog.value = null;
  toast(`高程：新增 ${added} 層、更新 ${updated} 層`);
}

// ---------- 斷面表 ----------

export function startScheduleBox() {
  app.controller?.startBox('框選圖紙上的構件表（斷面表）範圍：按住左鍵拖曳', (pane, x0, y0, x1, y1) => {
    const viewer = app.viewer!;
    const vs = pane.vs!;
    const texts: { s: string; x: number; y: number; h: number }[] = [];
    for (const it of viewer.drawings.snappable(vs)) {
      if (!it.data) continue;
      const f = it.frame!;
      const corners: [number, number][] = [];
      for (const [px, py] of [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]) {
        const hit = vs.rayPlane(vs.ray(px, py), { origin: f.origin, normal: f.normal, right: f.right, up: f.up });
        if (!hit) continue;
        corners.push(viewer.drawings.toLocal(it, hit));
      }
      if (corners.length < 4) continue;
      const inside = (x: number, y: number) => {
        let c = false;
        for (let i = 0, j = 3; i < 4; j = i++) {
          const [xi, yi] = corners[i];
          const [xj, yj] = corners[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
        }
        return c;
      };
      for (const t of it.data.texts) if (inside(t.x, t.y)) texts.push({ s: t.s, x: t.x, y: t.y, h: t.h });
    }
    if (!texts.length) {
      toast('框選範圍內沒有圖紙文字');
      return;
    }
    const r = extractSchedule(texts);
    recog.value = { kind: 'schedule', entries: r.entries, conflicts: r.conflicts, fromBox: true };
  });
}

export function openScheduleTable() {
  recog.value = { kind: 'schedule', entries: store.p.schedule.map((r) => ({ mark: r.mark, profile: r.profile, type: r.type as ScheduleEntry['type'] })), conflicts: [], fromBox: false };
}

export function applySchedule(entries: ScheduleEntry[], replace: boolean) {
  const p = store.p;
  const rows: ScheduleRow[] = replace ? [] : p.schedule.map((r) => ({ ...r }));
  for (const e of entries) {
    if (!e.mark.trim()) continue;
    const prof = parseProfile(e.profile);
    const row: ScheduleRow = { mark: e.mark.trim().toUpperCase(), profile: prof.ok ? prof.profile.name : e.profile.trim(), type: e.type || markType(e.mark) };
    const i = rows.findIndex((r) => r.mark === row.mark);
    if (i >= 0) rows[i] = row;
    else rows.push(row);
  }
  rows.sort((a, b) => a.mark.localeCompare(b.mark, 'en', { numeric: true }));
  store.setRoot('schedule', rows, '更新斷面對照表');
  recog.value = null;
  toast(`斷面對照表共 ${rows.length} 筆`);
}

// ---------- 梁柱 ----------

export async function openMembersRecog(drawingId?: string) {
  const ref = drawingId ? store.p.drawings.find((d) => d.id === drawingId) : defaultPlanDrawing();
  if (!ref) {
    toast('請先匯入平面圖，並放在對應的樓層平面');
    return;
  }
  const d = await dataOf(ref.id);
  if (!d) return;
  const lv = levelOfDrawing(ref);
  const sorted = [...store.p.levels].sort((a, b) => a.elevation - b.elevation);
  const below = lv ? [...sorted].reverse().find((l) => l.elevation < lv.elevation) : undefined;
  recog.value = {
    kind: 'members',
    drawingId: ref.id,
    beamLayers: d.layers.filter((l) => BEAM_LAYER_RE.test(l.name) && !COL_LAYER_RE.test(l.name)).map((l) => l.name),
    colLayers: d.layers.filter((l) => COL_LAYER_RE.test(l.name)).map((l) => l.name),
    mode: 'auto',
    bottomLevelId: below?.id ?? '',
    result: null,
    info: '',
  };
}

/** 平面上的軸線（給辨識用） */
function gridRefFor(): GridRef {
  const lines: GridRef['lines'] = [];
  const nodes: [number, number][] = [];
  for (const g of store.p.grids) {
    const r = (g.rotation * Math.PI) / 180;
    const ax = r + Math.PI / 2;
    for (const x of g.xs) {
      const p0 = gridToWorld(g, x.offset, 0);
      lines.push({ angle: ((ax % Math.PI) + Math.PI) % Math.PI, c: -Math.sin(ax) * p0[0] + Math.cos(ax) * p0[1] });
    }
    for (const y of g.ys) {
      const p0 = gridToWorld(g, 0, y.offset);
      lines.push({ angle: ((r % Math.PI) + Math.PI) % Math.PI, c: -Math.sin(r) * p0[0] + Math.cos(r) * p0[1] });
    }
    for (const n of gridNodes(g)) nodes.push([n.p[0], n.p[1]]);
  }
  return { lines, nodes };
}

function existing(type: MemberType, a: V3, b: V3): boolean {
  return store.p.members.some((m) => (m.type === type || (type !== 'column' && m.type !== 'column')) && ((dist(m.start, a) < 50 && dist(m.end, b) < 50) || (dist(m.start, b) < 50 && dist(m.end, a) < 50)));
}

export function candidateEnds(c: MemberCandidate, ref: DrawingRef, bottomLevelId: string): [V3, V3] | null {
  const f = targetFrame(ref.target, store.p);
  if (!f) return null;
  const a = planeToWorld(f, c.a[0], c.a[1]);
  const b = planeToWorld(f, c.b[0], c.b[1]);
  if (c.type === 'column') {
    const bot = store.p.levels.find((l) => l.id === bottomLevelId);
    if (!bot) return null;
    return [round3([a[0], a[1], bot.elevation]), round3([a[0], a[1], a[2]])];
  }
  return [round3(a), round3(b)];
}

export async function runMembersRecog() {
  const st = recog.peek();
  if (st?.kind !== 'members') return;
  const ref = store.p.drawings.find((d) => d.id === st.drawingId);
  const d = ref && (await dataOf(ref.id));
  if (!ref || !d) return;
  const toPlane = (x: number, y: number) => localToPlane(ref, d.base, x, y);
  const idx = (names: string[]) => new Set(d.layers.map((l, i) => (names.includes(l.name) ? i : -1)).filter((i) => i >= 0));
  const bl = idx(st.beamLayers);
  const cl = idx(st.colLayers);
  const texts: PlaneText[] = d.texts.map((t) => {
    const [x, y] = toPlane(t.x, t.y);
    return { s: t.s, x, y, h: t.h * ref.scale };
  });
  const schedule = new Map(store.p.schedule.map((r) => [r.mark, r.profile]));
  const grid = gridRefFor();
  const beams = bl.size ? detectBeams(segmentsOf(d, toPlane, (li) => bl.has(li)), texts, grid, schedule, { mode: st.mode }) : { list: [], mode: 'double' as const };
  const cols = detectColumns(segmentsOf(d, toPlane, (li) => cl.has(li)), texts, grid, schedule);
  const list = [...beams.list, ...cols];
  for (const c of list) {
    const ends = candidateEnds(c, ref, st.bottomLevelId);
    if (ends && existing(c.type, ends[0], ends[1])) {
      c.status = 'exists';
      c.checked = false;
    }
  }
  recog.value = { ...st, result: list, info: `梁 ${beams.list.length} 支（${beams.mode === 'double' ? '雙線' : '單線'}）、柱 ${cols.length} 支` };
  previewCandidates();
}

export function previewCandidates() {
  const st = recog.peek();
  const c = app.controller;
  if (!c) return;
  if (st?.kind !== 'members' || !st.result) {
    c.clearPreview();
    return;
  }
  const ref = store.p.drawings.find((d) => d.id === st.drawingId);
  if (!ref) return;
  const groups: Record<string, number[]> = { ok: [], warn: [], off: [] };
  for (const m of st.result) {
    const ends = candidateEnds(m, ref, st.bottomLevelId);
    if (!ends) continue;
    const k = !m.checked ? 'off' : m.profile && parseProfile(m.profile).ok ? 'ok' : 'warn';
    groups[k].push(...ends[0], ...ends[1]);
  }
  const color: Record<string, string> = { ok: COLORS.preview, warn: COLORS.error, off: '#9aa3ad' };
  c.setPreview(
    Object.entries(groups)
      .filter(([, arr]) => arr.length)
      .map(([k, arr]) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: color[k], depthTest: false, transparent: true }));
        l.renderOrder = 30;
        l.frustumCulled = false;
        return l;
      }),
  );
}

export function createCandidates() {
  const st = recog.peek();
  if (st?.kind !== 'members' || !st.result) return;
  const ref = store.p.drawings.find((d) => d.id === st.drawingId);
  if (!ref) return;
  const p = store.p;
  const lv = levelOfDrawing(ref);
  const ms: Member[] = [];
  let skipped = 0;
  for (const c of st.result) {
    if (!c.checked) continue;
    const prof = parseProfile(c.profile);
    if (!prof.ok) {
      skipped++;
      continue;
    }
    const ends = candidateEnds(c, ref, st.bottomLevelId);
    if (!ends) {
      skipped++;
      continue;
    }
    const d = p.settings.defaults[c.type];
    const extra: Partial<Member> =
      c.type === 'column'
        ? { levelId: st.bottomLevelId, startRef: { levelId: st.bottomLevelId }, endRef: { levelId: lv?.id } }
        : { levelId: lv?.id, startRef: { levelId: lv?.id }, endRef: { levelId: lv?.id } };
    ms.push(newMember(c.type, { ...d, profile: prof.profile.name }, ends[0], ends[1], { ...extra, note: c.note }));
  }
  if (!ms.length) {
    toast('沒有可建立的構件（請勾選並確認斷面）');
    return;
  }
  store.add('members', ms, `依圖面建立 ${ms.length} 支構件`);
  recog.value = null;
  app.controller?.clearPreview();
  toast(`已建立 ${ms.length} 支構件${skipped ? `，略過 ${skipped} 支（斷面不明）` : ''}`, 5000);
}

// ---------- 一鍵佈梁柱 ----------

export interface BatchOptions {
  gridId: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  columns: boolean;
  colProfile: string;
  colFrom: string;
  colTo: string;
  beamX: boolean;
  beamXProfile: string;
  beamY: boolean;
  beamYProfile: string;
  beamLevels: string[];
}

/** 柱放在範圍內所有交點（每層一支）；大梁沿軸線在交點間分跨 */
export function batchPlace(o: BatchOptions): number {
  const p = store.p;
  const g = p.grids.find((x) => x.id === o.gridId);
  if (!g) return 0;
  const sorted = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  const xs = g.xs.slice(Math.min(o.x0, o.x1), Math.max(o.x0, o.x1) + 1);
  const ys = g.ys.slice(Math.min(o.y0, o.y1), Math.max(o.y0, o.y1) + 1);
  const ms: Member[] = [];
  const d = p.settings.defaults;
  const add = (type: MemberType, profile: string, a: V3, b: V3, extra: Partial<Member>) => {
    if (existing(type, a, b)) return;
    ms.push(newMember(type, { ...d[type], profile }, round3(a), round3(b), extra));
  };
  if (o.columns) {
    const i0 = sorted.findIndex((l) => l.id === o.colFrom);
    const i1 = sorted.findIndex((l) => l.id === o.colTo);
    for (let i = Math.min(i0, i1); i >= 0 && i < Math.max(i0, i1); i++) {
      const lb = sorted[i];
      const lt = sorted[i + 1];
      for (const x of xs) for (const y of ys) add('column', o.colProfile, gridToWorld(g, x.offset, y.offset, lb.elevation), gridToWorld(g, x.offset, y.offset, lt.elevation), { levelId: lb.id, startRef: { levelId: lb.id }, endRef: { levelId: lt.id } });
    }
  }
  for (const lid of o.beamLevels) {
    const l = p.levels.find((x) => x.id === lid);
    if (!l) continue;
    const ex = { levelId: l.id, startRef: { levelId: l.id }, endRef: { levelId: l.id } };
    if (o.beamX) for (const y of ys) for (let i = 0; i < xs.length - 1; i++) add('girder', o.beamXProfile, gridToWorld(g, xs[i].offset, y.offset, l.elevation), gridToWorld(g, xs[i + 1].offset, y.offset, l.elevation), ex);
    if (o.beamY) for (const x of xs) for (let j = 0; j < ys.length - 1; j++) add('girder', o.beamYProfile, gridToWorld(g, x.offset, ys[j].offset, l.elevation), gridToWorld(g, x.offset, ys[j + 1].offset, l.elevation), ex);
  }
  if (ms.length) store.add('members', ms, `一鍵佈梁柱 ${ms.length} 支`);
  return ms.length;
}
