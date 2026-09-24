import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  addDays,
  daysBetween,
  formatDuration,
  fromZonedParts,
  isTimeZone,
  setDisplayLocale,
  setDisplayTimezone,
  toZonedParts,
} from './dates';

afterEach(() => {
  setDisplayTimezone('');
  setDisplayLocale('en');
});

describe('zoned date-time parts', () => {
  it('reads the day and time a moment falls on in the display zone', () => {
    setDisplayTimezone('Europe/Berlin');
    assert.deepEqual(toZonedParts('2026-07-01T22:30:00Z'), { day: '2026-07-02', time: '00:30' });
    assert.deepEqual(toZonedParts('2026-01-15T08:05:00Z'), { day: '2026-01-15', time: '09:05' });
    setDisplayTimezone('America/New_York');
    assert.deepEqual(toZonedParts('2026-07-02T03:00:00Z'), { day: '2026-07-01', time: '23:00' });
    assert.equal(toZonedParts('not a date'), null);
  });

  it('turns a day and time in the display zone back into the moment, across DST', () => {
    setDisplayTimezone('Europe/Berlin');
    assert.equal(fromZonedParts('2026-07-02', '00:30'), '2026-07-01T22:30:00.000Z');
    assert.equal(fromZonedParts('2026-01-15', '09:05'), '2026-01-15T08:05:00.000Z');
    // The day clocks go forward (29 March 2026): 03:30 is already summer time.
    assert.equal(fromZonedParts('2026-03-29', '03:30'), '2026-03-29T01:30:00.000Z');
    // The day clocks go back (25 October 2026): 12:00 is winter time again.
    assert.equal(fromZonedParts('2026-10-25', '12:00'), '2026-10-25T11:00:00.000Z');
  });

  it('round-trips every quarter hour of a DST day', () => {
    setDisplayTimezone('Europe/Berlin');
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      const moment = new Date(Date.UTC(2026, 2, 28, 22, 0) + minutes * 60_000).toISOString();
      const parts = toZonedParts(moment)!;
      assert.equal(fromZonedParts(parts.day, parts.time), moment);
    }
  });
});

describe('day math', () => {
  it('counts calendar days and adds them across a DST switch', () => {
    const before = new Date(2026, 2, 28);
    const after = addDays(before, 2);
    assert.equal(after.getDate(), 30);
    assert.equal(after.getHours(), 0);
    assert.equal(daysBetween(before, after), 2);
    assert.equal(daysBetween(after, before), -2);
  });
});

describe('formatDuration', () => {
  it('names the largest whole unit in the display language', () => {
    assert.equal(formatDuration(5 * 60_000), '5m');
    assert.equal(formatDuration(3 * 3_600_000), '3h');
    assert.equal(formatDuration(11 * 86_400_000), '11d');
    assert.equal(formatDuration(-1), '0m');
    setDisplayLocale('de');
    // Intl.DurationFormat's narrow German form ("5 Min." in V8, "5min" in JSC).
    assert.match(formatDuration(5 * 60_000), /^5\s?Min\.?$/i);
    setDisplayLocale('ru');
    assert.match(formatDuration(3 * 3_600_000), /^3\s?ч/);
  });
});

describe('isTimeZone', () => {
  it('accepts zones Intl knows and nothing else', () => {
    assert.equal(isTimeZone('Europe/Berlin'), true);
    assert.equal(isTimeZone('UTC'), true);
    assert.equal(isTimeZone('Mars/Olympus'), false);
    assert.equal(isTimeZone(''), false);
  });
});
