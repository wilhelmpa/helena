import type { BandColor } from './palette';

// The mark is pixel art on a 16×16 grid, the favicon's own size, so the 16px and 32px
// icons are crisp without hinting. One character per pixel: g gold, a amber, b bronze,
// '.' empty. It follows Hermes' banding: gold on top, amber in the middle, bronze at
// the foot.
export type PixelMap = readonly string[];

const KEYS: Record<string, BandColor> = { g: 'gold', a: 'amber', b: 'bronze' };

// Helena's torch: a flame leaning into the light with an ember breaking off, a wide
// rim, a tapering cup and the grip. Hermes carries the caduceus, Helena the torch.
export const TORCH: PixelMap = [
  '................',
  '.........g......',
  '........gg......',
  '.......ggg......',
  '......gggg.g....',
  '......ggggg.....',
  '.....aaagaaa....',
  '.....aaaaaa.....',
  '......aaaa......',
  '....bbbbbbbb....',
  '.....bbbbbb.....',
  '......bbbb......',
  '.......bb.......',
  '.......bb.......',
  '.......bb.......',
  '................',
];

export interface PixelLayer {
  color: BandColor;
  d: string;
}

const num = (v: number) => String(Math.round(v * 1000) / 1000);
const rect = (x: number, y: number, w: number, h: number) =>
  `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}z`;

// One path per colour; each row's runs of a colour merge into one rectangle.
export function pixelLayers(map: PixelMap): PixelLayer[] {
  const byColor = new Map<BandColor, string[]>();
  map.forEach((row, y) => {
    let start = -1;
    let key = '';
    [...row, '.'].forEach((c, x) => {
      if (start >= 0 && c !== key) {
        const color = KEYS[key];
        if (color)
          byColor.set(color, [...(byColor.get(color) ?? []), rect(start, y, x - start, 1)]);
        start = -1;
      }
      if (start < 0 && KEYS[c]) {
        start = x;
        key = c;
      }
    });
  });
  return [...byColor].map(([color, parts]) => ({ color, d: parts.join('') }));
}

// The Hermes shadow for a mark drawn large (app icons, the sign-in panel): the mark's
// outline repeated as two hairlines, shifted down and to the right, each segment in the
// colour of the pixel it outlines. Drawn under the pixels, so only the parts that fall
// outside the mark show, the way ANSI Shadow's ╗ ║ ╝ lines trail its blocks. The
// offsets are in pixels; below ~64px the hairlines are thinner than a device pixel, so
// small renderings leave them out.
export const ECHO_OFFSETS: readonly (readonly [number, number])[] = [
  [0.2, 0.36],
  [0.46, 0.66],
];
export const ECHO_LINE = 0.075;

export function echoLayers(map: PixelMap): PixelLayer[] {
  const on = (x: number, y: number) => KEYS[map[y]?.[x] ?? '.'] !== undefined;
  const byColor = new Map<BandColor, string[]>();
  const s = ECHO_LINE;
  for (const [dx, dy] of ECHO_OFFSETS) {
    map.forEach((row, y) =>
      [...row].forEach((c, x) => {
        const color = KEYS[c];
        if (!color) return;
        const parts = byColor.get(color) ?? [];
        const h = (yy: number) => parts.push(rect(x + dx - s / 2, yy + dy - s / 2, 1 + s, s));
        const v = (xx: number) => parts.push(rect(xx + dx - s / 2, y + dy - s / 2, s, 1 + s));
        if (!on(x, y - 1)) h(y);
        if (!on(x, y + 1)) h(y + 1);
        if (!on(x - 1, y)) v(x);
        if (!on(x + 1, y)) v(x + 1);
        byColor.set(color, parts);
      }),
    );
  }
  return [...byColor].map(([color, parts]) => ({ color, d: parts.join('') }));
}
