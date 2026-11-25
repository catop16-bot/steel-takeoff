import { signal } from '@preact/signals';
import type { Collection, Member, Project } from './types';
import { newProject } from './defaults';

type RootKey = Exclude<keyof Project, Collection | 'format' | 'version' | 'id' | 'createdAt' | 'updatedAt'>;

export type Change =
  | { coll: Collection; id: string; before?: any; after?: any }
  | { coll: 'root'; key: RootKey; before: any; after: any };

export interface Transaction {
  label: string;
  changes: Change[];
}

export type ChangeListener = (changes: Change[] | 'reset', project: Project) => void;

const MAX_UNDO = 300;

function applyChanges(p: Project, changes: Change[], dir: 'after' | 'before'): Project {
  const next: Project = { ...p, updatedAt: Date.now() };
  const byColl = new Map<Collection, Change[]>();
  for (const c of changes) {
    if (c.coll === 'root') {
      (next as any)[c.key] = c[dir];
      continue;
    }
    let arr = byColl.get(c.coll);
    if (!arr) byColl.set(c.coll, (arr = []));
    arr.push(c);
  }
  for (const [coll, list] of byColl) {
    const arr: any[] = [...(next[coll] as any[])];
    const index = new Map<string, number>();
    arr.forEach((it, i) => index.set(it.id, i));
    const removed = new Set<string>();
    for (const c of list as Extract<Change, { coll: Collection }>[]) {
      const target = c[dir];
      const i = index.get(c.id);
      if (target === undefined) {
        if (i !== undefined) removed.add(c.id);
      } else if (i !== undefined) {
        arr[i] = target;
        removed.delete(c.id);
      } else {
        index.set(c.id, arr.length);
        arr.push(target);
      }
    }
    (next as any)[coll] = removed.size ? arr.filter((it) => !removed.has(it.id)) : arr;
  }
  return next;
}

function invert(changes: Change[]): Change[] {
  return changes.map((c) => ({ ...c, before: c.after, after: c.before }) as Change).reverse();
}

class Store {
  readonly project = signal<Project>(newProject());
  /** 每次修改遞增，給需要知道「有變動」的元件用 */
  readonly rev = signal(0);
  readonly selection = signal<ReadonlySet<string>>(new Set());
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  readonly lastAction = signal('');

  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private listeners = new Set<ChangeListener>();

  get p(): Project {
    return this.project.peek();
  }

  subscribe(fn: ChangeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(changes: Change[] | 'reset') {
    const p = this.project.peek();
    for (const fn of this.listeners) fn(changes, p);
  }

  private syncFlags() {
    this.canUndo.value = this.undoStack.length > 0;
    this.canRedo.value = this.redoStack.length > 0;
  }

  /** 載入整個專案（清除 Undo） */
  load(p: Project) {
    this.undoStack = [];
    this.redoStack = [];
    this.project.value = p;
    this.selection.value = new Set();
    this.rev.value++;
    this.syncFlags();
    this.emit('reset');
  }

  commit(label: string, changes: Change[]) {
    if (!changes.length) return;
    this.project.value = applyChanges(this.project.peek(), changes, 'after');
    this.undoStack.push({ label, changes });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.lastAction.value = label;
    this.afterChange(changes);
  }

  undo() {
    const t = this.undoStack.pop();
    if (!t) return;
    this.project.value = applyChanges(this.project.peek(), t.changes, 'before');
    this.redoStack.push(t);
    this.lastAction.value = `復原：${t.label}`;
    this.afterChange(invert(t.changes));
  }

  redo() {
    const t = this.redoStack.pop();
    if (!t) return;
    this.project.value = applyChanges(this.project.peek(), t.changes, 'after');
    this.undoStack.push(t);
    this.lastAction.value = `重做：${t.label}`;
    this.afterChange(t.changes);
  }

  private afterChange(changes: Change[]) {
    // 被刪除的構件移出選取
    const sel = this.selection.peek();
    if (sel.size) {
      const alive = new Set(this.project.peek().members.map((m) => m.id));
      const kept = [...sel].filter((id) => alive.has(id));
      if (kept.length !== sel.size) this.selection.value = new Set(kept);
    }
    this.rev.value++;
    this.syncFlags();
    this.emit(changes);
  }

  // ---- 常用操作 ----

  add<C extends Collection>(coll: C, items: Project[C], label: string) {
    this.commit(
      label,
      (items as { id: string }[]).map((it) => ({ coll, id: it.id, after: it })),
    );
  }

  remove(coll: Collection, ids: Iterable<string>, label: string) {
    const arr = this.p[coll] as { id: string }[];
    const set = new Set(ids);
    this.commit(
      label,
      arr.filter((it) => set.has(it.id)).map((it) => ({ coll, id: it.id, before: it })),
    );
  }

  /** 以新物件取代（id 相同） */
  replace<C extends Collection>(coll: C, items: Project[C], label: string) {
    const arr = this.p[coll] as { id: string }[];
    const index = new Map(arr.map((it) => [it.id, it]));
    this.commit(
      label,
      (items as { id: string }[]).map((it) => ({ coll, id: it.id, before: index.get(it.id), after: it })),
    );
  }

  patchMembers(ids: Iterable<string>, patch: (m: Member) => Member | null, label: string) {
    const set = new Set(ids);
    const changes: Change[] = [];
    for (const m of this.p.members) {
      if (!set.has(m.id)) continue;
      const n = patch(m);
      if (n && n !== m) changes.push({ coll: 'members', id: m.id, before: m, after: n });
    }
    this.commit(label, changes);
  }

  setRoot<K extends RootKey>(key: K, value: Project[K], label: string) {
    this.commit(label, [{ coll: 'root', key, before: this.p[key], after: value }]);
  }

  /** 不進 Undo 的集合修改（圖層開關、透明度等即時設定） */
  commitSilent(changes: Change[]) {
    if (!changes.length) return;
    this.project.value = applyChanges(this.project.peek(), changes, 'after');
    this.afterChange(changes);
  }

  replaceSilent<C extends Collection>(coll: C, items: Project[C]) {
    const arr = this.p[coll] as { id: string }[];
    const index = new Map(arr.map((it) => [it.id, it]));
    this.commitSilent((items as { id: string }[]).map((it) => ({ coll, id: it.id, before: index.get(it.id), after: it })));
  }

  /** 不進 Undo 的修改（工具預設值、視圖相機等），仍會觸發自動存檔 */
  setRootSilent<K extends RootKey>(key: K, value: Project[K]) {
    this.project.value = { ...this.project.peek(), [key]: value, updatedAt: Date.now() };
    this.rev.value++;
    this.emit([]);
  }

  select(ids: Iterable<string>, mode: 'set' | 'add' | 'toggle' | 'remove' = 'set') {
    const cur = new Set(mode === 'set' ? [] : this.selection.peek());
    for (const id of ids) {
      if (mode === 'remove') cur.delete(id);
      else if (mode === 'toggle') cur.has(id) ? cur.delete(id) : cur.add(id);
      else cur.add(id);
    }
    this.selection.value = cur;
  }
}

export const store = new Store();
