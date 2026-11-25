import { useSignal } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import { findDuplicates, transformMember, translate } from '../../model/edit';
import { store } from '../../model/store';
import type { Member } from '../../model/types';
import { toast, ui } from '../ui';
import { Modal } from './Modal';

const close = () => (ui.dialog.value = '');

/** 陣列複製（Tekla「特殊複製－線性」） */
export function ArrayDialog() {
  const dx = useSignal('6000');
  const dy = useSignal('0');
  const dz = useSignal('0');
  const n = useSignal('1');
  const sel = store.selection.value;
  const nums = [dx.value, dy.value, dz.value, n.value].map(Number);
  const bad = nums.some((v) => !Number.isFinite(v)) || !(nums[3] >= 1 && nums[3] <= 200 && Number.isInteger(nums[3])) || (nums[0] === 0 && nums[1] === 0 && nums[2] === 0);
  const run = () => {
    const ms = store.p.members.filter((m) => sel.has(m.id));
    const out: Member[] = [];
    for (let k = 1; k <= nums[3]; k++) for (const m of ms) out.push(transformMember(m, translate([nums[0] * k, nums[1] * k, nums[2] * k]), { copy: true }));
    store.add('members', out, `陣列複製 ${out.length} 支構件`);
    toast(`已複製 ${out.length} 支構件`);
    close();
  };
  const f = (label: string, sig: { value: string }) => (
    <>
      <label>{label}</label>
      <input value={sig.value} onInput={(e) => (sig.value = (e.target as HTMLInputElement).value)} />
    </>
  );
  return (
    <Modal
      title="陣列複製"
      onClose={close}
      width={420}
      footer={
        <>
          <div class="grow hint">{sel.size ? `已選 ${sel.size} 支` : '請先選取構件'}</div>
          <button onClick={close}>取消</button>
          <button class="primary" disabled={bad || !sel.size} onClick={run}>
            複製
          </button>
        </>
      }
    >
      <div class="form-grid">
        {f('間距 dX（mm）', dx)}
        {f('間距 dY（mm）', dy)}
        {f('間距 dZ（mm）', dz)}
        {f('複製份數', n)}
      </div>
      <div class="hint" style={{ marginTop: 8 }}>
        例：沿 X 每 6000 複製 3 份 → dX 6000、份數 3。往上複製到各樓層可填 dZ 樓高。
      </div>
    </Modal>
  );
}

/** 重複／重疊構件檢查（避免重複算量） */
export function DuplicatesDialog() {
  const p = store.project.value;
  const groups = useMemo(() => findDuplicates(p.members), [p.members]);
  const removable = groups.filter((g) => g.kind === 'same').flatMap((g) => g.ids.slice(1));
  return (
    <Modal
      title="重複構件檢查"
      onClose={close}
      width={640}
      footer={
        <>
          <button onClick={() => store.select(groups.flatMap((g) => g.ids))} disabled={!groups.length}>
            全部選取
          </button>
          <button
            class="danger"
            disabled={!removable.length}
            onClick={() => {
              store.remove('members', removable, `刪除 ${removable.length} 支重複構件`);
              toast(`已刪除 ${removable.length} 支完全重複的構件`);
            }}
          >
            刪除完全重複的（每組留一支）
          </button>
          <div class="grow" />
          <button class="primary" onClick={close}>
            關閉
          </button>
        </>
      }
    >
      {!groups.length ? (
        <div class="hint" style={{ padding: 20, textAlign: 'center' }}>
          沒有重複或重疊的構件。
        </div>
      ) : (
        <div class="report-scroll" style={{ maxHeight: '55vh' }}>
          <table class="tbl">
            <thead>
              <tr>
                <th>類型</th>
                <th>說明</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={i} class={g.kind === 'same' ? 'err' : ''}>
                  <td>{g.kind === 'same' ? '完全重複' : '部分重疊'}</td>
                  <td>{g.desc}</td>
                  <td>
                    <button onClick={() => store.select(g.ids)}>選取</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div class="hint" style={{ marginTop: 8 }}>
        完全重複：同類型、同斷面、端點相同。部分重疊：同類型且共線、範圍重疊超過 50 mm（可能是重複繪製，請檢查後手動刪除或分割）。
      </div>
    </Modal>
  );
}
