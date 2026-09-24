import { beforeEach, describe, expect, it } from 'bun:test';
import {
  agentRun,
  db,
  janitorRun,
  pipelineRun,
  recordJanitorRun,
  recordServiceCheck,
} from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { apiKeyApi } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { addUser, setup } from '../helpers';
import { RESUME_LIMIT_ERROR } from '#modules/agents/runner/service';
import { queueStepRun } from '#modules/engine/agent-runs';
import { registerBuiltins } from '#modules/engine/builtin/index';

// The owner's overview of the services around Helena: when each was last seen working,
// the agent runs that wait or overran, and what the engine does (queued, active,
// stalled and failed runs, enabled schedules).

registerBuiltins();

async function project(god: Awaited<ReturnType<typeof setup>>['god']) {
  const createdProject = await god.api.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await god.api.projects({ projectKey: 'MKT' }).get()).data!;
  const created = await createAgent(god.api, 'MKT', { name: 'Ext Bot', username: 'ext' } as never);
  const issue = (
    await god.api.projects({ projectKey: 'MKT' }).issues.post({
      columnId: view.columns[0]!.id,
      title: 'Team task',
    })
  ).data!;
  const queueStage = () =>
    queueStepRun({
      agentId: created.data!.agent.id,
      projectId: createdProject.data!.id,
      issueId: issue.id,
      prompt: 'Complete the assignment.',
    });
  return {
    asRunner: apiKeyApi(created.data!.apiKey!),
    queueStage,
    projectId: createdProject.data!.id,
    issueId: issue.id,
  };
}

const service = (
  health: { services: { service: string }[] },
  name: string,
): Record<string, unknown> => health.services.find((item) => item.service === name)!;

describe('system health', () => {
  beforeEach(resetDb);

  it('shows who reported and who was never seen', async () => {
    const { god } = await setup();
    await recordServiceCheck('engine', null);
    const health = (await god.api.god['system-health'].get()).data!;
    expect(health.services.map((item) => item.service)).toEqual([
      'runner',
      'engine',
      'provisioning',
      'worker',
    ]);
    expect(service(health, 'engine')).toMatchObject({ state: 'ok', error: null });
    expect(service(health, 'worker')).toMatchObject({ state: 'unknown', lastSeenAt: null });
    expect(service(health, 'runner')).toMatchObject({ state: 'unknown' });
  });

  it('counts the agent runs that wait and overran, and the runs of the engine', async () => {
    const { god } = await setup();
    const { asRunner, queueStage, projectId, issueId } = await project(god);
    await queueStage();
    await queueStage();
    const claimed = (await asRunner['agent-runs'].claim.post()).data!.run!;
    // A claim fifty minutes old, still leased: past the runner's 30-minute stop.
    await db
      .update(agentRun)
      .set({ claimedAt: sql`now() - interval '50 minutes'` })
      .where(eq(agentRun.id, claimed.id));
    const definition = { schemaVersion: 1, trigger: { type: 'delegation' }, roles: [], steps: [] };
    const run = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
      id,
      kind: 'agent_team',
      definition,
      title: 'Agent team',
      projectId,
      issueId,
      trigger: 'manual',
      status,
      ...extra,
    });
    await db.insert(pipelineRun).values([
      run('queued', 'pending', { issueId: null }),
      run('stalled', 'running', {
        updatedAt: sql`now() - interval '1 hour'` as never,
        issueId: null,
      }),
      run('waiting', 'waiting', { issueId: null }),
      run('failed', 'failed', { error: 'Boom', finishedAt: new Date(), issueId: null }),
    ] as never);

    const health = (await god.api.god['system-health'].get()).data!;
    expect(service(health, 'runner')).toMatchObject({ state: 'ok' });
    expect(health.runs).toMatchObject({ waiting: 1, overdue: 1, failedLastDay: 0 });
    expect(health.runs.oldestWaitingSince).not.toBeNull();
    expect(health.engine).toMatchObject({
      queued: 1,
      active: 1,
      waiting: 1,
      failedLastDay: 1,
      stalled: 1,
      schedules: 0,
      lastErrors: [{ runId: 'failed', projectKey: 'MKT', name: 'Agent team', error: 'Boom' }],
    });
  });

  it("shows each janitor's last run, and stays down until one runs again", async () => {
    const { god } = await setup();
    const unknown = (await god.api.god['system-health'].get()).data!;
    expect(unknown.janitors).toEqual([
      { job: 'run-janitor', state: 'unknown', ranAt: null, cleaned: null, error: null },
      { job: 'resume-janitor', state: 'unknown', ranAt: null, cleaned: null, error: null },
      { job: 'engine-maintenance', state: 'unknown', ranAt: null, cleaned: null, error: null },
    ]);

    await recordJanitorRun('run-janitor', 3, null);
    const ok = (await god.api.god['system-health'].get()).data!;
    const runJanitor = ok.janitors.find((j) => j.job === 'run-janitor')!;
    expect(runJanitor).toMatchObject({ state: 'ok', cleaned: 3, error: null });
    expect(runJanitor.ranAt).not.toBeNull();

    // A run that fails keeps the last count it found rather than resetting it.
    await recordJanitorRun('run-janitor', null, 'connection refused');
    const failed = (await god.api.god['system-health'].get()).data!;
    expect(failed.janitors.find((j) => j.job === 'run-janitor')).toMatchObject({
      state: 'down',
      cleaned: 3,
      error: 'connection refused',
    });

    // Stale: it ran once, long enough ago that it counts as stopped.
    await db.insert(janitorRun).values({
      job: 'engine-maintenance',
      ranAt: new Date(Date.now() - 86_400_000),
      cleaned: 5,
      error: null,
    });
    const stale = (await god.api.god['system-health'].get()).data!;
    expect(stale.janitors.find((j) => j.job === 'engine-maintenance')).toMatchObject({
      state: 'down',
      cleaned: 5,
      error: null,
    });
  });

  it('counts runs resuming a session and ones that reached the resume limit', async () => {
    const { god } = await setup();
    const { asRunner, queueStage } = await project(god);
    await queueStage();
    const claimed = (await asRunner['agent-runs'].claim.post()).data!.run!;
    await db
      .update(agentRun)
      .set({ sessionId: 'sess-health-1' })
      .where(eq(agentRun.id, claimed.id));
    const resuming = (await god.api.god['system-health'].get()).data!;
    expect(resuming.runs).toMatchObject({ resuming: 1, needsResumeReview: 0 });
    await db
      .update(agentRun)
      .set({ status: 'failed', lastError: RESUME_LIMIT_ERROR })
      .where(eq(agentRun.id, claimed.id));
    const needsReview = (await god.api.god['system-health'].get()).data!;
    expect(needsReview.runs).toMatchObject({ resuming: 0, needsResumeReview: 1 });
  });

  it('is for the instance owner only', async () => {
    await setup();
    const member = await addUser({ name: 'Member' });
    expect((await member.api.god['system-health'].get()).status).toBe(403);
  });
});
