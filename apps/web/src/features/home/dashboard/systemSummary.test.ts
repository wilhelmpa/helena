import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SystemHealth } from '@/lib/api/endpoints/god';
import { systemSummary } from './systemSummary';

// Start's System card condenses the health overview into one state and a few lines: green
// while everything runs, and each thing to look at, the worst first.

const NOW = '2026-09-24T20:00:00.000Z';

function healthy(): SystemHealth {
  return {
    agents: {
      total: 6,
      synced: 6,
      drift: 0,
      pending: 0,
      degraded: 0,
      offline: 0,
      unknown: 0,
      agents: [],
    },
    logins: {
      reports: [
        {
          source: 'token-keeper',
          reporter: 'helena-token-keeper',
          checkedAt: NOW,
          intervalSeconds: 600,
          stale: false,
          logins: [
            {
              store: 'hermes',
              provider: 'anthropic',
              id: 'a',
              label: null,
              managed: true,
              state: 'ok',
              expiresAt: null,
              refreshedAt: null,
              error: null,
              command: null,
              note: null,
            },
          ],
          errors: [],
        },
      ],
      problems: 0,
    },
    services: [
      { service: 'runner', state: 'ok', lastSeenAt: NOW, error: null },
      { service: 'engine', state: 'ok', lastSeenAt: NOW, error: null },
      { service: 'provisioning', state: 'unknown', lastSeenAt: null, error: null },
      { service: 'worker', state: 'ok', lastSeenAt: NOW, error: null },
    ],
    runs: {
      waiting: 0,
      oldestWaitingSince: null,
      overdue: 0,
      resuming: 0,
      failedLastDay: 0,
      needsResumeReview: 0,
      provisioningFailed: 0,
    },
    engine: {
      running: true,
      executorId: null,
      queued: 0,
      active: 0,
      waiting: 0,
      failedLastDay: 0,
      stalled: 0,
      schedules: 3,
      overdueSchedules: 0,
      lastErrors: [],
    },
    janitors: [
      { job: 'run-janitor', state: 'ok', ranAt: NOW, cleaned: null, error: null },
      { job: 'resume-janitor', state: 'ok', ranAt: NOW, cleaned: null, error: null },
    ],
  } as SystemHealth;
}

describe('systemSummary', () => {
  it('is green with nothing to list while everything runs', () => {
    const summary = systemSummary(healthy());
    assert.equal(summary.status, 'success');
    assert.deepEqual(summary.problems, []);
    // A service nobody could ask yet (provisioning not installed) counts neither way.
    assert.deepEqual(summary.services, { ok: 3, total: 3 });
    assert.deepEqual(summary.agents, { synced: 6, total: 6 });
    assert.deepEqual(summary.logins, { ok: 1, total: 1 });
    assert.deepEqual(summary.janitors, { ok: 2, total: 2 });
  });

  it('is red for a service that is down or a login the provider rejected', () => {
    const health = healthy();
    health.services[3] = { service: 'worker', state: 'down', lastSeenAt: NOW, error: 'gone' };
    health.logins!.reports[0]!.logins[0]!.state = 'invalid';
    const summary = systemSummary(health);
    assert.equal(summary.status, 'danger');
    assert.deepEqual(
      summary.problems.map((problem) => problem.key),
      ['serviceDown', 'loginNeedsOwner'],
    );
  });

  it('is amber for drift, a stopped janitor and runs that wait', () => {
    const health = healthy();
    health.agents.synced = 4;
    health.janitors[1] = { ...health.janitors[1]!, state: 'down' };
    health.runs.waiting = 2;
    health.runs.oldestWaitingSince = NOW;
    const summary = systemSummary(health);
    assert.equal(summary.status, 'waiting');
    assert.deepEqual(
      summary.problems.map((problem) => problem.key),
      ['janitorDown', 'agentsDrift', 'run'],
    );
  });

  it('is amber, not red, for a login whose renewal fails for now', () => {
    const health = healthy();
    health.logins!.reports[0]!.logins[0]!.state = 'error';
    const summary = systemSummary(health);
    assert.equal(summary.status, 'waiting');
    assert.deepEqual(
      summary.problems.map((problem) => problem.key),
      ['loginRenewing'],
    );
  });

  it('leaves failed runs to "Braucht dich" and resuming runs out', () => {
    const health = healthy();
    health.runs.failedLastDay = 3;
    health.runs.resuming = 1;
    health.engine.failedLastDay = 2;
    const summary = systemSummary(health);
    assert.equal(summary.status, 'success');
    assert.deepEqual(summary.problems, []);
  });
});
