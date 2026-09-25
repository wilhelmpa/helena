import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { speakable } from './speakable';

describe('speakable', () => {
  it('spells out German abbreviations and symbols', () => {
    assert.equal(
      speakable('Das kostet ca. 40 € bzw. 12 % mehr, z. B. bei Verve & Co.'),
      'Das kostet circa 40 Euro beziehungsweise 12 Prozent mehr, zum Beispiel bei Verve und Co.',
    );
    assert.equal(speakable('Siehe Nr. 3, d.h. die Liste usw.'), 'Siehe Nummer 3, das heißt die Liste und so weiter');
  });

  it('says links as their site, task keys as words, and drops emojis', () => {
    assert.equal(
      speakable('Offen: https://www.volition.one/pricing?x=1 → VOL-42 ✅ fertig 👍🏽'),
      'Offen: volition.one, VOL 42 fertig',
    );
  });

  it('leaves other languages but the symbols alone', () => {
    assert.equal(speakable('Up 5% e.g. today', 'en'), 'Up 5 percent for example today');
    assert.equal(speakable('Hausse de 5 € env.', 'fr'), 'Hausse de 5 € env.');
  });
});
