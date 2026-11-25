/** 解析後、與格式無關的 2D 圖紙（座標為圖紙單位，已減去 base 以保留 Float32 精度） */
export interface Drawing2D {
  version: 1;
  format: 'dxf' | 'dwg' | 'pdf';
  /** 每個圖紙單位等於多少 mm（依檔案單位；未知時為 1） */
  unitScale: number;
  unitsKnown: boolean;
  unitName: string;
  /** 原始座標 = 局部座標 + base */
  base: [number, number];
  /** 局部座標外框 [minX, minY, maxX, maxY] */
  bounds: [number, number, number, number];
  layers: DrawLayer[];
  /** 每個圖層的線段（x1,y1,x2,y2,…，局部座標） */
  segs: Float32Array[];
  texts: DrawText[];
  /** 圓（x, y, r, 圖層），局部座標；給圓心鎖點與第 3 批辨識軸線泡泡 */
  circles: Float32Array;
  /** PDF 點陣底圖 */
  raster?: { blob: Blob; x0: number; y0: number; x1: number; y1: number };
  encoding: string;
  stats: { entities: number; segments: number; texts: number; skipped: Record<string, number> };
}

export interface DrawLayer {
  name: string;
  /** #rrggbb（已調整成淺色背景上看得清楚） */
  color: string;
  linetype: string;
  /** 檔案中為關閉或凍結 */
  off: boolean;
}

export interface DrawText {
  s: string;
  x: number;
  y: number;
  /** 字高（大寫字母高度） */
  h: number;
  /** 旋轉（度） */
  rot: number;
  /** 水平對齊 0 左、1 中、2 右 */
  ha: 0 | 1 | 2;
  /** 垂直對齊 0 基線、1 底、2 中、3 頂 */
  va: 0 | 1 | 2 | 3;
  /** 寬度係數 */
  wf: number;
  layer: number;
}

// ---------- 解析中間格式（DXF 與 DWG 共用） ----------

export type P2 = [number, number];

export interface RawVertex {
  x: number;
  y: number;
  b: number;
}

export interface RawEntity {
  type: string;
  layer: string;
  linetype?: string;
  /** OCS 擠出方向 Z 分量（−1 表示鏡射） */
  extZ?: number;
  p?: P2;
  p2?: P2;
  p3?: P2;
  p4?: P2;
  pts?: RawVertex[];
  closed?: boolean;
  r?: number;
  /** 弧：起訖角（度） */
  a0?: number;
  a1?: number;
  /** 橢圓：長軸端點（相對）、短長軸比、參數範圍（弧度） */
  major?: P2;
  ratio?: number;
  t0?: number;
  t1?: number;
  /** 雲形線 */
  degree?: number;
  knots?: number[];
  weights?: number[];
  ctrl?: P2[];
  fit?: P2[];
  /** 文字 */
  text?: string;
  h?: number;
  rot?: number;
  ha?: number;
  va?: number;
  wf?: number;
  /** MTEXT 對齊點 1–9 */
  attach?: number;
  /** MTEXT 方向向量 */
  dir?: P2;
  mtext?: boolean;
  /** 圖塊參考 */
  name?: string;
  sx?: number;
  sy?: number;
  cols?: number;
  rows?: number;
  cs?: number;
  rs?: number;
  attribs?: RawEntity[];
  paper?: boolean;
  invisible?: boolean;
}

export interface RawBlock {
  name: string;
  base: P2;
  entities: RawEntity[];
}

export interface RawLayer {
  name: string;
  /** ACI 色號，負值表示關閉 */
  aci: number;
  /** 真彩 0xRRGGBB */
  rgb?: number;
  linetype: string;
  frozen: boolean;
  off: boolean;
}

export interface RawDoc {
  /** $INSUNITS */
  insunits: number;
  encoding: string;
  layers: RawLayer[];
  blocks: Map<string, RawBlock>;
  entities: RawEntity[];
}
