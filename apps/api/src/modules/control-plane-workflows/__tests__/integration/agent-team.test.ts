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
import { agentRun, db, issue as issueTable, issueActivity, pipelineRun } from '@repo/db';
import { and, asc, eq } from 'drizzle-orm';
import { authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { recordModelUnavailable } from '#modules/model-availability/service';
import {
  answerStep,
  finishAgentRun,
  runSteps,
  resetEngineDb,
  startEngine,
  stopEngineRuns,
  stopTestEngine,
  waitForAgentRun,
  waitForStatus,
} from '#tests/helpers/engine';

// A run takes a few hops through the engine's queues (see helpers/engine.ts).
setDefaultTimeout(30_000);

// The agent team of a task on the Helena engine: started by delegating the task to a
// coordinator of a project that runs agent teams, or on request; the coordinator plans,
// specialists work in dependency order, the coordinator reviews, and the result goes to
// the task. Ported from the agent-team, stage-recovery and control-plane tests of the
// Mastra workflow; the test plays the Hermes runner.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const created = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const teamId = created.data!.teamId;
  const view = await asOwner.projects({ projectKey: 'MKT' }).get();
  const organization = asOwner.teams({ teamId }).organization;
  const coordinator = (await organization.get()).data!.agents.find(
    (agent) => agent.username === 'hermes-mkt-coordinator',
  )!;
  await organization.agents({ agentId: coordinator.id }).put({ role: 'coordinator' });
  const columns = view.data!.columns;
  return {
    owner,
    asOwner,
    teamId,
    organization,
    coordinator,
    columnId: columns[0]!.id,
    column: (name: string) => columns.find((column) => column.name === name)!.id,
  };
}

async function specialist(asOwner: Api, teamId: number, username: string, capabilities: string[]) {
  const agent = (
    await createAgent(asOwner, 'MKT', { name: username, username, triggerOnAssign: true } as never)
  ).data!.agent;
  await asOwner
    .teams({ teamId })
    .organization.agents({ agentId: agent.id })
    .put({ role: 'specialist', capabilities });
  return agent;
}

function enableAgentTeam(asOwner: Api, configuration: Record<string, unknown> = {}) {
  return asOwner
    .projects({ projectKey: 'MKT' })
    ['control-plane'].workflows({ workflowId: 'agent-team' })
    .put({ enabled: true, capabilityRefs: [], configuration: configuration as never });
}

async function createIssue(asOwner: Api, columnId: number, body: Record<string, unknown> = {}) {
  return (
    await asOwner
      .projects({ projectKey: 'MKT' })
      .issues.post({ columnId, title: 'Launch page', ...body } as never)
  ).data!;
}

async function teamRuns(issueId: number) {
  return db
    .select()
    .from(pipelineRun)
    .where(and(eq(pipelineRun.issueId, issueId), eq(pipelineRun.kind, 'agent_team')))
    .orderBy(asc(pipelineRun.createdAt));
}

function teamOf(run: { definition: unknown }) {
  return (run.definition as { steps: { team: Record<string, unknown> }[] }).steps[0]!.team;
}

const json = (value: unknown) => JSON.stringify(value);

async function runsOf(asOwner: Api, teamId: number, agentId: number) {
  return (await asOwner.teams({ teamId })['ai-agents']({ agentId }).runs.get()).data!.items;
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

describe('agent team settings', () => {
  it('validates and completes the agent-team configuration', async () => {
    const { asOwner } = await setup();
    const listed = async () =>
      (
        (await asOwner.projects({ projectKey: 'MKT' })['control-plane'].workflows.get()).data as {
          id: string;
          assignment: { configuration: unknown };
        }[]
      ).find((flow) => flow.id === 'agent-team')!.assignment.configuration;

    expect(await listed()).toEqual({
      autonomy: 'review',
      reviewRequired: true,
      maxTurns: null,
      runBudgetSeconds: null,
    });
    for (const configuration of [
      { maxTurns: 0 },
      { maxTurns: 201 },
      { runBudgetSeconds: 59 },
      { runBudgetSeconds: 7_201 },
      { autonomy: 'always' },
      { autonomy: 'done', reviewRequired: false },
    ])
      expect((await enableAgentTeam(asOwner, configuration)).status).toBe(400);
    expect(
      (
        await enableAgentTeam(asOwner, {
          autonomy: 'done',
          maxTurns: 200,
          runBudgetSeconds: 7_200,
          instructions: 'Keep the scope small.',
        })
      ).status,
    ).toBe(200);
    expect(await listed()).toEqual({
      autonomy: 'done',
      reviewRequired: true,
      maxTurns: 200,
      runBudgetSeconds: 7_200,
      instructions: 'Keep the scope small.',
    });
  });
});

describe('agent team runs', () => {
  it('plans with the coordinator, works in dependency order, reviews and updates the task', async () => {
    const { asOwner, teamId, columnId, coordinator, column } = await setup();
    const designer = await specialist(asOwner, teamId, 'designer', ['frontend']);
    const writer = await specialist(asOwner, teamId, 'writer', ['docs', 'copy']);
    await enableAgentTeam(asOwner, { maxTurns: 40, runBudgetSeconds: 900 });
    const task = await createIssue(asOwner, columnId, {
      description:
        'Build the page.\n\n- [ ] Hero section\n  - [x] Mobile layout\n* [ ] No regressions',
    });
    await asOwner.issues({ issueId: task.id }).patch({ delegateUserId: coordinator.userId });
    const [run] = await teamRuns(task.id);
    const taskRef = `task:MKT-${task.sequenceNumber}`;
    expect(run).toMatchObject({ trigger: 'delegation', agentId: coordinator.id });
    expect(teamOf(run!)).toMatchObject({
      task: {
        taskRef,
        title: 'Launch page',
        acceptanceCriteria: ['Hero section', 'Mobile layout', 'No regressions'],
        labels: [],
      },
      coordinator: { agentRef: 'agent:hermes-mkt-coordinator', role: 'coordinator' },
      specialists: [
        { agentRef: 'agent:designer', capabilities: ['frontend'] },
        { agentRef: 'agent:writer', capabilities: ['docs', 'copy'] },
      ],
      policy: { reviewRequired: true, autonomy: 'review', maxTurns: 40, runBudgetSeconds: 900 },
    });
    // The delegation went to the team, not to a run of the coordinator of its own.
    const plan = await waitForAgentRun(run!.id, 'team.coordinate');
    expect(plan.agentId).toBe(coordinator.id);
    expect(plan).toMatchObject({ maxTurns: 40, runBudgetSeconds: 900 });
    expect(plan.prompt).toContain('Phase: coordinate');
    expect(plan.prompt).toContain('Allowed specialists');
    // The coordinator's first plan is Lokale KI's `coordinator-triage`; the rest is not.
    expect(plan.workClass).toBe('coordinator-triage');
    await finishAgentRun(plan.id, {
      output: json({
        summary: 'Design first, then copy.',
        delegations: [
          {
            assignmentId: 'design',
            agentRef: 'agent:designer',
            objective: 'Design the hero.',
            acceptanceCriteria: ['Hero section'],
            dependsOn: [],
          },
          {
            assignmentId: 'copy',
            agentRef: 'agent:writer',
            objective: 'Write the copy for the hero.',
            acceptanceCriteria: ['Copy fits the hero'],
            dependsOn: ['design'],
          },
        ],
      }),
    });
    const design = await waitForAgentRun(run!.id, 'team.s1');
    expect(design.agentId).toBe(designer.id);
    expect(design.workClass).toBeNull();
    // The dependent assignment waits until its dependency is done.
    await Bun.sleep(300);
    expect(await db.select().from(agentRun).where(eq(agentRun.agentId, writer.id))).toEqual([]);
    await finishAgentRun(design.id, {
      output:
        '```json\n' +
        json({
          summary: 'Hero designed.',
          evidence: [{ kind: 'artifact', ref: 'figma://hero', label: 'Hero design' }],
        }) +
        '\n```',
    });
    const copy = await waitForAgentRun(run!.id, 'team.s2');
    expect(copy.agentId).toBe(writer.id);
    expect(copy.prompt).toContain('Hero designed.');
    await finishAgentRun(copy.id, { output: json({ summary: 'Copy written.', evidence: [] }) });
    const review = await waitForAgentRun(run!.id, 'team.review');
    expect(review.agentId).toBe(coordinator.id);
    expect(review.prompt).toContain('Specialist results');
    await finishAgentRun(review.id, {
      output: json({
        summary: 'Reviewed.',
        evidence: [],
        review: { accepted: true, notes: 'All criteria met.' },
      }),
    });
    const done = await waitForStatus(run!.id, 'succeeded');
    expect(done.result).toMatchObject({
      status: 'review',
      taskRef,
      summary: 'All criteria met.',
      evidence: [{ kind: 'artifact', ref: 'figma://hero', label: 'Hero design' }],
      planSync: { state: 'review' },
    });
    const [after] = await db.select().from(issueTable).where(eq(issueTable.id, task.id));
    expect(after!.columnId).toBe(column('Review'));
    const comments = await db
      .select({ body: issueActivity.body, actorName: issueActivity.actorName })
      .from(issueActivity)
      .where(and(eq(issueActivity.issueId, task.id), eq(issueActivity.kind, 'comment')));
    expect(comments).toContainEqual({
      body: '## Agent team result\n\nAll criteria met.\n\n### Evidence\n- Hero design: figma://hero',
      actorName: 'Agent team',
    });
    expect(await runsOf(asOwner, teamId, coordinator.id)).toHaveLength(2);

    // The issue lists the run with every stage and the agent run behind it.
    const listed = (await asOwner.issues({ issueId: task.id })['agent-team'].runs.get()).data!;
    expect(listed[0]).toMatchObject({
      runId: run!.id,
      status: 'succeeded',
      steps: [
        { id: 'coordinate', status: 'succeeded' },
        { id: 'specialize', status: 'succeeded' },
        { id: 'review', status: 'succeeded' },
        { id: 'synchronize', status: 'succeeded' },
      ],
    });
    expect(listed[0]!.stages.map((stage) => [stage.phase, stage.assignmentId])).toEqual([
      ['coordinate', null],
      ['specialize', 'design'],
      ['specialize', 'copy'],
      ['review', null],
    ]);
  });

  it('lets the coordinator complete a task when its plan needs no specialists', async () => {
    const { asOwner, teamId, columnId, coordinator, column } = await setup();
    await specialist(asOwner, teamId, 'designer', ['frontend']);
    await specialist(asOwner, teamId, 'writer', ['docs']);
    await enableAgentTeam(asOwner, { autonomy: 'done' });
    const task = await createIssue(asOwner, columnId, {
      description: 'Finish the owner response.\n\n- [ ] A useful answer is recorded',
    });
    const started = (await asOwner.issues({ issueId: task.id })['agent-team'].post({})).data!;

    const plan = await answerStep(started.runId, 'team.coordinate', {
      output: json({ summary: 'I can answer this directly.', delegations: [] }),
    });
    expect(plan.agentId).toBe(coordinator.id);
    const work = await waitForAgentRun(started.runId, 'team.s1');
    expect(work.agentId).toBe(coordinator.id);
    expect(work.prompt).toContain('Phase: specialize');
    expect(work.prompt).toContain('"assignmentId":"coordinator-work"');
    expect(work.prompt).toContain('A useful answer is recorded');
    await finishAgentRun(work.id, {
      output: json({
        summary: 'The answer is recorded.',
        evidence: [{ kind: 'comment', ref: 'task:MKT', label: 'Answer' }],
      }),
    });
    const review = await waitForAgentRun(started.runId, 'team.review');
    expect(review.agentId).toBe(coordinator.id);
    await finishAgentRun(review.id, {
      output: json({
        summary: 'Complete.',
        review: { accepted: true, notes: 'The answer meets the criterion.' },
      }),
    });
    const done = await waitForStatus(started.runId, 'succeeded');
    expect(done.result).toMatchObject({
      status: 'done',
      summary: 'The answer meets the criterion.',
      evidence: [{ kind: 'comment', ref: 'task:MKT', label: 'Answer' }],
    });
    expect(
      (done.result as { history: { phase: string }[] }).history.map((step) => step.phase),
    ).toEqual(['coordinate', 'specialize', 'review']);
    const [after] = await db.select().from(issueTable).where(eq(issueTable.id, task.id));
    expect(after!.columnId).toBe(column('Done'));
  });

  it('routes to the only specialist or the one the labels name without a coordinator stage', async () => {
    const { asOwner, teamId, columnId } = await setup();
    const designer = await specialist(asOwner, teamId, 'designer', ['frontend']);
    await enableAgentTeam(asOwner, { reviewRequired: false });
    const single = await createIssue(asOwner, columnId);
    const started = await asOwner.issues({ issueId: single.id })['agent-team'].post({});
    expect(started.status).toBe(200);
    const work = await waitForAgentRun(started.data!.runId, 'team.s1');
    expect(work.agentId).toBe(designer.id);
    await finishAgentRun(work.id, { output: json({ summary: 'Page built.', evidence: [] }) });
    const done = await waitForStatus(started.data!.runId, 'succeeded');
    expect(done.result).toMatchObject({ status: 'review', summary: 'Page built.' });
    expect(
      (done.result as { history: { phase: string; summary: string }[] }).history[0],
    ).toMatchObject({
      phase: 'route',
      summary: 'Routed to agent:designer without a coordinator stage: the team has one specialist.',
    });

    await specialist(asOwner, teamId, 'writer', ['docs']);
    const labelId = (await asOwner.projects({ projectKey: 'MKT' }).labels.post({ name: 'Docs' }))
      .data!.id;
    const labelled = await createIssue(asOwner, columnId, { labelIds: [labelId] });
    const byLabel = await asOwner.issues({ issueId: labelled.id })['agent-team'].post({});
    const writerWork = await waitForAgentRun(byLabel.data!.runId, 'team.s1');
    expect((await runSteps(byLabel.data!.runId)).map((row) => row.stepId)).not.toContain(
      'team.coordinate',
    );
    await finishAgentRun(writerWork.id, {
      output: json({ summary: 'Docs written.', evidence: [] }),
    });
    await waitForStatus(byLabel.data!.runId, 'succeeded');
  });

  it('moves accepted work to Done under autonomy done and rejected work to Review', async () => {
    const { asOwner, teamId, columnId, column } = await setup();
    await specialist(asOwner, teamId, 'designer', ['frontend']);
    await enableAgentTeam(asOwner, { autonomy: 'done' });
    const answer = async (accepted: boolean) => {
      const task = await createIssue(asOwner, columnId);
      const started = (await asOwner.issues({ issueId: task.id })['agent-team'].post({})).data!;
      await answerStep(started.runId, 'team.s1', {
        output: json({ summary: 'Built.', evidence: [] }),
      });
      await answerStep(started.runId, 'team.review', {
        output: json({
          summary: 'Checked.',
          evidence: [],
          review: { accepted, notes: accepted ? 'Good.' : 'Not yet.' },
        }),
      });
      const done = await waitForStatus(started.runId, 'succeeded');
      const [after] = await db.select().from(issueTable).where(eq(issueTable.id, task.id));
      return { status: (done.result as { status: string }).status, columnId: after!.columnId };
    };
    expect(await answer(true)).toEqual({
      status: 'done',
      columnId: column('Done'),
    });
    expect(await answer(false)).toEqual({ status: 'review', columnId: column('Review') });
  });

  it('stops before specialist work when the coordinator plans a dependency cycle', async () => {
    const { asOwner, teamId, columnId } = await setup();
    await specialist(asOwner, teamId, 'designer', ['frontend']);
    await specialist(asOwner, teamId, 'writer', ['docs']);
    await enableAgentTeam(asOwner);
    const task = await createIssue(asOwner, columnId);
    const started = (await asOwner.issues({ issueId: task.id })['agent-team'].post({})).data!;
    await answerStep(started.runId, 'team.coordinate', {
      output: json({
        summary: 'Plan.',
        delegations: [
          {
            assignmentId: 'a',
            agentRef: 'agent:designer',
            objective: 'A',
            acceptanceCriteria: ['A'],
            dependsOn: ['b'],
          },
          {
            assignmentId: 'b',
            agentRef: 'agent:writer',
            objective: 'B',
            acceptanceCriteria: ['B'],
            dependsOn: ['a'],
          },
        ],
      }),
    });
    const failed = await waitForStatus(started.runId, 'failed');
    expect(failed.error).toBe('Assignment dependencies form a cycle');
    expect((await runSteps(started.runId)).map((row) => row.stepId)).not.toContain('team.s1');
  });

  it("plans again on the coordinator's own model when its first plan is unusable", async () => {
    const { asOwner, teamId, columnId } = await setup();
    await specialist(asOwner, teamId, 'designer', ['frontend']);
    await specialist(asOwner, teamId, 'writer', ['docs']);
    await enableAgentTeam(asOwner, { reviewRequired: false });
    const task = await createIssue(asOwner, columnId);
    const started = (await asOwner.issues({ issueId: task.id })['agent-team'].post({})).data!;
    const first = await answerStep(started.runId, 'team.coordinate', { output: 'no plan' });
    expect(first.workClass).toBe('coordinator-triage');
    const second = await waitForAgentRun(started.runId, 'team.coordinate');
    expect(second.id).not.toBe(first.id);
    expect(second.workClass).toBeNull();
  });

  it('runs a stage again with backoff when its answer is unusable, up to the attempts', async () => {
    const { asOwner, teamId, columnId } = await setup();
    await specialist(asOwner, teamId, 'designer', ['frontend']);
    await enableAgentTeam(asOwner, { reviewRequired: false });
    const task = await createIssue(asOwner, columnId);
    const started = (await asOwner.issues({ issueId: task.id })['agent-team'].post({})).data!;
    const first = await answerStep(started.runId, 'team.s1', { output: 'I did it, trust me.' });
    const second = await answerStep(started.runId, 'team.s1', {
      status: 'failed',
      error: 'Crashed',
    });
    expect(second.id).not.toBe(first.id);
    const third = await answerStep(started.runId, 'team.s1', { output: 'still no json' });
    const failed = await waitForStatus(started.runId, 'failed');
    expect(failed.error).toContain('failed after 3 attempts');
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  });

  it('fails a stage at once when the provider refuses its model for good, and names it', async () => {
    const { asOwner, teamId, columnId } = await setup();
    await specialist(asOwner, teamId, 'designer', ['frontend']);
    await enableAgentTeam(asOwner, { reviewRequired: false });
    const task = await createIssue(asOwner, columnId);
    const started = (await asOwner.issues({ issueId: task.id })['agent-team'].post({})).data!;
    const refused = await answerStep(started.runId, 'team.s1', {
      status: 'failed',
      output: "ChatGPT or Codex Subscription rejected the request and retrying won't help.",
      error: 'HTTP 400: not supported\nsession_id: 20260924_190648_b02504',
      failure: {
        code: 'model-unavailable',
        retryable: false,
        model: 'gpt-6-terra',
        detail: "The 'gpt-6-terra' model is not supported when using Codex with a ChatGPT account.",
      },
    });
    const failed = await waitForStatus(started.runId, 'failed');
    // One attempt, not the three the policy allows, and the provider's words, not the session.
    expect(failed.error).toContain('the model gpt-6-terra is not available for this account');
    expect(failed.error).toContain('not supported when using Codex with a ChatGPT account');
    expect(failed.error).not.toContain('session_id');
    const stageRuns = await db
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(eq(agentRun.agentId, refused.agentId));
    expect(stageRuns).toEqual([{ id: refused.id }]);
    // The run views name it, for the reader's language.
    const runs = (await asOwner.issues({ issueId: task.id })['agent-team'].runs.get()).data!;
    expect(runs[0]).toMatchObject({
      status: 'failed',
      failure: { code: 'model-unavailable', model: 'gpt-6-terra' },
    });
  });

  it('does not start a stage on a model the provider already refused', async () => {
    const { asOwner, teamId, columnId } = await setup();
    const designer = await specialist(asOwner, teamId, 'designer', ['frontend']);
    await asOwner.teams({ teamId })['ai-agents']({ agentId: designer.id }).patch({
      model: 'gpt-6-terra',
    });
    await recordModelUnavailable(
      { runtime: 'hermes', provider: 'openai-codex', model: 'gpt-6-terra' },
      { agentId: designer.id },
      { code: 'model-unavailable', detail: 'not supported with a ChatGPT account' },
    );
    await enableAgentTeam(asOwner, { reviewRequired: false });
    const task = await createIssue(asOwner, columnId);
    const started = (await asOwner.issues({ issueId: task.id })['agent-team'].post({})).data!;
    const failed = await waitForStatus(started.runId, 'failed');
    expect(failed.error).toContain('@designer runs gpt-6-terra, which openai-codex does not serve');
    expect(
      await db.select({ id: agentRun.id }).from(agentRun).where(eq(agentRun.agentId, designer.id)),
    ).toEqual([]);
    const stage = (await runSteps(started.runId)).find((row) => row.stepId === 'team.s1');
    expect(stage).toMatchObject({ status: 'failed' });
    expect((stage!.state as { runtimeFailure?: unknown }).runtimeFailure).toMatchObject({
      code: 'model-unavailable',
      model: 'gpt-6-terra',
    });
  });

  it('fails a stage whose agent is blocked and asks, and a retry runs only that stage again', async () => {
    const { asOwner, teamId, columnId } = await setup();
    await specialist(asOwner, teamId, 'designer', ['frontend']);
    await enableAgentTeam(asOwner);
    const task = await createIssue(asOwner, columnId);
    const started = (await asOwner.issues({ issueId: task.id })['agent-team'].post({})).data!;
    const work = await answerStep(started.runId, 'team.s1', {
      output: json({ summary: 'Built.', evidence: [] }),
    });
    await answerStep(started.runId, 'team.review', { blockedQuestion: 'Which brand colour?' });
    const failed = await waitForStatus(started.runId, 'failed');
    expect(failed.error).toContain('is blocked and needs input: Which brand colour?');

    const retried = await asOwner
      .projects({ projectKey: 'MKT' })
      ['control-plane'].workflows({ workflowId: 'agent-team' })
      .runs({ runId: started.runId })
      .retry.post();
    expect(retried.status).toBe(200);
    await answerStep(started.runId, 'team.review', {
      output: json({ summary: 'Ok.', evidence: [], review: { accepted: true, notes: 'Fine.' } }),
    });
    await waitForStatus(started.runId, 'succeeded');
    // The specialist's finished stage kept its run; only the review ran again.
    const designerRuns = await db
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(eq(agentRun.agentId, work.agentId));
    expect(designerRuns).toEqual([{ id: work.id }]);
  });

  it('cancels the stage runs of a canceled team run', async () => {
    const { asOwner, teamId, columnId } = await setup();
    await specialist(asOwner, teamId, 'designer', ['frontend']);
    await enableAgentTeam(asOwner);
    const task = await createIssue(asOwner, columnId);
    const started = (await asOwner.issues({ issueId: task.id })['agent-team'].post({})).data!;
    const work = await waitForAgentRun(started.runId, 'team.s1');
    const canceled = await asOwner
      .projects({ projectKey: 'MKT' })
      ['control-plane'].workflows({ workflowId: 'agent-team' })
      .runs({ runId: started.runId })
      .cancel.post();
    expect(canceled.status).toBe(200);
    const [stage] = await db.select().from(agentRun).where(eq(agentRun.id, work.id));
    expect(stage!.status).toBe('canceled');
    expect((await teamRuns(task.id))[0]!.status).toBe('canceled');
  });

  it('queues a direct run when the team does not apply or cannot start', async () => {
    const { asOwner, teamId, columnId, coordinator, organization } = await setup();
    const designer = await specialist(asOwner, teamId, 'designer', ['frontend']);
    const disabled = await createIssue(asOwner, columnId);
    await asOwner.issues({ issueId: disabled.id }).patch({ delegateUserId: coordinator.userId });
    expect(await teamRuns(disabled.id)).toEqual([]);
    expect(await runsOf(asOwner, teamId, coordinator.id)).toHaveLength(1);

    await enableAgentTeam(asOwner);
    const toSpecialist = await createIssue(asOwner, columnId);
    await asOwner.issues({ issueId: toSpecialist.id }).patch({ delegateUserId: designer.userId });
    expect(await teamRuns(toSpecialist.id)).toEqual([]);
    expect(await runsOf(asOwner, teamId, designer.id)).toHaveLength(1);

    // A paused coordinator refuses its team; the delegation queues its own run, which
    // the pause then holds.
    await organization.agents({ agentId: coordinator.id }).pause.post({});
    const paused = await createIssue(asOwner, columnId);
    await asOwner.issues({ issueId: paused.id }).patch({ delegateUserId: coordinator.userId });
    expect(await teamRuns(paused.id)).toEqual([]);
  });

  it('starts one team per coordinator and task at a time, and replays the same key', async () => {
    const { asOwner, teamId, columnId, coordinator } = await setup();
    await specialist(asOwner, teamId, 'designer', ['frontend']);
    const task = await createIssue(asOwner, columnId);
    const start = (idempotencyKey?: string) =>
      asOwner.issues({ issueId: task.id })['agent-team'].post({ idempotencyKey });
    expect((await start()).status).toBe(409);
    await enableAgentTeam(asOwner);
    const key = crypto.randomUUID();
    const first = await start(key);
    expect(first.data).toMatchObject({ runId: key, taskRef: `task:MKT-${task.sequenceNumber}` });
    expect((await start(key)).data!.runId).toBe(key);
    // Delegating the task to the coordinator while its team works starts nothing new.
    await asOwner.issues({ issueId: task.id }).patch({ delegateUserId: coordinator.userId });
    await asOwner.issues({ issueId: task.id }).patch({ delegateUserId: coordinator.userId });
    expect(await teamRuns(task.id)).toHaveLength(1);
    expect((await start('not-a-uuid')).status).toBe(400);
  });

  it('leaves a paused specialist out and refuses a paused coordinator', async () => {
    const { asOwner, teamId, columnId, organization, coordinator } = await setup();
    await specialist(asOwner, teamId, 'designer', ['frontend']);
    const writer = await specialist(asOwner, teamId, 'writer', ['docs']);
    await enableAgentTeam(asOwner);
    const task = await createIssue(asOwner, columnId);
    await organization.agents({ agentId: writer.id }).pause.post({});
    const started = await asOwner.issues({ issueId: task.id })['agent-team'].post({});
    expect(started.status).toBe(200);
    const [run] = await teamRuns(task.id);
    expect((teamOf(run!).specialists as unknown[]).length).toBe(1);
    await organization.agents({ agentId: coordinator.id }).pause.post({});
    const other = await createIssue(asOwner, columnId);
    const refused = await asOwner.issues({ issueId: other.id })['agent-team'].post({});
    expect(refused.status).toBe(409);
    expect(refused.error?.value).toMatchObject({
      error: 'The coordinator @hermes-mkt-coordinator is paused',
    });
  });

  it('lets the coordinator do the work when the project has no specialist', async () => {
    const { asOwner, columnId, coordinator } = await setup();
    await enableAgentTeam(asOwner, { reviewRequired: false });
    const task = await createIssue(asOwner, columnId, { title: 'Write the brief' });
    const started = (await asOwner.issues({ issueId: task.id })['agent-team'].post({})).data!;
    const [run] = await teamRuns(task.id);
    expect(teamOf(run!)).toMatchObject({
      task: {
        objective: 'Write the brief',
        acceptanceCriteria: ['The work item is done as its description asks.'],
      },
      specialists: [{ agentRef: 'agent:hermes-mkt-coordinator', role: 'coordinator' }],
    });
    const work = await waitForAgentRun(started.runId, 'team.s1');
    expect(work.agentId).toBe(coordinator.id);
  });
});
