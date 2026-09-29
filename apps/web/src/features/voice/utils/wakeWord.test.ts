import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { wakeWordRemainder } from './wakeWord';

describe('Ava transcript gate', () => {
  it('recognizes each written form and keeps an immediate first utterance', () => {
    for (const name of ['Ava', 'Eywa', 'Ewa', 'Aiwa']) {
      assert.equal(wakeWordRemainder(`${name}, mach das Licht an`), 'mach das Licht an');
      assert.equal(wakeWordRemainder(name), '');
    }
  });

  it('rejects similar words and wake words embedded in ordinary speech', () => {
    for (const text of ['aber', 'Eva', 'Hawaii', 'einwandfrei', 'brav', 'Hallo Ava']) {
      assert.equal(wakeWordRemainder(text), null);
    }
  });
});
