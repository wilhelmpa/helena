import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { agentRun, db, issue as issueTable, issueActivity, notification } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import {
  answerStep,
  finishAgentRun,
  resetEngineDb,
  runSteps,
  startEngine,
  stopEngineRuns,
  stopTestEngine,
  waitForAgentRun,
  waitForRun,
  waitForStatus,
} from '#tests/helpers/engine';
import {
  agentStep,
  definition,
  enable,
  issue,
  setupProject,
  startRun,
  template,
  type Json,
  type ProjectSetup,
} from '#tests/helpers/workflows';

// A run takes a few hops through the engine's queues (see helpers/engine.ts).
setDefaultTimeout(30_000);

// The Helena engine running builder workflows for real: every kind of step in order,
// the lanes of conditions, rework loops, failures, test runs, cancel and retry. Ported
// from the plan-pipeline workflow tests of the Mastra control plane; the test plays the
// Hermes runner by finishing the agent runs the engine queues.

async function workflow(ctx: ProjectSetup, steps: Json[], extra: Json = {}) {
  const created = await template(ctx, { definition: definition(steps, extra) });
  expect((await enable(ctx, created.id, { coder: ctx.coder.id })).status).toBe(200);
  return created.id;
}

function stepsOf(rows: Awaited<ReturnType<typeof runSteps>>) {
  return rows
    .filter((row) => !row.stepId.includes('.'))
    .map((row) => ({ stepId: row.stepId, status: row.status, outcome: row.outcome }));
}

beforeAll(async () => {
  await startEngine();
});

afterAll(async () => {
  await stopTestEngine();
});

beforeEach(async () => {
  await resetEngineDb();
});

afterEach(async () => {
  await stopEngineRuns();
});

describe('workflow runs on the engine', () => {
  it('executes every kind of step in order and records each', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [
      agentStep('implement', 'Implement {{task.identifier}} "{{task.title}}".'),
      {
        id: 'worked',
        name: 'Did it work?',
        type: 'condition',
        condition: { kind: 'outcome', outcomes: ['success'] },
        then: [
          {
            id: 'note',
            name: 'Note',
            type: 'action',
            action: { kind: 'comment', body: 'Done: {{previous.summary}}' },
          },
        ],
        else: [],
        thenEnd: false,
        elseEnd: true,
      },
      {
        id: 'ok',
        name: 'Approve',
        type: 'approval',
        message: 'Ship it?',
        onReject: { action: 'end' },
      },
      {
        id: 'pause',
        name: 'Pause',
        type: 'wait',
        wait: { kind: 'until', field: 'dueDate', time: '00:00' },
      },
      {
        id: 'finish',
        name: 'Finish',
        type: 'action',
        action: { kind: 'set_status', status: 'Done' },
      },
    ]);
    const task = await issue(ctx, { dueDate: '2020-01-01' });
    const run = await startRun(ctx, task.id, pipelineId);
    const agent = await waitForAgentRun(run.id, 'implement');
    expect(agent.prompt).toContain(`Implement MKT-${task.sequenceNumber} "Launch page".`);
    expect(agent.agentId).toBe(ctx.coder.id);
    await finishAgentRun(agent.id, { output: 'I built the page.' });
    await waitForStatus(run.id, 'waiting');
    const decided = await ctx.asOwner['pipeline-runs']({ runId: run.id }).approval.post({
      approved: true,
      note: 'Looks good',
    });
    expect(decided.status).toBe(200);
    await waitForStatus(run.id, 'succeeded');
    expect(stepsOf(await runSteps(run.id))).toEqual([
      { stepId: 'implement', status: 'succeeded', outcome: 'success' },
      { stepId: 'worked', status: 'succeeded', outcome: 'true' },
      { stepId: 'note', status: 'succeeded', outcome: 'success' },
      { stepId: 'ok', status: 'succeeded', outcome: 'approved' },
      { stepId: 'pause', status: 'succeeded', outcome: 'success' },
      { stepId: 'finish', status: 'succeeded', outcome: 'success' },
    ]);
    const comments = await db
      .select({ body: issueActivity.body })
      .from(issueActivity)
      .where(and(eq(issueActivity.issueId, task.id), eq(issueActivity.kind, 'comment')));
    expect(comments.map((row) => row.body)).toContain('Done: I built the page.');
    const shown = (await ctx.asOwner['pipeline-runs']({ runId: run.id }).get()).data!;
    expect(shown).toMatchObject({ kind: 'workflow', status: 'succeeded', version: 1 });
    expect(shown.steps.find((step) => step.stepId === 'implement')?.agentRun?.id).toBe(agent.id);
    expect(shown.steps.find((step) => step.stepId === 'ok')).toMatchObject({
      note: 'Looks good',
      decidedByName: 'Owner',
    });
  });

  it('takes the lane of a condition and goes on after an empty lane', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [
      {
        id: 'urgent',
        name: 'Urgent?',
        type: 'condition',
        condition: { kind: 'task', field: 'priority', op: 'is', values: ['urgent'] },
        then: [
          { id: 'flag', name: 'Flag', type: 'action', action: { kind: 'comment', body: 'Urgent' } },
        ],
        else: [],
        thenEnd: false,
        elseEnd: false,
      },
      { id: 'after', name: 'After', type: 'action', action: { kind: 'comment', body: 'After' } },
    ]);
    const plain = await startRun(ctx, (await issue(ctx)).id, pipelineId);
    await waitForStatus(plain.id, 'succeeded');
    expect(stepsOf(await runSteps(plain.id)).map((step) => step.stepId)).toEqual([
      'urgent',
      'after',
    ]);
    const urgent = await startRun(ctx, (await issue(ctx, { priority: 'urgent' })).id, pipelineId);
    await waitForStatus(urgent.id, 'succeeded');
    expect(stepsOf(await runSteps(urgent.id)).map((step) => step.stepId)).toEqual([
      'urgent',
      'flag',
      'after',
    ]);
  });

  it('sends a rejected run back to the rework step until the loop guard ends it', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [
      agentStep('draft', 'Draft it.'),
      {
        id: 'review',
        name: 'Review',
        type: 'approval',
        message: 'Good?',
        onReject: { action: 'goto', stepId: 'draft', maxLoops: 1 },
      },
    ]);
    const run = await startRun(ctx, (await issue(ctx)).id, pipelineId);
    await answerStep(run.id, 'draft', { output: 'first draft' });
    await waitForStatus(run.id, 'waiting');
    await ctx.asOwner['pipeline-runs']({ runId: run.id }).approval.post({
      approved: false,
      note: 'Shorter please',
    });
    const second = await waitForAgentRun(run.id, 'draft');
    expect(second.prompt).toContain('Draft it.');
    await finishAgentRun(second.id, { output: 'second draft' });
    await waitForRun(run.id, (row) => row.status === 'waiting');
    await ctx.asOwner['pipeline-runs']({ runId: run.id }).approval.post({ approved: false });
    await waitForStatus(run.id, 'rejected');
    const rows = await runSteps(run.id);
    expect(rows.map((row) => `${row.stepId}#${row.iteration}:${row.outcome}`)).toEqual([
      'draft#1:success',
      'review#1:rejected',
      'draft#2:success',
      'review#2:rejected',
    ]);
  });

  it('fails the run on a failed agent step unless an outcome condition follows it', async () => {
    const ctx = await setupProject();
    const handled = await workflow(ctx, [
      agentStep('try', 'Try it.'),
      {
        id: 'failed',
        name: 'Failed?',
        type: 'condition',
        condition: { kind: 'outcome', outcomes: ['failed', 'blocked'] },
        then: [
          {
            id: 'tell',
            name: 'Tell',
            type: 'action',
            action: { kind: 'comment', body: 'It failed' },
          },
        ],
        else: [],
        thenEnd: true,
        elseEnd: false,
      },
    ]);
    const handledRun = await startRun(ctx, (await issue(ctx)).id, handled);
    await answerStep(handledRun.id, 'try', { status: 'failed', error: 'Hermes crashed' });
    await waitForStatus(handledRun.id, 'succeeded');
    expect(stepsOf(await runSteps(handledRun.id)).map((step) => step.stepId)).toEqual([
      'try',
      'failed',
      'tell',
    ]);

    const plain = await template(ctx, {
      name: 'Plain',
      definition: definition([agentStep('try', 'Try it.')]),
    });
    await enable(ctx, plain.id, { coder: ctx.coder.id });
    const run = await startRun(ctx, (await issue(ctx)).id, plain.id);
    await answerStep(run.id, 'try', { blockedQuestion: 'Which colour?' });
    const failed = await waitForStatus(run.id, 'failed');
    expect(failed.error).toBe('Step "Step try" is blocked: Which colour?');
  });

  it('simulates agents, actions and approvals in a test run', async () => {
    const ctx = await setupProject();
    const created = await template(ctx, {
      definition: definition([
        agentStep('implement', 'Implement {{task.title}}.'),
        { id: 'ok', name: 'Approve', type: 'approval', message: '', onReject: { action: 'end' } },
        {
          id: 'move',
          name: 'Move',
          type: 'action',
          action: { kind: 'set_status', status: 'Done' },
        },
        { id: 'pause', name: 'Pause', type: 'wait', wait: { kind: 'delay', minutes: 600 } },
      ]),
    });
    const task = await issue(ctx);
    // The project has not named the coder: a test run shows what is missing and goes on.
    const run = await startRun(ctx, task.id, created.id, true);
    await waitForStatus(run.id, 'succeeded');
    expect(stepsOf(await runSteps(run.id))).toEqual([
      { stepId: 'implement', status: 'simulated', outcome: 'success' },
      { stepId: 'ok', status: 'simulated', outcome: 'approved' },
      { stepId: 'move', status: 'simulated', outcome: 'success' },
      { stepId: 'pause', status: 'simulated', outcome: 'success' },
    ]);
    expect((await runSteps(run.id))[0]!.error).toBe('No agent of the project fills the role coder');
    const queued = await db.select().from(agentRun).where(eq(agentRun.issueId, task.id));
    expect(queued).toEqual([]);
  });

  it('cancels a run and the agent run it waits for, and records nothing more', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [
      agentStep('implement', 'Implement it.'),
      { id: 'after', name: 'After', type: 'action', action: { kind: 'comment', body: 'After' } },
    ]);
    const run = await startRun(ctx, (await issue(ctx)).id, pipelineId);
    const agent = await waitForAgentRun(run.id, 'implement');
    const canceled = await ctx.asOwner['pipeline-runs']({ runId: run.id }).cancel.post();
    expect(canceled.data).toMatchObject({ status: 'canceled' });
    const [queued] = await db.select().from(agentRun).where(eq(agentRun.id, agent.id));
    expect(queued!.status).toBe('canceled');
    await Bun.sleep(1_500);
    expect(stepsOf(await runSteps(run.id))).toEqual([
      { stepId: 'implement', status: 'canceled', outcome: null },
    ]);
    const again = await ctx.asOwner['pipeline-runs']({ runId: run.id }).cancel.post();
    expect(again.status).toBe(409);
  });

  it('retries a failed run from the failed step and keeps the steps before it', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [
      { id: 'hello', name: 'Hello', type: 'action', action: { kind: 'comment', body: 'Hello' } },
      agentStep('implement', 'Implement it.'),
    ]);
    const task = await issue(ctx);
    const run = await startRun(ctx, task.id, pipelineId);
    const first = await answerStep(run.id, 'implement', { status: 'failed', error: 'Boom' });
    await waitForStatus(run.id, 'failed');
    const retried = await ctx.asOwner['pipeline-runs']({ runId: run.id }).retry.post();
    expect(retried.status).toBe(200);
    const second = await waitForAgentRun(run.id, 'implement');
    expect(second.id).not.toBe(first.id);
    await finishAgentRun(second.id, { output: 'Fixed.' });
    await waitForStatus(run.id, 'succeeded');
    const rows = await runSteps(run.id);
    expect(rows.map((row) => `${row.stepId}:${row.status}:${row.attempt}`)).toEqual([
      'hello:succeeded:1',
      'implement:succeeded:2',
    ]);
    const hellos = await db
      .select()
      .from(issueActivity)
      .where(and(eq(issueActivity.issueId, task.id), eq(issueActivity.body, 'Hello')));
    expect(hellos).toHaveLength(1);
  });

  it('tells people about a run with a notify step', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [
      {
        id: 'tell',
        name: 'Tell',
        type: 'notify',
        to: { kind: 'assignee' },
        message: '{{task.identifier}} is ready.',
      },
    ]);
    const task = await issue(ctx, { assigneeUserId: ctx.owner.userId });
    const run = await startRun(ctx, task.id, pipelineId);
    await waitForStatus(run.id, 'succeeded');
    const notified = await db
      .select({ type: notification.type })
      .from(notification)
      .where(and(eq(notification.userId, ctx.owner.userId), eq(notification.issueId, task.id)));
    expect(notified.map((row) => row.type)).toContain('mentioned');
    const [step] = await runSteps(run.id);
    expect(step).toMatchObject({
      status: 'succeeded',
      summary: `MKT-${task.sequenceNumber} is ready.`,
    });
  });

  it('finds default states under their English names in a German project', async () => {
    const ctx = await setupProject({ locale: 'de' });
    // Enabling checks the state names against the project: "Todo" and "Review" are its
    // "Zu erledigen" and "In Prüfung".
    const pipelineId = await workflow(ctx, [
      {
        id: 'open',
        name: 'Still to do?',
        type: 'condition',
        condition: { kind: 'task', field: 'status', op: 'is', values: ['Todo'] },
        then: [
          {
            id: 'review',
            name: 'Move to review',
            type: 'action',
            action: { kind: 'set_status', status: 'Review' },
          },
        ],
        else: [],
        thenEnd: false,
        elseEnd: true,
      },
    ]);
    const task = await issue(ctx);
    expect(task.columnId).toBe(ctx.columnId('Zu erledigen'));
    const run = await startRun(ctx, task.id, pipelineId);
    await waitForStatus(run.id, 'succeeded');
    expect(stepsOf(await runSteps(run.id))).toEqual([
      { stepId: 'open', status: 'succeeded', outcome: 'true' },
      { stepId: 'review', status: 'succeeded', outcome: 'success' },
    ]);
    const [row] = await db
      .select({ columnId: issueTable.columnId })
      .from(issueTable)
      .where(eq(issueTable.id, task.id));
    expect(row!.columnId).toBe(ctx.columnId('In Prüfung'));
  });
});
