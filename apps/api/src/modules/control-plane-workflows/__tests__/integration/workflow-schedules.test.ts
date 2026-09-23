import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { controlPlane, type ControlRequest } from '#tests/helpers/control';
import { reconcileWorkflowSchedules } from '../../service';

// Schedules of a project workflow are Mastra schedules. The control endpoint is a
// stand-in that records the requests Plan sends it.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const created = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const workflows = asOwner.projects({ projectKey: 'MKT' })['control-plane'].workflows;
  return { owner, workflows, teamId: created.data!.teamId };
}

describe('workflow schedules', () => {
  beforeEach(async () => {
    await resetDb();
    controlPlane.reset();
  });

  it('creates a schedule whose fires are real runs of the project, in Europe/Berlin by default', async () => {
    const { owner, workflows, teamId } = await setup();
    await workflows({ workflowId: 'support' }).put({ enabled: true, capabilityRefs: [] });

    const res = await workflows({ workflowId: 'support' }).schedules.post({
      cron: '0 7 * * 1-5',
      payload: { queue: 'mail' },
    });
    expect(res.status).toBe(200);
    const created = controlPlane.requests.find(
      (request) => request.operation === 'create-schedule',
    )!;
    expect(created).toMatchObject({
      workflowId: 'support',
      projectRef: 'project:MKT',
      organizationRef: `organization:${teamId}`,
      cron: '0 7 * * 1-5',
      timezone: 'Europe/Berlin',
    });
    expect(Object.keys(created)).not.toContain('missedRunPolicy');
    expect(Object.keys(created)).not.toContain('concurrencyPolicy');
    expect(created.payload).toMatchObject({
      source: 'itsaplan-schedule',
      actor: { type: 'human', id: owner.userId },
      context: { projectRef: 'project:MKT', capabilityRefs: [], connectionRefs: [] },
      dryRun: false,
      payload: { queue: 'mail', projectKey: 'MKT', workflowRef: 'workflow:support:v1' },
    });

    await workflows({ workflowId: 'support' })
      .schedules({ scheduleId: 'schedule_1' })
      .patch({ cron: '0 8 * * 1-5' });
    const update = controlPlane.requests.at(-1)!;
    expect(update).toMatchObject({
      operation: 'update-schedule',
      scheduleId: 'schedule_1',
      cron: '0 8 * * 1-5',
    });
    expect(Object.keys(update)).not.toContain('timezone');
  });

  it('runs an agent-team schedule under the settings of the project', async () => {
    const { workflows } = await setup();
    await workflows({ workflowId: 'agent-team' }).put({
      enabled: true,
      capabilityRefs: ['hermes-team.v1', 'plan-task-sync.v1'],
      configuration: { autonomy: 'done', maxTurns: 40 },
    });
    await workflows({ workflowId: 'agent-team' }).schedules.post({
      cron: '0 7 * * 1',
      payload: { policy: { autonomy: 'review', reviewRequired: false, maxAttempts: 2 } },
    });
    const created = controlPlane.requests.find(
      (request) => request.operation === 'create-schedule',
    )!;
    expect((created.payload as { payload: unknown }).payload).toMatchObject({
      policy: { maxAttempts: 2, reviewRequired: true, autonomy: 'done', maxTurns: 40 },
      configuration: { autonomy: 'done', maxTurns: 40 },
    });
  });

  it('pauses the schedules of a workflow switched off, which can still be paused and deleted', async () => {
    const { workflows } = await setup();
    const fallback = controlPlane.answer;
    controlPlane.answer = (request) =>
      request.operation === 'schedules'
        ? {
            schedules: [
              { id: 'active_one', status: 'active', requestContext: { projectRef: 'project:MKT' } },
              { id: 'paused_one', status: 'paused', requestContext: { projectRef: 'project:MKT' } },
            ],
          }
        : fallback(request);
    await workflows({ workflowId: 'support' }).put({ enabled: true, capabilityRefs: [] });
    await workflows({ workflowId: 'support' }).put({ enabled: false, capabilityRefs: [] });
    expect(
      controlPlane.requests
        .filter((request) => request.operation === 'pause-schedule')
        .map((request) => request.scheduleId),
    ).toEqual(['active_one']);

    const schedule = workflows({ workflowId: 'support' }).schedules({ scheduleId: 'active_one' });
    expect((await schedule({ action: 'pause' }).post()).status).toBe(200);
    expect((await schedule.delete()).status).toBe(200);
    expect((await schedule({ action: 'run' }).post()).status).toBe(409);
    expect((await schedule({ action: 'resume' }).post()).status).toBe(409);
  });

  // A schedule of agent-team as Mastra stores it, saved under a maximum of 10 turns.
  function storedSchedule(status = 'active') {
    return {
      id: 'weekly',
      cron: '0 7 * * 1',
      status,
      requestContext: { projectRef: 'project:MKT' },
      inputData: {
        eventId: 'schedule-input',
        payload: {
          policy: { maxAttempts: 2, reviewRequired: true, autonomy: 'review', maxTurns: 10 },
          configuration: { maxTurns: 10 },
          projectKey: 'MKT',
        },
      },
    };
  }

  function withSchedules(schedule: Record<string, unknown>) {
    const fallback = controlPlane.answer;
    controlPlane.answer = (request: ControlRequest) =>
      request.operation === 'schedules' ? { schedules: [schedule] } : fallback(request);
  }

  const sent = (operation: string) =>
    controlPlane.requests.filter((request) => request.operation === operation);

  it('fires a schedule saved under earlier settings with the settings of the project', async () => {
    const { workflows } = await setup();
    withSchedules(storedSchedule());
    await workflows({ workflowId: 'agent-team' }).put({
      enabled: true,
      capabilityRefs: ['hermes-team.v1', 'plan-task-sync.v1'],
      configuration: { autonomy: 'done' },
    });

    const [update] = sent('update-schedule');
    expect(update).toMatchObject({ scheduleId: 'weekly', cron: '0 7 * * 1' });
    expect(update!.payload).toEqual({
      eventId: 'schedule-input',
      payload: {
        policy: { maxAttempts: 2, reviewRequired: true, autonomy: 'done' },
        configuration: { autonomy: 'done' },
        projectKey: 'MKT',
      },
    });
  });

  it('pauses on its next pass a schedule the switch-off could not reach', async () => {
    const { workflows } = await setup();
    await workflows({ workflowId: 'support' }).put({ enabled: true, capabilityRefs: [] });
    const schedule = { ...storedSchedule(), inputData: { payload: { configuration: {} } } };
    withSchedules(schedule);
    const answer = controlPlane.answer;
    controlPlane.answer = (request) =>
      request.operation === 'pause-schedule'
        ? Response.json({ message: 'Mastra is down' }, { status: 502 })
        : answer(request);
    await workflows({ workflowId: 'support' }).put({ enabled: false, capabilityRefs: [] });

    controlPlane.answer = answer;
    expect(await reconcileWorkflowSchedules()).toBe(1);
    expect(sent('pause-schedule').at(-1)).toMatchObject({
      scheduleId: 'weekly',
      projectRef: 'project:MKT',
    });
  });

  it('leaves a schedule alone that fires under the current settings', async () => {
    const { workflows } = await setup();
    await workflows({ workflowId: 'agent-team' }).put({
      enabled: true,
      capabilityRefs: ['hermes-team.v1', 'plan-task-sync.v1'],
      configuration: { maxTurns: 10 },
    });
    const current = storedSchedule();
    current.inputData.payload.configuration = { maxTurns: 10 };
    withSchedules(current);

    expect(await reconcileWorkflowSchedules()).toBe(0);
    expect(sent('update-schedule')).toEqual([]);
    withSchedules(storedSchedule('paused'));
    await workflows({ workflowId: 'agent-team' }).put({
      enabled: false,
      capabilityRefs: ['hermes-team.v1', 'plan-task-sync.v1'],
    });
    expect(sent('pause-schedule')).toEqual([]);
  });

  it('refuses a schedule of a workflow the project has not enabled', async () => {
    const { workflows } = await setup();
    const res = await workflows({ workflowId: 'support' }).schedules.post({
      cron: '0 7 * * *',
      payload: {},
    });
    expect(res.status).toBe(409);
    expect(controlPlane.requests.some((request) => request.operation === 'create-schedule')).toBe(
      false,
    );
  });

  it('leaves the routine workflow to the Schedules page', async () => {
    const { workflows } = await setup();
    controlPlane.answer = () => ({
      catalog: { flows: [{ id: 'support' }, { id: 'agent-routine' }] },
    });
    const listed = (await workflows.get()).data as { id: string }[];
    expect(listed.map((flow) => flow.id)).toEqual(['support']);
  });
});
