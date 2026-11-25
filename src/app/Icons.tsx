import type { JSX } from 'preact';

const S = (props: { children: JSX.Element | JSX.Element[] }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    {props.children}
  </svg>
);

export const Icon: Record<string, () => JSX.Element> = {
  select: () => (
    <S>
      <path d="M5 3l12 7-5 1.5L9.5 17z" fill="currentColor" fill-opacity="0.15" />
      <path d="M12.5 12l4 6" />
    </S>
  ),
  column: () => (
    <S>
      <path d="M7 3h10M7 21h10M12 3v18" stroke-width="2.2" />
      <path d="M9 3v2M15 3v2M9 19v2M15 19v2" />
    </S>
  ),
  girder: () => (
    <S>
      <path d="M2 8h20M2 16h20M2 12h20" stroke-width="1.4" />
      <path d="M2 8v8M22 8v8" />
    </S>
  ),
  beam: () => (
    <S>
      <path d="M3 10h18M3 14h18M3 12h18" stroke-width="1.2" />
      <path d="M3 9v6M21 9v6" />
    </S>
  ),
  brace: () => (
    <S>
      <path d="M4 3v18M20 3v18M4 21L20 3" />
      <path d="M4 3h16M4 21h16" stroke-opacity="0.4" />
    </S>
  ),
  purlin: () => (
    <S>
      <path d="M3 18L12 6l9 12" />
      <path d="M6.5 13.5h3M10 9h4M14.5 13.5h3" stroke-width="2.4" />
    </S>
  ),
  plate: () => (
    <S>
      <path d="M4 8l8-4 8 4-8 4z" fill="currentColor" fill-opacity="0.15" />
      <path d="M4 8v3l8 4 8-4V8" />
    </S>
  ),
  grid: () => (
    <S>
      <path d="M7 3v18M17 3v18M3 7h18M3 17h18" stroke-dasharray="3 1.5" />
      <circle cx="7" cy="3" r="1.2" />
    </S>
  ),
  level: () => (
    <S>
      <path d="M3 6h18M3 12h18M3 18h18" stroke-dasharray="3 1.5" />
      <path d="M17 4l2 2-2 2" />
    </S>
  ),
  del: () => (
    <S>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </S>
  ),
  undo: () => (
    <S>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </S>
  ),
  redo: () => (
    <S>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H10a6 6 0 000 12h3" />
    </S>
  ),
  measure: () => (
    <S>
      <path d="M3 17L17 3l4 4L7 21z" />
      <path d="M7 13l2 2M10 10l2 2M13 7l2 2" />
    </S>
  ),
  fit: () => (
    <S>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </S>
  ),
  views: () => (
    <S>
      <rect x="3" y="4" width="8" height="7" rx="1" />
      <rect x="13" y="4" width="8" height="7" rx="1" />
      <rect x="3" y="13" width="18" height="7" rx="1" />
    </S>
  ),
  cube: () => (
    <S>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </S>
  ),
  number: () => (
    <S>
      <path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16" />
    </S>
  ),
  report: () => (
    <S>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </S>
  ),
  excel: () => (
    <S>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8l8 8M16 8l-8 8" />
    </S>
  ),
  print: () => (
    <S>
      <path d="M7 9V3h10v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </S>
  ),
  file: () => (
    <S>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </S>
  ),
  solid: () => (
    <S>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="currentColor" fill-opacity="0.35" />
    </S>
  ),
  wire: () => (
    <S>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" stroke-dasharray="2 2" />
    </S>
  ),
  line: () => (
    <S>
      <path d="M4 20L20 4" stroke-width="2.2" />
      <circle cx="4" cy="20" r="1.5" fill="currentColor" />
      <circle cx="20" cy="4" r="1.5" fill="currentColor" />
    </S>
  ),
  info: () => (
    <S>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </S>
  ),
  move: () => (
    <S>
      <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
    </S>
  ),
  copy: () => (
    <S>
      <rect x="8" y="8" width="12" height="12" rx="1.5" />
      <path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8" />
    </S>
  ),
  array: () => (
    <S>
      <rect x="3" y="9" width="4" height="6" rx="1" />
      <rect x="10" y="9" width="4" height="6" rx="1" />
      <rect x="17" y="9" width="4" height="6" rx="1" />
    </S>
  ),
  mirror: () => (
    <S>
      <path d="M12 3v18" stroke-dasharray="2 2" />
      <path d="M9 7L4 17h5zM15 7l5 10h-5z" />
    </S>
  ),
  rotate: () => (
    <S>
      <path d="M20 12a8 8 0 11-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </S>
  ),
  split: () => (
    <S>
      <path d="M3 12h7M14 12h7" stroke-width="2.4" />
      <path d="M12 5v14" stroke-dasharray="2 2" />
    </S>
  ),
  dups: () => (
    <S>
      <rect x="4" y="4" width="11" height="11" rx="1.5" />
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M12 13l2 2 3-4" />
    </S>
  ),
  layout1: () => (
    <S>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
    </S>
  ),
  layout2: () => (
    <S>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M12 4v16" />
    </S>
  ),
  layout4: () => (
    <S>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M12 4v16M3 12h18" />
    </S>
  ),
};
