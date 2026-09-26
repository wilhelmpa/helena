import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
  spyOn,
} from 'bun:test';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { db, helenaSchedule, issue as issueTable } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import {
  resetEngineDb,
  startEngine,
  stopEngineRuns,
  stopTestEngine,
  testEngineExecutions,
  waitForStatus,
} from '#tests/helpers/engine';
import { addProjectMember } from '#tests/helpers/members';
import {
  agentStep,
  definition,
  enable,
  issue,
  setupProject,
  simple,
  startRun,
  template,
  type Json,
  type ProjectSetup,
} from '#tests/helpers/workflows';
import { planFire } from '#modules/engine/schedules';

// A run takes a few hops through the engine's queues (see helpers/engine.ts).
setDefaultTimeout(30_000);

// The workflow builder through the API: the library and a project's workflows, their
// schedules, and the runs the Helena engine starts by hand, on a task event or on a
// schedule. The engine's execution of the steps is tested in modules/engine.

beforeAll(async () => {
  await startEngine();
});

afterAll(async () => {
  await stopTestEngine();
});

afterEach(async () => {
  await stopEngineRuns();
});

// A workflow of one comment action: it finishes on its own.
const quick = (extra: Json = {}) =>
  definition(
    [{ id: 'note', name: 'Note', type: 'action', action: { kind: 'comment', body: 'Hi' } }],
    extra,
  );

async function runsOn(ctx: ProjectSetup, issueId: number) {
  return (await ctx.asOwner.issues({ issueId })['pipeline-runs'].get()).data!;
}

async function settled(ctx: ProjectSetup, issueId: number) {
  for (const run of await runsOn(ctx, issueId))
    if (['pending', 'running', 'waiting'].includes(run.status))
      await waitForStatus(run.id, 'succeeded', 'failed', 'rejected', 'canceled');
}

async function waitForRuns(ctx: ProjectSetup, issueId: number, count: number) {
  const deadline = Date.now() + 10_000;
  while ((await runsOn(ctx, issueId)).length < count) {
    if (Date.now() > deadline) throw new Error(`Fewer than ${count} runs on ${issueId}`);
    await Bun.sleep(100);
  }
  await settled(ctx, issueId);
  return runsOn(ctx, issueId);
}

describe('workflow library', () => {
  beforeEach(resetEngineDb);

  it('creates, versions and deletes a template', async () => {
    const ctx = await setupProject();
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
    const ctx = await setupProject();
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
    const ctx = await setupProject();
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
    const ctx = await setupProject();
    const builtins = (await ctx.asOwner.teams({ teamId: ctx.teamId })['pipeline-builtins'].get())
      .data!;
    expect(builtins.map((b) => b.key)).toEqual(['agent-team', 'release-notes']);
    for (const builtin of builtins)
      await template(ctx, { name: builtin.name, definition: builtin.definition });
  });
});

describe('workflows of a project', () => {
  beforeEach(resetEngineDb);

  it('enables a template once an agent fills each of its roles', async () => {
    const ctx = await setupProject();
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
    expect(await db.select().from(helenaSchedule)).toEqual([]);
  });

  it('keeps a project workflow to its project and lets it name the project agent', async () => {
    const ctx = await setupProject();
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

  it('keeps a schedule while a workflow with a schedule trigger is enabled', async () => {
    const ctx = await setupProject();
    const trigger = {
      type: 'schedule',
      cron: '0 9 * * 1',
      timezone: 'Europe/Berlin',
      title: 'Weekly release',
    };
    const created = await template(ctx, { definition: { ...simple(), trigger } });
    expect((await enable(ctx, created.id, { coder: ctx.coder.id })).status).toBe(200);
    const [schedule] = await db
      .select()
      .from(helenaSchedule)
      .where(eq(helenaSchedule.pipelineId, created.id));
    expect(schedule).toMatchObject({
      kind: 'workflow',
      projectId: ctx.projectId,
      cron: '0 9 * * 1',
      timezone: 'Europe/Berlin',
      title: 'Weekly release',
      enabled: true,
    });
    // Another time starts the schedule afresh: the times before the change do not fire.
    await db
      .update(helenaSchedule)
      .set({ firedThrough: new Date('2026-01-01T00:00:00Z') })
      .where(eq(helenaSchedule.id, schedule!.id));
    await ctx.asOwner
      .pipelines({ pipelineId: created.id })
      .patch({ definition: { ...simple(), trigger: { ...trigger, cron: '0 10 * * 1' } } });
    const [moved] = await db.select().from(helenaSchedule);
    expect(moved).toMatchObject({ id: schedule!.id, cron: '0 10 * * 1' });
    expect(moved!.firedThrough.getTime()).toBeGreaterThan(Date.now() - 60_000);

    expect((await enable(ctx, created.id, { coder: ctx.coder.id }, false)).status).toBe(200);
    expect(await db.select().from(helenaSchedule)).toEqual([]);
  });

  it('creates the task and the run of a schedule fire once', async () => {
    const ctx = await setupProject();
    const trigger = {
      type: 'schedule',
      cron: '0 9 * * 1',
      timezone: 'Europe/Berlin',
      title: 'Weekly release',
    };
    const created = await template(ctx, { definition: { ...quick(), trigger } });
    await enable(ctx, created.id);
    const [schedule] = await db.select().from(helenaSchedule);
    const at = new Date('2026-09-21T07:00:00.000Z');
    const runId = await planFire(schedule!.id, at.toISOString(), at.getTime());
    expect(runId).not.toBeNull();
    // The same time fired again finds the same run.
    expect(await planFire(schedule!.id, at.toISOString(), at.getTime())).toBe(runId);
    const { startRun: startEngineRun } = await import('#modules/engine/runs');
    await startEngineRun(runId!);
    const done = await waitForStatus(runId!, 'succeeded');
    const [task] = await db.select().from(issueTable).where(eq(issueTable.id, done.issueId!));
    expect(task).toMatchObject({
      title: 'Weekly release',
      description: 'Created by the scheduled workflow "Release".',
    });
    const [run] = (await ctx.asOwner.pipelines({ pipelineId: created.id }).runs.get({ query: {} }))
      .data!.items;
    expect(run).toMatchObject({
      id: runId,
      trigger: 'schedule',
      status: 'succeeded',
      scheduleId: schedule!.id,
    });
  });
});

describe('workflow runs', () => {
  beforeEach(resetEngineDb);

  it('starts a workflow on a task by hand, one active run at a time', async () => {
    const ctx = await setupProject();
    const created = await template(ctx);
    const task = await issue(ctx);
    const disabled = await ctx.asOwner
      .issues({ issueId: task.id })
      ['pipeline-runs'].post({ pipelineId: created.id });
    expect(disabled.status).toBe(409);
    const test = await startRun(ctx, task.id, created.id, true);
    expect(test).toMatchObject({ dryRun: true, trigger: 'manual', kind: 'workflow' });
    await waitForStatus(test.id, 'succeeded');

    await enable(ctx, created.id, { coder: ctx.coder.id });
    expect((await ctx.asOwner.issues({ issueId: task.id }).pipelines.get()).data).toEqual([
      { id: created.id, name: 'Release', description: '' },
    ]);
    const run = await startRun(ctx, task.id, created.id);
    expect(run).toMatchObject({ version: 1, issueIdentifier: `MKT-${task.sequenceNumber}` });
    const again = await ctx.asOwner
      .issues({ issueId: task.id })
      ['pipeline-runs'].post({ pipelineId: created.id });
    expect(again.status).toBe(409);
  });

  it('starts the workflows a task event triggers, not those a workflow change would', async () => {
    const ctx = await setupProject();
    const responsible = await signUpTestUser();
    const invite = await ctx.asOwner
      .projects({ projectKey: 'MKT' })
      .invites.post({ email: responsible.email, role: 'member' });
    expect(
      (await authedApi(responsible.cookie).invites({ token: invite.data!.token }).accept.post())
        .status,
    ).toBe(200);
    const triggered = async (trigger: Json) => {
      const created = await template(ctx, {
        name: String(trigger.type),
        definition: quick({ trigger }),
      });
      expect((await enable(ctx, created.id)).status).toBe(200);
      return created.id;
    };
    const urgent = (
      await ctx.asOwner.projects({ projectKey: 'MKT' }).labels.post({ name: 'urgent' })
    ).data!;
    await triggered({ type: 'task_created' });
    await triggered({ type: 'status_changed', to: 'review' });
    await triggered({ type: 'label_added', label: 'Urgent' });
    await triggered({ type: 'task_assigned' });

    const task = await issue(ctx);
    expect((await waitForRuns(ctx, task.id, 1)).map((run) => run.trigger)).toEqual([
      'task_created',
    ]);
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('In Progress') });
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('Review') });
    await ctx.asOwner.issues({ issueId: task.id }).patch({ labelIds: [urgent.id] });
    expect(task.assigneeUserId).toBe(ctx.owner.userId);
    // The default owner is already responsible: saving it again starts no workflow.
    await ctx.asOwner.issues({ issueId: task.id }).patch({ assigneeUserId: ctx.owner.userId });
    expect(
      (await ctx.asOwner.issues({ issueId: task.id }).patch({ assigneeUserId: responsible.userId }))
        .status,
    ).toBe(200);
    const runs = await waitForRuns(ctx, task.id, 4);
    expect(runs.map((run) => run.trigger).sort()).toEqual([
      'label_added',
      'status_changed',
      'task_assigned',
      'task_created',
    ]);
    await ctx.asOwner.issues({ issueId: task.id }).patch({ assigneeUserId: responsible.userId });

    // A move to Review made by a workflow starts nothing.
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
    await waitForStatus(moverRun.id, 'succeeded');
    await Bun.sleep(1_500);
    const after = await runsOn(ctx, task.id);
    expect(after.filter((run) => run.trigger === 'status_changed')).toHaveLength(1);
    expect(after.filter((run) => run.trigger === 'task_assigned')).toHaveLength(1);
  });

  it('holds a wait until its time and simulates everything in a test run', async () => {
    const ctx = await setupProject();
    const created = await template(ctx, {
      definition: definition([
        {
          id: 'due',
          name: 'Until due',
          type: 'wait',
          wait: { kind: 'until', field: 'dueDate', time: '09:00' },
        },
        agentStep('implement', 'Implement it.'),
      ]),
    });
    await enable(ctx, created.id, { coder: ctx.coder.id });
    const task = await issue(ctx, { dueDate: '2099-01-01' });
    const enteredSleep = Promise.withResolvers<void>();
    const releaseSleep = Promise.withResolvers<void>();
    const originalSleep = DBOS.sleep.bind(DBOS);
    // DBOS 5.0.2 checks cancellation only after its sleep expires. Keep the
    // planned 2099 deadline, but let this fixture expire its timer explicitly.
    // The original SDK sleep still observes the real cancellation when released.
    const sleep = spyOn(DBOS, 'sleep').mockImplementation(async (durationMs) => {
      expect(durationMs).toBeGreaterThan(24 * 60 * 60 * 1000);
      enteredSleep.resolve();
      await releaseSleep.promise;
      await originalSleep(1);
    });
    let execution: Promise<unknown> | undefined;
    try {
      const run = await startRun(ctx, task.id, created.id);
      const waiting = await waitForStatus(run.id, 'waiting');
      expect(waiting.status).toBe('waiting');
      await enteredSleep.promise;
      execution = testEngineExecutions().get(run.id)!.promise;
      const shown = (await ctx.asOwner['pipeline-runs']({ runId: run.id }).get()).data!;
      expect(shown.steps[0]).toMatchObject({ stepId: 'due', status: 'waiting' });
      expect(new Date(shown.steps[0]!.wakeAt!).toISOString()).toBe('2099-01-01T08:00:00.000Z');
      expect((await ctx.asOwner['pipeline-runs']({ runId: run.id }).cancel.post()).status).toBe(
        200,
      );
      releaseSleep.resolve();
      await execution;
      expect((await ctx.asOwner['pipeline-runs']({ runId: run.id }).get()).data!.status).toBe(
        'canceled',
      );
    } finally {
      releaseSleep.resolve();
      await execution;
      sleep.mockRestore();
    }

    const test = await startRun(ctx, task.id, created.id, true);
    await waitForStatus(test.id, 'succeeded');
    const simulated = (await ctx.asOwner['pipeline-runs']({ runId: test.id }).get()).data!;
    expect(simulated.steps.map((step) => step.status)).toEqual(['simulated', 'simulated']);
  });
});

describe('workflow run limit', () => {
  beforeEach(resetEngineDb);

  it('reads the default and lets an editor change it, within bounds', async () => {
    const ctx = await setupProject();
    const limitApi = () => ctx.asOwner.projects({ projectKey: 'MKT' })['pipeline-run-limit'];
    expect((await limitApi().get()).data).toEqual({ maxRuns: 10, windowMinutes: 60 });
    expect((await limitApi().patch({ maxRuns: 3 })).data).toEqual({
      maxRuns: 3,
      windowMinutes: 60,
    });
    expect((await limitApi().patch({ maxRuns: 5000 })).status).toBe(400);
    expect((await limitApi().patch({ maxRuns: 0 })).status).toBe(400);
    const asMember = await addProjectMember(ctx.asOwner, 'MKT');
    expect(
      (await asMember.projects({ projectKey: 'MKT' })['pipeline-run-limit'].patch({ maxRuns: 5 }))
        .status,
    ).toBe(403);
  });

  it('stops starting runs once the limit is reached and leaves one trace of it', async () => {
    const ctx = await setupProject();
    await ctx.asOwner.projects({ projectKey: 'MKT' })['pipeline-run-limit'].patch({ maxRuns: 2 });
    const created = await template(ctx, {
      definition: quick({ trigger: { type: 'status_changed' } }),
    });
    expect((await enable(ctx, created.id)).status).toBe(200);
    const task = await issue(ctx);
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('In Progress') });
    await waitForRuns(ctx, task.id, 1);
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('Todo') });
    await waitForRuns(ctx, task.id, 2);
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('In Progress') });
    const runs = await waitForRuns(ctx, task.id, 3);
    const rejected = runs.filter((run) => run.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.error).toContain('2 runs per 60 min reached');
    const feed = (await ctx.asOwner.issues({ issueId: task.id }).feed.get({ query: {} })).data!;
    const notice = feed.items.find((entry) => entry.action === 'workflow_run_limited');
    expect(notice).toBeDefined();
    expect(notice!.actorName).toBe('Workflow');
    await ctx.asOwner.issues({ issueId: task.id }).patch({ columnId: ctx.columnId('Todo') });
    await Bun.sleep(1_500);
    expect(await runsOn(ctx, task.id)).toHaveLength(3);
  });
});
