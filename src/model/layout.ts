/**
 * 視圖窗格版面（仿 Blender 的區域）：可任意分割、拖曳邊界調整大小、合併、關閉。
 * 以樹狀表示：葉節點是窗格，內部節點是同一方向排列的多個子節點（n 元，比例加總為 1）。
 * 正規化後，子節點不會與父節點同方向，所以「共用完整邊界的兩個窗格」一定是同一個父節點下相鄰的兩個子節點。
 */

export interface LayoutPane {
  t: 'pane';
  id: string;
  /** 顯示的視圖 id */
  view: string;
}

export interface LayoutSplit {
  t: 'split';
  id: string;
  /** row：左右排列；col：上下排列 */
  dir: 'row' | 'col';
  sizes: number[];
  children: LayoutNode[];
}

export type LayoutNode = LayoutPane | LayoutSplit;

let seq = 0;
export function layoutId(prefix: 'p' | 's'): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export const pane = (view: string, id = layoutId('p')): LayoutPane => ({ t: 'pane', id, view });

export function split(dir: 'row' | 'col', children: LayoutNode[], sizes?: number[]): LayoutSplit {
  return { t: 'split', id: layoutId('s'), dir, children, sizes: sizes ?? children.map(() => 1 / children.length) };
}

export function leaves(n: LayoutNode): LayoutPane[] {
  return n.t === 'pane' ? [n] : n.children.flatMap(leaves);
}

export function findPane(n: LayoutNode, id: string): LayoutPane | undefined {
  return leaves(n).find((p) => p.id === id);
}

/** 找出節點的父節點與索引 */
export function parentOf(root: LayoutNode, id: string): { parent: LayoutSplit; index: number } | null {
  if (root.t === 'pane') return null;
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i];
    if (c.id === id) return { parent: root, index: i };
    const r = parentOf(c, id);
    if (r) return r;
  }
  return null;
}

/** 合併同方向的巢狀分割、移除只有一個子節點的分割、比例歸一 */
export function normalize(n: LayoutNode): LayoutNode {
  if (n.t === 'pane') return n;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  n.children.forEach((c0, i) => {
    const c = normalize(c0);
    const s = n.sizes[i] ?? 0;
    if (c.t === 'split' && c.dir === n.dir) {
      c.children.forEach((cc, j) => {
        children.push(cc);
        sizes.push(s * c.sizes[j]);
      });
    } else {
      children.push(c);
      sizes.push(s);
    }
  });
  if (children.length === 1) return children[0];
  const sum = sizes.reduce((a, b) => a + b, 0) || 1;
  return { ...n, children, sizes: sizes.map((s) => s / sum) };
}

/** 以 fn 取代 id 節點（不可變更新） */
function replace(n: LayoutNode, id: string, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  if (n.id === id) return fn(n);
  if (n.t === 'pane') return n;
  let changed = false;
  const children = n.children.map((c) => {
    const r = replace(c, id, fn);
    if (r !== c) changed = true;
    return r;
  });
  return changed ? { ...n, children } : n;
}

/**
 * 分割窗格：dir 為新排列方向；ratio 是原窗格占原空間的比例；
 * newFirst 時新窗格放在左／上。回傳新樹與新窗格 id。
 */
export function splitPane(
  root: LayoutNode,
  id: string,
  dir: 'row' | 'col',
  view: string,
  ratio = 0.5,
  newFirst = false,
): { tree: LayoutNode; id: string } | null {
  const target = findPane(root, id);
  if (!target) return null;
  const r = Math.min(0.95, Math.max(0.05, ratio));
  const np = pane(view);
  const pi = parentOf(root, id);
  let tree: LayoutNode;
  if (pi && pi.parent.dir === dir) {
    // 同方向：直接插在旁邊，平分原窗格的大小
    const { parent, index } = pi;
    const s = parent.sizes[index];
    const children = [...parent.children];
    const sizes = [...parent.sizes];
    const mine = s * r;
    const theirs = s - mine;
    if (newFirst) {
      children.splice(index, 1, np, target);
      sizes.splice(index, 1, theirs, mine);
    } else {
      children.splice(index, 1, target, np);
      sizes.splice(index, 1, mine, theirs);
    }
    tree = replace(root, parent.id, () => ({ ...parent, children, sizes }));
  } else {
    tree = replace(root, id, (old) => (newFirst ? split(dir, [np, old], [1 - r, r]) : split(dir, [old, np], [r, 1 - r])));
  }
  return { tree: normalize(tree), id: np.id };
}

/** 關閉窗格：空間給相鄰的節點（前一個，沒有就後一個）。只剩一個窗格時回傳 null */
export function closePane(root: LayoutNode, id: string): LayoutNode | null {
  const pi = parentOf(root, id);
  if (!pi) return null;
  const { parent, index } = pi;
  const children = [...parent.children];
  const sizes = [...parent.sizes];
  const give = index > 0 ? index - 1 : index + 1;
  sizes[give] += sizes[index];
  children.splice(index, 1);
  sizes.splice(index, 1);
  return normalize(replace(root, parent.id, () => ({ ...parent, children, sizes })));
}

/** 兩個窗格是否共用完整邊界（可合併） */
export function canJoin(root: LayoutNode, keep: string, remove: string): boolean {
  const a = parentOf(root, keep);
  const b = parentOf(root, remove);
  return !!a && !!b && a.parent === b.parent && Math.abs(a.index - b.index) === 1 && a.parent.children[b.index].t === 'pane' && a.parent.children[a.index].t === 'pane';
}

/** 合併：keep 擴大蓋過 remove（Blender 從角落拖到相鄰區域） */
export function joinPanes(root: LayoutNode, keep: string, remove: string): LayoutNode | null {
  if (!canJoin(root, keep, remove)) return null;
  const { parent, index: ki } = parentOf(root, keep)!;
  const ri = parentOf(root, remove)!.index;
  const children = [...parent.children];
  const sizes = [...parent.sizes];
  sizes[ki] += sizes[ri];
  children.splice(ri, 1);
  sizes.splice(ri, 1);
  return normalize(replace(root, parent.id, () => ({ ...parent, children, sizes })));
}

/** 拖曳第 i 與 i+1 個子節點之間的邊界 */
export function resizeSplit(root: LayoutNode, splitId: string, i: number, sizesStart: number[], delta: number, minFrac: number): LayoutNode {
  return replace(root, splitId, (n) => {
    if (n.t !== 'split') return n;
    const a = sizesStart[i];
    const b = sizesStart[i + 1];
    const lo = Math.min(minFrac, (a + b) / 2);
    const na = Math.min(a + b - lo, Math.max(lo, a + delta));
    const sizes = [...sizesStart];
    sizes[i] = na;
    sizes[i + 1] = a + b - na;
    return { ...n, sizes };
  });
}

export function setPaneView(root: LayoutNode, id: string, view: string): LayoutNode {
  return replace(root, id, (n) => (n.t === 'pane' ? { ...n, view } : n));
}

/** 交換兩個窗格的視圖（Blender Ctrl＋拖曳角落） */
export function swapPanes(root: LayoutNode, a: string, b: string): LayoutNode {
  const pa = findPane(root, a);
  const pb = findPane(root, b);
  if (!pa || !pb) return root;
  return setPaneView(setPaneView(root, a, pb.view), b, pa.view);
}

/** 確認樹狀結構有效，視圖不存在的改成 fallback；無效時回傳 null */
export function sanitizeLayout(n: unknown, viewIds: Set<string>, fallback: string): LayoutNode | null {
  const ids = new Set<string>();
  const walk = (x: any): LayoutNode | null => {
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || ids.has(x.id)) return null;
    ids.add(x.id);
    if (x.t === 'pane') return { t: 'pane', id: x.id, view: viewIds.has(x.view) ? x.view : fallback };
    if (x.t !== 'split' || (x.dir !== 'row' && x.dir !== 'col') || !Array.isArray(x.children) || !x.children.length) return null;
    const children = x.children.map(walk);
    if (children.some((c: LayoutNode | null) => !c)) return null;
    const sizes = Array.isArray(x.sizes) && x.sizes.length === children.length && x.sizes.every((s: unknown) => typeof s === 'number' && s > 0) ? x.sizes : children.map(() => 1);
    return { t: 'split', id: x.id, dir: x.dir, children, sizes };
  };
  const r = walk(n);
  return r ? normalize(r) : null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 各窗格的相對位置（0–1），測試與判斷相鄰用 */
export function paneRects(n: LayoutNode, r: Rect = { x: 0, y: 0, w: 1, h: 1 }, out = new Map<string, Rect>()): Map<string, Rect> {
  if (n.t === 'pane') {
    out.set(n.id, r);
    return out;
  }
  let off = 0;
  n.children.forEach((c, i) => {
    const s = n.sizes[i];
    const cr = n.dir === 'row' ? { x: r.x + r.w * off, y: r.y, w: r.w * s, h: r.h } : { x: r.x, y: r.y + r.h * off, w: r.w, h: r.h * s };
    paneRects(c, cr, out);
    off += s;
  });
  return out;
}
