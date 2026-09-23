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
    expect((await apiKeyApi(key.key).connections.secrets.get()).status).toBe(403);
    expect(
      (
        await apiKeyApi(key.key).connections.secrets.post({
          name: 'TEST_SECRET',
          value: 'test',
          allowedHosts: [],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await apiKeyApi(key.key).theme.sync.post({
          theme: 'dark',
        })
      ).status,
    ).toBe(403);
    const connections = await authedApi(owner.cookie).connections.get();
    expect(connections.status).toBe(200);
    expect(connections.data?.items).toEqual([]);
    const secrets = await authedApi(owner.cookie).connections.secrets.get();
    expect(secrets.status).toBe(200);
    expect(secrets.data?.entries).toEqual([]);
    expect(
      (
        await authedApi(owner.cookie).connections.secrets.post({
          name: 'TEST_SECRET',
          value: 'test',
          allowedHosts: [],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authedApi(owner.cookie, { origin: 'http://localhost:3001' }).connections.secrets.post(
          { name: 'TEST_SECRET', value: 'test', allowedHosts: [] },
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await authedApi(owner.cookie, { origin: 'http://localhost:3001' }).theme.sync.post({
          theme: 'dark',
        })
      ).status,
    ).toBe(503);
  });

  it('requires an owner session and an allowed browser origin before mail operations', async () => {
    const owner = await signUpTestUser();
    const member = await signUpTestUser();
    expect((await authedApi(member.cookie).connections.get()).status).toBe(403);
    expect(
      (
        await authedApi(owner.cookie).mail.search.post({
          account: 'owner@example.com',
          query: 'in:inbox',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authedApi(owner.cookie, { origin: 'https://evil.test' }).mail.search.post({
          account: 'owner@example.com',
          query: 'in:inbox',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authedApi(owner.cookie, { origin: 'http://localhost:3001' }).mail.search.post({
          account: 'owner@example.com',
          query: 'in:inbox',
        })
      ).status,
    ).toBe(503);
  });
});
