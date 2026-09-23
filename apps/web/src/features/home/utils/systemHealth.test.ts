import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { healthProblems, janitorSummary } from './systemHealth';

const quiet = {
  waiting: 0,
  oldestWaitingSince: null,
  overdue: 0,
  failedLastDay: 0,
  agentTeamStartsWaiting: 0,
  provisioningFailed: 0,
  stalledWorkflowRuns: 0,
};

describe('health problems', () => {
  test('list nothing while every count is zero or unknown', () => {
    assert.deepEqual(healthProblems(quiet), []);
    assert.deepEqual(healthProblems({ ...quiet, stalledWorkflowRuns: null }), []);
  });

  test('list the waiting runs first, with the oldest, then the rest in order', () => {
    assert.deepEqual(
      healthProblems({
        ...quiet,
        failedLastDay: 2,
        waiting: 3,
        oldestWaitingSince: '2026-09-23T10:00:00.000Z',
        stalledWorkflowRuns: 1,
      }),
      [
        { key: 'waiting', count: 3, since: '2026-09-23T10:00:00.000Z' },
        { key: 'stalledWorkflowRuns', count: 1 },
        { key: 'failedLastDay', count: 2 },
      ],
    );
  });
});

describe('janitor summary', () => {
  test('is null while the janitor has never run', () => {
    assert.equal(janitorSummary({ ranAt: null, cleaned: null }), null);
  });

  test('leaves out the count for a run that cleaned nothing', () => {
    assert.deepEqual(janitorSummary({ ranAt: '2026-09-23T10:00:00.000Z', cleaned: 0 }), {
      ranAt: '2026-09-23T10:00:00.000Z',
      cleaned: null,
    });
    assert.deepEqual(janitorSummary({ ranAt: '2026-09-23T10:00:00.000Z', cleaned: null }), {
      ranAt: '2026-09-23T10:00:00.000Z',
      cleaned: null,
    });
  });

  test('carries the count for a run that cleaned something', () => {
    assert.deepEqual(janitorSummary({ ranAt: '2026-09-23T10:00:00.000Z', cleaned: 4 }), {
      ranAt: '2026-09-23T10:00:00.000Z',
      cleaned: 4,
    });
  });
});
