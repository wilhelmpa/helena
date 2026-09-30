import { beforeEach, describe, expect, it } from 'bun:test';
import { auth } from '@repo/auth';
import { api, app } from '#tests/helpers/app';
import { resetDb } from '#tests/helpers/db';
import { addUser, setup } from '../helpers';
import { bootstrapHomeAgent } from '../../../../scripts/bootstrap-home-agent';
import { normalizeOpenApiResponse } from '../../../../openapi';

describe('display name setting', () => {
  beforeEach(resetDb);

  it('is public, defaults to Ava and updates without a build', async () => {
    expect((await api['display-name'].get()).data).toMatchObject({ displayName: 'Ava' });
    const { god } = await setup();
    expect((await god.api.god['display-name'].put({ displayName: 'Atlas' })).status).toBe(200);
    expect((await api['display-name'].get()).data).toMatchObject({ displayName: 'Atlas' });
    await app.handle(new Request('http://localhost/api/auth/get-session'));
    expect((await auth.$context).appName).toBe('Atlas');
    const spec = await app.handle(new Request('http://localhost/docs/json'));
    const document = (await spec.json()) as {
      info: { title: string };
      tags: { name: string; description: string }[];
    };
    expect(document.info.title).toBe('Atlas API');
    expect(document.tags.find((tag) => tag.name === 'Routines')?.description).toBe(
      'Tasks created or reopened for an agent on a schedule, run by the Atlas engine',
    );
    const branded = await normalizeOpenApiResponse(new Request('http://localhost/docs/json'), {
      info: { title: 'Ava API', description: 'Available Avatars in Ava and Helena' },
      paths: {},
    });
    expect(branded).toMatchObject({
      info: { title: 'Atlas API', description: 'Available Avatars in Atlas and Atlas' },
    });
  });

  it('lets only the administrator write a valid name', async () => {
    const { god } = await setup();
    const member = await addUser({ email: 'member@example.com' });
    expect((await member.api.god['display-name'].put({ displayName: 'Atlas' })).status).toBe(403);
    expect((await god.api.god['display-name'].put({ displayName: '<script>' })).status).toBe(400);
  });

  it('renames the default Home agent when the visible name changes', async () => {
    const { god } = await setup();
    const home = await bootstrapHomeAgent();
    if (home.status !== 'ready') throw new Error('Home agent was not provisioned');
    const teamId = (await god.api.teams.get()).data![0]!.id;
    const agents = () => god.api.teams({ teamId })['ai-agents'].get();
    expect((await agents()).data?.find((agent) => agent.id === home.agentId)?.name).toBe('Ava');
    expect((await god.api.god['display-name'].put({ displayName: 'Atlas' })).status).toBe(200);
    expect((await agents()).data?.find((agent) => agent.id === home.agentId)?.name).toBe('Atlas');
  });
});
