import { decodeEscapes, stripMText } from './text';
import type { P2, RawBlock, RawDoc, RawEntity } from './types';

const DEG = 180 / Math.PI;

type Any = Record<string, any>;

const pt = (p: Any | undefined): P2 => [Number(p?.x) || 0, Number(p?.y) || 0];

function common(e: Any): Pick<RawEntity, 'layer' | 'linetype' | 'extZ' | 'invisible'> {
  const z = e.extrusionDirection?.z;
  return {
    layer: e.layer || '0',
    linetype: e.lineType || undefined,
    extZ: typeof z === 'number' ? z : undefined,
    invisible: e.isVisible === false,
  };
}

function textBase(t: Any, c: ReturnType<typeof common>, type: 'TEXT' | 'ATTRIB'): RawEntity {
  return {
    type,
    ...c,
    text: decodeEscapes(String(t.text ?? '')),
    p: pt(t.startPoint),
    p2: t.endPoint ? pt(t.endPoint) : undefined,
    h: Number(t.textHeight) || 1,
    rot: (Number(t.rotation) || 0) * DEG,
    wf: Number(t.xScale) || 1,
    ha: Number(t.halign) || 0,
    va: Number(t.valign) || 0,
  };
}

/** LibreDWG 的 DwgEntity → 中間格式 */
function convert(e: Any, skipped: Record<string, number>): RawEntity | null {
  const c = common(e);
  switch (e.type) {
    case 'LINE':
      return { type: 'LINE', ...c, p: pt(e.startPoint), p2: pt(e.endPoint) };
    case 'LWPOLYLINE':
      return {
        type: 'POLY',
        ...c,
        // DWG 的 LWPOLYLINE 旗標 512 = 封閉
        closed: ((Number(e.flag) || 0) & 512) !== 0,
        pts: (e.vertices ?? []).map((v: Any) => ({ x: Number(v.x) || 0, y: Number(v.y) || 0, b: Number(v.bulge) || 0 })),
      };
    case 'POLYLINE2D':
    case 'POLYLINE3D': {
      const flag = Number(e.flag) || 0;
      if (flag & (16 | 64)) {
        skipped.POLYFACE = (skipped.POLYFACE ?? 0) + 1;
        return null;
      }
      return {
        type: 'POLY',
        ...c,
        closed: (flag & 1) !== 0,
        pts: (e.vertices ?? []).filter((v: Any) => !((Number(v.flag) || 0) & 16)).map((v: Any) => ({ x: Number(v.x) || 0, y: Number(v.y) || 0, b: Number(v.bulge) || 0 })),
      };
    }
    case 'CIRCLE':
      return { type: 'CIRCLE', ...c, p: pt(e.center), r: Number(e.radius) || 0 };
    case 'ARC':
      return { type: 'ARC', ...c, p: pt(e.center), r: Number(e.radius) || 0, a0: (Number(e.startAngle) || 0) * DEG, a1: (Number(e.endAngle) || 0) * DEG };
    case 'ELLIPSE':
      return { type: 'ELLIPSE', ...c, p: pt(e.center), major: pt(e.majorAxisEndPoint), ratio: Number(e.axisRatio) || 1, t0: Number(e.startAngle) || 0, t1: Number(e.endAngle) || Math.PI * 2 };
    case 'SPLINE':
      return {
        type: 'SPLINE',
        ...c,
        degree: Number(e.degree) || 3,
        knots: e.knots ?? [],
        weights: e.weights ?? [],
        ctrl: (e.controlPoints ?? []).map(pt),
        fit: (e.fitPoints ?? []).map(pt),
        closed: ((Number(e.flag) || 0) & 1) !== 0,
      };
    case 'TEXT':
      return textBase(e, c, 'TEXT');
    case 'MTEXT': {
      const d = e.direction;
      const hasDir = d && (Math.abs(Number(d.x)) > 1e-9 || Math.abs(Number(d.y)) > 1e-9);
      return {
        type: 'TEXT',
        ...c,
        mtext: true,
        text: stripMText(String(e.text ?? '')),
        p: pt(e.insertionPoint),
        h: Number(e.textHeight) || 1,
        attach: Number(e.attachmentPoint) || 1,
        rot: (Number(e.rotation) || 0) * DEG,
        dir: hasDir ? [Number(d.x), Number(d.y)] : undefined,
      };
    }
    case 'INSERT':
      return {
        type: 'INSERT',
        ...c,
        name: e.name,
        p: pt(e.insertionPoint),
        sx: Number(e.xScale) || 1,
        sy: Number(e.yScale) || 1,
        rot: (Number(e.rotation) || 0) * DEG,
        cols: Math.max(1, Number(e.columnCount) || 1),
        rows: Math.max(1, Number(e.rowCount) || 1),
        cs: Number(e.columnSpacing) || 0,
        rs: Number(e.rowSpacing) || 0,
        attribs: (e.attribs ?? []).map((a: Any) => ({ ...textBase(a.text ?? {}, common(a), 'ATTRIB'), invisible: ((Number(a.flags) || 0) & 1) !== 0 })),
      };
    case 'DIMENSION':
      return { type: 'DIMENSION', ...c, name: e.name, text: decodeEscapes(String(e.text ?? '')), p: pt(e.textPoint) };
    case 'SOLID':
    case 'TRACE':
      return { type: 'QUAD', ...c, p: pt(e.corner1), p2: pt(e.corner2), p3: pt(e.corner3), p4: pt(e.corner4 ?? e.corner3) };
    case '3DFACE':
      return { type: 'QUAD', ...c, closed: true, p: pt(e.corner1), p2: pt(e.corner2), p3: pt(e.corner3), p4: pt(e.corner4 ?? e.corner3) };
    case 'LEADER':
      return { type: 'POLY', ...c, closed: false, pts: (e.vertices ?? []).map((v: Any) => ({ x: Number(v.x) || 0, y: Number(v.y) || 0, b: 0 })) };
    default:
      skipped[e.type] = (skipped[e.type] ?? 0) + 1;
      return null;
  }
}

function list(ents: Any[], skipped: Record<string, number>): RawEntity[] {
  const out: RawEntity[] = [];
  for (const e of ents ?? []) {
    if (e.isInPaperSpace) continue;
    const r = convert(e, skipped);
    if (r) out.push(r);
  }
  return out;
}

/** LibreDWG DwgDatabase → 中間格式 */
export function dwgToRaw(db: Any): { doc: RawDoc; skipped: Record<string, number> } {
  const skipped: Record<string, number> = {};
  const blocks = new Map<string, RawBlock>();
  for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) {
    const name = String(b.name ?? '');
    if (!name || /^\*(Model|Paper)_Space/i.test(name)) continue;
    blocks.set(name, { name, base: pt(b.basePoint), entities: list(b.entities ?? [], skipped) });
  }
  const layers = (db.tables?.LAYER?.entries ?? []).map((l: Any) => ({
    name: String(l.name ?? '0'),
    aci: Number(l.colorIndex) || 7,
    rgb: typeof l.color === 'number' && l.color > 0 && !l.colorIndex ? l.color : undefined,
    linetype: String(l.lineType ?? 'CONTINUOUS'),
    frozen: !!l.frozen,
    off: !!l.off || Number(l.colorIndex) < 0,
  }));
  return {
    doc: { insunits: Number(db.header?.INSUNITS) || 0, encoding: String(db.header?.DWGCODEPAGE ?? ''), layers, blocks, entities: list(db.entities ?? [], skipped) },
    skipped,
  };
}
