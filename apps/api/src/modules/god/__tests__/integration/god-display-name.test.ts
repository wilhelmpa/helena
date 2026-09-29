import { beforeEach, describe, expect, it } from 'bun:test';
import { auth } from '@repo/auth';
import { api, app } from '#tests/helpers/app';
import { resetDb } from '#tests/helpers/db';
import { addUser, setup } from '../helpers';

describe('display name setting', () => {
  beforeEach(resetDb);

  it('is public, defaults to Helena and updates without a build', async () => {
    expect((await api['display-name'].get()).data).toMatchObject({ displayName: 'Helena' });
    const { god } = await setup();
    expect((await god.api.god['display-name'].put({ displayName: 'Atlas' })).status).toBe(200);
    expect((await api['display-name'].get()).data).toMatchObject({ displayName: 'Atlas' });
    await app.handle(new Request('http://localhost/api/auth/get-session'));
    expect((await auth.$context).appName).toBe('Atlas');
    const spec = await app.handle(new Request('http://localhost/docs/json'));
    expect(await spec.json()).toMatchObject({ info: { title: 'Atlas API' } });
  });

  it('lets only the administrator write a valid name', async () => {
    const { god } = await setup();
    const member = await addUser({ email: 'member@example.com' });
    expect((await member.api.god['display-name'].put({ displayName: 'Atlas' })).status).toBe(403);
    expect((await god.api.god['display-name'].put({ displayName: '<script>' })).status).toBe(400);
  });
});
