import { decodeEscapes, stripMText } from './text';
import type { RawBlock, RawDoc, RawEntity, RawLayer, RawVertex } from './types';

type Pair = [number, string];

class Reader {
  i = 0;
  constructor(private lines: string[]) {}
  peek(): Pair | null {
    if (this.i + 1 >= this.lines.length) return null;
    return [parseInt(this.lines[this.i], 10), this.lines[this.i + 1]];
  }
  next(): Pair | null {
    const p = this.peek();
    if (p) this.i += 2;
    return p;
  }
}

/** 一個實體的全部群組碼 */
class Ent {
  constructor(
    public type: string,
    public pairs: Pair[],
  ) {}
  str(code: number, def = ''): string {
    for (const [c, v] of this.pairs) if (c === code) return v.trim();
    return def;
  }
  raw(code: number): string | undefined {
    for (const [c, v] of this.pairs) if (c === code) return v;
    return undefined;
  }
  num(code: number, def = 0): number {
    for (const [c, v] of this.pairs) {
      if (c === code) {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : def;
      }
    }
    return def;
  }
  has(code: number): boolean {
    return this.pairs.some(([c]) => c === code);
  }
  all(code: number): number[] {
    const out: number[] = [];
    for (const [c, v] of this.pairs) if (c === code) out.push(parseFloat(v));
    return out;
  }
  pts(cx: number, cy: number): [number, number][] {
    const xs = this.all(cx);
    const ys = this.all(cy);
    return xs.map((x, i) => [x, ys[i] ?? 0]);
  }
}

function readEntities(r: Reader, stop: string[]): Ent[] {
  const out: Ent[] = [];
  let cur: Ent | null = null;
  for (;;) {
    const p = r.peek();
    if (!p) break;
    const [code, value] = p;
    if (code === 0) {
      const v = value.trim();
      if (stop.includes(v)) break;
      r.next();
      cur = new Ent(v, []);
      out.push(cur);
      continue;
    }
    r.next();
    cur?.pairs.push([code, value.replace(/\r$/, '')]);
  }
  return out;
}

function common(e: Ent): Pick<RawEntity, 'layer' | 'linetype' | 'extZ' | 'paper' | 'invisible'> {
  return {
    layer: e.str(8, '0'),
    linetype: e.str(6) || undefined,
    extZ: e.has(230) ? e.num(230, 1) : undefined,
    paper: e.num(67) === 1,
    invisible: e.num(60) === 1,
  };
}

function textFrom(e: Ent, attrib: boolean): RawEntity {
  const p: [number, number] = [e.num(10), e.num(20)];
  const has2 = e.has(11);
  return {
    type: attrib ? 'ATTRIB' : 'TEXT',
    ...common(e),
    text: decodeEscapes(e.raw(1) ?? ''),
    p,
    p2: has2 ? [e.num(11), e.num(21)] : undefined,
    h: e.num(40, 1),
    rot: e.num(50),
    wf: e.num(41, 1) || 1,
    ha: e.num(72),
    va: e.num(attrib ? 74 : 73),
    invisible: attrib ? (e.num(70) & 1) === 1 : common(e).invisible,
  };
}

/** 把一個 DXF 實體轉成中間格式；不支援的回傳 null */
function convert(e: Ent): RawEntity | null {
  const c = common(e);
  switch (e.type) {
    case 'LINE':
      return { type: 'LINE', ...c, p: [e.num(10), e.num(20)], p2: [e.num(11), e.num(21)] };
    case 'LWPOLYLINE': {
      const pts: RawVertex[] = [];
      let v: RawVertex | null = null;
      for (const [code, val] of e.pairs) {
        if (code === 10) {
          v = { x: parseFloat(val), y: 0, b: 0 };
          pts.push(v);
        } else if (code === 20 && v) v.y = parseFloat(val);
        else if (code === 42 && v) v.b = parseFloat(val);
      }
      return { type: 'POLY', ...c, pts, closed: (e.num(70) & 1) === 1 };
    }
    case 'CIRCLE':
      return { type: 'CIRCLE', ...c, p: [e.num(10), e.num(20)], r: e.num(40) };
    case 'ARC':
      return { type: 'ARC', ...c, p: [e.num(10), e.num(20)], r: e.num(40), a0: e.num(50), a1: e.num(51) };
    case 'ELLIPSE':
      return {
        type: 'ELLIPSE',
        ...c,
        p: [e.num(10), e.num(20)],
        major: [e.num(11), e.num(21)],
        ratio: e.num(40, 1),
        t0: e.num(41, 0),
        t1: e.num(42, Math.PI * 2),
      };
    case 'SPLINE':
      return {
        type: 'SPLINE',
        ...c,
        degree: e.num(71, 3),
        knots: e.all(40),
        weights: e.all(41),
        ctrl: e.pts(10, 20),
        fit: e.pts(11, 21),
        closed: (e.num(70) & 1) === 1,
      };
    case 'TEXT':
      return textFrom(e, false);
    case 'MTEXT': {
      let raw = '';
      for (const [code, v] of e.pairs) if (code === 3) raw += v;
      raw += e.raw(1) ?? '';
      const dx = e.num(11, NaN);
      return {
        type: 'TEXT',
        ...c,
        mtext: true,
        text: stripMText(raw),
        p: [e.num(10), e.num(20)],
        h: e.num(40, 1),
        attach: e.num(71, 1),
        rot: e.has(50) ? (e.num(50) * 180) / Math.PI : 0,
        dir: Number.isFinite(dx) ? [dx, e.num(21)] : undefined,
        wf: 1,
      };
    }
    case 'INSERT':
      return {
        type: 'INSERT',
        ...c,
        name: e.str(2),
        p: [e.num(10), e.num(20)],
        sx: e.num(41, 1) || 1,
        sy: e.num(42, 1) || 1,
        rot: e.num(50),
        cols: Math.max(1, e.num(70, 1)),
        rows: Math.max(1, e.num(71, 1)),
        cs: e.num(44),
        rs: e.num(45),
        attribs: [],
      };
    case 'DIMENSION':
      return { type: 'DIMENSION', ...c, name: e.str(2), text: decodeEscapes(e.raw(1) ?? ''), p: [e.num(11), e.num(21)] };
    case 'SOLID':
    case 'TRACE':
    case '3DFACE':
      return {
        type: 'QUAD',
        ...c,
        p: [e.num(10), e.num(20)],
        p2: [e.num(11), e.num(21)],
        p3: [e.num(12), e.num(22)],
        p4: [e.num(13, e.num(12)), e.num(23, e.num(22))],
        closed: e.type === '3DFACE',
      };
    case 'LEADER': {
      const pts = e.pts(10, 20).map(([x, y]) => ({ x, y, b: 0 }));
      return { type: 'POLY', ...c, pts, closed: false };
    }
    default:
      return null;
  }
}

/** 實體串列（處理 POLYLINE/VERTEX/SEQEND 與 INSERT/ATTRIB/SEQEND 的串接） */
function collect(ents: Ent[], skipped: Record<string, number>): RawEntity[] {
  const out: RawEntity[] = [];
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.type === 'POLYLINE') {
      const pts: RawVertex[] = [];
      let j = i + 1;
      for (; j < ents.length && ents[j].type !== 'SEQEND'; j++) {
        const v = ents[j];
        if (v.type !== 'VERTEX') break;
        // 網格、多面網格的控制點不畫
        if (v.num(70) & 16) continue;
        pts.push({ x: v.num(10), y: v.num(20), b: v.num(42) });
      }
      i = ents[j]?.type === 'SEQEND' ? j : j - 1;
      const flags = e.num(70);
      if (flags & (16 | 64)) {
        skipped['POLYFACE'] = (skipped['POLYFACE'] ?? 0) + 1;
        continue;
      }
      out.push({ type: 'POLY', ...common(e), pts, closed: (flags & 1) === 1 });
      continue;
    }
    if (e.type === 'INSERT') {
      const ins = convert(e)!;
      if (e.num(66) === 1) {
        let j = i + 1;
        for (; j < ents.length && ents[j].type !== 'SEQEND'; j++) {
          if (ents[j].type === 'ATTRIB') ins.attribs!.push(textFrom(ents[j], true));
        }
        i = j;
      }
      out.push(ins);
      continue;
    }
    if (e.type === 'ATTDEF' || e.type === 'SEQEND' || e.type === 'VERTEX') continue;
    const r = convert(e);
    if (r) out.push(r);
    else skipped[e.type] = (skipped[e.type] ?? 0) + 1;
  }
  return out;
}

export interface DxfParseResult {
  doc: RawDoc;
  skipped: Record<string, number>;
}

/** 解析 ASCII DXF（已解碼成字串） */
export function parseDxf(text: string, encoding: string): DxfParseResult {
  if (text.startsWith('AutoCAD Binary DXF')) throw new Error('不支援二進位 DXF，請在 AutoCAD 另存為 ASCII DXF');
  const lines = text.split(/\r\n|\r|\n/);
  // 群組碼行去空白
  for (let i = 0; i < lines.length; i += 2) lines[i] = lines[i].trim();
  const r = new Reader(lines);
  const doc: RawDoc = { insunits: 0, encoding, layers: [], blocks: new Map(), entities: [] };
  const skipped: Record<string, number> = {};
  let sawSection = false;
  for (;;) {
    const p = r.next();
    if (!p) break;
    if (p[0] !== 0 || p[1].trim() !== 'SECTION') continue;
    sawSection = true;
    const name = r.next();
    const sec = name?.[1].trim();
    if (sec === 'HEADER') {
      for (;;) {
        const q = r.next();
        if (!q || (q[0] === 0 && q[1].trim() === 'ENDSEC')) break;
        if (q[0] === 9 && q[1].trim() === '$INSUNITS') {
          const v = r.next();
          if (v) doc.insunits = parseInt(v[1], 10) || 0;
        }
      }
    } else if (sec === 'TABLES') {
      for (;;) {
        const q = r.peek();
        if (!q) break;
        if (q[0] === 0 && q[1].trim() === 'ENDSEC') {
          r.next();
          break;
        }
        if (q[0] === 0 && q[1].trim() === 'TABLE') {
          r.next();
          const t = r.next();
          const tname = t?.[1].trim();
          const ents = readEntities(r, ['ENDTAB']);
          r.next(); // ENDTAB
          if (tname === 'LAYER') {
            for (const e of ents) {
              if (e.type !== 'LAYER') continue;
              const aci = e.num(62, 7);
              const flags = e.num(70);
              const layer: RawLayer = { name: e.str(2, '0'), aci, linetype: e.str(6, 'CONTINUOUS'), frozen: (flags & 1) === 1, off: aci < 0 };
              if (e.has(420)) layer.rgb = e.num(420);
              doc.layers.push(layer);
            }
          }
          continue;
        }
        r.next();
      }
    } else if (sec === 'BLOCKS') {
      const ents = readEntities(r, ['ENDSEC']);
      r.next();
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (e.type !== 'BLOCK') continue;
        let j = i + 1;
        while (j < ents.length && ents[j].type !== 'ENDBLK') j++;
        const name = e.str(2) || e.str(3);
        const block: RawBlock = { name, base: [e.num(10), e.num(20)], entities: collect(ents.slice(i + 1, j), skipped) };
        // 外部參考（xref）不展開
        if (!(e.num(70) & 4)) doc.blocks.set(name, block);
        i = j;
      }
    } else if (sec === 'ENTITIES') {
      const ents = readEntities(r, ['ENDSEC']);
      r.next();
      doc.entities = collect(ents, skipped).filter((e) => !e.paper);
    } else {
      // 其他區段略過
      for (;;) {
        const q = r.next();
        if (!q || (q[0] === 0 && q[1].trim() === 'ENDSEC')) break;
      }
    }
  }
  if (!sawSection) throw new Error('不是有效的 DXF 檔（找不到 SECTION）');
  return { doc, skipped };
}
