import { beforeEach, expect, it } from 'bun:test';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { bootstrapHomeAgent } from '../../../../../scripts/bootstrap-home-agent';
import { isTriggerableBy } from '../../service';

beforeEach(resetDb);

it('keeps the family member inside ELLI/FAM and hides private owner agents even in shared projects', async () => {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  await bootstrapHomeAgent();
  const fam = (await asOwner.projects.post({ key: 'FAM', name: 'Family' })).data!;
  await asOwner.projects.post({ key: 'ELLI', name: 'Personal' });
  await asOwner.projects.post({ key: 'PRIV', name: 'Owner personal' });
  const member = await signUpTestUser();
  const asMember = authedApi(member.cookie);
  const invite = await asOwner
    .projects({ projectKey: 'ELLI' })
    .invites.post({ email: member.email, role: 'member' });
  expect(invite.status).toBe(201);
  expect((await asMember.invites({ token: invite.data!.token }).accept.post()).status).toBe(200);
  expect(
    (
      await asOwner
        .projects({ projectKey: 'FAM' })
        .members.post({ userId: member.userId, role: 'member' })
    ).status,
  ).toBe(204);
  const shared = (
    await createAgent(asOwner, 'FAM', {
      name: 'Shared family agent',
      username: 'shared-family',
      runnerScope: 'team',
    })
  ).data!.agent;
  const privateAgent = (
    await createAgent(asOwner, 'FAM', {
      name: 'Owner-only in family',
      username: 'owner-private',
      runnerScope: 'owner',
    })
  ).data!.agent;
  const hidden = (
    await createAgent(asOwner, 'PRIV', {
      name: 'Private project agent',
      username: 'private-project',
    })
  ).data!.agent;
  const ownerAgents = (await asOwner.teams({ teamId: fam.teamId })['ai-agents'].get()).data!;
  const master = ownerAgents.find((agent) => agent.username === 'master')!;
  const visible = (await asMember.teams({ teamId: fam.teamId })['ai-agents'].get()).data!;
  expect(visible.some((agent) => agent.id === shared.id)).toBe(true);
  for (const agent of [privateAgent, hidden, master]) {
    expect(visible.some((entry) => entry.id === agent.id)).toBe(false);
    expect(
      (await asMember.teams({ teamId: fam.teamId })['ai-agents']({ agentId: agent.id }).get())
        .status,
    ).toBe(404);
    expect(
      (
        await asMember
          .teams({ teamId: fam.teamId })
          ['ai-agents']({ agentId: agent.id })
          ['chat-reflections'].get()
      ).status,
    ).toBe(404);
  }
  expect((await asMember.projects.get()).data!.map((project) => project.key).sort()).toEqual([
    'ELLI',
    'FAM',
  ]);
  expect((await asMember.projects({ projectKey: 'PRIV' }).get()).status).toBe(403);
  const request = (path: string, method = 'GET', body?: object) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          cookie: member.cookie,
          'content-type': 'application/json',
          origin: 'http://localhost:3001',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  for (const agent of [privateAgent, master]) {
    expect((await request(`/projects/FAM/ai-agents/${agent.id}/chat/catalog`)).status).toBe(404);
    expect((await request(`/projects/FAM/ai-agents/${agent.id}/threads`)).status).toBe(404);
    expect(
      (await request(`/projects/FAM/ai-agents/${agent.id}/chat`, 'POST', { prompt: 'Hello' }))
        .status,
    ).toBe(404);
  }
  expect(
    (await request(`/projects/FAM/ai-agents/${shared.id}/chat`, 'POST', { prompt: 'Family task' }))
      .status,
  ).toBe(200);
  for (const path of ['Projects/PRIV/Docs/secret.md', 'Home/Docs/secret.md', 'Private/secret.md']) {
    expect((await request(`/knowledge/documents?path=${encodeURIComponent(path)}`)).status).toBe(
      403,
    );
  }
});

it('does not transfer an owner-scoped agent to another person when its owner was deleted', () => {
  expect(isTriggerableBy({ runnerScope: 'owner', ownerUserId: null }, 'another')).toBe(false);
  expect(isTriggerableBy({ runnerScope: 'owner', ownerUserId: 'owner' }, 'owner')).toBe(true);
  expect(isTriggerableBy({ runnerScope: 'owner', ownerUserId: null }, null)).toBe(false);
});
