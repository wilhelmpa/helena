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
    expect(controlPlane.requests.at(-1)).toMatchObject({
      operation: 'update-schedule',
      scheduleId: 'schedule_1',
      cron: '0 8 * * 1-5',
      timezone: 'Europe/Berlin',
    });
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
