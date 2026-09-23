import { beforeEach, describe, expect, it } from 'bun:test';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { addProjectMember } from '#tests/helpers/members';
import { controlApi, controlPlane } from '#tests/helpers/control';
import { drainPendingStarts } from '../../runs';

// The workflow builder through the API: the library and a project's workflows, runs
// started by hand and by task events, and the control operations Mastra's plan-pipeline
// workflow calls while it runs one. The Mastra control endpoint is a stand-in that
// records what Plan asks it.

type Json = Record<string, unknown>;

const agentStep = (id: string, instruction: string, assignee: Json = { role: 'coder' }) => ({
  id,
  name: `Step ${id}`,
  type: 'agent',
  assignee,
  instruction,
  maxTurns: null,
  runBudgetSeconds: null,
  model: null,
  timeoutMinutes: 30,
});

function definition(steps: Json[], extra: Json = {}) {
  return {
    schemaVersion: 1,
    trigger: { type: 'manual' },
    roles: [
      { key: 'lead', name: 'Lead', match: { type: 'coordinator' } },
      { key: 'coder', name: 'Coder', match: { type: 'none' } },
    ],
    steps,
    ...extra,
  };
}

const simple = () => definition([agentStep('implement', 'Implement {{task.title}}.')]);

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const created = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const teamId = created.data!.teamId;
  const view = await asOwner.projects({ projectKey: 'MKT' }).get();
  const columns = view.data!.columns;
  const organization = asOwner.teams({ teamId }).organization;
  const coordinator = (await organization.get()).data!.agents.find(
    (agent) => agent.username === 'hermes-mkt-coordinator',
  )!;
  await organization.agents({ agentId: coordinator.id }).put({ role: 'coordinator' });
  const coder = await createAgent(asOwner, 'MKT', {
    name: 'Coder',
    username: 'coder',
    kind: 'external',
    model: 'luna',
    runtimePolicy: {
      reasoningEffort: null,
      toolAllow: [],
      toolDeny: [],
      mcpGrants: [],
      files: [],
      maxTurns: 8,
    },
  });
  return {
    owner,
    asOwner,
    teamId,
    coordinator,
    coder: coder.data!.agent,
    coderKey: coder.data!.apiKey!,
    columnId: (name: string) => columns.find((column) => column.name === name)!.id,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function template(ctx: Setup, body: Json = {}) {
  const res = await ctx.asOwner
    .teams({ teamId: ctx.teamId })
    .pipelines.post({ name: 'Release', definition: simple(), ...body } as never);
  expect(res.status).toBe(201);
  return res.data!;
}

function enable(
  ctx: Setup,
  pipelineId: number,
  roles: Record<string, number> = {},
  enabled = true,
) {
  return ctx.asOwner
    .projects({ projectKey: 'MKT' })
    .pipelines({ pipelineId })
    .put({ enabled, roles });
}

async function issue(ctx: Setup, body: Json = {}) {
  const res = await ctx.asOwner
    .projects({ projectKey: 'MKT' })
    .issues.post({ columnId: ctx.columnId('Todo'), title: 'Launch page', ...body } as never);
  return res.data!;
}

async function control(body: Json) {
  const res = await controlApi().internal.orchestration.pipeline.post({
    schemaVersion: 1,
    ...body,
  });
  return { status: res.status, data: (res.data ?? (res.error?.value as unknown)) as Json };
}

async function startRun(ctx: Setup, issueId: number, pipelineId: number, dryRun = false) {
  const res = await ctx.asOwner.issues({ issueId })['pipeline-runs'].post({ pipelineId, dryRun });
  expect(res.status).toBe(200);
  return res.data!;
}

describe('workflow library', () => {
  beforeEach(async () => {
    await resetDb();
    controlPlane.reset();
  });

  it('creates, versions and deletes a template', async () => {
    const ctx = await setup();
    const created = await template(ctx, { description: 'Ship a release' });
    expect(created).toMatchObject({ projectId: null, version: 1, name: 'Release' });
    const pipeline = ctx.asOwner.pipelines({ pipelineId: created.id });

    expect((await pipeline.patch({ name: 'Release 2' })).data!.version).toBe(1);
    const same = await pipeline.patch({ definition: simple(), baseVersion: 1 });
    expect(same.data!.version).toBe(1);
    const changed = definition([
      agentStep('implement', 'Implement it.'),
      agentStep('review', '{{previous.summary}}', { role: 'lead' }),
    ]);
    const saved = await pipeline.patch({ definition: changed, baseVersion: 1 });
    expect(saved.data).toMatchObject({ version: 2, name: 'Release 2' });
    const stale = await pipeline.patch({ definition: simple(), baseVersion: 1 });
    expect(stale.status).toBe(409);

    expect((await pipeline.versions.get()).data!.map((v) => v.version)).toEqual([2, 1]);
    expect(
      (await pipeline.versions({ version: 1 }).get()).data!.definition.steps[0].instruction,
    ).toBe('Implement {{task.title}}.');
    expect((await pipeline.versions({ version: 3 }).get()).status).toBe(404);
    expect(
      (await ctx.asOwner.teams({ teamId: ctx.teamId }).pipelines.get()).data!.map((p) => p.name),
    ).toEqual(['Release 2']);

    const invalid = await pipeline.patch({
      definition: definition([agentStep('x', '{{step.nope.summary}}')]),
    });
    expect(invalid.status).toBe(400);
    expect((invalid.error!.value as { error: string }).error).toContain(
      'names a step that does not exist',
    );

    expect((await pipeline.delete()).status).toBe(204);
    expect((await pipeline.get()).status).toBe(404);
  });

  it('refuses a template that names an agent and keeps the library to its team', async () => {
    const ctx = await setup();
    const res = await ctx.asOwner.teams({ teamId: ctx.teamId }).pipelines.post({
      name: 'Direct',
      definition: definition([agentStep('a', 'Go', { agentId: ctx.coder.id })]),
    });
    expect(res.status).toBe(400);

    const created = await template(ctx);
    const outsider = authedApi((await signUpTestUser({ name: 'Outsider' })).cookie);
    expect((await outsider.teams({ teamId: ctx.teamId }).pipelines.get()).status).toBe(404);
    expect((await outsider.pipelines({ pipelineId: created.id }).get()).status).toBe(404);
    expect((await outsider.pipelines({ pipelineId: created.id }).delete()).status).toBe(404);
  });

  it('names each problem of a draft with its step and field', async () => {
    const ctx = await setup();
    const draft = definition(
      [
        agentStep('implement', '{{previous.summary}}', { role: 'ghost' }),
        {
          id: 'close',
          name: 'Close',
          type: 'action',
          action: { kind: 'set_status', status: 'Shipped' },
        },
      ],
      { trigger: { type: 'status_changed', to: 'Review' } },
    );
    const library = await ctx.asOwner
      .teams({ teamId: ctx.teamId })
      .pipelines.validate.post({ definition: draft, template: true });
    expect(library.data!.issues.map((i) => [i.code, i.stepId, i.field])).toEqual([
      ['unknown_role', 'implement', 'assignee'],
      ['no_previous_step', 'implement', 'instruction'],
    ]);
    const project = await ctx.asOwner
      .projects({ projectKey: 'MKT' })
      .pipelines.validate.post({ definition: simple(), template: false });
    expect(project.data!.issues).toMatchObject([
      { code: 'role_unresolved', stepId: 'implement', params: { role: 'coder' } },
    ]);
    const mapped = await ctx.asOwner.projects({ projectKey: 'MKT' }).pipelines.validate.post({
      definition: draft,
      template: false,
      roles: { ghost: ctx.coder.id },
    });
    expect(mapped.data!.issues.map((i) => i.code)).toEqual([
      'unknown_role',
      'no_previous_step',
      'unknown_status',
    ]);
  });

  it('offers built-in templates that are valid workflows', async () => {
    const ctx = await setup();
    const builtins = (await ctx.asOwner.teams({ teamId: ctx.teamId })['pipeline-builtins'].get())
      .data!;
    expect(builtins.map((b) => b.key)).toEqual(['agent-team', 'release-notes']);
    for (const builtin of builtins)
      await template(ctx, { name: builtin.name, definition: builtin.definition });
  });
});

describe('workflows of a project', () => {
  beforeEach(async () => {
    await resetDb();
    controlPlane.reset();
  });

  it('enables a template once an agent fills each of its roles', async () => {
    const ctx = await setup();
    const created = await template(ctx);
    const listed = (await ctx.asOwner.projects({ projectKey: 'MKT' }).pipelines.get()).data!;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ source: 'template', enabled: false });
    expect(listed[0]!.resolvedRoles).toMatchObject([
      { key: 'lead', source: 'match', agent: { username: 'hermes-mkt-coordinator' } },
      { key: 'coder', source: null, agent: null },
    ]);

    const refused = await enable(ctx, created.id);
    expect(refused.status).toBe(409);
    expect((refused.error!.value as { error: string }).error).toContain(
      'No agent of the project fills this role',
    );
    expect((await enable(ctx, created.id, { nobody: ctx.coder.id })).status).toBe(400);
    expect((await enable(ctx, created.id, { coder: 999_999 })).status).toBe(400);

    const enabled = await enable(ctx, created.id, { coder: ctx.coder.id });
    expect(enabled.status).toBe(200);
    expect(enabled.data).toMatchObject({
      enabled: true,
      roles: { coder: ctx.coder.id },
      issues: [],
    });
    expect(enabled.data!.resolvedRoles[1]).toMatchObject({
      source: 'mapping',
      agent: { id: ctx.coder.id },
    });
    expect(controlPlane.requests.filter((r) => r.operation.includes('schedule'))).toEqual([]);
  });

  it('keeps a project workflow to its project and lets it name the project agent', async () => {
    const ctx = await setup();
    const own = await ctx.asOwner.projects({ projectKey: 'MKT' }).pipelines.post({
      name: 'Own',
      definition: definition([agentStep('a', 'Go', { agentId: ctx.coder.id })]),
    });
    expect(own.status).toBe(201);
    expect(own.data!.projectKey).toBe('MKT');
    await ctx.asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const foreign = await ctx.asOwner
      .projects({ projectKey: 'OPS' })
      .pipelines({ pipelineId: own.data!.id })
      .put({ enabled: true, roles: {} });
    expect(foreign.status).toBe(404);
    expect((await enable(ctx, own.data!.id)).data).toMatchObject({
      source: 'project',
      enabled: true,
    });
  });

  it('keeps a Mastra schedule while a workflow with a schedule trigger is enabled', async () => {
    const ctx = await setup();
    controlPlane.answer = (request) =>
      request.operation === 'create-schedule' ? { id: 'schedule-1' } : {};
    const trigger = {
      type: 'schedule',
      cron: '0 9 * * 1',
      timezone: 'Europe/Berlin',
      title: 'Weekly release',
    };
    const created = await template(ctx, { definition: { ...simple(), trigger } });
    expect((await enable(ctx, created.id, { coder: ctx.coder.id })).status).toBe(200);
    expect(controlPlane.requests.at(-1)).toMatchObject({
      operation: 'create-schedule',
      workflowId: 'plan-pipeline',
      projectRef: 'project:MKT',
      scheduleKey: `pipeline-${created.id}`,
      cron: '0 9 * * 1',
      payload: { payload: { schemaVersion: 1, pipelineId: created.id } },
    });

    await ctx.asOwner
      .pipelines({ pipelineId: created.id })
      .patch({ definition: { ...simple(), trigger: { ...trigger, cron: '0 10 * * 1' } } });
    expect(controlPlane.requests.at(-1)).toMatchObject({
      operation: 'update-schedule',
      scheduleId: 'schedule-1',
      cron: '0 10 * * 1',
    });

    expect((await enable(ctx, created.id, { coder: ctx.coder.id }, false)).status).toBe(200);
    expect(controlPlane.requests.at(-1)).toMatchObject({
      operation: 'delete-schedule',
      scheduleId: 'schedule-1',
    });
  });
});

describe('workflow runs', () => {
  beforeEach(async () => {
    await resetDb();
    controlPlane.reset();
  });

  it('starts a workflow on a task by hand, one active run at a time', async () => {
    const ctx = await setup();
    const created = await template(ctx);
    const task = await issue(ctx);
    const disabled = await ctx.asOwner
      .issues({ issueId: task.id })
      ['pipeline-runs'].post({ pipelineId: created.id });
    expect(disabled.status).toBe(409);
    const test = await startRun(ctx, task.id, created.id, true);
    expect(test).toMatchObject({ dryRun: true, status: 'running', trigger: 'manual' });
    // The project has not named the coder yet: a test run shows it and goes on.
    const simulated = await control({
      operation: 'agent',
      runId: test.id,
      projectRef: 'project:MKT',
      stepId: 'implement',
      iteration: 1,
      seq: 1,
    });
    expect(simulated.data).toMatchObject({ dryRun: true, agentRef: 'agent:none' });
    expect(
      (await ctx.asOwner['pipeline-runs']({ runId: test.id }).get()).data!.steps,
    ).toMatchObject([
      { status: 'simulated', error: 'No agent of the project fills the role coder' },
    ]);

    await enable(ctx, created.id, { coder: ctx.coder.id });
    expect((await ctx.asOwner.issues({ issueId: task.id }).pipelines.get()).data).toEqual([
      { id: created.id, name: 'Release', description: '' },
    ]);
    const run = await startRun(ctx, task.id, created.id);
    expect(run).toMatchObject({
      status: 'running',
      version: 1,
      issueIdentifier: `MKT-${task.sequenceNumber}`,
    });
    expect(controlPlane.started().at(-1)).toMatchObject({
      workflowId: 'plan-pipeline',
      eventId: run.id,
      projectRef: 'project:MKT',
      dryRun: false,
      payload: { schemaVersion: 1, pipelineId: created.id },
    });
    const again = await ctx.asOwner
      .issues({ issueId: task.id })
      ['pipeline-runs'].post({ pipelineId: created.id });
    expect(again.status).toBe(409);
  });

  it('starts the workflows a task event triggers, not those a workflow change would', async () => {
    const ctx = await setup();
    const triggered = async (trigger: Json) => {
      const created = await template(ctx, {
        name: String(trigger.type),
        definition: { ...simple(), trigger },
      });
      expect((await enable(ctx, created.id, { coder: ctx.coder.id })).status).toBe(200);
      return created.id;
    };
    const urgent = (
      await ctx.asOwner.projects({ projectKey: 'MKT' }).labels.post({ name: 'urgent' })
    ).data!;
    const onCreate = await triggered({ type: 'task_created' });
    const onReview = await triggered({ type: 'status_changed', to: 'review' });
    const onLabel = await triggered({ type: 'label_added', label: 'Urgent' });
    const onAssign = await triggered({ type: 'task_assigned' });

    const task = await issue(ctx);
    await drainPendingStarts();
    const started = () =>
      controlPlane.started().map((request) => (request.payload as Json).pipelineId);
    expect(started()).toEqual([onCreate]);

    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('In Progress') });
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('Review') });
    await ctx.asOwner.issues({ issueId: task.id }).patch({ labelIds: [urgent.id] });
    await ctx.asOwner.issues({ issueId: task.id }).patch({ assigneeUserId: ctx.owner.userId });
    await drainPendingStarts();
    expect(started().sort()).toEqual([onCreate, onReview, onLabel, onAssign].sort());
    const runs = (await ctx.asOwner.issues({ issueId: task.id })['pipeline-runs'].get()).data!;
    expect(runs.map((run) => run.trigger).sort()).toEqual([
      'label_added',
      'status_changed',
      'task_assigned',
      'task_created',
    ]);

    // Once the status workflow finished, a move to Review by hand would start it again;
    // the same move made by a workflow starts nothing.
    const statusRun = runs.find((run) => run.trigger === 'status_changed')!;
    await control({
      operation: 'finish',
      runId: statusRun.id,
      projectRef: 'project:MKT',
      status: 'succeeded',
    });
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('Todo') });
    const mover = await template(ctx, {
      name: 'Mover',
      definition: definition([
        {
          id: 'move',
          name: 'Move',
          type: 'action',
          action: { kind: 'set_status', status: 'Review' },
        },
      ]),
    });
    await enable(ctx, mover.id);
    const moverRun = await startRun(ctx, task.id, mover.id);
    await control({ operation: 'begin', runId: moverRun.id, projectRef: 'project:MKT' });
    const moved = await control({
      operation: 'action',
      runId: moverRun.id,
      projectRef: 'project:MKT',
      stepId: 'move',
      iteration: 1,
      seq: 1,
    });
    expect(moved).toEqual({ status: 200, data: { summary: 'Status set to Review' } });
    await drainPendingStarts();
    expect(started().filter((id) => id === onReview)).toHaveLength(1);
    expect(started().at(-1)).toBe(mover.id);
  });

  it('runs the steps Mastra reports and shows them on the task', async () => {
    const ctx = await setup();
    const created = await template(ctx, {
      definition: definition([
        agentStep('implement', 'Implement {{task.identifier}} "{{task.title}}".'),
        {
          id: 'check',
          name: 'Did it work?',
          type: 'condition',
          condition: { kind: 'outcome', outcomes: ['success'] },
          then: [
            {
              id: 'note',
              name: 'Note',
              type: 'action',
              action: { kind: 'comment', body: 'Built: {{previous.summary}}' },
            },
          ],
          else: [],
          thenEnd: false,
          elseEnd: true,
        },
        {
          id: 'approve',
          name: 'Approve',
          type: 'approval',
          message: 'Ship {{step.implement.summary}}?',
          onReject: { action: 'end' },
        },
        {
          ...agentStep('notes', 'Write notes. Approver said: {{step.approve.note}}'),
          model: 'luna',
          maxTurns: 12,
        },
        {
          id: 'done',
          name: 'Done',
          type: 'action',
          action: { kind: 'set_status', status: 'Review' },
        },
      ]),
    });
    await enable(ctx, created.id, { coder: ctx.coder.id });
    const task = await issue(ctx, { title: 'Pricing page' });
    const run = await startRun(ctx, task.id, created.id);
    const at = (stepId: string, seq: number, iteration = 1) => ({
      runId: run.id,
      projectRef: 'project:MKT',
      stepId,
      iteration,
      seq,
    });
    const asRunner = apiKeyApi(ctx.coderKey);

    const begun = await control({ operation: 'begin', runId: run.id, projectRef: 'project:MKT' });
    expect(begun.data).toMatchObject({
      run: { id: run.id, taskRef: `task:MKT-${task.sequenceNumber}`, dryRun: false, version: 1 },
      definition: { schemaVersion: 1 },
    });

    // An agent step: Plan renders the prompt, the bridge queues the run with the key.
    const prepared = (await control({ operation: 'agent', ...at('implement', 1) })).data;
    expect(prepared).toMatchObject({
      attempt: 1,
      agentRef: 'agent:coder',
      timeoutSeconds: 1_800,
      policy: {},
    });
    expect(String(prepared.prompt)).toContain(
      `Implement MKT-${task.sequenceNumber} "Pricing page".`,
    );
    const queued = await controlApi().internal.orchestration['agent-run'].post({
      projectRef: 'project:MKT',
      task: { taskRef: prepared.taskRef },
      agent: { agentRef: prepared.agentRef },
      idempotencyKey: prepared.idempotencyKey,
      prompt: prepared.prompt,
      policy: prepared.policy,
    });
    const agentRunId = (queued.data as unknown as { runId: number }).runId;
    const claimed = (await asRunner['agent-runs'].claim.post()).data!.run!;
    expect(claimed.id).toBe(agentRunId);
    await asRunner['agent-runs']({ runId: agentRunId }).result.post({
      status: 'success',
      output: 'The page is built.',
      usage: { inputTokens: 700, outputTokens: 50 },
    });
    await control({
      operation: 'record',
      ...at('implement', 1),
      status: 'succeeded',
      outcome: 'success',
      summary: 'The page is built.',
    });

    expect((await control({ operation: 'condition', ...at('check', 2) })).data).toEqual({
      matched: true,
    });
    expect((await control({ operation: 'action', ...at('note', 3) })).data).toEqual({
      summary: 'Built: The page is built.',
    });
    // Asked again after a restart, the comment is not written twice.
    await control({ operation: 'action', ...at('note', 3) });
    const feed = (await ctx.asOwner.issues({ issueId: task.id }).feed.get({ query: {} })).data!;
    expect(JSON.stringify(feed).match(/Built: The page is built\./g)).toHaveLength(1);

    // An approval: the run waits in the approvals inbox until a person decides it.
    expect(
      (await control({ operation: 'approval', phase: 'wait', ...at('approve', 4) })).data,
    ).toEqual({
      message: 'Ship The page is built.?',
    });
    const waiting = (await ctx.asOwner['pipeline-approvals'].get()).data!;
    expect(waiting).toMatchObject([
      {
        runId: run.id,
        stepId: 'approve',
        stepName: 'Approve',
        message: 'Ship The page is built.?',
        pipelineName: 'Release',
      },
    ]);
    const decided = await ctx.asOwner['pipeline-runs']({ runId: run.id }).approval.post({
      approved: true,
      note: 'Mention the price.',
    });
    expect(decided.status).toBe(200);
    expect(controlPlane.requests.at(-1)).toMatchObject({
      operation: 'resume',
      workflowId: 'plan-pipeline',
      runId: run.id,
      approved: true,
      note: 'Mention the price.',
      decidedBy: ctx.owner.userId,
    });
    expect((await ctx.asOwner['pipeline-approvals'].get()).data).toEqual([]);
    await control({
      operation: 'approval',
      phase: 'decided',
      ...at('approve', 4),
      approved: true,
      note: 'Mention the price.',
      decidedBy: ctx.owner.userId,
    });

    const notes = (await control({ operation: 'agent', ...at('notes', 5) })).data;
    expect(String(notes.prompt)).toContain('Approver said: Mention the price.');
    // The step asks for 12 turns; the agent's own limit is 8.
    expect(notes.policy).toEqual({ maxTurns: 8, model: 'luna' });
    expect((await control({ operation: 'action', ...at('done', 6) })).data).toEqual({
      summary: 'Status set to Review',
    });
    await control({
      operation: 'finish',
      runId: run.id,
      projectRef: 'project:MKT',
      status: 'succeeded',
    });

    const [shown] = (await ctx.asOwner.issues({ issueId: task.id })['pipeline-runs'].get()).data!;
    expect(shown).toMatchObject({ status: 'succeeded', inputTokens: 700, outputTokens: 50 });
    expect(shown!.steps.map((step) => [step.stepId, step.status, step.outcome])).toEqual([
      ['implement', 'succeeded', 'success'],
      ['check', 'succeeded', 'true'],
      ['note', 'succeeded', 'success'],
      ['approve', 'succeeded', 'approved'],
      ['notes', 'running', null],
      ['done', 'succeeded', 'success'],
    ]);
    expect(shown!.steps[0]).toMatchObject({
      agent: { username: 'coder' },
      agentRun: { id: agentRunId, status: 'success', inputTokens: 700, outputTokens: 50 },
    });
    expect(shown!.steps[3]).toMatchObject({ decidedByName: 'Owner', note: 'Mention the price.' });
    const moved = (await ctx.asOwner.issues({ issueId: task.id }).get()).data!;
    expect(moved.columnId).toBe(ctx.columnId('Review'));
  });

  it('retries an agent step as a new attempt and cancels the queued run of the old one', async () => {
    const ctx = await setup();
    const created = await template(ctx);
    await enable(ctx, created.id, { coder: ctx.coder.id });
    const task = await issue(ctx);
    const run = await startRun(ctx, task.id, created.id);
    const at = {
      runId: run.id,
      projectRef: 'project:MKT',
      stepId: 'implement',
      iteration: 1,
      seq: 1,
    };
    const first = (await control({ operation: 'agent', ...at })).data;
    const queue = async (prepared: Json) =>
      (
        (
          await controlApi().internal.orchestration['agent-run'].post({
            projectRef: 'project:MKT',
            task: { taskRef: prepared.taskRef },
            agent: { agentRef: prepared.agentRef },
            idempotencyKey: prepared.idempotencyKey,
            prompt: prepared.prompt,
            policy: prepared.policy,
          })
        ).data as unknown as { runId: number }
      ).runId;
    const oldRun = await queue(first);
    // Asked again after a restart: the same attempt and the same agent run.
    expect((await control({ operation: 'agent', ...at })).data).toMatchObject({
      attempt: 1,
      idempotencyKey: first.idempotencyKey,
    });
    await control({ operation: 'record', ...at, status: 'failed', error: 'The bridge stopped' });
    await control({
      operation: 'finish',
      runId: run.id,
      projectRef: 'project:MKT',
      status: 'failed',
      error: 'The bridge stopped',
    });
    expect((await ctx.asOwner['pipeline-runs']({ runId: run.id }).get()).data).toMatchObject({
      status: 'failed',
      error: 'The bridge stopped',
    });

    const retried = await ctx.asOwner['pipeline-runs']({ runId: run.id }).retry.post();
    expect(retried.data!.status).toBe('running');
    expect(controlPlane.requests.at(-1)).toMatchObject({ operation: 'retry', runId: run.id });
    const second = (await control({ operation: 'agent', ...at })).data;
    expect(second.attempt).toBe(2);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    const agentRuns = (
      await ctx.asOwner
        .teams({ teamId: ctx.teamId })
        ['ai-agents']({ agentId: ctx.coder.id })
        .runs.get()
    ).data!.items;
    expect(agentRuns.find((item) => item.id === oldRun)!.status).toBe('canceled');
    expect((await ctx.asOwner['pipeline-runs']({ runId: run.id }).retry.post()).status).toBe(409);
  });

  it('cancels a run through Mastra and marks its waiting step', async () => {
    const ctx = await setup();
    const created = await template(ctx, {
      definition: definition([
        {
          id: 'approve',
          name: 'Approve',
          type: 'approval',
          message: '',
          onReject: { action: 'end' },
        },
      ]),
    });
    await enable(ctx, created.id);
    const task = await issue(ctx);
    const run = await startRun(ctx, task.id, created.id);
    await control({
      operation: 'approval',
      phase: 'wait',
      runId: run.id,
      projectRef: 'project:MKT',
      stepId: 'approve',
      iteration: 1,
      seq: 1,
    });
    const canceled = await ctx.asOwner['pipeline-runs']({ runId: run.id }).cancel.post();
    expect(canceled.data).toMatchObject({
      status: 'canceled',
      steps: [{ stepId: 'approve', status: 'canceled' }],
    });
    expect(controlPlane.requests.at(-1)).toMatchObject({
      operation: 'cancel',
      workflowId: 'plan-pipeline',
      runId: run.id,
    });
    expect((await ctx.asOwner['pipeline-runs']({ runId: run.id }).cancel.post()).status).toBe(409);
    const late = await control({
      operation: 'approval',
      phase: 'wait',
      runId: run.id,
      projectRef: 'project:MKT',
      stepId: 'approve',
      iteration: 2,
      seq: 2,
    });
    expect(late.status).toBe(409);
    expect(
      (await ctx.asOwner['pipeline-runs']({ runId: run.id }).approval.post({ approved: true }))
        .status,
    ).toBe(409);
    // A later report of Mastra does not reopen the run.
    await control({
      operation: 'finish',
      runId: run.id,
      projectRef: 'project:MKT',
      status: 'failed',
    });
    expect((await ctx.asOwner['pipeline-runs']({ runId: run.id }).get()).data!.status).toBe(
      'canceled',
    );
  });

  it('creates the task and the run of a schedule fire once', async () => {
    const ctx = await setup();
    const trigger = {
      type: 'schedule',
      cron: '0 9 * * 1',
      timezone: 'Europe/Berlin',
      title: 'Weekly release',
    };
    const created = await template(ctx, { definition: { ...simple(), trigger } });
    await enable(ctx, created.id, { coder: ctx.coder.id });
    const fire = {
      operation: 'begin',
      runId: 'sched_s1_1790000000000',
      projectRef: 'project:MKT',
      pipelineId: created.id,
    };
    const first = await control(fire);
    expect(first.status).toBe(200);
    const second = await control(fire);
    expect(second.data).toEqual(first.data);
    const tasks = (await ctx.asOwner.projects({ projectKey: 'MKT' }).issues.get({ query: {} }))
      .data as unknown as { title: string }[];
    expect(tasks.filter((item) => item.title === 'Weekly release')).toHaveLength(1);
    const [run] = (await ctx.asOwner.pipelines({ pipelineId: created.id }).runs.get({ query: {} }))
      .data!.items;
    expect(run).toMatchObject({
      id: 'sched_s1_1790000000000',
      trigger: 'schedule',
      status: 'running',
    });

    const manual = await template(ctx, { name: 'Manual' });
    await enable(ctx, manual.id, { coder: ctx.coder.id });
    expect((await control({ ...fire, runId: 'sched_s2_1', pipelineId: manual.id })).status).toBe(
      409,
    );
  });

  it('holds a wait until its time and simulates everything in a test run', async () => {
    const ctx = await setup();
    const created = await template(ctx, {
      definition: definition([
        {
          id: 'due',
          name: 'Until due',
          type: 'wait',
          wait: { kind: 'until', field: 'dueDate', time: '09:00' },
        },
        { id: 'pause', name: 'Pause', type: 'wait', wait: { kind: 'delay', minutes: 60 } },
        agentStep('implement', 'Implement {{task.title}}.'),
        {
          id: 'close',
          name: 'Close',
          type: 'action',
          action: { kind: 'set_status', status: 'Done' },
        },
        {
          id: 'approve',
          name: 'Approve',
          type: 'approval',
          message: '',
          onReject: { action: 'end' },
        },
      ]),
    });
    await enable(ctx, created.id, { coder: ctx.coder.id });
    const task = await issue(ctx, { dueDate: '2099-01-05' });
    const run = await startRun(ctx, task.id, created.id);
    const at = (stepId: string, seq: number) => ({
      runId: run.id,
      projectRef: 'project:MKT',
      stepId,
      iteration: 1,
      seq,
    });
    // Treaty revives the ISO string of the answer as a Date.
    expect((await control({ operation: 'wait', ...at('due', 1) })).data).toEqual({
      wakeAt: new Date('2099-01-05T08:00:00.000Z'),
    });
    expect((await ctx.asOwner['pipeline-runs']({ runId: run.id }).get()).data!.status).toBe(
      'waiting',
    );
    const pause = (await control({ operation: 'wait', ...at('pause', 2) })).data;
    expect((await control({ operation: 'wait', ...at('pause', 2) })).data).toEqual(pause);

    const test = await startRun(ctx, task.id, created.id, true);
    const dry = (stepId: string, seq: number) => ({
      runId: test.id,
      projectRef: 'project:MKT',
      stepId,
      iteration: 1,
      seq,
    });
    expect((await control({ operation: 'wait', ...dry('due', 1) })).data).toEqual({ wakeAt: null });
    expect((await control({ operation: 'agent', ...dry('implement', 2) })).data).toMatchObject({
      dryRun: true,
    });
    expect((await control({ operation: 'action', ...dry('close', 3) })).data).toEqual({
      summary: 'Set the status to Done',
    });
    await control({ operation: 'approval', phase: 'wait', ...dry('approve', 4) });
    const shown = (await ctx.asOwner['pipeline-runs']({ runId: test.id }).get()).data!;
    expect(shown.steps.map((step) => step.status)).toEqual([
      'simulated',
      'simulated',
      'simulated',
      'simulated',
    ]);
    expect(shown.steps[1]!.summary).toBe(`Implement Launch page.`);
    expect((await ctx.asOwner.issues({ issueId: task.id }).get()).data!.columnId).toBe(
      ctx.columnId('Todo'),
    );
    expect(controlPlane.requests.filter((request) => request.operation === 'resume')).toEqual([]);
  });

  it('answers only the bridge and names what it cannot do', async () => {
    const ctx = await setup();
    const created = await template(ctx);
    await enable(ctx, created.id, { coder: ctx.coder.id });
    const task = await issue(ctx);
    const run = await startRun(ctx, task.id, created.id);
    const denied = await ctx.asOwner.internal.orchestration.pipeline.post({
      schemaVersion: 1,
      operation: 'begin',
    });
    expect(denied.status).toBe(401);
    expect(
      (await control({ operation: 'drop', runId: run.id, projectRef: 'project:MKT' })).status,
    ).toBe(400);
    expect(
      (await control({ operation: 'begin', runId: 'missing', projectRef: 'project:MKT' })).status,
    ).toBe(404);
    expect(
      (await control({ operation: 'begin', runId: run.id, projectRef: 'project:OTHER' })).status,
    ).toBe(404);
    const wrongKind = await control({
      operation: 'condition',
      runId: run.id,
      projectRef: 'project:MKT',
      stepId: 'implement',
      iteration: 1,
      seq: 1,
    });
    expect(wrongKind.status).toBe(409);

    await enable(ctx, created.id, {}, false);
    const unmapped = await control({
      operation: 'agent',
      runId: run.id,
      projectRef: 'project:MKT',
      stepId: 'implement',
      iteration: 1,
      seq: 1,
    });
    expect(unmapped.status).toBe(409);
    const outsider = authedApi((await signUpTestUser({ name: 'Outsider' })).cookie);
    expect((await outsider['pipeline-runs']({ runId: run.id }).get()).status).toBe(403);
    expect((await outsider['pipeline-runs']({ runId: run.id }).cancel.post()).status).toBe(403);
  });
});

describe('workflow run limit', () => {
  beforeEach(async () => {
    await resetDb();
    controlPlane.reset();
  });

  // Starts the newest run Mastra was just asked to start, then reports it finished —
  // the run this task event just created, freed up so the next task event can start
  // its own (the partial unique index only blocks a second *active* run of the same
  // workflow on the same task).
  async function finishNewestRun(ctx: Setup, issueId: number) {
    await drainPendingStarts();
    const runs = (await ctx.asOwner.issues({ issueId })['pipeline-runs'].get()).data!;
    const newest = runs[0]!;
    await control({
      operation: 'finish',
      runId: newest.id,
      projectRef: 'project:MKT',
      status: 'succeeded',
    });
  }

  it('reads the default and lets an editor change it, within bounds', async () => {
    const ctx = await setup();
    const limitApi = () => ctx.asOwner.projects({ projectKey: 'MKT' })['pipeline-run-limit'];

    expect((await limitApi().get()).data).toEqual({ maxRuns: 10, windowMinutes: 60 });

    expect((await limitApi().patch({ maxRuns: 3 })).data).toEqual({
      maxRuns: 3,
      windowMinutes: 60,
    });
    expect((await limitApi().get()).data).toEqual({ maxRuns: 3, windowMinutes: 60 });

    // Outside the allowed range (1-1000) is refused, not clamped.
    expect((await limitApi().patch({ maxRuns: 5000 })).status).toBe(400);
    expect((await limitApi().patch({ maxRuns: 0 })).status).toBe(400);
    expect((await limitApi().get()).data).toEqual({ maxRuns: 3, windowMinutes: 60 });

    const asMember = await addProjectMember(ctx.asOwner, 'MKT');
    expect(
      (await asMember.projects({ projectKey: 'MKT' })['pipeline-run-limit'].patch({ maxRuns: 5 }))
        .status,
    ).toBe(403);
  });

  it('stops starting runs once the limit is reached and leaves one trace of it', async () => {
    const ctx = await setup();
    await ctx.asOwner.projects({ projectKey: 'MKT' })['pipeline-run-limit'].patch({ maxRuns: 2 });
    const created = await template(ctx, {
      definition: { ...simple(), trigger: { type: 'status_changed' } },
    });
    expect((await enable(ctx, created.id, { coder: ctx.coder.id })).status).toBe(200);
    const task = await issue(ctx);

    // Two runs, each a real status change finished before the next is asked for.
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('In Progress') });
    await finishNewestRun(ctx, task.id);
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('Todo') });
    await finishNewestRun(ctx, task.id);

    // A third is the limit's business: nothing is asked of Mastra for it.
    const beforeThird = controlPlane.started().length;
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('In Progress') });
    await drainPendingStarts();
    expect(controlPlane.started().length).toBe(beforeThird);

    const runs = (await ctx.asOwner.issues({ issueId: task.id })['pipeline-runs'].get()).data!;
    expect(runs).toHaveLength(3);
    const rejected = runs.filter((run) => run.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.trigger).toBe('status_changed');
    expect(rejected[0]!.error).toContain('2 runs per 60 min reached');

    const feed = (await ctx.asOwner.issues({ issueId: task.id }).feed.get({ query: {} })).data!;
    const notice = feed.items.find((entry) => entry.action === 'workflow_run_limited');
    expect(notice).toBeDefined();
    expect(notice!.actorName).toBe('Workflow');
    expect(notice!.payload.subject?.value).toBe('Release');

    // A second blocked attempt in the same window leaves the trace alone — one
    // notice per workflow per window, not one per retry of the loop this guards
    // against, so neither the run history nor the activity gets a second entry.
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('Todo') });
    await drainPendingStarts();
    expect(controlPlane.started().length).toBe(beforeThird);
    expect(
      (await ctx.asOwner.issues({ issueId: task.id })['pipeline-runs'].get()).data,
    ).toHaveLength(3);
    const feedAfter = (await ctx.asOwner.issues({ issueId: task.id }).feed.get({ query: {} }))
      .data!;
    expect(feedAfter.items.filter((entry) => entry.action === 'workflow_run_limited')).toHaveLength(
      1,
    );
  });

  it('counts every workflow of the task toward the one limit, not each apart', async () => {
    const ctx = await setup();
    await ctx.asOwner.projects({ projectKey: 'MKT' })['pipeline-run-limit'].patch({ maxRuns: 1 });
    const first = await template(ctx, {
      name: 'First',
      definition: { ...simple(), trigger: { type: 'status_changed' } },
    });
    const second = await template(ctx, {
      name: 'Second',
      definition: { ...simple(), trigger: { type: 'label_added', label: 'Urgent' } },
    });
    const urgent = (
      await ctx.asOwner.projects({ projectKey: 'MKT' }).labels.post({ name: 'urgent' })
    ).data!;
    expect((await enable(ctx, first.id, { coder: ctx.coder.id })).status).toBe(200);
    expect((await enable(ctx, second.id, { coder: ctx.coder.id })).status).toBe(200);
    const task = await issue(ctx);

    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('In Progress') });
    await drainPendingStarts();
    expect(controlPlane.started()).toHaveLength(1);

    // The task used up its one slot for the hour on the first workflow: the
    // second workflow's own, distinct trigger is refused too.
    await ctx.asOwner.issues({ issueId: task.id }).patch({ labelIds: [urgent.id] });
    await drainPendingStarts();
    expect(controlPlane.started()).toHaveLength(1);
    const runs = (await ctx.asOwner.issues({ issueId: task.id })['pipeline-runs'].get()).data!;
    expect(runs.map((run) => run.trigger).sort()).toEqual(['label_added', 'status_changed']);
    expect(runs.find((run) => run.trigger === 'label_added')!.status).toBe('rejected');
  });
});
