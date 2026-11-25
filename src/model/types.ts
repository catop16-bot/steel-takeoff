import type { Material } from '../catalog/materials';
import type { V3 } from '../geom/vec';

/** 構件類型 */
export type MemberType = 'column' | 'girder' | 'beam' | 'brace' | 'purlin' | 'plate';

export const MEMBER_TYPES: MemberType[] = ['column', 'girder', 'beam', 'brace', 'purlin', 'plate'];

export const MEMBER_TYPE_LABEL: Record<MemberType, string> = {
  column: '柱',
  girder: '大梁',
  beam: '小梁',
  brace: '斜撐',
  purlin: '桁條',
  plate: '鋼板',
};

/** Tekla 式位置設定 */
export interface MemberPosition {
  /** 平面上：沿構件左右方向 */
  plane: 'middle' | 'left' | 'right';
  planeOffset: number;
  /** 旋轉：頂 0°、前 90°、下 180°、後 270°，再加 rotationAngle */
  rotation: 'top' | 'front' | 'below' | 'back';
  rotationAngle: number;
  /** 深度：沿構件高度方向（梁預設「後」＝梁頂齊參考線） */
  depth: 'middle' | 'front' | 'behind';
  depthOffset: number;
}

export interface EndOffset {
  /** 沿構件軸向；起點正值縮短、終點正值加長（同 Tekla） */
  dx: number;
  dy: number;
  dz: number;
}

/** 點的吸附參考（磁性軸線／高程用） */
export interface PointRef {
  levelId?: string;
}

export interface Member {
  id: string;
  type: MemberType;
  name: string;
  /** 斷面字串；鋼板為 PL厚度 */
  profile: string;
  material: string;
  /** 類別（顏色） */
  cls: number;
  /** 編號前綴 */
  prefix: string;
  start: V3;
  end: V3;
  pos: MemberPosition;
  offStart: EndOffset;
  offEnd: EndOffset;
  /** 所屬樓層（報表分層用） */
  levelId?: string;
  startRef?: PointRef;
  endRef?: PointRef;
  /** 編號（Numbering 後才有） */
  mark?: string;
  /** 多邊形鋼板頂點（同一平面） */
  points?: V3[];
  note?: string;
}

export interface GridAxis {
  label: string;
  /** 沿軸向的累計座標 mm */
  offset: number;
}

export interface Grid {
  id: string;
  name: string;
  origin: V3;
  /** 繞 Z 軸旋轉角（度） */
  rotation: number;
  /** X 向座標（垂直 X 軸的軸線，標籤通常為 1 2 3…） */
  xs: GridAxis[];
  /** Y 向座標（垂直 Y 軸的軸線，標籤通常為 A B C…） */
  ys: GridAxis[];
  /** 軸線超出最外側的延伸長度 */
  ext: number;
  /** 使用者輸入的原始文字（Tekla 語法），方便再編輯 */
  xText: string;
  yText: string;
  xLabels: string;
  yLabels: string;
}

export interface Level {
  id: string;
  name: string;
  /** 高程 mm */
  elevation: number;
  /** 樓地板面積 m²；未填則以軸線外框估算 */
  floorArea?: number;
}

export type ViewKind = 'plan' | 'elevation' | '3d';

export interface CameraState {
  target: V3;
  /** 3D：相機距離；平面／立面：可視高度（mm） */
  distance: number;
  yaw: number;
  pitch: number;
  ortho: boolean;
}

export interface ViewDef {
  id: string;
  name: string;
  kind: ViewKind;
  /** 平面視圖所在高程 */
  levelId?: string;
  /** 立面視圖：沿哪條軸線 */
  gridRef?: { gridId: string; dir: 'x' | 'y'; label: string };
  /** 視圖深度（工作平面上下／前後的顯示範圍，mm） */
  depthUp: number;
  depthDown: number;
  camera?: CameraState;
}

export type ToolKey = MemberType;

/** 圖紙放置的目標平面 */
export type DrawingTarget = { kind: 'plan'; levelId: string } | { kind: 'elevation'; gridId: string; dir: 'x' | 'y'; label: string };

/** 專案中的圖紙（幾何資料另存在 IndexedDB，這裡只放設定） */
export interface DrawingRef {
  id: string;
  name: string;
  fileName: string;
  format: 'dxf' | 'dwg' | 'pdf';
  page?: number;
  target: DrawingTarget;
  /** 每個圖紙單位換算成多少 mm（含比例尺） */
  scale: number;
  /** 在目標平面上的旋轉角（度） */
  rotation: number;
  /** 圖紙原點在目標平面上的座標（mm；平面為世界 X／Y，立面為沿軸線水平距離／高程） */
  offset: [number, number];
  visible: boolean;
  opacity: number;
  /** 單色顯示 */
  mono: boolean;
  showText: boolean;
  hiddenLayers: string[];
  /** 顯示 PDF 點陣底圖 */
  raster: boolean;
  encoding: string;
}

/** 每種構件工具的預設屬性（仿 Tekla 屬性對話框的儲存值） */
export interface MemberDefaults {
  name: string;
  profile: string;
  material: string;
  cls: number;
  prefix: string;
  pos: MemberPosition;
  /** 柱：底部、頂部參考樓層與偏移 */
  bottomLevelId?: string;
  bottomOffset?: number;
  topLevelId?: string;
  topOffset?: number;
}

export interface ProjectSettings {
  /** 報表各表隱藏的欄位（表 id → 欄位 key） */
  reportHidden: Record<string, string[]>;
  /** 塗裝面積是否含端面 */
  paintIncludeEnds: boolean;
  /** 編號長度容差 mm */
  numberTolerance: number;
  defaults: Record<ToolKey, MemberDefaults>;
}

export interface ProjectInfo {
  /** 公司名稱（報表表頭） */
  company: string;
  client: string;
  location: string;
  designer: string;
  note: string;
}

export interface Project {
  format: 'steel-takeoff';
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  info: ProjectInfo;
  settings: ProjectSettings;
  grids: Grid[];
  levels: Level[];
  members: Member[];
  views: ViewDef[];
  drawings: DrawingRef[];
  /** 斷面對照表（圖面編號 → 斷面），辨識梁柱時使用 */
  schedule: ScheduleRow[];
  customMaterials: Material[];
}

export interface ScheduleRow {
  mark: string;
  profile: string;
  type: MemberType | '';
}

export type Collection = 'members' | 'grids' | 'levels' | 'views' | 'drawings';
