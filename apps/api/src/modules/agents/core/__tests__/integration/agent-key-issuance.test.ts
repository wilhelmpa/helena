import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { apikey, db } from '@repo/db';
import { auth } from '@repo/auth';
import { eq } from 'drizzle-orm';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// createAgent issues the agent's API key outside the row's own transaction (better-auth
// writes it through its own connection), so a failure there must not leave the agent
// half set up. The name-length limit that used to be the natural way to trigger this is
// now handled by truncation before the call (agentKeyName, hub/fix-agent-key-names), so
// both tests reach the same failure directly instead: auth.api.createApiKey itself is
// spied to reject once, the same as any other reason it might fail (a database error, a
// rate limit, better-auth being unreachable) — the fix is about that class of failure,
// not specifically a long name.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const project = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  return { asOwner, teamId: project.data!.teamId };
}

const agents = (api: Api, teamId: number) => api.teams({ teamId })['ai-agents'];

let createApiKeySpy: ReturnType<typeof spyOn> | null = null;

afterEach(() => {
  createApiKeySpy?.mockRestore();
  createApiKeySpy = null;
});

// Makes the next call (and the next call only) to auth.api.createApiKey throw, then
// fall through to the real implementation again — a single simulated outage, not a
// permanently broken auth layer that would also break the retry the test makes.
function failNextKeyIssue(): void {
  const real = auth.api.createApiKey.bind(auth.api);
  let used = false;
  createApiKeySpy = spyOn(auth.api, 'createApiKey').mockImplementation(((...args: unknown[]) => {
    if (!used) {
      used = true;
      throw new Error('simulated key issuance failure');
    }
    return (real as (...a: unknown[]) => unknown)(...args);
  }) as typeof auth.api.createApiKey);
}

describe('agent API key issuance', () => {
  beforeEach(resetDb);

  it('cleans up a half-created agent when issuing its key fails, so retrying the same username works', async () => {
    const { asOwner, teamId } = await setup();
    failNextKeyIssue();

    const failed = await agents(asOwner, teamId).post({
      name: 'Retry Me',
      username: 'retry-me',
      kind: 'external',
    });
    expect(failed.status).toBeGreaterThanOrEqual(500);

    // Before the fix, the row committed in createAgent's own transaction survived the
    // later issueKey failure, so this retry got 409 (username taken) instead of
    // actually creating the agent.
    const retried = await agents(asOwner, teamId).post({
      name: 'Retry Me',
      username: 'retry-me',
      kind: 'external',
    });
    expect(retried.status).toBe(201);
    expect(retried.data!.agent.username).toBe('retry-me');

    const list = await agents(asOwner, teamId).get();
    expect(list.data!.filter((a) => a.username === 'retry-me')).toHaveLength(1);
  });

  it('regenerates a key without a gap: the old key survives if issuing the new one fails', async () => {
    const { asOwner, teamId } = await setup();

    const created = await agents(asOwner, teamId).post({
      name: 'Renameable',
      username: 'renameable',
      kind: 'external',
    });
    expect(created.status).toBe(201);
    const agentId = created.data!.agent.id;
    const userId = created.data!.agent.userId;
    // The old key authenticates right now, before touching anything — the baseline
    // the test's real assertion (after the failed regenerate) is compared against.
    expect((await apiKeyApi(created.data!.apiKey!).teams({ teamId }).get()).status).toBe(200);
    const before = await db.select().from(apikey).where(eq(apikey.referenceId, userId));
    expect(before).toHaveLength(1);

    failNextKeyIssue();
    const regenerated = await agents(asOwner, teamId)({ agentId })['regenerate-key'].post();
    expect(regenerated.status).toBeGreaterThanOrEqual(500);

    // The failed regenerate must not have deleted the working key: same row, same
    // secret, still authenticating — never zero keys in between.
    const after = await db.select().from(apikey).where(eq(apikey.referenceId, userId));
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect((await apiKeyApi(created.data!.apiKey!).teams({ teamId }).get()).status).toBe(200);
  });
});
