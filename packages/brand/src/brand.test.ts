import { describe, expect, test } from 'bun:test';
import { ANSI_COMPACT, ANSI_FULL, HELENA_ANSI, renderAnsi } from './ansi';
import { markLayers, wordmarkArt } from './art';
import { BRAND_VARIANT, BRAND_VARIANTS } from './config';
import { mailHeaderHtml } from './mail';
import { MONOGRAM, SPARK, TORCH } from './pixel';
import { lockupSvg, markSvg, wordmarkSvg } from './svg';

const numbers = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

describe('ANSI wordmark', () => {
  test('every row is 50 cells, as figlet sets HELENA', () => {
    for (const row of HELENA_ANSI) expect([...row].length).toBe(50);
  });

  test('the full drawing sits on whole units, so it is crisp at 1 unit = 1 device pixel', () => {
    const art = renderAnsi(HELENA_ANSI, ANSI_FULL);
    expect([art.width, art.height]).toEqual([300, 84]);
    for (const row of art.rows)
      for (const n of numbers(row.d)) expect(Number.isInteger(n)).toBe(true);
  });

  test('the compact drawing too (half the size, one shadow line)', () => {
    const art = renderAnsi(HELENA_ANSI, ANSI_COMPACT);
    expect([art.width, art.height]).toEqual([150, 42]);
    for (const row of art.rows)
      for (const n of numbers(row.d)) expect(Number.isInteger(n)).toBe(true);
  });

  test('rows take Hermes bands: gold, gold, amber, amber, bronze, bronze', () => {
    const bands = renderAnsi(HELENA_ANSI, ANSI_FULL).rows.map((r) => r.band);
    expect(bands).toEqual(['gold', 'gold', 'amber', 'amber', 'bronze', 'bronze']);
  });
});

describe('marks', () => {
  test.each([
    ['torch', TORCH],
    ['monogram', MONOGRAM],
    ['spark', SPARK],
  ])('%s is a 16×16 map of known colours, centred', (_name, map) => {
    expect(map.length).toBe(16);
    for (const row of map) expect(row).toMatch(/^[.gabc]{16}$/);
    // Centred horizontally: the art's left and right margins differ by at most one.
    const cols = map.flatMap((row) => [...row].flatMap((c, x) => (c === '.' ? [] : [x])));
    expect(Math.abs(Math.min(...cols) - (15 - Math.max(...cols)))).toBeLessThanOrEqual(1);
  });

  test('small marks are pixels only; large ones add the shadow where the variant has it', () => {
    for (const v of BRAND_VARIANTS) expect(markLayers(v, 'small').some((l) => l.echo)).toBe(false);
    expect(markLayers('fackel', 'large').some((l) => l.echo)).toBe(true);
    expect(markLayers('monogramm', 'large').some((l) => l.echo)).toBe(false);
  });
});

describe('files', () => {
  test.each(BRAND_VARIANTS)('%s renders every file', (v) => {
    expect(markSvg(v, { detail: 'small', frame: 'tile' })).toContain('crispEdges');
    expect(markSvg(v, { detail: 'large', frame: 'bleed', pad: 4 })).toContain(
      'viewBox="-4 -4 24 24"',
    );
    for (const theme of ['dark', 'light'] as const) {
      expect(wordmarkSvg(v, 'full', theme)).toStartWith('<svg');
      expect(lockupSvg(v, theme)).toContain('aria-label="Helena"');
    }
  });

  test('the monogram variant draws its compact wordmark in the text colour', () => {
    expect(wordmarkArt('monogramm', 'compact').tone).toBe('text');
  });

  test('the mail header carries the wordmark as text, never an image', () => {
    const html = mailHeaderHtml(BRAND_VARIANT);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
  });
});
