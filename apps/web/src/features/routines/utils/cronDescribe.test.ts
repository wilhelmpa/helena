import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { describeCronIn, type CronWords } from './cronDescribe';

// Plain English stand-ins for the translated phrases, so the test reads which clause
// each pattern picks and how the clauses are joined.
const words: CronWords = {
  everyMinute: 'every minute',
  everyNMinutes: (n) => `every ${n} minutes`,
  everyHour: 'every hour',
  everyNHours: (n) => `every ${n} hours`,
  everyNHoursAtMinute: (n, minute) => `every ${n} hours at :${minute}`,
  at: (times) => `at ${times}`,
  everyNMinutesBetween: (n, start, end) => `every ${n} minutes ${start}-${end}`,
  everyHourBetween: (start, end) => `every hour ${start}-${end}`,
  everyNHoursBetween: (n, start, end) => `every ${n} hours ${start}-${end}`,
  atMinuteDuringHour: (minute, hour) => `minute ${minute} hour ${hour}`,
  onDays: (days) => `on ${days}`,
  onDaysOrWeekdays: (days, weekdays) => `on ${days} or ${weekdays}`,
  inMonths: (months) => `in ${months}`,
  weekdays: 'weekdays',
  weekends: 'weekends',
  through: (start, end) => `${start}..${end}`,
  dayOrdinal: (n) => `${n}.`,
  time: (hour, minute) => `${hour}:${String(minute).padStart(2, '0')}`,
  weekdayName: (day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]!,
  monthName: (month) => `M${month}`,
  list: (items) => items.join('+'),
};

describe('localized cron descriptions', () => {
  const cases: Array<[string, string]> = [
    ['* * * * *', 'every minute'],
    ['*/15 * * * *', 'every 15 minutes'],
    ['0 * * * *', 'every hour'],
    ['0 */2 * * *', 'every 2 hours'],
    ['30 */3 * * *', 'every 3 hours at :30'],
    ['0 9 * * 1-5', 'at 9:00 · weekdays'],
    ['0 12 * * 0,6', 'at 12:00 · weekends'],
    ['0 9,17 * * *', 'at 9:00+17:00'],
    ['0 17 * * 1,5', 'at 17:00 · Mon+Fri'],
    ['0 9 * * 2-4', 'at 9:00 · Tue..Thu'],
    ['0 9 * * 7', 'at 9:00 · Sun'],
    ['0 0 1,15 * *', 'at 0:00 · on 1.+15.'],
    ['0 9 1 1 *', 'at 9:00 · on 1. · in M1'],
    ['0 0 1 1,4,7,10 *', 'at 0:00 · on 1. · in M1+M4+M7+M10'],
    ['*/15 9-17 * * *', 'every 15 minutes 9:00-17:00'],
    ['0 9-17 * * *', 'every hour 9:00-17:00'],
    ['0 9-17/2 * * *', 'every 2 hours 9:00-17:00'],
    ['0 9 1 * 1', 'at 9:00 · on 1. or Mon'],
  ];
  for (const [cron, expected] of cases) {
    test(cron, () => assert.equal(describeCronIn(cron, words), expected));
  }

  test('an expression that does not parse has no description', () => {
    assert.equal(describeCronIn('not a cron', words), null);
  });
});
