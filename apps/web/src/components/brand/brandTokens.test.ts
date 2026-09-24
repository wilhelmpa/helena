import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BANDS, TILE, type BandColor } from '@helena/brand';

// globals.css repeats the brand's colours as CSS tokens (a stylesheet cannot import
// them); this keeps the two in step.
const css = readFileSync(join(import.meta.dirname, '../../app/globals.css'), 'utf8');
const block = (selector: RegExp) => css.match(selector)?.[1] ?? '';
const token = (body: string, name: string) =>
  body.match(new RegExp(`--helena-${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]?.toLowerCase();

describe('brand tokens in globals.css', () => {
  const light = block(/:root \{([\s\S]*?)\n\}/);
  const dark = block(/\.dark,\s*\.helena-on-ink \{([\s\S]*?)\}/);
  const bands: BandColor[] = ['gold', 'amber', 'bronze'];

  for (const band of bands) {
    it(`${band} matches the palette in both themes`, () => {
      assert.equal(token(light, band), BANDS.light[band].toLowerCase());
      assert.equal(token(dark, band), BANDS.dark[band].toLowerCase());
    });
  }

  it('the ink is the tile colour', () => {
    assert.equal(token(light, 'ink'), TILE.toLowerCase());
  });
});
