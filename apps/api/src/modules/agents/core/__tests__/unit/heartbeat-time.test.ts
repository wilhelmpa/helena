import { expect, it } from 'bun:test';
import { nextHeartbeatAt, validateHeartbeatClock } from '../../heartbeat-time';

it('moves a due heartbeat to the next local work window', () => {
  const clock = {
    heartbeatIntervalMinutes: 60,
    heartbeatTimezone: 'Europe/Berlin',
    heartbeatDays: [1, 2, 3, 4, 5],
    heartbeatStart: '09:00',
    heartbeatEnd: '17:00',
  };
  validateHeartbeatClock(clock);
  expect(nextHeartbeatAt(clock, new Date('2026-09-25T15:30:00Z'))?.toISOString()).toBe(
    '2026-09-28T07:00:00.000Z',
  );
});
