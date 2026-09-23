import { beforeEach, describe, expect, it } from 'bun:test';
import { agentRun, db } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { apiKeyApi } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { controlApi, controlPlane } from '#tests/helpers/control';
import { resetDb } from '#tests/helpers/db';
import { addUser, setup } from '../helpers';

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

  it('is for the instance owner only', async () => {
    await setup();
    const member = await addUser({ name: 'Member' });
    expect((await member.api.god['system-health'].get()).status).toBe(403);
  });
});
