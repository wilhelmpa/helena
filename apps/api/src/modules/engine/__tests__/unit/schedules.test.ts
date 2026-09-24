import { describe, expect, it } from 'bun:test';
import { assertCron, latestFireTime, nextFireTime } from '../../schedules';

// The times a schedule fires, computed with croner in the schedule's time zone, as the
// engine's tick fires them and the UI shows the next one.

const BERLIN = 'Europe/Berlin';
const at = (value: string) => new Date(value);

describe('schedule times', () => {
  it('fires a daily time in Berlin at the wall-clock time, summer and winter', () => {
    expect(nextFireTime('0 9 * * *', BERLIN, at('2026-07-01T12:00:00Z'))).toEqual(
      at('2026-07-02T07:00:00Z'),
    );
    expect(nextFireTime('0 9 * * *', BERLIN, at('2026-12-01T12:00:00Z'))).toEqual(
      at('2026-12-02T08:00:00Z'),
    );
  });

  it('fires a time that does not exist when summer time begins an hour later, once', () => {
    // 29 March 2026: 02:00 becomes 03:00, so 02:30 happens at 03:30 summer time.
    const after = at('2026-03-28T12:00:00Z');
    expect(nextFireTime('30 2 * * *', BERLIN, after)).toEqual(at('2026-03-29T01:30:00Z'));
    expect(latestFireTime('30 2 * * *', BERLIN, after, at('2026-03-29T01:29:00Z'))).toBeNull();
    expect(latestFireTime('30 2 * * *', BERLIN, after, at('2026-03-29T05:00:00Z'))).toEqual(
      at('2026-03-29T01:30:00Z'),
    );
    expect(nextFireTime('30 2 * * *', BERLIN, at('2026-03-29T01:30:00Z'))).toEqual(
      at('2026-03-30T00:30:00Z'),
    );
  });

  it('fires a time that happens twice when summer time ends once, the first time', () => {
    // 25 October 2026: 03:00 becomes 02:00 again, so 02:30 happens twice.
    const first = at('2026-10-25T00:30:00Z');
    expect(nextFireTime('30 2 * * *', BERLIN, at('2026-10-24T12:00:00Z'))).toEqual(first);
    expect(nextFireTime('30 2 * * *', BERLIN, first)).toEqual(at('2026-10-26T01:30:00Z'));
    expect(latestFireTime('30 2 * * *', BERLIN, first, at('2026-10-25T03:00:00Z'))).toBeNull();
  });

  it('answers the newest time since the last fire, and nothing for a clock set back', () => {
    const since = at('2026-09-20T12:00:00Z');
    const now = at('2026-09-24T09:30:00Z');
    expect(latestFireTime('0 9 * * *', BERLIN, since, now)).toEqual(at('2026-09-24T07:00:00Z'));
    expect(latestFireTime('0 9 * * *', BERLIN, now, since)).toBeNull();
    // Exactly at the time counts.
    expect(latestFireTime('0 9 * * *', BERLIN, since, at('2026-09-21T07:00:00Z'))).toEqual(
      at('2026-09-21T07:00:00Z'),
    );
  });

  it('finds the newest time after a long downtime of a frequent schedule', () => {
    const since = at('2026-08-01T00:00:00Z');
    const now = at('2026-09-24T09:30:30Z');
    expect(latestFireTime('* * * * *', 'UTC', since, now)).toEqual(at('2026-09-24T09:30:00Z'));
    expect(latestFireTime('*/5 * * * *', 'UTC', since, now)).toEqual(at('2026-09-24T09:30:00Z'));
  });

  it('refuses the cron extensions the engine does not read and unknown time zones', () => {
    for (const cron of ['0 9 L * *', '0 9 ? * 1', '0 9 * * 1#2', '0 0 9 * * *', 'hourly'])
      expect(() => assertCron(cron, BERLIN)).toThrow('Invalid cron expression');
    expect(() => assertCron('0 9 * * *', 'Mars/Olympus')).toThrow('Invalid time zone');
    expect(() => assertCron('0 9 * * MON-FRI', BERLIN)).not.toThrow();
    expect(latestFireTime('nope', BERLIN, at('2026-01-01T00:00:00Z'), new Date())).toBeNull();
  });
});
