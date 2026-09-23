import { beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { controlApi, controlPlane, type ControlRequest } from '#tests/helpers/control';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';

// The timeline of a project and of Home: the caller's chat answers and the agent runs
// from Plan's tables, and the workflow runs the Mastra control endpoint holds. That
// endpoint is a stand-in here that answers with the runs a test gives it.

process.env.AGENT_CHAT_CLAIM_WAIT_MS = '50';
process.env.AGENT_CHAT_CLAIM_POLL_MS = '10';

const CAPABILITIES = ['hermes-team.v1', 'plan-task-sync.v1'];

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Ext Bot',
    username: 'ext',
    kind: 'external',
    triggerOnMention: true,
  });
  return {
    asOwner,
    projectId: view.project.id,
    columns: view.columns,
    columnId: view.columns[0].id,
    agent: created.data!.agent,
    asRunner: apiKeyApi(created.data!.apiKey!),
  };
}

function activity(api: Api, query: Record<string, unknown> = {}) {
  return api.projects({ projectKey: 'MKT' })['agent-activity'].get({ query });
}

async function createIssue(asOwner: Api, columnId: number, projectKey = 'MKT') {
  return (await asOwner.projects({ projectKey }).issues.post({ columnId, title: 'Landing page' }))
    .data!;
}

// Queues a run by mentioning the agent, then claims and finishes it the way a runner
// does.
async function finishedRun(
  asOwner: Api,
  asRunner: Api,
  issueId: number,
  username: string,
  usage: { inputTokens: number; outputTokens: number } | null = null,
) {
  await asOwner.issues({ issueId }).comments.post({ body: `please review @${username}` });
  const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
  await asRunner['agent-runs']({ runId: run.id }).result.post({
    status: 'success',
    output: 'Done',
    usage,
  });
  return run;
}

async function chatAnswer(api: Api, asRunner: Api, agentId: number) {
  const sent = (
    await api.projects({ projectKey: 'MKT' })['ai-agents']({ agentId }).chat.post({
      prompt: 'Hello',
    })
  ).data!;
  const claimed = (await asRunner['agent-chats'].claim.post()).data!.message!;
  await asRunner['agent-chats']({ messageId: claimed.id }).result.post({ status: 'success' });
  return sent;
}

function enableWorkflow(asOwner: Api, workflowId: string, capabilityRefs: string[]) {
  return asOwner
    .projects({ projectKey: 'MKT' })
    ['control-plane'].workflows({ workflowId })
    .put({ enabled: true, capabilityRefs });
}

// The key the agent-team workflow sends with a stage (teamIdempotencyKey in Mastra).
function stageKey(eventId: string, taskRef: string, phase: string, subject: string) {
  return createHash('sha256')
    .update(`agent-team\0${eventId}\0${taskRef}\0${phase}\0${subject}`)
    .digest('hex');
}

function teamRun(runId: string, taskRef: string, createdAt: string) {
  return {
    runId,
    status: 'success',
    createdAt,
    updatedAt: new Date(Date.parse(createdAt) + 90_000).toISOString(),
    snapshot: {
      status: 'success',
      context: {
        input: {
          eventId: runId,
          correlationId: taskRef,
          payload: {
            task: { taskRef },
            coordinator: { agentRef: 'agent:ext' },
            specialists: [{ agentRef: 'agent:ext' }],
            policy: { maxTurns: 40, runBudgetSeconds: 900 },
          },
        },
        coordinate: {
          status: 'success',
          output: { delegations: [{ assignmentId: 'assignment-1', agentRef: 'agent:ext' }] },
        },
      },
    },
  };
}

function answerRuns(runs: Record<string, unknown[]>) {
  controlPlane.answer = (request: ControlRequest) =>
    request.operation === 'runs'
      ? { runs: runs[request.workflowId as string] ?? [], total: 0 }
      : {};
}

function runRequests() {
  return controlPlane.requests.filter((request) => request.operation === 'runs');
}

// Every kind once: a run on an issue, the Hermes stage of an agent-team run on the same
// issue, the agent-team run and a support run from Mastra, and a chat answer.
async function fullTimeline() {
  const context = await setup();
  const { asOwner, asRunner, agent, columnId } = context;
  const issue = await createIssue(asOwner, columnId);
  const taskRef = `task:MKT-${issue.sequenceNumber}`;
  await finishedRun(asOwner, asRunner, issue.id, agent.username, {
    inputTokens: 1200,
    outputTokens: 300,
  });
  const queued = await controlApi().internal.orchestration['agent-run'].post({
    projectRef: 'project:MKT',
    task: { taskRef },
    agent: { agentRef: 'agent:ext' },
    idempotencyKey: stageKey('team-run-1', taskRef, 'specialize', 'assignment-1'),
    prompt: 'Complete the assignment.',
    policy: { leaseSeconds: 300, heartbeatSeconds: 60, maxAttempts: 3 },
  });
  const stageRunId = (queued.data as unknown as { runId: number }).runId;
  await asRunner['agent-runs'].claim.post();
  await asRunner['agent-runs']({ runId: stageRunId }).result.post({
    status: 'success',
    output: '{}',
    usage: { inputTokens: 5000, outputTokens: 700 },
  });
  await enableWorkflow(asOwner, 'agent-team', CAPABILITIES);
  await enableWorkflow(asOwner, 'support', []);
  answerRuns({
    'agent-team': [teamRun('team-run-1', taskRef, '2020-01-02T10:00:00.000Z')],
    support: [
      {
        runId: 'support-run-1',
        status: 'running',
        createdAt: '2020-01-01T10:00:00.000Z',
        snapshot: { status: 'running', context: { input: { payload: {} } } },
      },
    ],
  });
  const chat = await chatAnswer(asOwner, asRunner, agent.id);
  return { ...context, issue, stageRunId, chat };
}

describe('agent activity', () => {
  beforeEach(async () => {
    await resetDb();
    controlPlane.reset();
  });

  it('lists chat answers, agent runs and workflow runs newest first', async () => {
    const { asOwner, agent, issue, stageRunId, chat, projectId } = await fullTimeline();

    const res = await activity(asOwner);
    expect(res.status).toBe(200);
    const items = res.data!.items;
    expect(items.map((item) => item.kind)).toEqual([
      'chat',
      'agent-run',
      'agent-run',
      'agent-team-run',
      'workflow-run',
    ]);
    const project = { id: projectId, key: 'MKT', name: 'Marketing' };
    const issueRef = {
      id: issue.id,
      identifier: `MKT-${issue.sequenceNumber}`,
      sequenceNumber: issue.sequenceNumber,
      title: 'Landing page',
    };
    expect(items[0]).toMatchObject({
      status: 'success',
      project,
      agent: { id: agent.id, username: 'ext', name: 'Ext Bot' },
      issue: null,
      threadId: chat.threadId,
      inputTokens: null,
    });
    expect(items[1]).toMatchObject({
      id: `run:${stageRunId}`,
      trigger: 'manual',
      issue: issueRef,
      inputTokens: 5000,
      outputTokens: 700,
    });
    expect(items[2]).toMatchObject({
      status: 'success',
      trigger: 'mention',
      issue: issueRef,
      inputTokens: 1200,
      outputTokens: 300,
      durationMs: expect.any(Number),
    });
    expect(items[3]).toMatchObject({
      status: 'success',
      project,
      agent: { id: agent.id, username: 'ext' },
      issue: issueRef,
      workflowId: 'agent-team',
      workflowRunId: 'team-run-1',
      maxTurns: 40,
      runBudgetSeconds: 900,
      durationMs: 90_000,
      inputTokens: 5000,
      outputTokens: 700,
    });
    expect(items[4]).toMatchObject({
      status: 'running',
      agent: null,
      workflowId: 'support',
      workflowRunId: 'support-run-1',
      durationMs: null,
    });
    expect(res.data!.nextCursor).toBeNull();
    expect(res.data!.notice).toBeNull();
    expect(runRequests()).toHaveLength(2);
    expect(runRequests()[0]).toMatchObject({ projectRef: 'project:MKT', page: 0, pageSize: 20 });
  });

  it('pages by cursor without repeating or skipping an entry', async () => {
    const { asOwner } = await fullTimeline();
    const all = (await activity(asOwner)).data!.items.map((item) => item.id);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const res = await activity(asOwner, { limit: 2, ...(cursor ? { cursor } : {}) });
      expect(res.status).toBe(200);
      seen.push(...res.data!.items.map((item) => item.id));
      if (!res.data!.nextCursor) break;
      cursor = JSON.stringify(res.data!.nextCursor);
    }
    expect(seen).toEqual(all);

    expect((await activity(asOwner, { cursor: 'not json' })).status).toBe(400);
    expect((await activity(asOwner, { cursor: '{"at":"never","id":"run:1"}' })).status).toBe(400);
    expect((await activity(asOwner, { limit: 0 })).status).toBe(400);
    expect((await activity(asOwner, { limit: 101 })).status).toBe(400);
  });

  it('filters by kind and by agent', async () => {
    const { asOwner, agent, columnId } = await fullTimeline();
    const other = await createAgent(asOwner, 'MKT', {
      name: 'Other Bot',
      username: 'other',
      kind: 'external',
      triggerOnMention: true,
    });
    const issue = await createIssue(asOwner, columnId);
    await finishedRun(
      asOwner,
      apiKeyApi(other.data!.apiKey!),
      issue.id,
      other.data!.agent.username,
    );

    const kinds = async (query: Record<string, unknown>) =>
      (await activity(asOwner, query)).data!.items.map((item) => item.kind);
    expect(await kinds({ kind: 'chat' })).toEqual(['chat']);
    controlPlane.requests = [];
    expect(await kinds({ kind: 'agent-run' })).toEqual(['agent-run', 'agent-run', 'agent-run']);
    expect(runRequests()).toEqual([]);
    expect(await kinds({ kind: 'agent-team-run' })).toEqual(['agent-team-run']);
    expect(await kinds({ kind: 'workflow-run' })).toEqual(['workflow-run']);
    expect(await kinds({ kind: 'workflow-run', agentId: agent.id })).toEqual([]);
    expect((await activity(asOwner, { kind: 'mail' })).status).toBe(400);

    expect(await kinds({ agentId: agent.id })).toEqual([
      'chat',
      'agent-run',
      'agent-run',
      'agent-team-run',
    ]);
    const others = (await activity(asOwner, { agentId: other.data!.agent.id })).data!.items;
    expect(others.map((item) => item.agent?.username)).toEqual(['other']);
  });

  it('leaves the workflow runs out with a notice when Mastra does not answer', async () => {
    const { asOwner } = await fullTimeline();
    controlPlane.answer = (request) =>
      request.operation === 'runs'
        ? Response.json({ message: 'Mastra is down' }, { status: 502 })
        : {};

    const res = await activity(asOwner);
    expect(res.status).toBe(200);
    expect(res.data!.items.map((item) => item.kind)).toEqual(['chat', 'agent-run', 'agent-run']);
    expect(res.data!.notice).toBe('workflow-runs-unavailable');
  });

  it('leaves out a workflow that Mastra no longer registers without a notice', async () => {
    const { asOwner } = await fullTimeline();
    controlPlane.answer = (request) =>
      request.operation !== 'runs'
        ? {}
        : request.workflowId === 'support'
          ? Response.json({ message: 'Mastra rejected the control request' }, { status: 404 })
          : { runs: [], total: 0 };

    const res = await activity(asOwner);
    expect(res.status).toBe(200);
    expect(res.data!.items.map((item) => item.kind)).toEqual(['chat', 'agent-run', 'agent-run']);
    expect(res.data!.notice).toBeNull();
  });

  it('says so when older workflow runs lie beyond the pages it reads', async () => {
    const { asOwner } = await setup();
    await enableWorkflow(asOwner, 'support', []);
    controlPlane.answer = (request) =>
      request.operation === 'runs'
        ? {
            runs: Array.from({ length: 20 }, (_, index) => ({
              runId: `run-${String(request.page)}-${index}`,
              status: 'success',
              createdAt: new Date(
                Date.UTC(2026, 0, 1) - (Number(request.page) * 20 + index) * 60_000,
              ).toISOString(),
              snapshot: {},
            })),
          }
        : {};

    const first = await activity(asOwner, { limit: 1 });
    expect(first.data!.items.map((item) => item.workflowRunId)).toEqual(['run-0-0']);
    expect(first.data!.notice).toBeNull();
    const cursor = JSON.stringify({ at: '2020-01-01T00:00:00.000Z', id: 'run:1' });
    const deep = await activity(asOwner, { cursor });
    expect(deep.data!.items).toEqual([]);
    expect(deep.data!.notice).toBe('workflow-runs-limited');
    expect(runRequests().map((request) => request.page)).toEqual([0, 0, 1, 2]);
  });

  it('shows a reader their own chats and the workflow runs only with the workflows permission', async () => {
    const { asOwner, asRunner, agent } = await fullTimeline();
    const asMember = await addProjectMember(asOwner, 'MKT');
    await chatAnswer(asMember, asRunner, agent.id);
    controlPlane.requests = [];

    const member = (await activity(asMember)).data!.items;
    expect(member.map((item) => item.kind)).toEqual(['chat', 'agent-run', 'agent-run']);
    expect(runRequests()).toEqual([]);
    const owner = (await activity(asOwner)).data!.items;
    expect(owner.filter((item) => item.kind === 'chat')).toHaveLength(1);
    expect(owner[0]!.threadId).not.toBe(member[0]!.threadId);
  });

  it('keeps the timeline to readers of the agents', async () => {
    const { asOwner } = await setup();
    const outsider = authedApi((await signUpTestUser({ name: 'Outsider' })).cookie);
    expect((await activity(outsider)).status).toBe(403);
    expect(
      (await outsider.projects({ projectKey: 'MKT' })['agent-activity'].usage.get()).status,
    ).toBe(403);

    const role = (
      await createRole(asOwner, 'MKT', {
        name: 'Work items only',
        permissions: { work_items: { read: true } },
      })
    ).data!;
    const asGuest = await addProjectMember(asOwner, 'MKT', role.id);
    expect((await activity(asGuest)).status).toBe(403);
    expect((await asOwner.projects({ projectKey: 'NOPE' })['agent-activity'].get()).status).toBe(
      404,
    );
  });

  it('lists the activity of every project whose agents the reader may see on Home', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await finishedRun(asOwner, asRunner, (await createIssue(asOwner, columnId)).id, 'ext');
    await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const ops = (await asOwner.projects({ projectKey: 'OPS' }).get()).data!;
    const opsAgent = await createAgent(asOwner, 'OPS', {
      name: 'Ops Bot',
      username: 'ops',
      kind: 'external',
      triggerOnMention: true,
    });
    const opsIssue = await createIssue(asOwner, ops.columns[0].id, 'OPS');
    await finishedRun(asOwner, apiKeyApi(opsAgent.data!.apiKey!), opsIssue.id, 'ops');
    const asMember = await addProjectMember(asOwner, 'MKT');
    await chatAnswer(asMember, asRunner, agent.id);

    const owner = (await asOwner['agent-activity'].get({ query: {} })).data!;
    expect(owner.items.map((item) => [item.kind, item.project?.key])).toEqual([
      ['agent-run', 'OPS'],
      ['agent-run', 'MKT'],
    ]);
    const member = (await asMember['agent-activity'].get({ query: {} })).data!;
    expect(member.items.map((item) => [item.kind, item.project?.key ?? null])).toEqual([
      ['chat', null],
      ['agent-run', 'MKT'],
    ]);
    const paged = await asOwner['agent-activity'].get({ query: { limit: 1 } });
    expect(paged.data!.items).toHaveLength(1);
    expect(paged.data!.nextCursor).not.toBeNull();
  });

  it('reads the agent-team runs of every project on Home', async () => {
    const { asOwner } = await fullTimeline();
    controlPlane.requests = [];
    const res = await asOwner['agent-activity'].get({ query: { kind: 'agent-team-run' } });
    expect(res.data!.items).toHaveLength(1);
    expect(res.data!.items[0]).toMatchObject({ workflowRunId: 'team-run-1', inputTokens: 5000 });
    expect(runRequests()).toHaveLength(1);
  });

  it('reports the tokens of this month and per closed task', async () => {
    const { asOwner, asRunner, agent, columns, columnId } = await setup();
    const done = columns.find((column) => column.stateType === 'completed')!;
    const closed = await createIssue(asOwner, columnId);
    const open = await createIssue(asOwner, columnId);
    await finishedRun(asOwner, asRunner, closed.id, agent.username, {
      inputTokens: 1000,
      outputTokens: 200,
    });
    await finishedRun(asOwner, asRunner, closed.id, agent.username, {
      inputTokens: 400,
      outputTokens: 100,
    });
    await finishedRun(asOwner, asRunner, open.id, agent.username, {
      inputTokens: 50,
      outputTokens: 5,
    });
    const usage = () => asOwner.projects({ projectKey: 'MKT' })['agent-activity'].usage.get();

    expect((await usage()).data).toMatchObject({
      inputTokens: 1450,
      outputTokens: 305,
      closedTasks: 0,
      tokensPerClosedTask: null,
    });
    await asOwner.issues({ issueId: closed.id }).patch({ columnId: done.id });
    const res = await usage();
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ closedTasks: 1, tokensPerClosedTask: 1700 });
    expect(new Date(res.data!.since).getUTCDate()).toBe(1);
  });
});
