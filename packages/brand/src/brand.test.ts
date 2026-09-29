import { describe, expect, test } from 'bun:test';
import { TERMINAL_WORDMARK, terminalWordmark } from './ansi';
import { MAIL_INLINE_IMAGES, MAIL_ORB_CID, mailHeaderHtml } from './mail';
import { ORB } from './palette';
import {
  DISC_RADIUS,
  discBody,
  faviconSvg,
  lockupSvg,
  markSvg,
  socialPreviewSvg,
  wordmarkGeometry,
  wordmarkSvg,
} from './svg';
import { WORDMARK_GLYPHS } from './wordmark-glyphs';

const orb = { href: 'data:image/png;base64,AA==', fraction: 0.94 };

describe('vector Orb', () => {
  test('every variant draws the disc; only tiles carry a background', () => {
    expect(discBody('bare-dark')).toContain(`r="${DISC_RADIUS.bare}"`);
    expect(discBody('tile-dark')).toContain(`fill="${ORB.ink}"`);
    expect(discBody('tile-light')).toContain(`fill="${ORB.paper}"`);
    expect(discBody('mono')).toBe(
      `<circle cx="50" cy="50" r="${DISC_RADIUS.bare}" fill="currentColor"/>`,
    );
    for (const variant of ['bare-dark', 'bare-light', 'mono'] as const)
      expect(discBody(variant)).not.toContain('<rect');
  });

  test('the gradient runs violet to pink, deeper on light surfaces', () => {
    for (const c of ORB.onDark) expect(discBody('bare-dark')).toContain(c);
    for (const c of ORB.onLight) expect(discBody('bare-light')).toContain(c);
  });

  test('the favicon follows the colour scheme with distinct gradient ids', () => {
    const fav = faviconSvg();
    expect(fav).toContain('prefers-color-scheme: dark');
    expect(fav).toContain('id="ava-l"');
    expect(fav).toContain('id="ava-d"');
    expect(markSvg()).toStartWith('<svg');
  });
});

describe('wordmark', () => {
  test('AVA in Inter Light at 0.32em, and Regular for the compact size', () => {
    expect(WORDMARK_GLYPHS.full).toMatchObject({ weight: 300, tracking: 0.32 });
    expect(WORDMARK_GLYPHS.compact).toMatchObject({ weight: 400, tracking: 0.32 });
    // At least one outline per letter.
    expect(WORDMARK_GLYPHS.full.d.split('M').length - 1).toBeGreaterThanOrEqual(3);
  });

  test('the box runs from the cap height to the baseline', () => {
    const g = wordmarkGeometry('full');
    expect(g.y).toBe(-1490);
    expect(g.y + g.height).toBe(0);
    expect(g.width / g.height).toBeGreaterThan(3);
  });

  test('themes colour the letters', () => {
    expect(wordmarkSvg('full', 'dark')).toContain(`fill="${ORB.paper}"`);
    expect(wordmarkSvg('full', 'light')).toContain(`fill="${ORB.text}"`);
    expect(wordmarkSvg('compact', 'mono')).toContain('fill="currentColor"');
  });
});

describe('lockup, preview, terminal and mail', () => {
  test('lockup and preview place the particle Orb beside the wordmark', () => {
    for (const theme of ['dark', 'light'] as const) {
      const l = lockupSvg(theme, orb);
      expect(l).toContain(`<image href="${orb.href}"`);
      expect(l).toContain('aria-label="AVA"');
    }
    const preview = socialPreviewSvg(orb);
    expect(preview).toContain('viewBox="0 0 1280 640"');
    expect(preview).toContain(`fill="${ORB.ink}"`);
  });

  test('the terminal shows only the spaced name', () => {
    expect(TERMINAL_WORDMARK).toBe('A V A');
    expect(terminalWordmark(false)).toBe('A V A');
    expect(terminalWordmark()).toContain('A V A');
  });

  test('the mail header references its inline Orb and keeps a text wordmark', () => {
    const html = mailHeaderHtml('Ava');
    expect(html).toContain(`src="cid:${MAIL_ORB_CID}"`);
    expect(html).toContain('letter-spacing:0.32em">Ava</td>');
    expect(mailHeaderHtml('Atlas')).toContain('>Atlas</td>');
    expect(mailHeaderHtml('Atlas')).not.toContain('>Ava</td>');
    expect(MAIL_INLINE_IMAGES.map((i) => i.cid)).toEqual([MAIL_ORB_CID]);
    // A PNG: the base64 of its signature.
    expect(MAIL_INLINE_IMAGES[0]!.base64.startsWith('iVBORw0KGgo')).toBe(true);
  });
});
