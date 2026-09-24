import { describe, expect, test } from 'bun:test';
import { ANSI_COMPACT, ANSI_FULL, HELENA_ANSI, renderAnsi } from './ansi';
import { markLayers } from './art';
import { mailHeaderHtml } from './mail';
import { TORCH } from './pixel';
import { lockupSvg, markSvg, socialPreviewSvg, wordmarkSvg } from './svg';

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

describe('mark', () => {
  test('the torch is a 16×16 map of the three bands, centred', () => {
    expect(TORCH.length).toBe(16);
    for (const row of TORCH) expect(row).toMatch(/^[.gab]{16}$/);
    const cols = TORCH.flatMap((row) => [...row].flatMap((c, x) => (c === '.' ? [] : [x])));
    expect(Math.abs(Math.min(...cols) - (15 - Math.max(...cols)))).toBeLessThanOrEqual(1);
  });

  test('small is pixels only; large adds the shadow hairlines', () => {
    expect(markLayers('small').some((l) => l.echo)).toBe(false);
    expect(markLayers('large').some((l) => l.echo)).toBe(true);
  });
});

describe('files', () => {
  test('every file renders', () => {
    expect(markSvg({ detail: 'small', frame: 'tile' })).toContain('crispEdges');
    expect(markSvg({ detail: 'large', frame: 'bleed', pad: 4 })).toContain('viewBox="-4 -4 24 24"');
    for (const theme of ['dark', 'light'] as const) {
      expect(wordmarkSvg('full', theme)).toStartWith('<svg');
      expect(lockupSvg(theme)).toContain('aria-label="Helena"');
    }
    expect(socialPreviewSvg()).toContain('viewBox="0 0 1280 640"');
  });

  test('the mail header carries the wordmark as text, never an image', () => {
    const html = mailHeaderHtml();
    expect(html).toContain('██╗  ██╗');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
  });
});
