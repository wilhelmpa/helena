import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { api, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { controlPlane, type ControlRequest } from '#tests/helpers/control';
import { clearLimits, setLimits } from '#tests/helpers/limits';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';

// A routine is a schedule of Mastra's agent-routine workflow. The control endpoint is a
// stand-in that keeps the schedules Plan creates, the way mastra-control answers them.

type Schedule = Record<string, unknown> & {
  id: string;
  workflowId: string;
  status: string;
  requestContext: { projectRef: string };
  metadata: { scheduleKey?: string };
};

const mastra = {
  schedules: new Map<string, Schedule>(),
  lastRuns: new Map<string, unknown>(),
  created: 0,
  reset() {
    this.schedules.clear();
    this.lastRuns.clear();
    this.created = 0;
  },
  withLastRun(schedule: Schedule) {
    return { ...schedule, lastRun: this.lastRuns.get(schedule.id) ?? null };
  },
  answer(request: ControlRequest): unknown {
    const schedule = this.schedules.get(String(request.scheduleId));
    const owned =
      schedule &&
      schedule.workflowId === request.workflowId &&
      schedule.requestContext.projectRef === request.projectRef;
    switch (request.operation) {
      case 'create-schedule': {
        const existing = [...this.schedules.values()].find(
          (item) =>
            item.requestContext.projectRef === request.projectRef &&
            item.metadata.scheduleKey === request.scheduleKey,
        );
        if (existing) return { ...existing, replayed: true };
        this.created += 1;
        const created: Schedule = {
          id: `schedule_${this.created}`,
          workflowId: String(request.workflowId),
          cron: request.cron,
          timezone: request.timezone,
          status: 'active',
          nextFireAt: Date.parse('2026-10-05T07:00:00.000Z'),
          inputData: request.payload,
          requestContext: { projectRef: String(request.projectRef) },
          metadata: { scheduleKey: request.scheduleKey as string | undefined },
          createdAt: Date.parse('2026-09-23T10:00:00.000Z') + this.created,
          updatedAt: Date.parse('2026-09-23T10:00:00.000Z') + this.created,
        };
        this.schedules.set(created.id, created);
        return created;
      }
      case 'schedules': {
        const projects = new Set(request.projectRefs as string[]);
        return {
          schedules: [...this.schedules.values()]
            .filter((item) => projects.has(item.requestContext.projectRef))
            .map((item) => this.withLastRun(item)),
        };
      }
      case 'schedule':
        return owned
          ? this.withLastRun(schedule)
          : Response.json({ message: 'Workflow schedule not found' }, { status: 404 });
      case 'update-schedule':
        Object.assign(schedule!, {
          cron: request.cron,
          timezone: request.timezone,
          ...(request.payload ? { inputData: request.payload } : {}),
        });
        return schedule;
      case 'pause-schedule':
      case 'resume-schedule':
        schedule!.status = request.operation === 'pause-schedule' ? 'paused' : 'active';
        return schedule;
      case 'run-schedule':
        return { scheduleId: schedule!.id, claimId: `sched_${schedule!.id}_1790000000000` };
      case 'delete-schedule':
        this.schedules.delete(schedule!.id);
        return { message: 'Schedule deleted' };
      default:
        return {};
    }
  },
};

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const created = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
  const agent = (
    await createAgent(asOwner, 'MKT', {
      name: 'Writer',
      username: 'writer',
      kind: 'external',
      triggerOnAssign: true,
    })
  ).data!.agent;
  return { owner, asOwner, agent, teamId: created.data!.teamId, columnId: view.columns[0].id };
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

const requests = (operation: string) =>
  controlPlane.requests.filter((request) => request.operation === operation);

describe('routines', () => {
  beforeEach(async () => {
    await resetDb();
    controlPlane.reset();
    mastra.reset();
    controlPlane.answer = (request) => mastra.answer(request);
  });

  afterEach(() => clearLimits());

  it('creates a routine as a real, project-scoped Mastra schedule in Europe/Berlin', async () => {
    const { owner, asOwner, agent, teamId } = await setup();
    const body = routineBody(agent.id);
    const res = await routines(asOwner).post(body);
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      id: 'schedule_1',
      projectKey: 'MKT',
      projectName: 'Marketing',
      agent: { id: agent.id, name: 'Writer' },
      title: 'Weekly report',
      instructions: 'Summarize the week.',
      mode: 'new',
      task: null,
      cron: '0 9 * * 1',
      timezone: 'Europe/Berlin',
      enabled: true,
      nextRunAt: new Date('2026-10-05T07:00:00.000Z'),
      lastRun: null,
    });

    const [created] = requests('create-schedule');
    expect(created).toMatchObject({
      workflowId: 'agent-routine',
      projectRef: 'project:MKT',
      organizationRef: `organization:${teamId}`,
      scheduleKey: body.idempotencyKey,
      cron: '0 9 * * 1',
      timezone: 'Europe/Berlin',
    });
    expect(created.payload).toMatchObject({
      source: 'itsaplan-schedule',
      actor: { type: 'human', id: owner.userId },
      context: {
        projectRef: 'project:MKT',
        organizationRef: `organization:${teamId}`,
        capabilityRefs: [],
        connectionRefs: [],
      },
      dryRun: false,
      payload: {
        projectRef: 'project:MKT',
        agentRef: 'agent:writer',
        title: 'Weekly report',
        instructions: 'Summarize the week.',
        mode: 'new',
      },
    });

    const again = await routines(asOwner).post(body);
    expect(again.data?.id).toBe('schedule_1');
    expect(mastra.schedules.size).toBe(1);
  });

  it('reopens a task of the project and names it', async () => {
    const { asOwner, agent, columnId } = await setup();
    const task = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Backups' })
    ).data!;
    const res = await routines(asOwner).post(
      routineBody(agent.id, { mode: 'reopen', taskId: task.id, timezone: 'UTC' }),
    );
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      mode: 'reopen',
      task: { id: task.id, number: task.sequenceNumber, title: 'Backups' },
      timezone: 'UTC',
    });
    expect(requests('create-schedule')[0].payload).toMatchObject({
      payload: { mode: 'reopen', taskRef: `task:MKT-${task.sequenceNumber}` },
    });
  });

  it('validates the agent, the task, the cron, the time zone and the cadence', async () => {
    const { asOwner, agent } = await setup();
    const idle = (
      await createAgent(asOwner, 'MKT', { name: 'Idle', username: 'idle', kind: 'external' })
    ).data!.agent;
    await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const foreign = (
      await asOwner.projects({ projectKey: 'OPS' }).issues.post({
        columnId: (await asOwner.projects({ projectKey: 'OPS' }).get()).data!.columns[0].id,
        title: 'Elsewhere',
      })
    ).data!;
    for (const body of [
      { agentId: agent.id + 1000 },
      { agentId: idle.id },
      { mode: 'reopen' },
      { mode: 'reopen', taskId: foreign.id },
      { cron: 'every day' },
      { timezone: 'Mars/Olympus' },
      { title: '   ' },
      { title: 'x'.repeat(301) },
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
    expect(mastra.schedules.size).toBe(1);
  });

  it('refuses a routine for an agent that takes tasks from its owner only', async () => {
    const { asOwner, agent } = await setup();
    const { teamId } = (await asOwner.projects.get()).data![0];
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
    const run = await routines(asMember)({ routineId: mine.data!.id }).run.post();
    expect(run.status).toBe(403);
  });

  it('lists the routines of a project and of every project the member reads, with the last run', async () => {
    const { asOwner, agent } = await setup();
    const first = (await routines(asOwner).post(routineBody(agent.id))).data!;
    await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const ops = (
      await createAgent(asOwner, 'OPS', {
        name: 'Operator',
        username: 'operator',
        kind: 'external',
        triggerOnAssign: true,
      })
    ).data!.agent;
    const second = (await routines(asOwner, 'OPS').post(routineBody(ops.id))).data!;
    mastra.lastRuns.set(first.id, {
      runId: 'sched_schedule_1_1790000000000',
      firedAt: Date.parse('2026-09-28T07:00:00.000Z'),
      status: 'success',
      result: { status: 'skipped', taskRef: 'task:MKT-3', skipReason: 'task-open' },
      error: null,
    });

    const listed = (await routines(asOwner).get({ query: {} })).data!;
    expect(listed.total).toBe(1);
    expect(listed.items[0]).toMatchObject({
      id: first.id,
      lastRun: {
        status: 'success',
        outcome: 'skipped',
        skipReason: 'task-open',
        taskNumber: 3,
        error: null,
        firedAt: new Date('2026-09-28T07:00:00.000Z'),
      },
    });

    const home = (await asOwner.routines.get({ query: {} })).data!;
    expect(home.items.map((item) => [item.projectKey, item.id])).toEqual([
      ['OPS', second.id],
      ['MKT', first.id],
    ]);
    expect((await asOwner.routines.get({ query: { pageSize: 1, page: 2 } })).data).toMatchObject({
      total: 2,
      items: [{ id: first.id }],
    });

    const stranger = authedApi((await signUpTestUser()).cookie);
    expect((await stranger.routines.get({ query: {} })).data).toMatchObject({
      total: 0,
      items: [],
    });
    expect((await routines(stranger).get({ query: {} })).status).toBe(403);
    expect((await api.routines.get({ query: {} })).status).toBe(401);
  });

  it('changes a routine for the member who saves it and switches it off and on', async () => {
    const { asOwner, agent } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id))).data!;
    const routine = routines(asOwner)({ routineId: created.id });

    const changed = await routine.patch({ title: 'Monthly report', cron: '0 9 1 * *' });
    expect(changed.status).toBe(200);
    expect(changed.data).toMatchObject({ title: 'Monthly report', cron: '0 9 1 * *' });
    const [update] = requests('update-schedule');
    expect(update).toMatchObject({ scheduleId: created.id, cron: '0 9 1 * *' });
    expect(update.payload).toMatchObject({
      dryRun: false,
      payload: { title: 'Monthly report', instructions: 'Summarize the week.', mode: 'new' },
    });

    const off = await routine.patch({ enabled: false });
    expect(off.data).toMatchObject({ enabled: false, nextRunAt: null });
    expect(requests('update-schedule')).toHaveLength(1);
    expect((await routine.patch({ enabled: true })).data).toMatchObject({ enabled: true });
    expect(requests('pause-schedule')).toHaveLength(1);
    expect(requests('resume-schedule')).toHaveLength(1);
  });

  it('runs a routine now and deletes it; an unknown routine is 404', async () => {
    const { asOwner, agent } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id))).data!;
    const run = await routines(asOwner)({ routineId: created.id }).run.post();
    expect(run.status).toBe(202);
    expect(run.data).toEqual({ runId: `sched_${created.id}_1790000000000` });

    expect((await routines(asOwner)({ routineId: created.id }).delete()).status).toBe(204);
    expect(mastra.schedules.size).toBe(0);
    for (const res of [
      await routines(asOwner)({ routineId: created.id }).delete(),
      await routines(asOwner)({ routineId: created.id }).run.post(),
      await routines(asOwner)({ routineId: 'schedule_9' }).patch({ enabled: false }),
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
