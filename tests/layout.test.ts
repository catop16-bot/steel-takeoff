import { describe, expect, it } from 'vitest';
import {
  canJoin,
  closePane,
  joinPanes,
  leaves,
  normalize,
  pane,
  paneRects,
  resizeSplit,
  sanitizeLayout,
  split,
  splitPane,
  swapPanes,
  type LayoutNode,
  type LayoutSplit,
} from '../src/model/layout';

const views = (t: LayoutNode) => leaves(t).map((p) => p.view);
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe('版面樹', () => {
  it('同方向分割插在旁邊、不另外巢狀', () => {
    const a = pane('3d');
    let t: LayoutNode = a;
    const r1 = splitPane(t, a.id, 'row', 'plan1')!;
    t = r1.tree;
    expect(t.t).toBe('split');
    const r2 = splitPane(t, r1.id, 'row', 'plan2')!;
    t = r2.tree;
    const s = t as LayoutSplit;
    expect(s.children.length).toBe(3);
    expect(views(t)).toEqual(['3d', 'plan1', 'plan2']);
    expect(s.sizes.map((x) => +x.toFixed(3))).toEqual([0.5, 0.25, 0.25]);
  });

  it('不同方向分割變成巢狀，newFirst 放在前面，ratio 是原窗格保留的比例', () => {
    const a = pane('3d');
    const r = splitPane(split('row', [a, pane('p')]), a.id, 'col', 'e', 0.7, true)!;
    const rects = paneRects(r.tree);
    const ra = rects.get(a.id)!;
    const rn = rects.get(r.id)!;
    expect(close(rn.y, 0) && close(rn.h, 0.3)).toBe(true);
    expect(close(ra.y, 0.3) && close(ra.h, 0.7)).toBe(true);
    expect(close(ra.w, 0.5)).toBe(true);
  });

  it('關閉窗格：空間給相鄰窗格，只剩一個時不能關', () => {
    const a = pane('a');
    const b = pane('b');
    const c = pane('c');
    const t = split('row', [a, b, c], [0.2, 0.3, 0.5]);
    const t2 = closePane(t, b.id)! as LayoutSplit;
    expect(views(t2)).toEqual(['a', 'c']);
    expect(t2.sizes.map((x) => +x.toFixed(3))).toEqual([0.5, 0.5]);
    const t3 = closePane(t2, a.id)!;
    expect(t3.t).toBe('pane');
    expect(closePane(t3, (t3 as { id: string }).id)).toBeNull();
  });

  it('合併：只有共用整條邊界的相鄰窗格可以，保留的窗格擴大', () => {
    const a = pane('a');
    const b = pane('b');
    const c = pane('c');
    const d = pane('d');
    // a | (b / c) | d
    const t = split('row', [a, split('col', [b, c]), d], [0.3, 0.4, 0.3]);
    expect(canJoin(t, a.id, b.id)).toBe(false); // a 的右邊界比 b 長
    expect(canJoin(t, b.id, c.id)).toBe(true);
    expect(joinPanes(t, a.id, d.id)).toBeNull(); // 不相鄰
    const t2 = joinPanes(t, c.id, b.id)!;
    expect(views(t2)).toEqual(['a', 'c', 'd']);
    const rc = paneRects(t2).get(c.id)!;
    expect(close(rc.h, 1) && close(rc.w, 0.4)).toBe(true);
    // 合併後成為同方向的鄰居，可以再合併
    const t3 = joinPanes(t2, a.id, c.id)!;
    expect(close(paneRects(t3).get(a.id)!.w, 0.7)).toBe(true);
  });

  it('正規化把同方向巢狀攤平，比例相乘', () => {
    const a = pane('a');
    const b = pane('b');
    const c = pane('c');
    const t = normalize(split('row', [a, split('row', [b, c], [0.25, 0.75])], [0.6, 0.4])) as LayoutSplit;
    expect(t.children.length).toBe(3);
    expect(t.sizes.map((x) => +x.toFixed(3))).toEqual([0.6, 0.1, 0.3]);
  });

  it('拖曳邊界只動兩側，並限制最小比例', () => {
    const a = pane('a');
    const b = pane('b');
    const c = pane('c');
    const t = split('row', [a, b, c], [0.4, 0.3, 0.3]);
    const t2 = resizeSplit(t, t.id, 0, t.sizes, 0.2, 0.1) as LayoutSplit;
    expect(t2.sizes.map((x) => +x.toFixed(3))).toEqual([0.6, 0.1, 0.3]);
    const t3 = resizeSplit(t, t.id, 0, t.sizes, 0.5, 0.1) as LayoutSplit;
    expect(t3.sizes.map((x) => +x.toFixed(3))).toEqual([0.6, 0.1, 0.3]);
    const t4 = resizeSplit(t, t.id, 1, t.sizes, -1, 0.1) as LayoutSplit;
    expect(t4.sizes.map((x) => +x.toFixed(3))).toEqual([0.4, 0.1, 0.5]);
  });

  it('交換視圖', () => {
    const a = pane('a');
    const b = pane('b');
    expect(views(swapPanes(split('col', [a, b]), a.id, b.id))).toEqual(['b', 'a']);
  });

  it('讀回存檔：無效結構回傳 null，不存在的視圖改成預設', () => {
    const a = pane('a');
    const b = pane('gone');
    const saved = JSON.parse(JSON.stringify(split('row', [a, b])));
    const t = sanitizeLayout(saved, new Set(['a']), 'a')!;
    expect(views(t)).toEqual(['a', 'a']);
    expect(sanitizeLayout({ t: 'split', id: 'x', dir: 'row', children: [] }, new Set(), 'a')).toBeNull();
    expect(sanitizeLayout({ t: 'weird' }, new Set(), 'a')).toBeNull();
    // 重複 id 視為損毀
    expect(sanitizeLayout({ t: 'split', id: 's', dir: 'row', sizes: [1, 1], children: [{ t: 'pane', id: 'p', view: 'a' }, { t: 'pane', id: 'p', view: 'a' }] }, new Set(['a']), 'a')).toBeNull();
  });
});
