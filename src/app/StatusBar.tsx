import { store } from '../model/store';
import { ui, type SnapSettings } from './ui';

const SNAPS: [keyof SnapSettings, string][] = [
  ['end', '端點'],
  ['mid', '中點'],
  ['grid', '交點'],
  ['line', '線上'],
  ['free', '自由點'],
  ['drawing', '圖紙'],
];

const f = (n: number) => (Math.round(n * 10) / 10).toLocaleString('zh-TW');

export function StatusBar() {
  const c = ui.cursor.value;
  const snaps = ui.snaps.value;
  const save = ui.saveState.value;
  return (
    <div class="status">
      <div class="prompt">{ui.prompt.value}</div>
      {ui.numeric.value && <span class="num">{ui.numeric.value}▏</span>}
      <span class="coord">{c ? `X ${f(c[0])}  Y ${f(c[1])}  Z ${f(c[2])}　${ui.snapKind.value}` : ''}</span>
      <div class="chips">
        {SNAPS.map(([k, label]) => (
          <button key={k} class={`chip${snaps[k] ? ' on' : ''}`} title={`鎖點：${label}`} onClick={() => (ui.snaps.value = { ...snaps, [k]: !snaps[k] })}>
            {label}
          </button>
        ))}
        <button class={`chip${ui.ortho.value ? ' on' : ''}`} title="正交 (O)" onClick={() => (ui.ortho.value = !ui.ortho.value)}>
          正交
        </button>
      </div>
      <span>已選 {store.selection.value.size}</span>
      <span class={`save${save === 'error' ? ' err' : ''}`}>{save === 'saving' ? '儲存中…' : save === 'saved' ? '已自動儲存' : save === 'error' ? '儲存失敗' : ''}</span>
    </div>
  );
}
