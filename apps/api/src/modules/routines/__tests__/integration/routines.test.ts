import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  agentRun,
  db,
  helenaSchedule,
  issue as issueTable,
  issueActivity,
  pipelineRun,
} from '@repo/db';
import { and, asc, eq } from 'drizzle-orm';
import { api, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { startEngine, stopEngineRuns, waitForStatus } from '#tests/helpers/engine';
import { clearLimits, setLimits } from '#tests/helpers/limits';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import { planFire } from '#modules/engine/schedules';

// Routines on the Helena engine: Helena keeps them (helena_schedule) and the engine fires
// them (a DBOS schedule of the same id). Every fire creates a task delegated to the agent
// or reopens the routine's task, and is skipped while the routine's task is open. Ported
// from the agent-routine workflow tests of the Mastra control plane and the routine
// dispatch tests of its bridge.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const created = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
  const agent = (
    await createAgent(asOwner, 'MKT', {
      name: 'Writer',
      username: 'writer',
      triggerOnAssign: true,
    } as never)
  ).data!.agent;
  const columns = view.columns;
  return {
    owner,
    asOwner,
    agent,
    teamId: created.data!.teamId,
    columnId: columns[0]!.id,
    column: (name: string) => columns.find((column) => column.name === name)!.id,
  };
}

const routines = (client: Api, projectKey = 'MKT') => client.projects({ projectKey }).routines;

function routineBody(agentId: number, body: Record<string, unknown> = {}) {
  return {
    idempotencyKey: crypto.randomUUID(),
    agentId,
    title: 'Weekly report',
    instructions: 'Summarize the week.',
    mode: 'new' as const,
    cron: '0 9 * * 1',
    ...body,
  };
}

async function scheduleRow(id: string) {
  const [row] = await db.select().from(helenaSchedule).where(eq(helenaSchedule.id, id));
  return row!;
}

async function runsOf(scheduleId: string) {
  return db
    .select()
    .from(pipelineRun)
    .where(eq(pipelineRun.scheduleId, scheduleId))
    .orderBy(asc(pipelineRun.scheduledFor));
}

// Fires the routine at a time, the way the engine's schedule does, and waits for the run.
async function fire(scheduleId: string, at: Date, now = at.getTime()) {
  const runId = await planFire(scheduleId, at.toISOString(), now);
  if (runId) {
    const { startRun } = await import('#modules/engine/runs');
    await startRun(runId);
    return waitForStatus(runId, 'succeeded', 'skipped', 'failed');
  }
  return null;
}

beforeAll(async () => {
  await startEngine();
});

beforeEach(async () => {
  await resetDb();
});

afterEach(async () => {
  clearLimits();
  await stopEngineRuns();
});

afterAll(async () => {
  for (const schedule of await DBOS.listSchedules())
    await DBOS.deleteSchedule(schedule.scheduleName);
});

describe('routines', () => {
  it('creates a routine in Europe/Berlin with an engine schedule and replays its key', async () => {
    const { owner, asOwner, agent } = await setup();
    const body = routineBody(agent.id);
    const res = await routines(asOwner).post(body);
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      projectKey: 'MKT',
      projectName: 'Marketing',
      agent: { id: agent.id, name: 'Writer' },
      title: 'Weekly report',
      instructions: 'Summarize the week.',
      mode: 'new',
      task: null,
      cron: '0 9 * * 1',
      timezone: 'Europe/Berlin',
      catchUp: 'skip',
      enabled: true,
      lastRun: null,
    });
    // The next Monday at 09:00 in Berlin.
    const next = new Date(res.data!.nextRunAt!);
    expect(next.getUTCDay()).toBe(1);
    expect(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Berlin',
        hour: '2-digit',
        minute: '2-digit',
      }).format(next),
    ).toBe('09:00');
    expect(await scheduleRow(res.data!.id)).toMatchObject({
      kind: 'routine',
      agentId: agent.id,
      actorUserId: owner.userId,
      enabled: true,
    });
    expect(await DBOS.getSchedule(res.data!.id)).toMatchObject({
      schedule: '0 9 * * 1',
      cronTimezone: 'Europe/Berlin',
      status: 'ACTIVE',
      automaticBackfill: true,
    });
    const again = await routines(asOwner).post(body);
    expect(again.data?.id).toBe(res.data!.id);
    expect(await db.select().from(helenaSchedule)).toHaveLength(1);
  });

  it('reopens a task of the project and names it', async () => {
    const { asOwner, agent, columnId } = await setup();
    const task = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Backups' })
    ).data!;
    const res = await routines(asOwner).post(
      routineBody(agent.id, { mode: 'reopen', taskId: task.id, timezone: 'UTC', catchUp: 'once' }),
    );
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      mode: 'reopen',
      task: { id: task.id, number: task.sequenceNumber, title: 'Backups' },
      timezone: 'UTC',
      catchUp: 'once',
    });
  });

  it('validates the agent, the task, the cron, the time zone and the cadence', async () => {
    const { asOwner, agent } = await setup();
    const idle = (await createAgent(asOwner, 'MKT', { name: 'Idle', username: 'idle' } as never))
      .data!.agent;
    await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const foreign = (
      await asOwner.projects({ projectKey: 'OPS' }).issues.post({
        columnId: (await asOwner.projects({ projectKey: 'OPS' }).get()).data!.columns[0]!.id,
        title: 'Elsewhere',
      })
    ).data!;
    for (const body of [
      { agentId: agent.id + 1000 },
      { agentId: idle.id },
      { mode: 'reopen' },
      { mode: 'reopen', taskId: foreign.id },
      { cron: 'every day' },
      { cron: '0 9 L * *' },
      { timezone: 'Mars/Olympus' },
      { title: '   ' },
      { title: 'x'.repeat(301) },
      { catchUp: 'always' },
    ]) {
      expect((await routines(asOwner).post(routineBody(agent.id, body))).status).toBe(400);
    }
    setLimits({ minScheduleIntervalSeconds: 3600 });
    expect(
      (await routines(asOwner).post(routineBody(agent.id, { cron: '*/5 * * * *' }))).status,
    ).toBe(400);
    expect(
      (await routines(asOwner).post(routineBody(agent.id, { cron: '0 * * * *' }))).status,
    ).toBe(201);
    expect(await db.select().from(helenaSchedule)).toHaveLength(1);
  });

  it('refuses a routine for an agent that takes tasks from its owner only', async () => {
    const { asOwner, agent, teamId } = await setup();
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({ runnerScope: 'owner' });
    const role = await createRole(asOwner, 'MKT', {
      name: 'Agent admin',
      permissions: { ai_agents: { read: true, create: true, edit: true, delete: true } },
    });
    const asMember = await addProjectMember(asOwner, 'MKT', role.data!.id);
    expect((await routines(asMember).post(routineBody(agent.id))).status).toBe(403);
    const mine = await routines(asOwner).post(routineBody(agent.id));
    expect(mine.status).toBe(201);
    expect((await routines(asMember)({ routineId: mine.data!.id }).run.post()).status).toBe(403);
  });

  it('changes a routine for the member who saves it and switches it off and on', async () => {
    const { asOwner, agent } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id))).data!;
    const routine = routines(asOwner)({ routineId: created.id });
    const changed = await routine.patch({ title: 'Monthly report', cron: '0 9 1 * *' });
    expect(changed.data).toMatchObject({ title: 'Monthly report', cron: '0 9 1 * *' });
    expect((await DBOS.getSchedule(created.id))?.schedule).toBe('0 9 1 * *');
    const off = await routine.patch({ enabled: false });
    expect(off.data).toMatchObject({ enabled: false, nextRunAt: null });
    expect(await DBOS.getSchedule(created.id)).toBeNull();
    const on = await routine.patch({ enabled: true, catchUp: 'once' });
    expect(on.data).toMatchObject({ enabled: true, catchUp: 'once' });
    expect((await DBOS.getSchedule(created.id))?.status).toBe('ACTIVE');
  });

  it('lists the routines of a project and of every project the member reads', async () => {
    const { asOwner, agent } = await setup();
    const first = (await routines(asOwner).post(routineBody(agent.id))).data!;
    await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const ops = (
      await createAgent(asOwner, 'OPS', {
        name: 'Operator',
        username: 'operator',
        triggerOnAssign: true,
      } as never)
    ).data!.agent;
    const second = (await routines(asOwner, 'OPS').post(routineBody(ops.id))).data!;
    expect((await routines(asOwner).get({ query: {} })).data).toMatchObject({
      total: 1,
      items: [{ id: first.id }],
    });
    const home = (await asOwner.routines.get({ query: {} })).data!;
    expect(home.items.map((item) => [item.projectKey, item.id])).toEqual([
      ['OPS', second.id],
      ['MKT', first.id],
    ]);
    const stranger = authedApi((await signUpTestUser()).cookie);
    expect((await stranger.routines.get({ query: {} })).data).toMatchObject({ total: 0 });
    expect((await routines(stranger).get({ query: {} })).status).toBe(403);
    expect((await api.routines.get({ query: {} })).status).toBe(401);
  });

  it('runs now: creates a task delegated to the agent, skips while it is open, creates the next once it is done', async () => {
    const { asOwner, agent, column } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id))).data!;
    const routine = routines(asOwner)({ routineId: created.id });
    const first = await routine.run.post();
    expect(first.status).toBe(202);
    const ran = await waitForStatus(first.data!.runId, 'succeeded');
    expect(ran.result).toMatchObject({ outcome: 'created', skipReason: null });
    const [task] = await db.select().from(issueTable).where(eq(issueTable.id, ran.issueId!));
    expect(task).toMatchObject({
      title: 'Weekly report',
      description: 'Summarize the week.',
      delegateUserId: agent.userId,
    });
    expect(await db.select().from(agentRun).where(eq(agentRun.issueId, task!.id))).toHaveLength(1);

    const second = (await routine.run.post()).data!;
    const skipped = await waitForStatus(second.runId, 'skipped');
    expect(skipped).toMatchObject({
      issueId: task!.id,
      result: { outcome: 'skipped', skipReason: 'task-open' },
    });
    const listed = (await routines(asOwner).get({ query: {} })).data!.items[0]!;
    expect(listed.lastRun).toMatchObject({
      status: 'skipped',
      outcome: 'skipped',
      skipReason: 'task-open',
      taskNumber: task!.sequenceNumber,
    });

    await asOwner.issues({ issueId: task!.id }).patch({ columnId: column('Done') });
    const third = (await routine.run.post()).data!;
    const next = await waitForStatus(third.runId, 'succeeded');
    expect(next.issueId).not.toBe(task!.id);
    const history = (await routine.runs.get({ query: {} })).data!;
    expect(history.total).toBe(3);
    expect(history.items.map((item) => item.status)).toEqual(['succeeded', 'skipped', 'succeeded']);
  });

  it('reopens a finished task: back to unstarted, a comment and a new run of the agent', async () => {
    const { asOwner, agent, column } = await setup();
    const task = (
      await asOwner
        .projects({ projectKey: 'MKT' })
        .issues.post({ columnId: column('Done'), title: 'Backups' } as never)
    ).data!;
    const created = (
      await routines(asOwner).post(routineBody(agent.id, { mode: 'reopen', taskId: task.id }))
    ).data!;
    const run = (await routines(asOwner)({ routineId: created.id }).run.post()).data!;
    const reopened = await waitForStatus(run.runId, 'succeeded');
    expect(reopened.result).toMatchObject({ outcome: 'reopened', taskId: task.id });
    const [after] = await db.select().from(issueTable).where(eq(issueTable.id, task.id));
    expect(after).toMatchObject({ columnId: column('Todo'), delegateUserId: agent.userId });
    const comments = await db
      .select({ body: issueActivity.body })
      .from(issueActivity)
      .where(and(eq(issueActivity.issueId, task.id), eq(issueActivity.kind, 'comment')));
    expect(comments).toContainEqual({
      body: 'Reopened by the schedule "Weekly report".\n\nSummarize the week.',
    });
    expect(await db.select().from(agentRun).where(eq(agentRun.issueId, task.id))).toHaveLength(1);
    // The task is open now: the next fire leaves it alone.
    const again = (await routines(asOwner)({ routineId: created.id }).run.post()).data!;
    await waitForStatus(again.runId, 'skipped');
  });

  it('fires each time once, and records a fire that comes too late as missed', async () => {
    const { asOwner, agent } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id, { cron: '0 9 * * *' })))
      .data!;
    const monday = new Date('2026-09-21T07:00:00.000Z');
    const first = await fire(created.id, monday);
    expect(first).toMatchObject({ status: 'succeeded', trigger: 'schedule' });
    // The same time fired again (a replica, a backfill) runs nothing new.
    expect(await planFire(created.id, monday.toISOString(), monday.getTime())).toBeNull();
    // Ten minutes late is still on time; more is missed, and only the newest missed time
    // is recorded.
    const tuesday = new Date('2026-09-22T07:00:00.000Z');
    const wednesday = new Date('2026-09-23T07:00:00.000Z');
    const later = wednesday.getTime() + 60 * 60_000;
    expect(await planFire(created.id, tuesday.toISOString(), later)).toBeNull();
    expect(await planFire(created.id, wednesday.toISOString(), later)).toBeNull();
    const runs = await runsOf(created.id);
    expect(runs.map((run) => [run.scheduledFor!.toISOString(), run.status, run.result])).toEqual([
      [monday.toISOString(), 'succeeded', expect.objectContaining({ outcome: 'created' })],
      [wednesday.toISOString(), 'skipped', { outcome: 'skipped', skipReason: 'missed' }],
    ]);
  });

  it('runs the newest missed time once under the catch-up policy "once"', async () => {
    const { asOwner, agent } = await setup();
    const created = (
      await routines(asOwner).post(routineBody(agent.id, { cron: '0 9 * * *', catchUp: 'once' }))
    ).data!;
    const tuesday = new Date('2026-09-22T07:00:00.000Z');
    const wednesday = new Date('2026-09-23T07:00:00.000Z');
    const later = wednesday.getTime() + 5 * 60 * 60_000;
    expect(await planFire(created.id, tuesday.toISOString(), later)).toBeNull();
    const runId = await planFire(created.id, wednesday.toISOString(), later);
    expect(runId).not.toBeNull();
    const { startRun } = await import('#modules/engine/runs');
    await startRun(runId!);
    await waitForStatus(runId!, 'succeeded');
    expect((await runsOf(created.id)).map((run) => run.scheduledFor!.toISOString())).toEqual([
      wednesday.toISOString(),
    ]);
  });

  it('fires no run for a routine that is off, deleted or gone with its project', async () => {
    const { asOwner, agent } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id))).data!;
    const at = new Date('2026-09-21T07:00:00.000Z');
    await routines(asOwner)({ routineId: created.id }).patch({ enabled: false });
    expect(await planFire(created.id, at.toISOString(), at.getTime())).toBeNull();
    expect((await routines(asOwner)({ routineId: created.id }).delete()).status).toBe(204);
    expect(await planFire(created.id, at.toISOString(), at.getTime())).toBeNull();
    for (const res of [
      await routines(asOwner)({ routineId: created.id }).delete(),
      await routines(asOwner)({ routineId: created.id }).run.post(),
      await routines(asOwner)({ routineId: 'nope' }).patch({ enabled: false }),
    ])
      expect(res.status).toBe(404);
  });

  it('keeps members without the agent permissions out', async () => {
    const { asOwner, agent } = await setup();
    const asMember = await addProjectMember(asOwner, 'MKT');
    expect((await routines(asMember).get({ query: {} })).status).toBe(200);
    expect((await routines(asMember).post(routineBody(agent.id))).status).toBe(403);
    const stranger = authedApi((await signUpTestUser()).cookie);
    expect((await routines(stranger).post(routineBody(agent.id))).status).toBe(403);
  });
});
