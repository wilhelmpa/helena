import { describe, it, expect, beforeEach } from 'bun:test';
import { db, agentChatThread } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { recordContextUsage } from '../../../chat-usage';
import { createAgent } from '#tests/helpers/agents';

// The chat-history endpoints under a project:
//   GET    /projects/:key/ai-agents/:agentId/threads                  — the caller's own
//                                                                       chats with the agent
//   GET    .../ai-agents/:agentId/threads/:threadId/messages          — one chat's transcript
//   PATCH  .../ai-agents/:agentId/threads/:threadId                   — rename one chat
//   DELETE .../ai-agents/:agentId/threads/:threadId                   — delete one chat
//
// The chats are rows of agent_chat_thread, seeded directly here so the list, its pages
// and its scoping are tested without a runner. What a runner writes into a chat is
// covered by the agent chat tests.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  return { owner, asOwner };
}

const agents = (api: Api) => api.projects({ projectKey: 'MKT' })['ai-agents'];

async function createTestAgent(asOwner: Api, name: string, username: string) {
  const res = await createAgent(asOwner, 'MKT', { name, username });
  return res.data!.agent;
}

// Seeds a chat of userId with the agent. Each one is stamped a minute before the next
// by its index, so the newest-first order is the only one the list may return.
async function seedThread(
  threadId: string,
  userId: string,
  agent: { id: number; projects: { id: number }[] },
  title: string,
  minutesAgo = 0,
) {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  await db.insert(agentChatThread).values({
    id: threadId,
    agentId: agent.id,
    userId,
    projectId: agent.projects[0].id,
    title,
    createdAt: at,
    updatedAt: at,
  });
}

async function threadExists(threadId: string): Promise<boolean> {
  const rows = await db
    .select({ id: agentChatThread.id })
    .from(agentChatThread)
    .where(eq(agentChatThread.id, threadId));
  return rows.length > 0;
}

describe('agent chat history', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('returns an empty list for an agent with no threads', async () => {
    const { asOwner } = await setup();
    const agent = await createTestAgent(asOwner, 'Design Bot', 'design');

    const res = await agents(asOwner)({ agentId: agent.id }).threads.get();
    expect(res.status).toBe(200);
    expect(res.data!.items).toEqual([]);
  });

  it("lists the caller's threads for the agent, newest first, with the title", async () => {
    const { owner, asOwner } = await setup();
    const agent = await createTestAgent(asOwner, 'Design Bot', 'design');
    await seedThread('t-old', owner.userId, agent, 'older question', 1);
    await seedThread('t-new', owner.userId, agent, 'newer question');

    const res = await agents(asOwner)({ agentId: agent.id }).threads.get();
    expect(res.status).toBe(200);
    expect(res.data!.items.map((t) => t.id)).toEqual(['t-new', 't-old']);
    expect(res.data!.items[0]).toMatchObject({ id: 't-new', title: 'newer question' });
  });

  it('scopes threads to the requesting user', async () => {
    const { owner, asOwner } = await setup();
    const other = await signUpTestUser({ name: 'Other' });
    const agent = await createTestAgent(asOwner, 'Design Bot', 'design');
    await seedThread('mine', owner.userId, agent, 'mine');
    await seedThread('theirs', other.userId, agent, 'theirs');

    const res = await agents(asOwner)({ agentId: agent.id }).threads.get();
    expect(res.data!.items.map((t) => t.id)).toEqual(['mine']);
  });

  it('hands out the threads a page at a time, newest first', async () => {
    const { owner, asOwner } = await setup();
    const agent = await createTestAgent(asOwner, 'Design Bot', 'design');
    // One more than a page holds, so the last one falls onto the second page.
    for (let i = 0; i < 26; i++) {
      await seedThread(`t-${i}`, owner.userId, agent, `question ${i}`, i);
    }

    const first = await agents(asOwner)({ agentId: agent.id }).threads.get();
    expect(first.data!.items).toHaveLength(25);
    expect(first.data!.nextPage).toBe(1);

    const second = await agents(asOwner)({ agentId: agent.id }).threads.get({ query: { page: 1 } });
    expect(second.data!.items.map((t) => t.id)).toEqual(['t-25']);
    expect(second.data!.nextPage).toBeNull();
  });

  it('scopes threads to the requested agent', async () => {
    const { owner, asOwner } = await setup();
    const a = await createTestAgent(asOwner, 'Bot A', 'bota');
    const b = await createTestAgent(asOwner, 'Bot B', 'botb');
    await seedThread('for-a', owner.userId, a, 'for a');

    const res = await agents(asOwner)({ agentId: b.id }).threads.get();
    expect(res.data!.items).toEqual([]);
    const resA = await agents(asOwner)({ agentId: a.id }).threads.get();
    expect(resA.data!.items.map((t) => t.id)).toEqual(['for-a']);
  });

  it('404s the thread list for an agent that does not exist', async () => {
    const { asOwner } = await setup();
    const res = await agents(asOwner)({ agentId: 999999 }).threads.get();
    expect(res.status).toBe(404);
  });

  it('400s the thread list for a non-numeric agent id', async () => {
    const { asOwner } = await setup();
    const res = await agents(asOwner)({ agentId: 'abc' }).threads.get();
    expect(res.status).toBe(400);
  });

  it('denies a non-member the thread list with 403', async () => {
    const { asOwner } = await setup();
    const agent = await createTestAgent(asOwner, 'Design Bot', 'design');
    const outsider = await signUpTestUser({ name: 'Outsider' });

    const res = await agents(authedApi(outsider.cookie))({ agentId: agent.id }).threads.get();
    expect(res.status).toBe(403);
  });

  it('returns an empty transcript for an owned thread with no messages', async () => {
    const { owner, asOwner } = await setup();
    const agent = await createTestAgent(asOwner, 'Design Bot', 'design');
    await seedThread('empty', owner.userId, agent, 'nothing yet');

    const res = await agents(asOwner)({ agentId: agent.id })
      .threads({ threadId: 'empty' })
      .messages.get();
    expect(res.status).toBe(200);
    expect(res.data!.items).toEqual([]);
  });

  it('404s a thread that does not exist', async () => {
    const { asOwner } = await setup();
    const agent = await createTestAgent(asOwner, 'Design Bot', 'design');

    const res = await agents(asOwner)({ agentId: agent.id })
      .threads({ threadId: 'nope' })
      .messages.get();
    expect(res.status).toBe(404);
  });

  it('404s a thread owned by another user (no cross-user read)', async () => {
    const { asOwner } = await setup();
    const other = await signUpTestUser({ name: 'Other' });
    const agent = await createTestAgent(asOwner, 'Design Bot', 'design');
    await seedThread('theirs', other.userId, agent, 'theirs');

    const res = await agents(asOwner)({ agentId: agent.id })
      .threads({ threadId: 'theirs' })
      .messages.get();
    expect(res.status).toBe(404);
  });

  it("renames the caller's thread", async () => {
    const { owner, asOwner } = await setup();
    const agent = await createTestAgent(asOwner, 'Design Bot', 'design');
    await seedThread('mine', owner.userId, agent, 'first question');

    const res = await agents(asOwner)({ agentId: agent.id })
      .threads({ threadId: 'mine' })
      .patch({ title: 'Launch plan' });
    expect(res.status).toBe(204);
    const list = await agents(asOwner)({ agentId: agent.id }).threads.get();
    expect(list.data!.items[0]).toMatchObject({ id: 'mine', title: 'Launch plan' });
  });

  it("404s renaming another user's thread", async () => {
    const { asOwner } = await setup();
    const other = await signUpTestUser({ name: 'Other' });
    const agent = await createTestAgent(asOwner, 'Design Bot', 'design');
    await seedThread('theirs', other.userId, agent, 'theirs');

    const res = await agents(asOwner)({ agentId: agent.id })
      .threads({ threadId: 'theirs' })
      .patch({ title: 'Mine now' });
    expect(res.status).toBe(404);
  });

  it('404s deleting a thread that does not exist', async () => {
    const { asOwner } = await setup();
    const agent = await createTestAgent(asOwner, 'Design Bot', 'design');

    const res = await agents(asOwner)({ agentId: agent.id }).threads({ threadId: 'nope' }).delete();
    expect(res.status).toBe(404);
  });

  it('denies a non-member the delete with 403', async () => {
    const { owner, asOwner } = await setup();
    const agent = await createTestAgent(asOwner, 'Design Bot', 'design');
    await seedThread('mine', owner.userId, agent, 'mine');
    const outsider = await signUpTestUser({ name: 'Outsider' });

    const res = await agents(authedApi(outsider.cookie))({ agentId: agent.id })
      .threads({ threadId: 'mine' })
      .delete();
    expect(res.status).toBe(403);
    expect(await threadExists('mine')).toBe(true);
  });

  // The context size is written when the runner closes an answer; it is recorded here
  // the way that does and read back through the thread list.
  it('shows the context size an answer recorded, and drops it with the thread', async () => {
    const { owner, asOwner } = await setup();
    const agent = await createTestAgent(asOwner, 'Design Bot', 'design');
    await seedThread('sized', owner.userId, agent, 'sized');
    await recordContextUsage('sized', agent.id, { inputTokens: 1200, outputTokens: 80 });

    const list = await agents(asOwner)({ agentId: agent.id }).threads.get();
    expect(list.data!.items[0]).toMatchObject({ id: 'sized', contextTokens: 1280 });

    await agents(asOwner)({ agentId: agent.id }).threads({ threadId: 'sized' }).delete();
    expect(await threadExists('sized')).toBe(false);
    await seedThread('sized', owner.userId, agent, 'sized again');
    const again = await agents(asOwner)({ agentId: agent.id }).threads.get();
    expect(again.data!.items[0]).not.toHaveProperty('contextTokens');
  });
});
