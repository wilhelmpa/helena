import { beforeEach, describe, expect, it } from 'bun:test';
import { apikey, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// createAgent issues the agent's API key outside the row's own transaction (better-auth
// writes it through its own connection), and better-auth's apiKey plugin rejects a name
// over 32 characters. Both paths below make that failure land cleanly instead of
// leaving the agent half set up.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const project = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  return { asOwner, teamId: project.data!.teamId };
}

const agents = (api: Api, teamId: number) => api.teams({ teamId })['ai-agents'];

// "agent:" (6) + this name (27) = 33, one over better-auth's default 32-character
// maximumNameLength — chosen to fail regardless of whether hub/fix-agent-key-names'
// truncation has landed in this branch yet (it truncates to well under 32, so a name
// this long only fails while that fix is absent, which is the state this branch is in;
// once merged this test should be revisited, see the report).
const TOO_LONG_NAME = 'A'.repeat(27);

describe('agent API key issuance', () => {
  beforeEach(resetDb);

  it('cleans up a half-created agent when issuing its key fails, so retrying the same username works', async () => {
    const { asOwner, teamId } = await setup();

    const failed = await agents(asOwner, teamId).post({
      name: TOO_LONG_NAME,
      username: 'retry-me',
      kind: 'external',
    });
    expect(failed.status).toBeGreaterThanOrEqual(400);

    // Before the fix, the row committed in createAgent's own transaction survived the
    // later issueKey failure, so this retry got 409 (username taken) instead of ever
    // reaching a real error.
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

    // Rename the agent past the length that would fail key issuance, then regenerate.
    const renamed = await agents(asOwner, teamId)({ agentId }).patch({ name: TOO_LONG_NAME });
    expect(renamed.status).toBe(200);
    const regenerated = await agents(asOwner, teamId)({ agentId })['regenerate-key'].post();
    expect(regenerated.status).toBeGreaterThanOrEqual(400);

    // The failed regenerate must not have deleted the working key: same row, same
    // secret, still authenticating — never zero keys in between.
    const after = await db.select().from(apikey).where(eq(apikey.referenceId, userId));
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect((await apiKeyApi(created.data!.apiKey!).teams({ teamId }).get()).status).toBe(200);
  });
});
