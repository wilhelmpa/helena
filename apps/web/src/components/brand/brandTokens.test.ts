import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANDS, TILE } from '@helena/brand';

// globals.css repeats the brand's colours as CSS tokens (a stylesheet cannot import
// them); this keeps the two in step.
const css = readFileSync(join(import.meta.dirname, '../../app/globals.css'), 'utf8');
const block = (selector: RegExp) => css.match(selector)?.[1] ?? '';
const token = (body: string, name: string) =>
  body.match(new RegExp(`--helena-${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]?.toLowerCase();

describe('brand tokens in globals.css', () => {
  const light = block(/:root \{([\s\S]*?)\n\}/);
  const dark = block(/\.dark,\s*\.helena-on-ink \{([\s\S]*?)\}/);

  test.each(['gold', 'amber', 'bronze'] as const)(
    '%s matches the palette in both themes',
    (band) => {
      expect(token(light, band)).toBe(BANDS.light[band].toLowerCase());
      expect(token(dark, band)).toBe(BANDS.dark[band].toLowerCase());
    },
  );

  test('the ink is the tile colour', () => {
    expect(token(light, 'ink')).toBe(TILE.toLowerCase());
  });
});
