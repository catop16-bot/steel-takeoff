/** 類別顏色（仿 Tekla class 1–14） */
export const CLASS_COLORS: string[] = [
  '#9aa3ad', // 0 未指定
  '#9aa3ad', // 1 灰
  '#d9534f', // 2 紅
  '#4caf50', // 3 綠
  '#3f7fd9', // 4 藍
  '#26b5c6', // 5 青
  '#e8c547', // 6 黃
  '#c25bc9', // 7 洋紅
  '#a0703e', // 8 棕
  '#2e7d4f', // 9 深綠
  '#2f4c9e', // 10 深藍
  '#7aa83a', // 11 草綠
  '#f08a24', // 12 橙
  '#6c757d', // 13 深灰
  '#e57399', // 14 粉紅
];

export function classColor(cls: number): string {
  return CLASS_COLORS[cls] ?? CLASS_COLORS[1];
}

export const COLORS = {
  selected: '#ff9800',
  hover: '#ffd54f',
  edge: '#2b3138',
  edgeSelected: '#c75b00',
  grid: '#3d7bd9',
  gridFaint: '#8fb3e8',
  level: '#2e9e5b',
  error: '#ff1744',
  preview: '#ff6d00',
  bgPlan: '#eef2f6',
  bg3d: '#dfe7ef',
};
