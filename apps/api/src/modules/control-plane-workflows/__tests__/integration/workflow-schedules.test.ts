import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { controlPlane } from '#tests/helpers/control';

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
              { id: 'active_one', status: 'active' },
              { id: 'paused_one', status: 'paused' },
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
