import { beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { aiAgent, db, teamMember } from '@repo/db';
import { eq } from 'drizzle-orm';

import { signUpTestUser } from '#tests/helpers/auth';
import { authedApi } from '#tests/helpers/app';
import { resetDb } from '#tests/helpers/db';
import type { AgentRuntimePolicy } from '#modules/agents/core/service';

import { bootstrapHomeAgent, HOME_AGENT_SOUL } from './bootstrap-home-agent';

describe('Home agent bootstrap', () => {
  beforeEach(resetDb);

  it('waits while the fresh installation has no owner', async () => {
    expect(await bootstrapHomeAgent()).toEqual({ status: 'pending' });
  });

  it('creates one owner-scoped external Home agent and rotates only its key on retry', async () => {
    const owner = await signUpTestUser({ name: 'Patrick' });

    const first = await bootstrapHomeAgent();
    expect(first.status).toBe('ready');

    const rowsAfterFirst = await db.select().from(aiAgent);
    expect(rowsAfterFirst).toHaveLength(1);
    expect(rowsAfterFirst[0]).toMatchObject({
      username: 'master',
      kind: 'external',
      ownerUserId: owner.userId,
      runnerScope: 'owner',
      memoryEnabled: true,
      memoryLastMessages: 50,
      triggerOnMention: true,
      triggerOnAssign: false,
    });
    expect((rowsAfterFirst[0]!.runtimePolicy as AgentRuntimePolicy).files).toEqual([
      { kind: 'instructions', path: 'SOUL.md', content: HOME_AGENT_SOUL },
    ]);
    expect(createHash('sha256').update(HOME_AGENT_SOUL).digest('hex')).toBe(
      '36c1f5a2e92cd1d018311eaf4c8f1e8886672eae78212e033c681d0e3d5d506f',
    );

    const customizedPolicy: AgentRuntimePolicy = {
      ...(rowsAfterFirst[0]!.runtimePolicy as AgentRuntimePolicy),
      files: [{ kind: 'instructions' as const, path: 'SOUL.md', content: '# My own persona' }],
    };
    await db
      .update(aiAgent)
      .set({ runtimePolicy: customizedPolicy })
      .where(eq(aiAgent.id, first.status === 'ready' ? first.agentId : -1));

    const second = await bootstrapHomeAgent();
    expect(second.status).toBe('ready');
    if (first.status === 'ready' && second.status === 'ready') {
      expect(second.agentId).toBe(first.agentId);
      expect(second.apiKey).not.toBe(first.apiKey);
    }

    expect(await db.$count(aiAgent, eq(aiAgent.username, 'master'))).toBe(1);
    const [afterRetry] = await db.select().from(aiAgent).where(eq(aiAgent.username, 'master'));
    expect(afterRetry!.runtimePolicy).toEqual(customizedPolicy);
  });

  it('serves the Home chat directly from the team without creating a project', async () => {
    const owner = await signUpTestUser({ name: 'Patrick' });
    const result = await bootstrapHomeAgent();
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Home agent was not provisioned');

    const [membership] = await db
      .select({ teamId: teamMember.teamId })
      .from(teamMember)
      .where(eq(teamMember.userId, owner.userId))
      .limit(1);
    const home = authedApi(owner.cookie)
      .teams({ teamId: membership!.teamId })
      ['ai-agents']({ agentId: result.agentId });

    const sent = await home.chat.post({ prompt: 'Richte mein System ein' });
    expect(sent.status).toBe(200);
    const threads = await home.threads.get();
    expect(threads.status).toBe(200);
    expect(threads.data?.items).toHaveLength(1);
    expect(threads.data?.items[0]?.title).toBe('Richte mein System ein');
  });
});
