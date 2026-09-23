import { beforeEach, describe, expect, it } from 'bun:test';
import { listJanitorRuns } from '@repo/db';
import { janitorJob } from '../../background';
import { resetDb } from '#tests/helpers/db';

// The wrapper every janitor loop in background.ts runs through, so the health overview
// always has an up to date row of what a job last did, however many api replicas call
// it at once.

describe('janitorJob', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('records what a run cleaned up, and keeps that count when a later run fails', async () => {
    expect(await janitorJob('run-janitor', async () => 5)).toBe(5);
    let rows = await listJanitorRuns();
    expect(rows).toEqual([{ job: 'run-janitor', ranAt: rows[0]!.ranAt, cleaned: 5, error: null }]);

    await expect(
      janitorJob('run-janitor', async () => {
        throw new Error('database unreachable');
      }),
    ).rejects.toThrow('database unreachable');

    rows = await listJanitorRuns();
    // The count stays at the last run that had one; the failed run only adds the error
    // and moves when it last ran.
    expect(rows).toEqual([
      { job: 'run-janitor', ranAt: rows[0]!.ranAt, cleaned: 5, error: 'database unreachable' },
    ]);
  });

  it('keeps one row per job when several replicas record a run at once', async () => {
    const results = await Promise.allSettled([
      janitorJob('stage-janitor', async () => 1),
      janitorJob('stage-janitor', async () => 2),
      janitorJob('stage-janitor', async () => 3),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);

    const rows = await listJanitorRuns();
    expect(rows).toHaveLength(1);
    // Whichever call's UPDATE landed last wins the row; the primary key on `job` keeps
    // the concurrent upserts from ever producing two rows for the same job.
    expect([1, 2, 3]).toContain(rows[0]!.cleaned!);
  });

  it('runs the three janitors independently of each other', async () => {
    await Promise.all([
      janitorJob('run-janitor', async () => 1),
      janitorJob('stage-janitor', async () => 2),
      janitorJob('workflow-schedules', async () => 3),
    ]);
    const rows = await listJanitorRuns();
    expect(rows.map((row) => [row.job, row.cleaned]).sort()).toEqual([
      ['run-janitor', 1],
      ['stage-janitor', 2],
      ['workflow-schedules', 3],
    ]);
  });
});
