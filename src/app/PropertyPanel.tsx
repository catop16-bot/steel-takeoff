import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { MATERIALS, densityOf } from '../catalog/materials';
import { parseProfile, unitWeight } from '../catalog/parse';
import { store } from '../model/store';
import { MEMBER_TYPE_LABEL, type Member, type MemberDefaults, type MemberType, type ToolKey } from '../model/types';
import { computeMember } from '../quantity/compute';
import { summarize } from '../quantity/summary';
import { CLASS_COLORS } from '../view3d/colors';
import { fmtNum } from './core';
import { openProfileBrowser } from './dialogs/ProfileBrowser';
import { chrome, LIMITS, patchChrome, propRect, saveChrome } from './chrome';
import { closeProps, isMemberTool, propOpen } from './propWindow';
import { ui } from './ui';

const MIXED = '\u0000';

type Form = Record<string, string>;

const PLANE = [
  ['middle', '中'],
  ['left', '左'],
  ['right', '右'],
] as const;
const ROT = [
  ['top', '頂（0°）'],
  ['front', '前（90°）'],
  ['below', '下（180°）'],
  ['back', '後（270°）'],
] as const;
const DEPTH = [
  ['middle', '中'],
  ['front', '前（上）'],
  ['behind', '後（下）'],
] as const;

function getKey(m: any, key: string): string {
  const parts = key.split('.');
  let v = m;
  for (const k of parts) {
    if (v == null) return '';
    if (k === 'x' || k === 'y' || k === 'z') v = v[{ x: 0, y: 1, z: 2 }[k]];
    else v = v[k];
  }
  return v == null ? '' : String(typeof v === 'number' ? Math.round(v * 100) / 100 : v);
}

const NUM_KEYS = new Set(['cls', 'pos.planeOffset', 'pos.rotationAngle', 'pos.depthOffset', 'offStart.dx', 'offStart.dy', 'offStart.dz', 'offEnd.dx', 'offEnd.dy', 'offEnd.dz', 'start.x', 'start.y', 'start.z', 'end.x', 'end.y', 'end.z']);

function setKey<T extends object>(m: T, key: string, raw: string): T {
  const parts = key.split('.');
  const val: any = NUM_KEYS.has(key) ? Number(raw) : raw;
  const clone = (o: any) => (Array.isArray(o) ? [...o] : { ...o });
  const root: any = clone(m);
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = clone(cur[parts[i]] ?? {});
    cur = cur[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (last === 'x' || last === 'y' || last === 'z') cur[{ x: 0, y: 1, z: 2 }[last]] = val;
  else cur[last] = val;
  return root;
}

function Row(props: { label: string; dirty?: boolean; children: ComponentChildren }) {
  return (
    <div class={`frow${props.dirty ? ' dirty' : ''}`}>
      <label>{props.label}</label>
      <div>{props.children}</div>
    </div>
  );
}

function Txt(props: { k: string; f: Form; set: (k: string, v: string) => void; bad?: boolean; num?: boolean; list?: string }) {
  const v = props.f[props.k];
  return (
    <input
      class={`${props.bad ? 'bad' : ''}${props.num ? ' num' : ''}`}
      value={v === MIXED ? '' : (v ?? '')}
      placeholder={v === MIXED ? '（多種）' : ''}
      list={props.list}
      inputMode={props.num ? 'decimal' : undefined}
      onInput={(e) => props.set(props.k, (e.target as HTMLInputElement).value)}
    />
  );
}

function Sel(props: { k: string; f: Form; set: (k: string, v: string) => void; opts: readonly (readonly [string, string])[] }) {
  const v = props.f[props.k];
  return (
    <select value={v === MIXED ? '' : v} onChange={(e) => props.set(props.k, (e.target as HTMLSelectElement).value)}>
      {v === MIXED && <option value="">（多種）</option>}
      {props.opts.map(([a, b]) => (
        <option key={a} value={a}>
          {b}
        </option>
      ))}
    </select>
  );
}

function ProfileHint(props: { text: string; material: string }) {
  if (!props.text || props.text === MIXED) return null;
  const r = parseProfile(props.text);
  if (!r.ok) return <div class="hint err">{r.error}</div>;
  const rho = densityOf(props.material === MIXED ? 'SS400' : props.material, store.p.customMaterials);
  const pr = r.profile;
  if (pr.thicknessOnly) return <div class="hint ok">鋼板厚 {pr.dims.t} mm（{fmtNum((pr.dims.t! * rho) / 1000, 1)} kg/m²）</div>;
  return (
    <div class="hint ok">
      {pr.name}・{pr.family}・{fmtNum(unitWeight(pr, rho), 2)} kg/m{pr.catalog ? '' : '（參數化）'}
    </div>
  );
}

function ClassPick(props: { f: Form; set: (k: string, v: string) => void }) {
  return (
    <div class="cls-pick">
      {CLASS_COLORS.slice(1).map((c, i) => (
        <button key={i} class={props.f.cls === String(i + 1) ? 'on' : ''} style={{ background: c }} title={`類別 ${i + 1}`} onClick={() => props.set('cls', String(i + 1))}>
          {i + 1}
        </button>
      ))}
    </div>
  );
}

type FieldProps = { f: Form; set: (k: string, v: string) => void; dirty: Set<string>; plate: boolean; linear: boolean };

/** 零件屬性：名稱、斷面、材質、類別、編號前綴 */
function PartFields(props: FieldProps) {
  const { f, set, dirty } = props;
  const prof = f.profile;
  const bad = prof && prof !== MIXED ? !parseProfile(prof).ok : false;
  return (
    <>
      <h4>零件屬性</h4>
      <Row label="名稱" dirty={dirty.has('name')}>
        <Txt k="name" f={f} set={set} />
      </Row>
      <Row label="斷面" dirty={dirty.has('profile')}>
        <div class="fpair">
          <Txt k="profile" f={f} set={set} bad={bad} />
          <button style={{ flex: '0 0 auto' }} title="從型錄選擇" onClick={() => openProfileBrowser(prof === MIXED ? '' : prof, (name) => set('profile', name), props.plate)}>
            …
          </button>
        </div>
        <ProfileHint text={prof} material={f.material} />
      </Row>
      <Row label="材質" dirty={dirty.has('material')}>
        <Txt k="material" f={f} set={set} list="materials" />
        {f.material && f.material !== MIXED && <div class="hint">密度 {fmtNum(densityOf(f.material, store.p.customMaterials))} kg/m³</div>}
      </Row>
      <Row label="類別" dirty={dirty.has('cls')}>
        <ClassPick f={f} set={set} />
      </Row>
      <Row label="編號前綴" dirty={dirty.has('prefix')}>
        <Txt k="prefix" f={f} set={set} />
      </Row>
    </>
  );
}

/** 位置：平面上、旋轉、深度 */
function PositionFields(props: FieldProps) {
  const { f, set, dirty } = props;
  return (
    <>
      <h4>位置</h4>
      {props.linear && (
        <>
          <Row label="平面上" dirty={dirty.has('pos.plane') || dirty.has('pos.planeOffset')}>
            <div class="fpair">
              <Sel k="pos.plane" f={f} set={set} opts={PLANE} />
              <Txt k="pos.planeOffset" f={f} set={set} num />
            </div>
          </Row>
          <Row label="旋轉" dirty={dirty.has('pos.rotation') || dirty.has('pos.rotationAngle')}>
            <div class="fpair">
              <Sel k="pos.rotation" f={f} set={set} opts={ROT} />
              <Txt k="pos.rotationAngle" f={f} set={set} num />
            </div>
          </Row>
        </>
      )}
      <Row label="深度" dirty={dirty.has('pos.depth') || dirty.has('pos.depthOffset')}>
        <div class="fpair">
          <Sel k="pos.depth" f={f} set={set} opts={DEPTH} />
          <Txt k="pos.depthOffset" f={f} set={set} num />
        </div>
      </Row>
    </>
  );
}

// ---------------- 工具預設值 ----------------

function defaultsForm(d: MemberDefaults): Form {
  const f: Form = {};
  for (const k of ['name', 'profile', 'material', 'cls', 'prefix', 'pos.plane', 'pos.planeOffset', 'pos.rotation', 'pos.rotationAngle', 'pos.depth', 'pos.depthOffset']) f[k] = getKey(d, k);
  f.bottomLevelId = d.bottomLevelId ?? '';
  f.bottomOffset = String(d.bottomOffset ?? 0);
  f.topLevelId = d.topLevelId ?? '';
  f.topOffset = String(d.topOffset ?? 0);
  return f;
}

function ToolDefaults(props: { type: ToolKey }) {
  const p = store.project.value;
  const d = p.settings.defaults[props.type];
  const [f, setF] = useState<Form>(() => defaultsForm(d));
  useEffect(() => setF(defaultsForm(store.p.settings.defaults[props.type])), [props.type, p.id]);
  const levels = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  const lvOpts = levels.map((l) => [l.id, `${l.name}（${l.elevation}）`] as const);
  const set = (k: string, v: string) => {
    setF((o) => ({ ...o, [k]: v }));
    const cur = store.p.settings.defaults[props.type];
    let nd: MemberDefaults;
    if (k === 'bottomOffset' || k === 'topOffset') {
      if (!Number.isFinite(Number(v))) return;
      nd = { ...cur, [k]: Number(v) || 0 };
    } else if (k === 'bottomLevelId' || k === 'topLevelId') nd = { ...cur, [k]: v };
    else if (NUM_KEYS.has(k) && (v.trim() === '' || !Number.isFinite(Number(v)))) return;
    else if (k === 'profile') {
      const r = parseProfile(v);
      if (!r.ok) return;
      nd = { ...cur, profile: r.profile.name };
    } else nd = setKey(cur, k, v);
    const st = store.p.settings;
    store.setRootSilent('settings', { ...st, defaults: { ...st.defaults, [props.type]: nd } });
  };
  return (
    <div class="props">
      <h3>
        {MEMBER_TYPE_LABEL[props.type]}的預設屬性
      </h3>
      <div class="hint">之後新建的{MEMBER_TYPE_LABEL[props.type]}使用這些設定（相當於 Tekla 屬性對話框）。</div>
      <div class="prop-cols">
        <div class="prop-col">
          <PartFields f={f} set={set} dirty={new Set()} plate={props.type === 'plate'} linear={props.type !== 'plate'} />
        </div>
        <div class="prop-col">
          <PositionFields f={f} set={set} dirty={new Set()} plate={props.type === 'plate'} linear={props.type !== 'plate'} />
      {props.type === 'column' && (
        <>
          <h4>高程</h4>
          <Row label="底部">
            <div class="fpair">
              <Sel k="bottomLevelId" f={f} set={set} opts={lvOpts} />
              <Txt k="bottomOffset" f={f} set={set} num />
            </div>
          </Row>
          <Row label="頂部">
            <div class="fpair">
              <Sel k="topLevelId" f={f} set={set} opts={lvOpts} />
              <Txt k="topOffset" f={f} set={set} num />
            </div>
          </Row>
          <div class="hint">後方欄位為相對樓層的偏移（mm），例如柱頂到梁底可填 −588。</div>
        </>
      )}
        </div>
      </div>
      <ToolTips type={props.type} />
    </div>
  );
}

function ToolTips(props: { type: ToolKey }) {
  return (
    <>
      <h4>操作</h4>
      <div class="hint" style={{ lineHeight: 1.7 }}>
        {props.type === 'column' && '在平面視圖點軸線交點放柱；可連續點選。'}
        {props.type === 'plate' && '依序點選角點，點回第一點、按 Enter 或右鍵完成。'}
        {props.type !== 'column' && props.type !== 'plate' && '點起點、終點建立構件；選起點後可直接輸入長度（如 6000）或相對座標（@6000,0,0）再按 Enter。'}
        <br />O 切換正交；Esc 中斷。
      </div>
    </>
  );
}

// ---------------- 選取構件 ----------------

const SEL_KEYS = ['name', 'profile', 'material', 'cls', 'prefix', 'pos.plane', 'pos.planeOffset', 'pos.rotation', 'pos.rotationAngle', 'pos.depth', 'pos.depthOffset'];
const OFF_KEYS = ['offStart.dx', 'offStart.dy', 'offStart.dz', 'offEnd.dx', 'offEnd.dy', 'offEnd.dz'];
const GEO_KEYS = ['start.x', 'start.y', 'start.z', 'end.x', 'end.y', 'end.z'];

function formFrom(ms: Member[]): Form {
  const f: Form = {};
  for (const k of [...SEL_KEYS, ...OFF_KEYS, ...GEO_KEYS]) {
    const vals = new Set(ms.map((m) => getKey(m, k)));
    f[k] = vals.size === 1 ? [...vals][0] : MIXED;
  }
  return f;
}

function Selection(props: { ids: ReadonlySet<string> }) {
  const p = store.project.value;
  const ms = useMemo(() => p.members.filter((m) => props.ids.has(m.id)), [p.members, props.ids]);
  const [f, setF] = useState<Form>(() => formFrom(ms));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  useEffect(() => {
    setF(formFrom(ms));
    setDirty(new Set());
  }, [ms]);
  const set = (k: string, v: string) => {
    setF((o) => ({ ...o, [k]: v }));
    setDirty((o) => new Set(o).add(k));
  };
  const plate = ms.every((m) => m.type === 'plate');
  const linear = ms.every((m) => m.type !== 'plate');
  const types = new Set<MemberType>(ms.map((m) => m.type));
  const single = ms.length === 1 ? ms[0] : null;

  const apply = () => {
    const keys = [...dirty];
    for (const k of keys) {
      if (NUM_KEYS.has(k) && !Number.isFinite(Number(f[k]))) {
        alert(`數值錯誤：${f[k]}`);
        return;
      }
      if (k === 'profile' && !parseProfile(f.profile).ok) {
        alert('斷面無法解析');
        return;
      }
    }
    store.patchMembers(
      props.ids,
      (m) => {
        let n = m;
        for (const k of keys) {
          if (k === 'profile') n = { ...n, profile: parseProfile(f.profile).ok ? (parseProfile(f.profile) as any).profile.name : f.profile };
          else if ((OFF_KEYS.includes(k) || GEO_KEYS.includes(k)) && m.type === 'plate') continue;
          else n = setKey(n, k, f[k]);
        }
        return n;
      },
      `修改 ${ms.length} 支構件`,
    );
    setDirty(new Set());
  };

  const ctx = { grids: p.grids, levels: p.levels, customMaterials: p.customMaterials, paintIncludeEnds: p.settings.paintIncludeEnds };
  const rows = ms.slice(0, 5000).map((m) => computeMember(m, ctx));
  const sum = summarize(rows, p.levels, p.grids).total;
  const q = single ? rows[0] : null;

  return (
    <div class="props">
      <h3>
        {single ? `${MEMBER_TYPE_LABEL[single.type]}` : `已選 ${ms.length} 支構件`}
        {single?.mark && <span class="chip on">{single.mark}</span>}
      </h3>
      {!single && <div class="hint">類型：{[...types].map((t) => MEMBER_TYPE_LABEL[t]).join('、')}。只會套用有改動（藍字）的欄位。</div>}
      <div class="prop-cols">
        <div class="prop-col">
          <PartFields f={f} set={set} dirty={dirty} plate={plate} linear={linear} />
        </div>
        <div class="prop-col">
          <PositionFields f={f} set={set} dirty={dirty} plate={plate} linear={linear} />
      {linear && (
        <>
          <h4>端部偏移（Dx Dy Dz）</h4>
          <Row label="起點" dirty={OFF_KEYS.slice(0, 3).some((k) => dirty.has(k))}>
            <div class="ftrip">
              <Txt k="offStart.dx" f={f} set={set} num />
              <Txt k="offStart.dy" f={f} set={set} num />
              <Txt k="offStart.dz" f={f} set={set} num />
            </div>
          </Row>
          <Row label="終點" dirty={OFF_KEYS.slice(3).some((k) => dirty.has(k))}>
            <div class="ftrip">
              <Txt k="offEnd.dx" f={f} set={set} num />
              <Txt k="offEnd.dy" f={f} set={set} num />
              <Txt k="offEnd.dz" f={f} set={set} num />
            </div>
          </Row>
          <div class="hint">Dx：起點正值縮短、終點正值加長。</div>
        </>
      )}
      {linear && (
        <>
          <h4>座標（mm）</h4>
          <Row label="起點" dirty={GEO_KEYS.slice(0, 3).some((k) => dirty.has(k))}>
            <div class="ftrip">
              <Txt k="start.x" f={f} set={set} num />
              <Txt k="start.y" f={f} set={set} num />
              <Txt k="start.z" f={f} set={set} num />
            </div>
          </Row>
          <Row label="終點" dirty={GEO_KEYS.slice(3).some((k) => dirty.has(k))}>
            <div class="ftrip">
              <Txt k="end.x" f={f} set={set} num />
              <Txt k="end.y" f={f} set={set} num />
              <Txt k="end.z" f={f} set={set} num />
            </div>
          </Row>
        </>
      )}
        </div>
      </div>
      <div class="actions">
        <button class="primary" disabled={!dirty.size} onClick={apply}>
          修改
        </button>
        <button
          disabled={!dirty.size}
          onClick={() => {
            setF(formFrom(ms));
            setDirty(new Set());
          }}
        >
          還原
        </button>
        <span style={{ flex: 1 }} />
        <button class="danger" onClick={() => store.remove('members', props.ids, `刪除 ${ms.length} 支構件`)}>
          刪除
        </button>
      </div>
      <h4>數量</h4>
      {q ? (
        q.error ? (
          <div class="hint err">{q.error}</div>
        ) : (
          <dl class="qty">
            <dt>斷面</dt>
            <dd>{q.profile}</dd>
            <dt>{q.type === 'plate' ? '尺寸' : '長度'}</dt>
            <dd>{q.type === 'plate' ? `${q.size} mm` : `${fmtNum(q.length, 1)} mm`}</dd>
            <dt>{q.type === 'plate' ? '板面積' : '斷面積'}</dt>
            <dd>{q.type === 'plate' ? `${fmtNum(q.area / 1e6, 3)} m²` : `${fmtNum(q.area / 100, 2)} cm²`}</dd>
            <dt>單位重</dt>
            <dd>
              {fmtNum(q.unitWeight, 2)} {q.type === 'plate' ? 'kg/m²' : 'kg/m'}
            </dd>
            <dt>重量</dt>
            <dd>
              <b>{fmtNum(q.weight, 2)} kg</b>
            </dd>
            <dt>塗裝面積</dt>
            <dd>{fmtNum(q.surface, 3)} m²</dd>
            <dt>密度</dt>
            <dd>{fmtNum(q.density)} kg/m³</dd>
            <dt>樓層</dt>
            <dd>{q.levelName || '—'}</dd>
            <dt>位置</dt>
            <dd>{q.location || '—'}</dd>
          </dl>
        )
      ) : (
        <dl class="qty">
          <dt>支數</dt>
          <dd>{fmtNum(sum.qty)}</dd>
          <dt>總長度</dt>
          <dd>{fmtNum(sum.length / 1000, 2)} m</dd>
          <dt>總重量</dt>
          <dd>
            <b>{fmtNum(sum.weight, 1)} kg</b>
          </dd>
          <dt>塗裝面積</dt>
          <dd>{fmtNum(sum.surface, 2)} m²</dd>
        </dl>
      )}
    </div>
  );
}

/** 專案數量統計（放在左側專案瀏覽） */
export function Overview() {
  const p = store.project.value;
  const ctx = { grids: p.grids, levels: p.levels, customMaterials: p.customMaterials, paintIncludeEnds: p.settings.paintIncludeEnds };
  const s = useMemo(() => summarize(p.members.map((m) => computeMember(m, ctx)), p.levels, p.grids), [p]);
  return (
    <div class="props overview">
      <dl class="qty">
        <dt>構件數</dt>
        <dd>{fmtNum(s.total.qty)}</dd>
        <dt>總重量</dt>
        <dd>
          <b>{fmtNum(s.total.weight / 1000, 3)} t</b>
        </dd>
        <dt>塗裝面積</dt>
        <dd>{fmtNum(s.total.surface, 1)} m²</dd>
        <dt>樓地板面積</dt>
        <dd>{fmtNum(s.total.floorArea, 1)} m²</dd>
        <dt>單位面積用鋼量</dt>
        <dd>{s.total.floorArea ? `${fmtNum(s.total.kgPerM2, 1)} kg/m²` : '—'}</dd>
      </dl>
      {s.errors.length > 0 && (
        <div class="warn-box" style={{ marginTop: 10 }}>
          有 {s.errors.length} 支構件無法計算（斷面錯誤），以紅線顯示。
          <button style={{ marginLeft: 6 }} onClick={() => store.select(s.errors.map((r) => r.id))}>
            選取
          </button>
        </div>
      )}
      <h4>依類型</h4>
      <table class="tbl">
        <tbody>
          {s.byType.map((r) => (
            <tr key={r.type}>
              <td>{r.typeLabel}</td>
              <td class="n">{r.qty} 支</td>
              <td class="n">{fmtNum(r.totalWeight, 0)} kg</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="hint" style={{ marginTop: 10, lineHeight: 1.7 }}>
        雙擊構件開啟屬性視窗（N）；雙擊工具按鈕設定斷面等預設屬性。
      </div>
    </div>
  );
}

/**
 * 浮動屬性視窗：拖曳標題列移動、拖曳右下角調整大小，位置與大小記住；Esc 或 × 關閉。
 * 使用構件工具時顯示該工具的預設屬性，否則顯示選取的構件。
 */
export function PropertyWindow() {
  const open = propOpen.value;
  const t = ui.tool.value;
  const sel = store.selection.value;
  void chrome.value; // 位置變更時重畫
  const el = useRef<HTMLDivElement>(null);
  const [, bump] = useState(0);
  // 視窗大小改變時把屬性視窗拉回畫面內
  useEffect(() => {
    const h = () => bump((n) => n + 1);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  // 使用者拖右下角改大小：記下新尺寸
  useEffect(() => {
    const node = el.current;
    if (!open || !node) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      // 關閉時元素被移除會回報 0×0，不能當成使用者改的大小
      if (!node.isConnected || node.offsetWidth < 50 || node.offsetHeight < 50) return;
      const cur = propRect();
      const w = Math.round(node.offsetWidth);
      const h = Math.round(node.offsetHeight);
      if (Math.abs(w - cur.w) > 1 || Math.abs(h - cur.h) > 1) patchChrome({ prop: { ...cur, w, h } });
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [open]);
  if (!open) return null;
  const r = propRect();
  const tool = isMemberTool(t) ? t : null;
  const title = tool ? '工具預設屬性' : '構件屬性';
  const startDrag = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const head = e.currentTarget as HTMLElement;
    head.setPointerCapture(e.pointerId);
    const s0 = propRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      patchChrome({ prop: { ...s0, x: s0.x + ev.clientX - x0, y: s0.y + ev.clientY - y0 } }, false);
    };
    const end = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', end);
      head.removeEventListener('pointercancel', end);
      patchChrome({ prop: propRect() });
      saveChrome();
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  };
  return (
    <div
      ref={el}
      class="prop-win"
      style={{ left: r.x, top: r.y, width: r.w, height: r.h, minWidth: LIMITS.propMin[0], minHeight: LIMITS.propMin[1] }}
    >
      <div class="prop-win-h" onPointerDown={startDrag} title="拖曳移動">
        <span class="grow">{title}</span>
        <button class="x" title="關閉（Esc）" onClick={closeProps}>
          ×
        </button>
      </div>
      <div class="prop-win-b">
        <datalist id="materials">
          {[...MATERIALS, ...store.project.value.customMaterials].map((m) => (
            <option key={m.name} value={m.name}>
              {m.standard}
            </option>
          ))}
        </datalist>
        {tool ? (
          <ToolDefaults type={tool} />
        ) : sel.size ? (
          <Selection ids={sel} />
        ) : (
          <div class="props">
            <div class="hint" style={{ lineHeight: 1.8 }}>
              沒有選取構件。
              <br />
              在視圖中點選構件即可在這裡修改；雙擊構件會直接打開這個視窗。
              <br />
              雙擊上方的柱、大梁等工具按鈕可設定新建構件的預設屬性。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
