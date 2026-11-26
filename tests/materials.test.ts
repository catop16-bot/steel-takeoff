import { describe, expect, it } from 'vitest';
import { MATERIALS, findMaterial, materialGroups } from '../src/catalog/materials';

describe('材質下拉選單分組', () => {
  it('列出全部內建材質，每筆只出現一次，依規範分組', () => {
    const groups = materialGroups();
    const names = groups.flatMap((g) => g.items.map((m) => m.name));
    expect(names.length).toBe(MATERIALS.length);
    expect(new Set(names).size).toBe(MATERIALS.length);
    const sn = groups.find((g) => g.items.some((m) => m.name === 'SN490B'))!;
    expect(sn.label).toContain('建築結構用');
    expect(sn.items.map((m) => m.name)).toEqual(['SN400A', 'SN400B', 'SN400C', 'SN490B', 'SN490C']);
    const sus = groups.find((g) => g.items.some((m) => m.name === 'SUS304'))!;
    expect(sus.items.map((m) => m.name)).toEqual(['SUS304', 'SUS316']);
  });

  it('自訂材質排在最前面', () => {
    const custom = [{ name: 'Q345B', density: 7850, standard: 'GB/T 1591' }];
    const groups = materialGroups(custom);
    expect(groups[0].label).toBe('自訂材質');
    expect(groups[0].items[0].name).toBe('Q345B');
    expect(findMaterial('q345b', custom)?.name).toBe('Q345B');
  });

  it('名稱比對不分大小寫，打一半的名稱找不到', () => {
    expect(findMaterial('sn490b')?.name).toBe('SN490B');
    expect(findMaterial('SN49')).toBeUndefined();
  });
});
