/** 斷面種類 */
export type ProfileKind =
  | 'H' // H 型鋼（熱軋或焊接 BH）
  | 'I' // I 型鋼
  | 'C' // 熱軋槽鋼
  | 'L' // 角鋼
  | 'T' // T 型鋼（CT 剖分）
  | 'BOX' // 冷軋方管／矩形管（STKR，角半徑外 2t、內 t）
  | 'WBOX' // 焊接箱型（尖角）
  | 'PIPE' // 圓管
  | 'LC' // 帶唇 C 型鋼
  | 'LCH' // 輕型槽鋼（無唇）
  | 'Z' // 帶唇 Z 型鋼
  | 'PL' // 鋼板
  | 'FB' // 扁鋼
  | 'RB'; // 圓鋼

/** 斷面尺寸（mm）。斷面座標：x 向為寬 b，y 向為高 h。 */
export interface ProfileDims {
  h: number;
  b: number;
  tw?: number;
  tf?: number;
  /** 均一厚度（角鋼、管、輕型鋼、板） */
  t?: number;
  /** 唇高 */
  c?: number;
  r1?: number;
  r2?: number;
}

export interface Profile {
  /** 正規化名稱，如 H300x150x6.5x9 */
  name: string;
  kind: ProfileKind;
  dims: ProfileDims;
  /** 斷面積 mm² */
  area: number;
  /** 外露周長 mm（塗裝面積用；薄壁輕型鋼為內外兩面） */
  perimeter: number;
  /** 外形包絡寬（x）與高（y），mm */
  width: number;
  height: number;
  /** 類別（中文，給斷面瀏覽器分組） */
  family: string;
  /** 依據規範；參數化斷面為「參數化」 */
  standard: string;
  /** 是否為型錄內規格 */
  catalog: boolean;
  /** 鋼板只有厚度（多邊形板用） */
  thicknessOnly?: boolean;
  /** 型錄表列單位重（kg/m），只用於檢核 */
  tableWeight?: number;
}

export type ParseResult = { ok: true; profile: Profile } | { ok: false; error: string };
