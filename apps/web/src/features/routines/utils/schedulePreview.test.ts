import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isTimeZone, nextRuns } from './schedulePreview';

describe('schedule preview', () => {
  test('lists the next fires in the time zone of the schedule', () => {
    const from = new Date('2026-10-23T12:00:00.000Z');
    assert.deepEqual(
      nextRuns('0 9 * * *', 'Europe/Berlin', 3, from).map((run) => run.toISOString()),
      // Berlin leaves summer time on 25 October, so 09:00 moves from 07:00 to 08:00 UTC.
      ['2026-10-24T07:00:00.000Z', '2026-10-25T08:00:00.000Z', '2026-10-26T08:00:00.000Z'],
    );
    assert.deepEqual(
      nextRuns('0 9 * * *', 'UTC', 1, from).map((run) => run.toISOString()),
      ['2026-10-24T09:00:00.000Z'],
    );
  });

  test('has no preview for a cron or a time zone that does not parse', () => {
    assert.deepEqual(nextRuns('every day', 'Europe/Berlin'), []);
    assert.deepEqual(nextRuns('0 9 * * *', 'Mars/Olympus'), []);
    assert.equal(isTimeZone('Europe/Berlin'), true);
    assert.equal(isTimeZone(''), false);
    assert.equal(isTimeZone('Mars/Olympus'), false);
  });
});
