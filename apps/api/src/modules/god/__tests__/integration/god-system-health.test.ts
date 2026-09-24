import { beforeEach, describe, expect, it } from 'bun:test';
import { agentRun, db, janitorRun, recordJanitorRun } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { apiKeyApi } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { controlApi, controlPlane } from '#tests/helpers/control';
import { resetDb } from '#tests/helpers/db';
import { addUser, setup } from '../helpers';
import { RESUME_LIMIT_ERROR } from '#modules/agents/runner/service';

// The owner's overview of the services around Plan: when each was last seen working,
// and the agent runs that wait, overran or belong to a stalled workflow run.

async function project(god: Awaited<ReturnType<typeof setup>>['god']) {
  await god.api.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await god.api.projects({ projectKey: 'MKT' }).get()).data!;
  const created = await createAgent(god.api, 'MKT', {
    name: 'Ext Bot',
    username: 'ext',
    kind: 'external',
  });
  const issue = (
    await god.api.projects({ projectKey: 'MKT' }).issues.post({
      columnId: view.columns[0].id,
      title: 'Team task',
    })
  ).data!;
  const queueStage = (key: string, workflowRunId: string) =>
    controlApi().internal.orchestration['agent-run'].post({
      projectRef: 'project:MKT',
      task: { taskRef: `task:MKT-${issue.sequenceNumber}` },
      agent: { agentRef: 'agent:ext' },
      idempotencyKey: key.repeat(64),
      prompt: 'Complete the assignment.',
      policy: { leaseSeconds: 300, heartbeatSeconds: 60, maxAttempts: 3 },
      workflowRunId,
    });
  return { asRunner: apiKeyApi(created.data!.apiKey!), queueStage };
}

const service = (
  health: { services: { service: string }[] },
  name: string,
): Record<string, unknown> => health.services.find((item) => item.service === name)!;

describe('system health', () => {
  beforeEach(async () => {
    await resetDb();
    controlPlane.reset();
  });

  it('shows who reported, who was never seen, and a Mastra that does not answer', async () => {
    const { god } = await setup();
    await controlApi().internal.orchestration.heartbeat.post({ service: 'bridge' });

    const healthy = (await god.api.god['system-health'].get()).data!;
    expect(service(healthy, 'bridge')).toMatchObject({ state: 'ok', error: null });
    expect(service(healthy, 'mastra')).toMatchObject({ state: 'ok' });
    expect(service(healthy, 'worker')).toMatchObject({ state: 'unknown', lastSeenAt: null });
    expect(service(healthy, 'runner')).toMatchObject({ state: 'unknown' });

    controlPlane.healthy = false;
    const down = (await god.api.god['system-health'].get()).data!;
    expect(service(down, 'mastra')).toMatchObject({
      state: 'down',
      error: 'HTTP 503',
      lastSeenAt: service(healthy, 'mastra').lastSeenAt,
    });
  });

  it('counts the runs that wait, overran, and the workflow runs that stalled', async () => {
    const { god } = await setup();
    const { asRunner, queueStage } = await project(god);
    await queueStage('a', 'waits-on-plan');
    await queueStage('b', 'second-stage');
    const claimed = (await asRunner['agent-runs'].claim.post()).data!.run!;
    // A claim fifty minutes old, still leased: past the runner's 30-minute stop.
    await db
      .update(agentRun)
      .set({ claimedAt: sql`now() - interval '50 minutes'` })
      .where(eq(agentRun.id, claimed.id));
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    controlPlane.answer = (request) =>
      request.operation === 'active-runs'
        ? {
            runs: [
              { runId: 'waits-on-plan', updatedAt: hourAgo },
              { runId: 'lost-after-restart', updatedAt: hourAgo },
              { runId: 'just-moved', updatedAt: new Date().toISOString() },
            ],
          }
        : {};

    const health = (await god.api.god['system-health'].get()).data!;
    expect(service(health, 'runner')).toMatchObject({ state: 'ok' });
    expect(health.runs).toMatchObject({
      waiting: 1,
      overdue: 1,
      failedLastDay: 0,
      agentTeamStartsWaiting: 0,
      stalledWorkflowRuns: 1,
    });
    expect(health.runs.oldestWaitingSince).not.toBeNull();

    controlPlane.answer = () => new Response('{}', { status: 502 });
    expect((await god.api.god['system-health'].get()).data!.runs.stalledWorkflowRuns).toBeNull();
  });

  it("shows each janitor's last run, and stays down until one runs again", async () => {
    const { god } = await setup();
    const unknown = (await god.api.god['system-health'].get()).data!;
    expect(unknown.janitors).toEqual([
      { job: 'run-janitor', state: 'unknown', ranAt: null, cleaned: null, error: null },
      { job: 'stage-janitor', state: 'unknown', ranAt: null, cleaned: null, error: null },
      { job: 'workflow-schedules', state: 'unknown', ranAt: null, cleaned: null, error: null },
      { job: 'resume-janitor', state: 'unknown', ranAt: null, cleaned: null, error: null },
    ]);

    await recordJanitorRun('run-janitor', 3, null);
    const ok = (await god.api.god['system-health'].get()).data!;
    const runJanitor = ok.janitors.find((j) => j.job === 'run-janitor')!;
    expect(runJanitor).toMatchObject({ state: 'ok', cleaned: 3, error: null });
    expect(runJanitor.ranAt).not.toBeNull();

    // A run that fails keeps the last count it found rather than resetting it, so the
    // owner still sees what the janitor last actually cleaned up.
    await recordJanitorRun('run-janitor', null, 'connection refused');
    const failed = (await god.api.god['system-health'].get()).data!;
    expect(failed.janitors.find((j) => j.job === 'run-janitor')).toMatchObject({
      state: 'down',
      cleaned: 3,
      error: 'connection refused',
    });

    // Stale: it ran once, long enough ago that it counts as stopped even without an
    // error of its own.
    await db.insert(janitorRun).values({
      job: 'stage-janitor',
      ranAt: new Date(Date.now() - 86_400_000),
      cleaned: 5,
      error: null,
    });
    const stale = (await god.api.god['system-health'].get()).data!;
    expect(stale.janitors.find((j) => j.job === 'stage-janitor')).toMatchObject({
      state: 'down',
      cleaned: 5,
      error: null,
    });
  });

  it('counts runs resuming a session and ones that reached the resume limit', async () => {
    const { god } = await setup();
    const { asRunner, queueStage } = await project(god);
    await queueStage('c', 'resume-check');
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

  it("names why the runner could not start until an agent is seen again, and each agent's sync", async () => {
    const { god } = await setup();
    const { asRunner } = await project(god);
    // The runner polled and reported, but has not applied the current settings yet.
    await asRunner['agent-runs'].claim.post();
    await asRunner['agent-runtime'].status.post({
      adapter: 'hermes',
      status: 'online',
      appliedRevision: 'sha256:older',
      capabilities: [],
      detail: null,
    });
    const pending = (await god.api.god['system-health'].get()).data!;
    // The project's coordinator has no runner here.
    expect(pending.agents).toMatchObject({ total: 2, pending: 1, offline: 1, synced: 0 });
    expect(pending.agents.agents).toContainEqual(
      expect.objectContaining({ username: 'ext', state: 'pending', drift: [] }),
    );

    const failed = await asRunner['agent-runtime']['runner-health'].post({
      error: 'The isolated Hermes home conflicts with its global provider reference',
    });
    expect(failed.status).toBe(204);
    expect(service((await god.api.god['system-health'].get()).data!, 'runner')).toMatchObject({
      state: 'down',
      error: 'The isolated Hermes home conflicts with its global provider reference',
    });

    await asRunner['agent-runtime']['runner-health'].post({ error: null });
    await asRunner['agent-runs'].claim.post();
    expect(service((await god.api.god['system-health'].get()).data!, 'runner')).toMatchObject({
      state: 'ok',
      error: null,
    });
  });

  it('is for the instance owner only', async () => {
    await setup();
    const member = await addUser({ name: 'Member' });
    expect((await member.api.god['system-health'].get()).status).toBe(403);
  });
});
