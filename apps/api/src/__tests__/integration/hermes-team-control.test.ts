import { beforeEach, describe, expect, it } from 'bun:test';
import { api, apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { controlApi } from '#tests/helpers/control';

// The Hermes team bridge queues each agent-team stage as a run of the stage's agent,
// asks for it again when Mastra retries or continues the stage, and cancels it when the
// workflow run waiting on it was canceled. It calls these routes with the control token.

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
  const queue = () =>
    controlApi().internal.orchestration['agent-run'].post({
      projectRef: 'project:MKT',
      task: { taskRef: `task:MKT-${issue.sequenceNumber}` },
      agent: { agentRef: `agent:${created.data!.agent.username}` },
      idempotencyKey: 'a'.repeat(64),
      prompt: 'Complete the assignment.',
      policy: { leaseSeconds: 300, heartbeatSeconds: 60, maxAttempts: 3 },
    });
  // The internal routes answer with a Response, which Treaty parses without a type.
  const { runId } = (await queue()).data as unknown as { runId: number };
  return {
    asOwner,
    projectId: view.project.id,
    asRunner: apiKeyApi(created.data!.apiKey!),
    runId,
    queue,
  };
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

describe('Hermes stage replay', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('queues a canceled or failed stage run again, with its claims counted anew', async () => {
    const { asRunner, runId, queue } = await setup();
    await cancel({ runId, projectRef: 'project:MKT' });

    expect((await queue()).data).toMatchObject({ runId, replayed: true });
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      id: runId,
      attempts: 1,
    });
    await asRunner['agent-runs']({ runId }).result.post({
      status: 'failed',
      error: 'Hermes failed',
    });

    expect((await queue()).data).toMatchObject({ runId, replayed: true });
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      id: runId,
      attempts: 1,
    });
  });

  it('answers a replay of a finished stage with its outcome', async () => {
    const { asRunner, runId, queue } = await setup();
    await asRunner['agent-runs'].claim.post();
    await asRunner['agent-runs']({ runId }).result.post({ status: 'success', output: 'Done' });

    expect((await queue()).data).toMatchObject({ runId, replayed: true });
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toBeNull();
    const status = await controlApi().internal.orchestration['agent-run'].status.post({
      runId,
      projectRef: 'project:MKT',
    });
    expect(status.data).toMatchObject({ status: 'success', output: 'Done' });
  });
});

// Each fire of a routine asks Plan, through the bridge, to create a task for the
// routine's agent or to reopen the routine's task. The routine's task blocks both while
// it is open.
describe('routine dispatch', () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function routineSetup() {
    const owner = await signUpTestUser({ name: 'Owner' });
    const asOwner = authedApi(owner.cookie);
    await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
    const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
    const created = await createAgent(asOwner, 'MKT', {
      name: 'Writer',
      username: 'writer',
      kind: 'external',
      triggerOnAssign: true,
      delegationDelaySec: 0,
    });
    const column = (stateType: string) =>
      view.columns.find((item) => item.stateType === stateType)!.id;
    return {
      owner,
      asOwner,
      agent: created.data!.agent,
      asRunner: apiKeyApi(created.data!.apiKey!),
      todo: column('unstarted'),
      done: column('completed'),
    };
  }

  const KEY = 'b'.repeat(64);
  const request = (body: Record<string, unknown> = {}) =>
    controlApi().internal.orchestration.routine.post({
      idempotencyKey: KEY,
      projectRef: 'project:MKT',
      agentRef: 'agent:writer',
      title: 'Weekly report',
      instructions: 'Summarize the week.',
      mode: 'new',
      ...body,
    });
  const answer = async (body: Record<string, unknown> = {}) => {
    const res = await request(body);
    return { status: res.status, data: res.data as unknown as Record<string, unknown> };
  };
  const issuesOf = async (asOwner: Api) =>
    (await asOwner.projects({ projectKey: 'MKT' }).issues.get({ query: {} })).data!;

  it('creates a task in the first unstarted state and delegates it to the agent', async () => {
    const { owner, asOwner, agent, asRunner, todo } = await routineSetup();
    const res = await answer({ actorId: owner.userId });
    expect(res).toEqual({
      status: 200,
      data: { idempotencyKey: KEY, outcome: 'created', taskRef: 'task:MKT-1' },
    });
    const [listed] = await issuesOf(asOwner);
    const task = (await asOwner.issues({ issueId: listed.id }).get()).data!;
    expect(task).toMatchObject({
      sequenceNumber: 1,
      title: 'Weekly report',
      description: 'Summarize the week.',
      columnId: todo,
      delegateUserId: agent.userId,
    });
    const feed = (await asOwner.issues({ issueId: task.id }).feed.get({ query: {} })).data!;
    expect(feed.items.find((item) => item.action === 'created')?.actorUserId).toBe(owner.userId);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
    expect(run).toMatchObject({ trigger: 'delegation', issueIdentifier: 'MKT-1' });
  });

  it('answers a repeated key with what the first request did and refuses another request', async () => {
    const { asOwner } = await routineSetup();
    const first = await answer();
    expect(await answer()).toEqual(first);
    expect(await issuesOf(asOwner)).toHaveLength(1);
    expect((await answer({ title: 'Monthly report' })).status).toBe(409);
  });

  it('creates two tasks at once for one key only once', async () => {
    const { asOwner } = await routineSetup();
    const [first, second] = await Promise.all([answer(), answer()]);
    expect(second).toEqual(first);
    expect(await issuesOf(asOwner)).toHaveLength(1);
  });

  it('skips while the task the routine created last is open and creates the next once it is done', async () => {
    const { asOwner, done } = await routineSetup();
    await answer();
    const [task] = await issuesOf(asOwner);

    const skipped = await answer({ idempotencyKey: 'c'.repeat(64), taskRef: 'task:MKT-1' });
    expect(skipped.data).toMatchObject({ outcome: 'skipped', taskRef: 'task:MKT-1' });
    expect(await issuesOf(asOwner)).toHaveLength(1);

    await asOwner.issues({ issueId: task.id }).patch({ columnId: done });
    const next = await answer({ idempotencyKey: 'd'.repeat(64), taskRef: 'task:MKT-1' });
    expect(next.data).toMatchObject({ outcome: 'created', taskRef: 'task:MKT-2' });
  });

  it('reopens a finished task: back to unstarted, a comment and a new run of the agent', async () => {
    const { asOwner, agent, asRunner, todo, done } = await routineSetup();
    const task = (
      await asOwner
        .projects({ projectKey: 'MKT' })
        .issues.post({ columnId: done, title: 'Check the backups' })
    ).data!;
    await asOwner.issues({ issueId: task.id }).archive.post({});

    const reopen = { mode: 'reopen', taskRef: 'task:MKT-1', instructions: 'Check them again.' };
    const res = await answer(reopen);
    expect(res.data).toEqual({ idempotencyKey: KEY, outcome: 'reopened', taskRef: 'task:MKT-1' });
    const [reopened] = await issuesOf(asOwner);
    expect(reopened).toMatchObject({
      id: task.id,
      columnId: todo,
      delegateUserId: agent.userId,
      archived: false,
    });
    const feed = (await asOwner.issues({ issueId: task.id }).feed.get({ query: {} })).data!;
    expect(feed.items.filter((item) => item.kind === 'comment').map((item) => item.body)).toEqual([
      'Reopened by the schedule "Weekly report".\n\nCheck them again.',
    ]);
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      issueIdentifier: 'MKT-1',
    });

    expect(await answer(reopen)).toEqual(res);
    expect(
      (await asOwner.issues({ issueId: task.id }).feed.get({ query: {} })).data!.items.filter(
        (item) => item.kind === 'comment',
      ),
    ).toHaveLength(1);
  });

  it('leaves an open task to reopen alone', async () => {
    const { asOwner, todo } = await routineSetup();
    await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId: todo, title: 'Open' });
    const res = await answer({ mode: 'reopen', taskRef: 'task:MKT-1' });
    expect(res.data).toMatchObject({ outcome: 'skipped', taskRef: 'task:MKT-1' });
  });

  it('rejects an invalid request, a foreign project or agent and a missing task', async () => {
    const { asOwner } = await routineSetup();
    for (const body of [
      { idempotencyKey: 'short' },
      { projectRef: 'MKT' },
      { mode: 'later' },
      { mode: 'reopen' },
      { title: '' },
      { instructions: 'x'.repeat(20_001) },
    ])
      expect((await request(body)).status).toBe(400);
    expect((await request({ projectRef: 'project:NOPE' })).status).toBe(404);
    expect((await request({ agentRef: 'agent:nobody' })).status).toBe(409);
    expect((await request({ mode: 'reopen', taskRef: 'task:MKT-9' })).status).toBe(404);
    expect(await issuesOf(asOwner)).toHaveLength(0);
  });

  it('refuses a caller without the control token', async () => {
    await routineSetup();
    const res = await api.internal.orchestration.routine.post({ idempotencyKey: KEY });
    expect(res.status).toBe(401);
  });
});
