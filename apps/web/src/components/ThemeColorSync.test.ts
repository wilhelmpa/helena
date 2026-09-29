import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from '@/utils/app';
import { syncThemeColor } from './ThemeColorSync';

// O70: on the phone a band in another colour sat over the header. The status bar takes
// theme-color; it must be the page background of the theme the member chose.
test('both theme-color tags carry the chosen theme, whatever the system prefers', () => {
  const dom = new JSDOM(
    '<head><meta name="theme-color" media="(prefers-color-scheme: light)" content="#fff"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000"></head>',
  );
  const doc = dom.window.document;
  syncThemeColor(doc, 'light');
  const colors = () =>
    [...doc.querySelectorAll('meta[name="theme-color"]')].map((tag) => tag.getAttribute('content'));
  assert.deepEqual(colors(), [THEME_COLOR_LIGHT, THEME_COLOR_LIGHT]);
  syncThemeColor(doc, 'dark');
  assert.deepEqual(colors(), [THEME_COLOR_DARK, THEME_COLOR_DARK]);
});

test('the colours are the page background tokens of each theme', () => {
  const tokens = readFileSync(new URL('../design-system/tokens.css', import.meta.url), 'utf8');
  const light = tokens.match(/\[data-theme='light'\]\s*{[^}]*?--bg:\s*(#[0-9a-f]+)/i)?.[1];
  const dark = tokens.match(/\[data-theme='dark'\]\s*{[^}]*?--bg:\s*(#[0-9a-f]+)/i)?.[1];
  assert.equal(THEME_COLOR_LIGHT.toLowerCase(), light?.toLowerCase());
  assert.equal(THEME_COLOR_DARK.toLowerCase(), dark?.toLowerCase());
});
