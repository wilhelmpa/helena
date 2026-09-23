import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setDisplayTimezone } from '@/utils/dates';
import { mailListDate } from './mailDates';

describe('mailListDate', () => {
  it('shows the time for mail of today and the day for older mail', () => {
    setDisplayTimezone('Europe/Berlin');
    const now = new Date('2026-03-10T15:00:00Z');
    assert.equal(mailListDate('2026-03-10T08:05:00Z', now), '09:05');
    assert.notEqual(mailListDate('2026-03-09T08:05:00Z', now), '09:05');
    assert.match(mailListDate('2026-03-09T08:05:00Z', now), /9/);
    setDisplayTimezone('');
  });
});
