import { beforeEach, expect, test } from 'bun:test';
import { aiAgent, apikey, db, user, projectMember } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app, authedApi, apiKeyApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { enforceAgentLimits } from '#modules/agents/governance';

beforeEach(resetDb);

test('agent trash preserves identity, key, assignments and settings, blocks work and restores', async () => {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'TRASH', name: 'Trash' })).data!;
  const created = (
    await createAgent(api, project.key, {
      name: 'Trash regression',
      username: 'trash-regression',
      kind: 'external',
      instructions: 'Keep these instructions.',
    })
  ).data!;
  const agent = created.agent;
  const resource = api.teams({ teamId: project.teamId })['ai-agents']({ agentId: agent.id });
  const premature = await app.handle(
    new Request(`http://localhost/teams/${project.teamId}/ai-agents/${agent.id}?permanent=true`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    }),
  );
  expect(premature.status).toBe(404);
  expect((await resource.get()).status).toBe(200);
  expect((await resource.delete()).status).toBe(204);
  expect(await db.query.aiAgent.findFirst({ where: eq(aiAgent.id, agent.id) })).toBeDefined();
  expect(await db.query.user.findFirst({ where: eq(user.id, agent.userId) })).toBeDefined();
  expect(
    await db.query.apikey.findFirst({ where: eq(apikey.referenceId, agent.userId) }),
  ).toBeDefined();
  expect(
    await db.query.projectMember.findFirst({ where: eq(projectMember.userId, agent.userId) }),
  ).toBeDefined();
  expect((await resource.get()).status).toBe(404);
  expect(
    (await api.teams({ teamId: project.teamId })['ai-agents'].get()).data?.some(
      (a) => a.id === agent.id,
    ),
  ).toBe(false);
  expect(
    (await api.projects({ projectKey: project.key }).get()).data?.assignees.some(
      (a) => a.userId === agent.userId,
    ),
  ).toBe(false);
  expect((await apiKeyApi(created.apiKey!).projects.get()).status).toBe(401);
  expect(await enforceAgentLimits(agent.id, project.id, null)).toBe('The agent is in the trash.');
  const request = (path: string, method = 'GET') =>
    app.handle(
      new Request(`http://localhost/teams/${project.teamId}/${path}`, {
        method,
        headers: { cookie: owner.cookie },
      }),
    );
  const trash = await request('ai-agent-trash');
  expect(trash.status).toBe(200);
  expect(await trash.json()).toEqual([
    expect.objectContaining({ id: agent.id, name: agent.name, deletedAt: expect.any(String) }),
  ]);
  expect((await request(`ai-agent-trash/${agent.id}/restore`, 'POST')).status).toBe(204);
  expect((await resource.get()).data?.instructions).toBe('Keep these instructions.');
  expect(
    (await api.projects({ projectKey: project.key }).get()).data?.assignees.some(
      (a) => a.userId === agent.userId,
    ),
  ).toBe(true);
  expect((await apiKeyApi(created.apiKey!).projects.get()).status).toBe(200);
  expect(await enforceAgentLimits(agent.id, project.id, null)).toBeNull();
});

test('another team cannot restore an agent in the trash', async () => {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'TRASH', name: 'Trash' })).data!;
  const created = (
    await createAgent(api, project.key, { name: 'Trash', username: 'trash', kind: 'external' })
  ).data!;
  await api.teams({ teamId: project.teamId })['ai-agents']({ agentId: created.agent.id }).delete();
  const other = await signUpTestUser();
  const response = await app.handle(
    new Request(
      `http://localhost/teams/${project.teamId}/ai-agent-trash/${created.agent.id}/restore`,
      { method: 'POST', headers: { cookie: other.cookie } },
    ),
  );
  expect(response.status).toBe(404);
  expect(
    (await db.query.aiAgent.findFirst({ where: eq(aiAgent.id, created.agent.id) }))?.deletedAt,
  ).not.toBeNull();
});
