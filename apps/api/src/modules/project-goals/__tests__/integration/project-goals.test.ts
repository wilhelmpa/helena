import { beforeEach, describe, expect, it } from 'bun:test';
import { db, helenaGoalTask, helenaProjectGoalLink, initiative } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app, apiKeyApi, authedApi } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import { projectGoalsForAgent } from '../../service';

async function readViaMcp(apiKey: string, projectKey: string) {
  const response = await app.handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_project_goal_context', arguments: { projectKey } },
      }),
    }),
  );
  const text = await response.text();
  return JSON.parse(text.slice(text.indexOf('data: ') + 6)).result as {
    isError?: boolean;
    content: { text: string }[];
  };
}

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  const other = (await api.projects.post({ key: 'OPS', name: 'Operations' })).data!;
  const org = api.teams({ teamId: project.teamId }).organization;
  const pool = (await org.goals.post({ title: 'Shared result', status: 'active' })).data!;
  const foreign = (await org.goals.post({ title: 'Private other result', projectId: other.id }))
    .data!;
  const local = (
    await api
      .projects({ projectKey: 'MKT' })
      .initiatives.post({ title: 'Owner outcome', status: 'active', ownerUserId: owner.userId })
  ).data!;
  return { owner, api, project, org, pool, foreign, local };
}

describe('project goal pool relationship', () => {
  beforeEach(resetDb);

  it('keeps stable IDs and owner data while reading through later pool changes', async () => {
    const { api, org, pool, local } = await setup();
    const before = await db.select().from(initiative).where(eq(initiative.id, local.id));
    const link = api.initiatives({ initiativeId: local.id })['pool-goal'];
    expect((await link.put({ goalId: pool.id })).status).toBe(200);
    expect((await link.put({ goalId: pool.id })).status).toBe(200);
    expect(await db.select().from(helenaProjectGoalLink)).toEqual([
      { initiativeId: local.id, goalId: pool.id },
    ]);
    await org.goals({ goalId: pool.id }).patch({ title: 'Updated by owner', status: 'paused' });
    const context = await api.projects({ projectKey: 'MKT' })['goal-context'].get();
    expect(context.status).toBe(200);
    expect(context.data!.goals.find((g) => g.id === pool.id)).toMatchObject({
      title: 'Updated by owner',
      status: 'paused',
    });
    expect(context.data!.links).toEqual([{ initiativeId: local.id, goalId: pool.id }]);
    expect(await db.select().from(initiative).where(eq(initiative.id, local.id))).toEqual(before);
    expect((await link.put({ goalId: null })).status).toBe(200);
    expect(await db.select().from(helenaProjectGoalLink)).toEqual([]);
    expect(await db.select().from(initiative).where(eq(initiative.id, local.id))).toEqual(before);
  });

  it('refuses cross-project and cross-team links without replacing the existing link', async () => {
    const { api, pool, foreign, local } = await setup();
    const stranger = authedApi((await signUpTestUser()).cookie);
    const foreignProject = (await stranger.projects.post({ key: 'SEC', name: 'Other team' })).data!;
    const external = (
      await stranger
        .teams({ teamId: foreignProject.teamId })
        .organization.goals.post({ title: 'Another team' })
    ).data!;
    const link = api.initiatives({ initiativeId: local.id })['pool-goal'];
    expect((await link.put({ goalId: pool.id })).status).toBe(200);
    expect((await link.put({ goalId: foreign.id })).status).toBe(400);
    expect((await link.put({ goalId: external.id })).status).toBe(400);
    const read = await api.projects({ projectKey: 'MKT' })['goal-context'].get();
    expect(read.data!.goals.map((g) => g.id)).not.toContain(foreign.id);
    expect(read.data!.goals.map((g) => g.id)).not.toContain(external.id);
    expect(read.data!.links).toEqual([{ initiativeId: local.id, goalId: pool.id }]);
    expect(
      (
        await stranger
          .initiatives({ initiativeId: local.id })
          ['pool-goal'].put({ goalId: external.id })
      ).status,
    ).toBe(403);
  });

  it('keeps explicit task choices and counts only readable current-project contributions', async () => {
    const { api, org, pool, local } = await setup();
    const explicit = (await org.goals.post({ title: 'Explicit choice' })).data!;
    await api.initiatives({ initiativeId: local.id })['pool-goal'].put({ goalId: pool.id });
    const view = (await api.projects({ projectKey: 'MKT' }).get()).data!;
    const columnId = view.columns.find((c) => c.stateType === 'completed')!.id;
    await api
      .projects({ projectKey: 'MKT' })
      .issues.post({ title: 'Inherited contribution', columnId, initiativeId: local.id });
    await api.projects({ projectKey: 'MKT' }).issues.post({
      title: 'Explicit contribution',
      columnId,
      initiativeId: local.id,
      goalId: explicit.id,
    });
    const stored = await db.select().from(helenaGoalTask);
    expect(stored).toHaveLength(1);
    const read = await api.projects({ projectKey: 'MKT' })['goal-context'].get();
    expect(read.data!.goals.find((g) => g.id === pool.id)?.progress).toEqual({ total: 1, done: 1 });
    expect(read.data!.goals.find((g) => g.id === explicit.id)?.progress).toEqual({
      total: 1,
      done: 1,
    });
    expect(await db.select().from(helenaGoalTask)).toEqual(stored);
    const role = (
      await createRole(api, 'MKT', {
        name: 'Goals only',
        permissions: { initiatives: { read: true } },
      })
    ).data!;
    const reader = await addProjectMember(api, 'MKT', role.id);
    const limited = await reader.projects({ projectKey: 'MKT' })['goal-context'].get();
    expect(limited.status).toBe(200);
    expect(limited.data!.goals.every((g) => g.progress === null)).toBe(true);
    expect(
      (await reader.initiatives({ initiativeId: local.id })['pool-goal'].put({ goalId: null }))
        .status,
    ).toBe(403);
    const taskRole = (
      await createRole(api, 'MKT', {
        name: 'Tasks only',
        permissions: { work_items: { read: true } },
      })
    ).data!;
    const taskReader = await addProjectMember(api, 'MKT', taskRole.id);
    expect((await taskReader.projects({ projectKey: 'MKT' })['goal-context'].get()).status).toBe(
      403,
    );
  });

  it('hides a moved pool goal and its link, then cascades only the relationship on deletion', async () => {
    const { api, org, pool, foreign, local } = await setup();
    const before = await db.select().from(initiative).where(eq(initiative.id, local.id));
    await api.initiatives({ initiativeId: local.id })['pool-goal'].put({ goalId: pool.id });
    await org.goals({ goalId: pool.id }).patch({ projectId: foreign.projectId });
    const read = await api.projects({ projectKey: 'MKT' })['goal-context'].get();
    expect(read.data!.goals.map((g) => g.id)).not.toContain(pool.id);
    expect(read.data!.links).toEqual([]);
    expect(await db.select().from(helenaProjectGoalLink)).toHaveLength(1);
    expect((await org.goals({ goalId: pool.id }).delete()).status).toBe(204);
    expect(await db.select().from(helenaProjectGoalLink)).toEqual([]);
    expect(await db.select().from(initiative).where(eq(initiative.id, local.id))).toEqual(before);
  });

  it('restricts agent context and API-key reads to authorized project goals', async () => {
    const { api, project, pool, local } = await setup();
    await api.initiatives({ initiativeId: local.id })['pool-goal'].put({ goalId: pool.id });
    await api
      .projects({ projectKey: 'OPS' })
      .initiatives.post({ title: 'Invisible project goal', status: 'active' });
    const created = (
      await createAgent(api, 'MKT', {
        name: 'Delegate',
        username: 'delegate',
        kind: 'external',
        runtimePolicy: {
          reasoningEffort: null,
          toolAllow: [],
          toolDeny: [],
          mcpGrants: ['get_project_goal_context'],
          files: [],
        },
      })
    ).data!;
    const agentApi = apiKeyApi(created.apiKey);
    const text = await projectGoalsForAgent({
      teamId: project.teamId,
      userId: created.agent.userId,
    });
    expect(text).toContain('Owner outcome');
    expect(text).toContain(`pool goal #${pool.id}`);
    expect(text).not.toContain('Invisible project goal');
    expect((await agentApi.projects({ projectKey: 'MKT' })['goal-context'].get()).status).toBe(200);
    expect((await agentApi.projects({ projectKey: 'OPS' })['goal-context'].get()).status).toBe(403);
    const own = await readViaMcp(created.apiKey, 'MKT');
    expect(own.isError).not.toBe(true);
    expect(JSON.parse(own.content[0]!.text).links).toEqual([
      { initiativeId: local.id, goalId: pool.id },
    ]);
    const forbidden = await readViaMcp(created.apiKey, 'OPS');
    expect(forbidden.isError).toBe(true);
    expect(JSON.stringify(forbidden)).not.toContain('Invisible project goal');
  });
});
