import { beforeEach, describe, expect, it } from 'bun:test';
import { db, pipeline, pipelineRun, pipelineRunStep, pipelineVersion } from '@repo/db';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import { queueStepRun } from '#modules/engine/agent-runs';
import { registerBuiltins } from '#modules/engine/builtin/index';

// The timeline of a project and of Home: the caller's chat answers, the agent runs and
// the runs of the Helena engine (agent teams and workflows), all from Helena's tables.

registerBuiltins();

process.env.AGENT_CHAT_CLAIM_WAIT_MS = '50';
process.env.AGENT_CHAT_CLAIM_POLL_MS = '10';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Ext Bot',
    username: 'ext',
    triggerOnMention: true,
  } as never);
  return {
    teamId: (await asOwner.projects.get()).data!.find((item) => item.key === 'MKT')!.teamId,
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

// Every kind once: a run on an issue, the stage run of an agent team on the same issue,
// the agent-team run itself, a workflow run, and a chat answer.
async function fullTimeline() {
  const context = await setup();
  const { asOwner, asRunner, agent, columnId, projectId } = context;
  const issue = await createIssue(asOwner, columnId);
  await finishedRun(asOwner, asRunner, issue.id, agent.username, {
    inputTokens: 1200,
    outputTokens: 300,
  });
  const stageRunId = await queueStepRun({
    agentId: agent.id,
    projectId,
    issueId: issue.id,
    prompt: 'Complete the assignment.',
  });
  await asRunner['agent-runs'].claim.post();
  await asRunner['agent-runs']({ runId: stageRunId }).result.post({
    status: 'success',
    output: '{}',
    usage: { inputTokens: 5000, outputTokens: 700 },
  });
  const team = {
    task: { taskRef: `task:MKT-${issue.sequenceNumber}` },
    coordinator: { agentRef: 'agent:ext' },
    specialists: [{ agentRef: 'agent:ext' }],
    policy: { maxTurns: 40, runBudgetSeconds: 900 },
  };
  const teamStart = new Date('2020-01-02T10:00:00.000Z');
  await db.insert(pipelineRun).values({
    id: 'team-run-1',
    kind: 'agent_team',
    definition: {
      schemaVersion: 1,
      trigger: { type: 'delegation' },
      roles: [],
      steps: [{ id: 'team', name: 'Agent team', type: 'agent_team', team }],
    },
    title: 'Agent team',
    projectId,
    issueId: issue.id,
    agentId: agent.id,
    trigger: 'delegation',
    status: 'succeeded',
    createdAt: teamStart,
    finishedAt: new Date(teamStart.getTime() + 90_000),
  });
  await db.insert(pipelineRunStep).values({
    runId: 'team-run-1',
    stepId: 'team.s1',
    iteration: 1,
    seq: 1,
    kind: 'agent',
    name: 'Specialist works: assignment-1',
    status: 'succeeded',
    agentId: agent.id,
    agentRunId: stageRunId,
    state: { assignmentId: 'assignment-1' },
  });
  const [workflow] = await db
    .insert(pipeline)
    .values({ teamId: context.teamId, projectId, name: 'Support' })
    .returning();
  const [version] = await db
    .insert(pipelineVersion)
    .values({
      pipelineId: workflow!.id,
      version: 1,
      definition: { schemaVersion: 1, trigger: { type: 'manual' }, roles: [], steps: [] },
    })
    .returning();
  await db.insert(pipelineRun).values({
    id: 'support-run-1',
    kind: 'workflow',
    pipelineId: workflow!.id,
    versionId: version!.id,
    projectId,
    trigger: 'manual',
    status: 'running',
    createdAt: new Date('2020-01-01T10:00:00.000Z'),
  });
  const chat = await chatAnswer(asOwner, asRunner, agent.id);
  return { ...context, issue, stageRunId, chat };
}

describe('agent activity', () => {
  beforeEach(resetDb);

  it('keeps failures in history without attention after their task is completed or archived', async () => {
    const ctx = await setup();
    const task = await createIssue(ctx.asOwner, ctx.columnId);
    const runId = await queueStepRun({
      agentId: ctx.agent.id,
      projectId: ctx.projectId,
      issueId: task.id,
      prompt: 'Check the task',
    });
    await ctx.asRunner['agent-runs'].claim.post();
    await ctx.asRunner['agent-runs']({ runId }).result.post({
      status: 'failed',
      error: 'Test failure',
    });
    await db.insert(pipelineRun).values({
      id: 'completed-task-failure',
      kind: 'routine',
      definition: { steps: [] },
      projectId: ctx.projectId,
      issueId: task.id,
      agentId: ctx.agent.id,
      trigger: 'manual',
      status: 'failed',
      finishedAt: new Date(),
    });
    const failed = async () =>
      (await activity(ctx.asOwner)).data!.items.filter(
        (entry) => entry.id === `run:${runId}` || entry.id === 'workflow:completed-task-failure',
      );
    expect((await failed()).map((entry) => entry.requiresAttention)).toEqual([true, true]);
    const completed = ctx.columns.find((column) => column.stateType === 'completed')!;
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: completed.id });
    expect((await failed()).map((entry) => entry.requiresAttention)).toEqual([false, false]);
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId });
    expect((await failed()).map((entry) => entry.requiresAttention)).toEqual([true, true]);
    await ctx.asOwner.issues({ issueId: task.id }).archive.post({});
    expect((await failed()).map((entry) => entry.requiresAttention)).toEqual([false, false]);
    expect((await failed()).every((entry) => entry.status === 'failed')).toBe(true);
  });

  async function failedChat() {
    const ctx = await setup();
    const sent = (
      await ctx.asOwner
        .projects({ projectKey: 'MKT' })
        ['ai-agents']({ agentId: ctx.agent.id })
        .chat.post({ prompt: 'Please answer' })
    ).data!;
    const claimed = (await ctx.asRunner['agent-chats'].claim.post()).data!.message!;
    await ctx.asRunner['agent-chats']({ messageId: claimed.id }).result.post({
      status: 'failed',
      error: 'Test failure',
    });
    return { ...ctx, sent, messageId: claimed.id };
  }

  it('keeps failed chat history but clears attention after successful continuation', async () => {
    const ctx = await failedChat();
    const read = () => activity(ctx.asOwner);
    expect(
      (await read()).data!.items.find((row) => row.id === `chat:${ctx.messageId}`)
        ?.requiresAttention,
    ).toBe(true);
    await ctx.asOwner
      .projects({ projectKey: 'MKT' })
      ['ai-agents']({ agentId: ctx.agent.id })
      .chat.post({ prompt: 'Continue', threadId: ctx.sent.threadId });
    const claimed = (await ctx.asRunner['agent-chats'].claim.post()).data!.message!;
    await ctx.asRunner['agent-chats']({ messageId: claimed.id }).result.post({ status: 'success' });
    expect(
      (await read()).data!.items.find((row) => row.id === `chat:${ctx.messageId}`),
    ).toMatchObject({ status: 'failed', requiresAttention: false });
  });

  it('a successful answer on an unrelated branch keeps the original failure open', async () => {
    const ctx = await failedChat();
    await ctx.asOwner
      .projects({ projectKey: 'MKT' })
      ['ai-agents']({ agentId: ctx.agent.id })
      .chat.post({ prompt: 'A different question', threadId: ctx.sent.threadId, parentId: null });
    const claimed = (await ctx.asRunner['agent-chats'].claim.post()).data!.message!;
    await ctx.asRunner['agent-chats']({ messageId: claimed.id }).result.post({ status: 'success' });
    expect(
      (await activity(ctx.asOwner)).data!.items.find((row) => row.id === `chat:${ctx.messageId}`)
        ?.requiresAttention,
    ).toBe(true);
  });

  it('all read clears the callers failed chats and preserves other users failures', async () => {
    const ctx = await failedChat();
    const other = await signUpTestUser({ name: 'Other' });
    await authedApi(other.cookie).notifications['read-all'].post({});
    expect(
      (await activity(ctx.asOwner)).data!.items.find((row) => row.id === `chat:${ctx.messageId}`)
        ?.requiresAttention,
    ).toBe(true);
    expect((await ctx.asOwner.notifications['read-all'].post({})).data!.count).toBe(1);
    expect(
      (await activity(ctx.asOwner)).data!.items.find((row) => row.id === `chat:${ctx.messageId}`),
    ).toMatchObject({ status: 'failed', requiresAttention: false });
  });

  it('reading a failed answer acknowledges it durably', async () => {
    const ctx = await failedChat();
    await ctx.asOwner
      .projects({ projectKey: 'MKT' })
      ['ai-agents']({ agentId: ctx.agent.id })
      .threads({ threadId: ctx.sent.threadId })
      .messages.get({ query: {} });
    expect(
      (await activity(ctx.asOwner)).data!.items.find((row) => row.id === `chat:${ctx.messageId}`)
        ?.requiresAttention,
    ).toBe(false);
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
      status: 'succeeded',
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
      workflowId: 'workflow',
      workflowRunId: 'support-run-1',
      durationMs: null,
    });
    expect(res.data!.nextCursor).toBeNull();
    expect(res.data!.notice).toBeNull();
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
      triggerOnMention: true,
    } as never);
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
    expect(await kinds({ kind: 'agent-run' })).toEqual(['agent-run', 'agent-run', 'agent-run']);
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

  it('shows a reader their own chats and the workflow runs only with the workflows permission', async () => {
    const { asOwner, asRunner, agent } = await fullTimeline();
    const asMember = await addProjectMember(asOwner, 'MKT');
    await chatAnswer(asMember, asRunner, agent.id);

    const member = (await activity(asMember)).data!.items;
    expect(member.map((item) => item.kind)).toEqual(['chat', 'agent-run', 'agent-run']);
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
      triggerOnMention: true,
    } as never);
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
    const res = await asOwner['agent-activity'].get({ query: { kind: 'agent-team-run' } });
    expect(res.data!.items).toHaveLength(1);
    expect(res.data!.items[0]).toMatchObject({ workflowRunId: 'team-run-1', inputTokens: 5000 });
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
