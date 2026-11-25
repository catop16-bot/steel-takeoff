export interface Material {
  name: string;
  /** 密度 kg/m³ */
  density: number;
  standard: string;
  note?: string;
}

/** 內建材質（台灣常用；密度依 CNS／JIS 單位重計算基準） */
export const MATERIALS: Material[] = [
  { name: 'SS400', density: 7850, standard: 'CNS 2473 / JIS G 3101', note: '一般結構用軋鋼' },
  { name: 'SS490', density: 7850, standard: 'CNS 2473 / JIS G 3101' },
  { name: 'SM400A', density: 7850, standard: 'CNS 2947 / JIS G 3106', note: '銲接結構用' },
  { name: 'SM400B', density: 7850, standard: 'CNS 2947 / JIS G 3106' },
  { name: 'SM490A', density: 7850, standard: 'CNS 2947 / JIS G 3106' },
  { name: 'SM490B', density: 7850, standard: 'CNS 2947 / JIS G 3106' },
  { name: 'SM490YB', density: 7850, standard: 'CNS 2947 / JIS G 3106' },
  { name: 'SM520B', density: 7850, standard: 'CNS 2947 / JIS G 3106' },
  { name: 'SM570', density: 7850, standard: 'CNS 2947 / JIS G 3106' },
  { name: 'SN400A', density: 7850, standard: 'CNS 13812 / JIS G 3136', note: '建築結構用' },
  { name: 'SN400B', density: 7850, standard: 'CNS 13812 / JIS G 3136' },
  { name: 'SN400C', density: 7850, standard: 'CNS 13812 / JIS G 3136' },
  { name: 'SN490B', density: 7850, standard: 'CNS 13812 / JIS G 3136' },
  { name: 'SN490C', density: 7850, standard: 'CNS 13812 / JIS G 3136' },
  { name: 'STK400', density: 7850, standard: 'CNS 4435 / JIS G 3444', note: '結構用鋼管' },
  { name: 'STK490', density: 7850, standard: 'CNS 4435 / JIS G 3444' },
  { name: 'STKR400', density: 7850, standard: 'CNS 7141 / JIS G 3466', note: '結構用角形鋼管' },
  { name: 'STKR490', density: 7850, standard: 'CNS 7141 / JIS G 3466' },
  { name: 'SSC400', density: 7850, standard: 'CNS 6183 / JIS G 3350', note: '輕量型鋼' },
  { name: 'A36', density: 7850, standard: 'ASTM A36' },
  { name: 'A572 Gr.50', density: 7850, standard: 'ASTM A572' },
  { name: 'SUS304', density: 7930, standard: 'CNS 8497 / JIS G 4304', note: '不鏽鋼' },
  { name: 'SUS316', density: 7980, standard: 'CNS 8497 / JIS G 4304', note: '不鏽鋼' },
];

export const DEFAULT_DENSITY = 7850;

export function findMaterial(name: string, custom: Material[] = []): Material | undefined {
  const key = name.trim().toUpperCase();
  return custom.find((m) => m.name.toUpperCase() === key) ?? MATERIALS.find((m) => m.name.toUpperCase() === key);
}

/** 材質密度；找不到時用 7850 */
export function densityOf(name: string, custom: Material[] = []): number {
  return findMaterial(name, custom)?.density ?? DEFAULT_DENSITY;
}
