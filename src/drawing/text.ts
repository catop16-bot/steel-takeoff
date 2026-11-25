/** DXF／DWG 文字編碼與控制碼處理 */

const CODEPAGE: Record<string, string> = {
  ANSI_950: 'big5',
  ANSI_936: 'gbk',
  ANSI_932: 'shift_jis',
  ANSI_949: 'euc-kr',
  ANSI_1250: 'windows-1250',
  ANSI_1251: 'windows-1251',
  ANSI_1252: 'windows-1252',
  ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254',
  ANSI_874: 'windows-874',
  DOS950: 'big5',
  DOS936: 'gbk',
  DOS932: 'shift_jis',
};

/** \M+N 的 N 對應的編碼 */
const MBCS: Record<string, string> = { '1': 'shift_jis', '2': 'big5', '3': 'euc-kr', '5': 'gbk' };

export const ENCODINGS: [string, string][] = [
  ['auto', '自動'],
  ['utf-8', 'UTF-8'],
  ['big5', 'Big5（繁體）'],
  ['gbk', 'GBK（簡體）'],
  ['shift_jis', 'Shift-JIS（日文）'],
  ['windows-1252', '西歐'],
];

function headerVar(head: string, name: string): string | undefined {
  const i = head.indexOf(name);
  if (i < 0) return undefined;
  const m = head.slice(i + name.length, i + name.length + 80).match(/^\s*\r?\n\s*\d+\s*\r?\n([^\r\n]*)/);
  return m?.[1].trim();
}

/** 依 $ACADVER 與 $DWGCODEPAGE 判斷 DXF 文字編碼並解碼 */
export function decodeDxf(bytes: Uint8Array, forced = 'auto'): { text: string; encoding: string } {
  if (forced !== 'auto') return { text: new TextDecoder(forced).decode(bytes), encoding: forced };
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 200000)));
  const ver = headerVar(head, '$ACADVER');
  const cp = headerVar(head, '$DWGCODEPAGE')?.toUpperCase();
  // R2007（AC1021）以後的 DXF 一律 UTF-8
  if (ver && ver >= 'AC1021') return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
  const label = cp ? CODEPAGE[cp] : undefined;
  if (label) {
    try {
      return { text: new TextDecoder(label).decode(bytes), encoding: label };
    } catch {
      /* 不支援的編碼 */
    }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // 台灣舊圖未標編碼時多為 Big5
    return { text: new TextDecoder('big5').decode(bytes), encoding: 'big5' };
  }
}

function decodeMbcs(n: string, hex: string): string {
  const label = MBCS[n];
  if (!label) return '?';
  const bytes = new Uint8Array([parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16)]);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return '?';
  }
}

/** 處理 \U+XXXX、\M+NXXXX、%%c 等控制碼（TEXT 與 MTEXT 共用） */
export function decodeEscapes(s: string): string {
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4,5})/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\M\+([1-5])([0-9A-Fa-f]{4})/g, (_, n, h) => decodeMbcs(n, h))
    .replace(/%%(\d{3})/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/%%[cC]/g, '⌀')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoOkK]/g, '')
    .replace(/%%%/g, '%');
}

/** 去掉 MTEXT 格式碼，回傳以 \n 分行的純文字 */
export function stripMText(raw: string): string {
  const s = decodeEscapes(raw);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{' || c === '}') continue;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = s[i + 1];
    if (n === undefined) break;
    if (n === 'P' || n === 'X') {
      out += '\n';
      i++;
    } else if (n === '~') {
      out += ' ';
      i++;
    } else if (n === '\\' || n === '{' || n === '}') {
      out += n;
      i++;
    } else if ('LlOoKkNn'.includes(n)) {
      i++;
    } else if (n === 'S') {
      // 堆疊：\S上^下; 或 \S上/下; 或 \S上#下;
      const end = s.indexOf(';', i);
      const body = end > 0 ? s.slice(i + 2, end) : s.slice(i + 2);
      out += body.replace(/[\^#]/g, '/');
      i = end > 0 ? end : s.length;
    } else if ('fFHWQTACcpa'.includes(n)) {
      const end = s.indexOf(';', i);
      i = end > 0 ? end : s.length;
    } else {
      out += n;
      i++;
    }
  }
  return out.replace(/ /g, ' ');
}

// ---------- AutoCAD 顏色 ----------

const BASE: Record<number, string> = {
  1: '#ff0000',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#0000ff',
  6: '#ff00ff',
  7: '#ffffff',
  8: '#808080',
  9: '#c0c0c0',
};

function hsv(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}

/** ACI 色號 → RGB（10–249 依標準色盤的色相／明度規則近似） */
export function aciColor(aci: number): string {
  const a = Math.abs(aci);
  if (BASE[a]) return BASE[a];
  if (a >= 10 && a <= 249) {
    const hue = Math.floor((a - 10) / 10) * 15;
    const k = (a - 10) % 10;
    const v = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][k];
    const s = k % 2 === 0 ? 1 : 0.5;
    return hsv(hue, s, v);
  }
  if (a >= 250 && a <= 255) {
    const g = [51, 91, 132, 173, 214, 255][a - 250];
    const h = g.toString(16).padStart(2, '0');
    return `#${h}${h}${h}`;
  }
  return '#ffffff';
}

/** 在淺色背景上看得清楚：太亮的顏色壓暗 */
export function visibleOnLight(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum < 0.62) return hex;
  const k = 0.62 / lum;
  const to = (x: number) =>
    Math.round(x * k)
      .toString(16)
      .padStart(2, '0');
  // 白色（色號 7）改成深灰
  if (r > 240 && g > 240 && b > 240) return '#2b2f33';
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbHex(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** $INSUNITS → mm */
export function insunitsToMm(u: number): { scale: number; name: string; known: boolean } {
  switch (u) {
    case 1:
      return { scale: 25.4, name: '英寸', known: true };
    case 2:
      return { scale: 304.8, name: '英尺', known: true };
    case 4:
      return { scale: 1, name: 'mm', known: true };
    case 5:
      return { scale: 10, name: 'cm', known: true };
    case 6:
      return { scale: 1000, name: 'm', known: true };
    case 14:
      return { scale: 100, name: 'dm', known: true };
    default:
      return { scale: 1, name: '未指定（視為 mm）', known: false };
  }
}
