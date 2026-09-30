import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasEntries, joinEntries, noteLines, parseEntries } from './memoryEntries';

describe('memory entries', () => {
  it('splits a Hermes file at its "§" lines and never keeps the separator', () => {
    const file = 'Erster Eintrag\n§\nZweiter\nüber zwei Zeilen\n§\n\n§\nDritter';
    assert.equal(hasEntries(file), true);
    assert.deepEqual(parseEntries(file), [
      'Erster Eintrag',
      'Zweiter\nüber zwei Zeilen',
      'Dritter',
    ]);
  });

  it('leaves a plain Markdown file as it is', () => {
    const file = '- eins\n- zwei § kein Trenner';
    assert.equal(hasEntries(file), false);
  });

  it('writes the entries back with the separator between them', () => {
    const entries = ['A', ' B ', '', 'C'];
    assert.equal(joinEntries(entries), 'A\n§\nB\n§\nC');
    assert.deepEqual(parseEntries(joinEntries(entries)), ['A', 'B', 'C']);
  });

  it('reads the time of a daily note line', () => {
    assert.deepEqual(noteLines('- 08:12 Build lief.\n- ohne Uhrzeit\n\n'), [
      { time: '08:12', text: 'Build lief.' },
      { time: null, text: 'ohne Uhrzeit' },
    ]);
  });
});
