import type { BandColor } from './palette';

// HELENA in the figlet font "ANSI Shadow", the font of Hermes Agent's banner
// (HERMES-AGENT in ui-tui/src/banner.ts and hermes_cli/banner.py): full blocks for the
// letters, double box-drawing lines for the shadow that falls down and to the right.
// Hermes colours the six rows in three bands, two rows each: gold, amber, bronze.
export const HELENA_ANSI = [
  '██╗  ██╗███████╗██╗     ███████╗███╗   ██╗ █████╗ ',
  '██║  ██║██╔════╝██║     ██╔════╝████╗  ██║██╔══██╗',
  '███████║█████╗  ██║     █████╗  ██╔██╗ ██║███████║',
  '██╔══██║██╔══╝  ██║     ██╔══╝  ██║╚██╗██║██╔══██║',
  '██║  ██║███████╗███████╗███████╗██║ ╚████║██║  ██║',
  '╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝',
] as const;

// The band of each row, as in Hermes' LOGO_GRADIENT [0, 0, 1, 1, 2, 2].
export const ROW_BANDS: readonly BandColor[] = [
  'gold',
  'gold',
  'amber',
  'amber',
  'bronze',
  'bronze',
];

// How one character cell is drawn. `cell` is its width and height; the shadow is
// 'double' (two lines `gap` apart around the cell's centre line, as a terminal draws
// ═ ║ ╗ ╝ ╚ ╔), 'single' (one line on the centre, for small sizes where two would
// blur into one) or 'none' (blocks only). `line` is the stroke width. With the default
// full geometry (6×14, gap 3, line 1) every edge falls on a whole unit, so the drawing
// is crisp at 1 unit = 1 device pixel and at every whole multiple of it.
export interface AnsiGeometry {
  cell: readonly [number, number];
  shadow: 'double' | 'single' | 'none';
  gap: number;
  line: number;
}

export const ANSI_FULL: AnsiGeometry = { cell: [6, 14], shadow: 'double', gap: 3, line: 1 };
export const ANSI_COMPACT: AnsiGeometry = { cell: [3, 7], shadow: 'single', gap: 0, line: 1 };
export const ANSI_BLOCKS: AnsiGeometry = { cell: [6, 14], shadow: 'none', gap: 0, line: 1 };

export interface AnsiRow {
  band: BandColor;
  // Path data of the row's blocks and of its shadow lines, in the art's units.
  d: string;
}

export interface AnsiArt {
  width: number;
  height: number;
  rows: AnsiRow[];
}

const num = (v: number) => String(Math.round(v * 1000) / 1000);
const rect = (x: number, y: number, w: number, h: number) =>
  `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}z`;

// Draws ANSI art as filled rectangles (no strokes, so a rasteriser has nothing to
// round). Runs of blocks merge into one rectangle; each box-drawing character becomes
// the line segments a terminal draws for it, reaching the cell's edges so neighbouring
// cells join without a seam. With shadow 'none' the empty last row is dropped.
export function renderAnsi(rows: readonly string[], geometry: AnsiGeometry): AnsiArt {
  const [W, H] = geometry.cell;
  const { line: s, shadow } = geometry;
  const d = shadow === 'double' ? geometry.gap / 2 : 0;
  const offsets = shadow === 'double' ? [-d, d] : [0];
  const drawn = shadow === 'none' ? rows.filter((row) => row.includes('█')) : rows;
  const out = drawn.map((row, ri): AnsiRow => {
    const y0 = ri * H;
    const cy = y0 + H / 2;
    const parts: string[] = [];
    const chars = [...row];
    let run = -1;
    const flush = (end: number) => {
      if (run >= 0) parts.push(rect(run * W, y0, (end - run) * W, H));
      run = -1;
    };
    const hLine = (y: number, xa: number, xb: number) =>
      parts.push(rect(Math.min(xa, xb), y - s / 2, Math.abs(xb - xa), s));
    const vLine = (x: number, ya: number, yb: number) =>
      parts.push(rect(x - s / 2, Math.min(ya, yb), s, Math.abs(yb - ya)));
    chars.forEach((c, ci) => {
      if (c === '█') {
        if (run < 0) run = ci;
        return;
      }
      flush(ci);
      if (shadow === 'none') return;
      const x0 = ci * W;
      const x1 = x0 + W;
      const y1 = y0 + H;
      const cx = x0 + W / 2;
      const h = s / 2;
      // A corner is drawn once per line: the outer one at offset +d, the inner at -d.
      switch (c) {
        case '═':
          offsets.forEach((o) => hLine(cy + o, x0, x1));
          break;
        case '║':
          offsets.forEach((o) => vLine(cx + o, y0, y1));
          break;
        case '╗': // from the left, turning down; the outer line runs top and right
          for (const o of offsets) {
            hLine(cy - o, x0, cx + o + h);
            vLine(cx + o, cy - o - h, y1);
          }
          break;
        case '╔': // from the right, turning down; the outer line runs top and left
          for (const o of offsets) {
            hLine(cy - o, cx - o - h, x1);
            vLine(cx - o, cy - o - h, y1);
          }
          break;
        case '╝': // from the left, turning up; the outer line runs bottom and right
          for (const o of offsets) {
            hLine(cy + o, x0, cx + o + h);
            vLine(cx + o, y0, cy + o + h);
          }
          break;
        case '╚': // from the right, turning up; the outer line runs bottom and left
          for (const o of offsets) {
            hLine(cy + o, cx - o - h, x1);
            vLine(cx - o, y0, cy + o + h);
          }
          break;
      }
    });
    flush(chars.length);
    return { band: ROW_BANDS[ri] ?? 'bronze', d: parts.join('') };
  });
  const width = Math.max(...rows.map((row) => [...row].length)) * W;
  return { width, height: drawn.length * H, rows: out };
}
