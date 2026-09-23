import { describe, it, expect, beforeEach } from 'bun:test';
import { api, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// Nginx asks these routes before it forwards a request to a local tool.
describe('reverse-proxy authentication', () => {
  beforeEach(resetDb);

  it('admits any member to the tools and the instance owner alone to Mastra Studio', async () => {
    const owner = await signUpTestUser();
    const member = await signUpTestUser();

    expect((await authedApi(owner.cookie).auth.verify.get()).status).toBe(204);
    expect((await authedApi(member.cookie).auth.verify.get()).status).toBe(204);
    expect((await authedApi(owner.cookie).auth.verify.owner.get()).status).toBe(204);
    expect((await authedApi(member.cookie).auth.verify.owner.get()).status).toBe(403);
  });

  it('refuses a request without a session', async () => {
    expect((await api.auth.verify.get()).status).toBe(401);
    expect((await api.auth.verify.owner.get()).status).toBe(401);
  });
});
