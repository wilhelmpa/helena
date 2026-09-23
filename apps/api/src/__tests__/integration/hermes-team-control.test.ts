import { beforeEach, describe, expect, it } from 'bun:test';
import { api, apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { controlApi } from '#tests/helpers/control';

// The Hermes team bridge queues each agent-team stage as a run of the stage's agent and
// cancels it when the workflow run waiting on it was canceled. It calls these routes
// with the control token.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Ext Bot',
    username: 'ext',
    kind: 'external',
  });
  const issue = (
    await asOwner
      .projects({ projectKey: 'MKT' })
      .issues.post({ columnId: view.columns[0].id, title: 'Team task' })
  ).data!;
  const queued = await controlApi().internal.orchestration['agent-run'].post({
    projectRef: 'project:MKT',
    task: { taskRef: `task:MKT-${issue.sequenceNumber}` },
    agent: { agentRef: `agent:${created.data!.agent.username}` },
    idempotencyKey: 'a'.repeat(64),
    prompt: 'Complete the assignment.',
    policy: { leaseSeconds: 300, heartbeatSeconds: 60, maxAttempts: 3 },
  });
  // The internal routes answer with a Response, which Treaty parses without a type.
  const { runId } = queued.data as unknown as { runId: number };
  return { asOwner, projectId: view.project.id, asRunner: apiKeyApi(created.data!.apiKey!), runId };
}

function cancel(body: Record<string, unknown>) {
  return controlApi().internal.orchestration['agent-run'].cancel.post(body);
}

async function controlPlaneRev(asOwner: Api, projectId: number) {
  const scope = `controlPlane:${projectId}`;
  return Number((await asOwner.sync.rev.get({ query: { scopes: scope } })).data!.revs[scope]);
}

describe('Hermes stage cancel', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('cancels a queued stage, which no runner claims afterwards', async () => {
    const { asOwner, asRunner, projectId, runId } = await setup();
    const before = await controlPlaneRev(asOwner, projectId);

    const res = await cancel({ runId, projectRef: 'project:MKT' });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ runId, status: 'canceled', finishedAt: expect.anything() });
    expect(await controlPlaneRev(asOwner, projectId)).toBeGreaterThan(before);
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toBeNull();
  });

  it('answers a repeated cancel with the same status', async () => {
    const { runId } = await setup();
    const first = await cancel({ runId, projectRef: 'project:MKT' });
    const second = await cancel({ runId, projectRef: 'project:MKT' });
    expect(second.status).toBe(200);
    expect(second.data).toEqual(first.data);
  });

  it('keeps the outcome of a run that already finished', async () => {
    const { asRunner, runId } = await setup();
    await asRunner['agent-runs'].claim.post();
    await asRunner['agent-runs']({ runId }).result.post({ status: 'success', output: 'Done' });

    const res = await cancel({ runId, projectRef: 'project:MKT' });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ runId, status: 'success', output: 'Done' });
  });

  it('rejects an invalid request and a run outside the named project', async () => {
    const { runId } = await setup();
    expect((await cancel({ runId, projectRef: 'MKT' })).status).toBe(400);
    expect((await cancel({ runId: 0, projectRef: 'project:MKT' })).status).toBe(400);
    expect((await cancel({ runId, projectRef: 'project:OTHER' })).status).toBe(404);
    expect((await cancel({ runId: runId + 1, projectRef: 'project:MKT' })).status).toBe(404);

    const status = await controlApi().internal.orchestration['agent-run'].status.post({
      runId,
      projectRef: 'project:MKT',
    });
    expect(status.data).toMatchObject({ status: 'pending' });
  });

  it('refuses a caller without the control token', async () => {
    const { runId } = await setup();
    const res = await api.internal.orchestration['agent-run'].cancel.post({
      runId,
      projectRef: 'project:MKT',
    });
    expect(res.status).toBe(401);
  });
});
