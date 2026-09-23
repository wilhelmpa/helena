import { describe, expect, test } from 'bun:test';
import { minCronIntervalSeconds } from '../../cron';

describe('minCronIntervalSeconds', () => {
  const from = new Date('2026-07-15T08:30:00.000Z');

  test('measures an even schedule', () => {
    expect(minCronIntervalSeconds('*/5 * * * *', 'Europe/Berlin', from)).toBe(300);
    expect(minCronIntervalSeconds('0 9 * * *', 'Europe/Berlin', from)).toBe(86_400);
  });

  test('takes the shortest gap of an uneven schedule, not the first', () => {
    // 09:00 and 09:01 every day: the gap after the first run is a minute, the one
    // after it a day.
    expect(minCronIntervalSeconds('0,1 9 * * *', 'Europe/Berlin', from)).toBe(60);
  });

  test('rejects an invalid expression and an unknown time zone', () => {
    expect(() => minCronIntervalSeconds('not a cron', 'Europe/Berlin')).toThrow(
      'Invalid cron expression',
    );
    expect(() => minCronIntervalSeconds('0 9 * * *', 'Mars/Olympus')).toThrow('Invalid time zone');
  });
});
