import { signal, useSignal } from '@preact/signals';
import { catalogFamilies, FAMILY } from '../../catalog/catalog';
import { parseProfile, unitWeight } from '../../catalog/parse';
import { sectionOutline } from '../../catalog/shapes';
import type { Profile } from '../../catalog/types';
import { fmtNum } from '../core';
import { Modal } from './Modal';

interface PBState {
  initial: string;
  onPick: (name: string) => void;
  plate: boolean;
}

const state = signal<PBState | null>(null);

export function openProfileBrowser(initial: string, onPick: (name: string) => void, plate = false) {
  state.value = { initial, onPick, plate };
}

const PARAM_HELP: [string, string][] = [
  ['H400x200x8x13', 'H 型鋼（型錄外自動參數化）'],
  ['BH600x300x12x25', '焊接 H 型鋼（無圓角）'],
  ['[150x75x6.5x10', '熱軋槽鋼'],
  ['C150x65x20x2.3', '帶唇 C 型鋼'],
  ['L100x100x10', '角鋼'],
  ['□200x200x9', '冷軋方管'],
  ['BOX500x500x25x25', '焊接箱型'],
  ['φ216.3x8.2', '圓管'],
  ['PL12x300', '鋼板（厚x寬）'],
  ['FB50x6', '扁鋼'],
  ['φ25', '圓鋼'],
];

function Preview(props: { p: Profile }) {
  const p = props.p;
  const o = sectionOutline(p.kind, p.dims);
  const w = Math.max(p.width, 1);
  const h = Math.max(p.height, 1);
  const s = Math.max(w, h) * 1.3;
  const d = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${x},${-y}`).join('L')}Z`;
  return (
    <svg viewBox={`${-s / 2} ${-s / 2} ${s} ${s}`}>
      <path d={[d(o.outer), ...o.holes.map(d)].join(' ')} fill="#9cc2f0" stroke="#1e5fb8" stroke-width={s / 200} fill-rule="evenodd" />
    </svg>
  );
}

function Props(props: { p: Profile }) {
  const p = props.p;
  const dm = p.dims;
  const rows: [string, string][] = [
    ['名稱', p.name],
    ['類別', p.family],
    ['依據', p.standard],
    ['高 H', `${fmtNum(dm.h, 1)} mm`],
    ['寬 B', `${fmtNum(dm.b, 1)} mm`],
  ];
  if (dm.tw !== undefined) rows.push(['腹板 t1', `${dm.tw} mm`]);
  if (dm.tf !== undefined) rows.push(['翼板 t2', `${dm.tf} mm`]);
  if (dm.t !== undefined) rows.push(['厚 t', `${dm.t} mm`]);
  if (dm.c !== undefined) rows.push(['唇高 C', `${dm.c} mm`]);
  if (dm.r1) rows.push(['圓角 r', `${dm.r1} mm`]);
  rows.push(['斷面積', `${fmtNum(p.area / 100, 2)} cm²`], ['單位重（7850）', `${fmtNum(unitWeight(p, 7850), 2)} kg/m`], ['塗裝周長', `${fmtNum(p.perimeter / 1000, 3)} m²/m`]);
  return (
    <table class="tbl" style={{ marginTop: 8 }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td class="n">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Browser(props: { st: PBState }) {
  const fams = catalogFamilies();
  const init = parseProfile(props.st.initial);
  const initFam = init.ok ? init.profile.family : fams[0].family;
  const fam = useSignal(fams.some((f) => f.family === initFam) ? initFam : fams[0].family);
  const text = useSignal(props.st.initial);
  const filter = useSignal('');
  const cur = parseProfile(text.value);
  const items = (fams.find((f) => f.family === fam.value)?.items ?? []).filter((p) => !filter.value || p.name.toUpperCase().includes(filter.value.toUpperCase()));
  const close = () => (state.value = null);
  const pick = () => {
    if (!cur.ok) return;
    props.st.onPick(cur.profile.name);
    close();
  };
  return (
    <Modal
      title="選擇斷面"
      onClose={close}
      footer={
        <>
          <div class="grow hint">{cur.ok ? `已選：${cur.profile.name}` : text.value ? cur.error : '請選擇或輸入斷面'}</div>
          <button onClick={close}>取消</button>
          <button class="primary" disabled={!cur.ok} onClick={pick}>
            確定
          </button>
        </>
      }
    >
      <div class="filters">
        <label>斷面</label>
        <input value={text.value} onInput={(e) => (text.value = (e.target as HTMLInputElement).value)} style={{ width: 220 }} onKeyDown={(e) => e.key === 'Enter' && pick()} />
        <label>篩選</label>
        <input value={filter.value} placeholder="如 588、300x" onInput={(e) => (filter.value = (e.target as HTMLInputElement).value)} style={{ width: 120 }} />
      </div>
      <div class="pb">
        <div class="pb-list">
          {fams.map((f) => (
            <div key={f.family} class={fam.value === f.family ? 'on' : ''} onClick={() => (fam.value = f.family)}>
              {f.family}
              <span class="hint"> {f.items.length}</span>
            </div>
          ))}
          <div class={fam.value === 'param' ? 'on' : ''} onClick={() => (fam.value = 'param')}>
            參數化寫法
          </div>
        </div>
        <div class="pb-list">
          {fam.value === 'param'
            ? PARAM_HELP.map(([n, d]) => (
                <div key={n} class={text.value === n ? 'on' : ''} onClick={() => (text.value = n)} onDblClick={pick}>
                  {n}
                  <span class="hint"> {d}</span>
                </div>
              ))
            : items.map((p) => (
                <div key={p.name} class={cur.ok && cur.profile.name === p.name ? 'on' : ''} onClick={() => (text.value = p.name)} onDblClick={() => {
                  text.value = p.name;
                  pick();
                }}>
                  {p.name}
                  <span class="hint"> {fmtNum(unitWeight(p, 7850), 1)} kg/m</span>
                </div>
              ))}
        </div>
        <div class="pb-prev">
          {cur.ok && !cur.profile.thicknessOnly ? (
            <>
              <Preview p={cur.profile} />
              <Props p={cur.profile} />
            </>
          ) : cur.ok ? (
            <div class="hint">多邊形鋼板只需厚度（{cur.profile.name}）。</div>
          ) : (
            <div class="hint">型錄依 JIS／CNS；型錄外的尺寸可直接輸入，程式會依尺寸計算斷面積。</div>
          )}
        </div>
      </div>
      {props.st.plate && <div class="hint" style={{ marginTop: 6 }}>多邊形鋼板請輸入 PL厚度，例如 PL12。（{FAMILY.PL}）</div>}
    </Modal>
  );
}

export function ProfileBrowserHost() {
  const st = state.value;
  return st ? <Browser st={st} /> : null;
}
