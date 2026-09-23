import { beforeEach, describe, expect, it } from 'bun:test';
import { auth } from '@repo/auth';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

describe('interactive communications boundary', () => {
  beforeEach(resetDb);

  it('accepts the owner browser and denies a valid owner API key', async () => {
    const owner = await signUpTestUser();
    const key = await auth.api.createApiKey({ body: { userId: owner.userId, name: 'agent' } });
    expect((await apiKeyApi(key.key).connections.get()).status).toBe(403);
    expect(
      (await apiKeyApi(key.key).connections.actions.post({ id: 'hermes', action: 'probe' })).status,
    ).toBe(403);
    const connections = await authedApi(owner.cookie).connections.get();
    expect(connections.status).toBe(200);
    expect(connections.data?.items).toEqual([]);
    expect(
      (await authedApi(owner.cookie).connections.actions.post({ id: 'hermes', action: 'probe' }))
        .status,
    ).toBe(403);
    expect(
      (
        await authedApi(owner.cookie, {
          origin: 'http://localhost:3001',
        }).connections.actions.post({ id: 'hermes', action: 'probe' })
      ).status,
    ).toBe(503);
  });

  it('refuses a member who does not own the instance', async () => {
    await signUpTestUser();
    const member = await signUpTestUser();
    expect((await authedApi(member.cookie).connections.get()).status).toBe(403);
  });
});
