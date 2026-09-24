import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { healthProblems, janitorSummary } from './systemHealth';

const quiet = {
  waiting: 0,
  oldestWaitingSince: null,
  overdue: 0,
  resuming: 0,
  failedLastDay: 0,
  needsResumeReview: 0,
  provisioningFailed: 0,
};

const calm = { stalled: 0, overdueSchedules: 0, failedLastDay: 0 };

describe('health problems', () => {
  test('list nothing while every count is zero', () => {
    assert.deepEqual(healthProblems(quiet), []);
    assert.deepEqual(healthProblems(quiet, calm), []);
  });

  test('list the waiting runs first, with the oldest, then the rest in order', () => {
    assert.deepEqual(
      healthProblems(
        {
          ...quiet,
          failedLastDay: 2,
          waiting: 3,
          oldestWaitingSince: '2026-09-23T10:00:00.000Z',
        },
        { ...calm, stalled: 1, overdueSchedules: 2, failedLastDay: 4 },
      ),
      [
        { key: 'waiting', count: 3, since: '2026-09-23T10:00:00.000Z' },
        { key: 'stalledWorkflowRuns', count: 1 },
        { key: 'overdueSchedules', count: 2 },
        { key: 'failedLastDay', count: 2 },
        { key: 'failedWorkflowRuns', count: 4 },
      ],
    );
  });

  test('lists resuming runs as informational, and a run past the resume limit as a problem', () => {
    assert.deepEqual(healthProblems({ ...quiet, resuming: 2, needsResumeReview: 1 }), [
      { key: 'resuming', count: 2 },
      { key: 'needsResumeReview', count: 1 },
    ]);
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
