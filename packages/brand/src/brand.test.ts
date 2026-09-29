import { describe, expect, test } from 'bun:test';
import { ANSI_COMPACT, ANSI_FULL, HELENA_ANSI, renderAnsi } from './ansi';
import { mailHeaderHtml } from './mail';
import { ORB } from './palette';
import {
  faviconSvg,
  lockupSvg,
  markSvg,
  orbBody,
  orbGeometry,
  socialPreviewSvg,
  wordmarkSvg,
} from './svg';

const numbers = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

describe('ANSI wordmark', () => {
  test('every row is 50 cells, as figlet sets HELENA', () => {
    for (const row of HELENA_ANSI) expect([...row].length).toBe(50);
  });

  test('the full drawing sits on whole units', () => {
    const art = renderAnsi(HELENA_ANSI, ANSI_FULL);
    expect([art.width, art.height]).toEqual([300, 84]);
    for (const row of art.rows)
      for (const n of numbers(row.d)) expect(Number.isInteger(n)).toBe(true);
  });

  test('the compact drawing has half the size', () => {
    const art = renderAnsi(HELENA_ANSI, ANSI_COMPACT);
    expect([art.width, art.height]).toEqual([150, 42]);
    for (const row of art.rows)
      for (const n of numbers(row.d)) expect(Number.isInteger(n)).toBe(true);
  });
});

describe('orb', () => {
  test('the regular and small optical geometry is exact', () => {
    expect(orbGeometry('regular')).toEqual({ stroke: 7, core: 10, satellite: 6.5 });
    expect(orbGeometry('small')).toEqual({ stroke: 9, core: 11, satellite: 7.5 });
    const small = orbBody('tile-light', 'small');
    expect(small).toContain('<rect x="0" y="0" width="100" height="100" rx="23"');
    expect(small).toContain('cx="50" cy="52" r="23" fill="none"');
    expect(small).toContain('cx="72" cy="30" r="7.5"');
  });

  test('all five variants use the specified colours', () => {
    expect(orbBody('tile-light', 'regular')).toContain(`fill="${ORB.tileLight}"`);
    expect(orbBody('tile-dark', 'regular')).toContain(`fill="${ORB.tileDark}"`);
    expect(orbBody('bare-light', 'regular')).toContain(`fill="${ORB.tileLight}"`);
    expect(orbBody('bare-dark', 'regular')).toContain(`fill="${ORB.paper}"`);
    expect(orbBody('mono', 'regular')).toContain('stroke="currentColor"');
    for (const variant of ['bare-light', 'bare-dark', 'mono'] as const)
      expect(orbBody(variant, 'regular')).not.toContain('<rect');
  });

  test('favicon switches theme and maskable mark stays within the safe zone', () => {
    expect(faviconSvg()).toContain('prefers-color-scheme: dark');
    expect(faviconSvg()).toContain(ORB.tileDark);
    expect(markSvg({ variant: 'tile-light', inset: 10 })).toContain('translate(10 10) scale(0.8)');
  });
});

describe('files and mail', () => {
  test('wordmark, lockup and preview render', () => {
    for (const theme of ['dark', 'light'] as const) {
      expect(wordmarkSvg('full', theme)).toStartWith('<svg');
      expect(lockupSvg(theme)).toContain('aria-label="Helena"');
    }
    expect(socialPreviewSvg()).toContain('viewBox="0 0 1280 640"');
  });

  test('mail header embeds the Orb and a readable text fallback', () => {
    const html = mailHeaderHtml();
    expect(html).toContain('<svg');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('>Helena</td>');
    expect(html).not.toContain('██');
  });
});
