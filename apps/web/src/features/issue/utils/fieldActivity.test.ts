import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setDisplayLocale, setDisplayTimezone } from '@/utils/dates';
import { readableFieldValue } from './fieldActivity';

const words = { yes: 'Ja', no: 'Nein' };

describe('readableFieldValue', () => {
  setDisplayLocale('de');
  setDisplayTimezone('Europe/Berlin');

  it('words a checkbox', () => {
    assert.equal(readableFieldValue('true', words), 'Ja');
    assert.equal(readableFieldValue('false', words), 'Nein');
  });

  it('shows a UTC moment in the reader zone, not as ISO', () => {
    const shown = readableFieldValue('2026-09-27T07:00:00.000Z', words);
    assert.doesNotMatch(shown, /T07:00|Z$/);
    assert.match(shown, /09:00/);
  });

  it('shows a range and a calendar day readably', () => {
    const range = readableFieldValue('2026-09-27T07:00:00.000Z — 2026-09-27T09:30:00.000Z', words);
    assert.match(range, /09:00 – 11:30/);
    assert.doesNotMatch(readableFieldValue('2026-09-27', words), /^2026-09-27$/);
  });

  it('leaves text alone', () => {
    assert.equal(readableFieldValue('Rot', words), 'Rot');
  });
});
