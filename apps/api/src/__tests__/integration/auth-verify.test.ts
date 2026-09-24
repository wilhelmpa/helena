import { describe, it, expect, beforeEach } from 'bun:test';
import { auth } from '@repo/auth';
import { api, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// Nginx asks these routes before it forwards a request to a local tool (code-server, the
// project terminal, the project browsers). The tools have no login of their own and reach
// every project, so they are the owner's alone, from his signed-in browser
// (docs/helena-decisions/security-hardening.md H-01).
describe('reverse-proxy authentication', () => {
  beforeEach(resetDb);

  it('admits the owner and nobody else to the tools', async () => {
    const owner = await signUpTestUser();
    const member = await signUpTestUser();

    expect((await authedApi(owner.cookie).auth.verify.get()).status).toBe(204);
    expect((await authedApi(member.cookie).auth.verify.get()).status).toBe(403);
  });

  it('refuses an API key, even the owner’s', async () => {
    const owner = await signUpTestUser();
    const key = await auth.api.createApiKey({ body: { userId: owner.userId, name: 'cli' } });
    const withKey = await api.auth.verify.get({ headers: { 'x-api-key': key.key } });
    expect(withKey.status).toBe(403);
  });

  it('refuses a request without a session', async () => {
    expect((await api.auth.verify.get()).status).toBe(401);
  });
});
