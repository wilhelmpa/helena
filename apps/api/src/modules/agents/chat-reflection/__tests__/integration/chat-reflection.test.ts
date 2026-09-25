import { beforeEach, describe, expect, it } from 'bun:test';
import { agentUsage, aiAgent, db, helenaChatReflection } from '@repo/db';
import { eq } from 'drizzle-orm';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent, teamOf } from '#tests/helpers/agents';

// Learning from chats (docs/helena-decisions/agent-context.md §5): the reflection a chat's
// answers queue, how a runner takes it, and that it never shares the chat's session with an
// answer.
process.env.AGENT_CHAT_CLAIM_WAIT_MS = '50';
process.env.AGENT_CHAT_CLAIM_POLL_MS = '10';

async function setup(policy: Record<string, unknown> = {}) {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Mia',
    username: 'mia',
    kind: 'external',
  });
  const agent = created.data!.agent;
  if (Object.keys(policy).length > 0) {
    await db.update(aiAgent).set({ runtimePolicy: policy }).where(eq(aiAgent.id, agent.id));
  }
  return { asOwner, agent, asRunner: apiKeyApi(created.data!.apiKey!) };
}

const chat = (api: Api, agentId: number) =>
  api.projects({ projectKey: 'MKT' })['ai-agents']({ agentId }).chat;

async function answer(asRunner: Api, text: string) {
  const claimed = (await asRunner['agent-chats'].claim.post()).data!.message!;
  await asRunner['agent-chats']({ messageId: claimed.id }).events.post({
    events: [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: text }],
    sessionId: 'session-1',
  });
  await asRunner['agent-chats']({ messageId: claimed.id }).result.post({ status: 'success' });
  return claimed;
}

// A conversation of `turns` questions, each answered.
async function converse(asOwner: Api, asRunner: Api, agentId: number, turns: number) {
  let threadId: string | undefined;
  let last = 0;
  for (let turn = 1; turn <= turns; turn++) {
    const sent = await chat(asOwner, agentId).post(
      threadId ? { prompt: `Question ${turn}`, threadId } : { prompt: `Question ${turn}` },
    );
    threadId = sent.data!.threadId;
    last = (await answer(asRunner, `Answer ${turn}`)).id;
  }
  return { threadId: threadId!, last };
}

async function waiting(threadId: string) {
  return db.select().from(helenaChatReflection).where(eq(helenaChatReflection.threadId, threadId));
}

async function makeDue(threadId: string) {
  await db
    .update(helenaChatReflection)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) })
    .where(eq(helenaChatReflection.threadId, threadId));
}

describe('chat reflection', () => {
  beforeEach(resetDb);

  it('queues a reflection for when the chat goes quiet, and not after a single question', async () => {
    const { asOwner, asRunner, agent } = await setup();
    const single = await converse(asOwner, asRunner, agent.id, 1);
    expect(await waiting(single.threadId)).toEqual([]);

    const started = Date.now();
    const { threadId, last } = await converse(asOwner, asRunner, agent.id, 2);
    const [queued] = await waiting(threadId);
    expect(queued).toMatchObject({
      status: 'pending',
      reason: 'idle',
      turns: 2,
      uptoMessageId: last,
    });
    const due = queued!.nextAttemptAt.getTime() - started;
    expect(due).toBeGreaterThan(9 * 60_000);
    expect(due).toBeLessThan(11 * 60_000);
    expect((await asRunner['agent-chat-reflections'].claim.post()).data).toEqual({
      reflection: null,
    });
  });

  it('hands a due reflection out with the chat session, holds the chat meanwhile and records it', async () => {
    const { asOwner, asRunner, agent } = await setup();
    const { threadId, last } = await converse(asOwner, asRunner, agent.id, 2);
    await makeDue(threadId);

    const claimed = (await asRunner['agent-chat-reflections'].claim.post()).data!.reflection!;
    expect(claimed).toMatchObject({ threadId, sessionId: 'session-1', messageId: last });
    expect(claimed.prompt).toContain('Only your memory and skill tools are available now');

    // The next question waits until the reflection is back.
    await chat(asOwner, agent.id).post({ prompt: 'One more thing', threadId });
    expect((await asRunner['agent-chats'].claim.post()).data!.message).toBeNull();

    const reported = await asRunner['agent-chat-reflections']({ id: claimed.id }).result.post(
      {
        status: 'success',
        saved: [{ tool: 'memory', action: 'add', target: 'user' }],
        summary: 'Saved: prefers German answers.',
        usage: { inputTokens: 1200, outputTokens: 80 },
        spend: { runtime: 'hermes', inputTokens: 1200, outputTokens: 80 },
      },
      { query: { claim: claimed.claim } },
    );
    expect(reported.status).toBe(204);
    const [done] = await waiting(threadId);
    expect(done).toMatchObject({ status: 'success', inputTokens: 1200, outputTokens: 80 });
    const usage = await db.select().from(agentUsage).where(eq(agentUsage.agentId, agent.id));
    expect(usage.some((entry) => entry.kind === 'reflection')).toBe(true);

    // Reported once only; the chat goes on.
    const again = await asRunner['agent-chat-reflections']({ id: claimed.id }).result.post(
      { status: 'success', saved: [] },
      { query: { claim: claimed.claim } },
    );
    expect(again.status).toBe(404);
    expect((await asRunner['agent-chats'].claim.post()).data!.message).not.toBeNull();

    const listed = await asOwner
      .teams({ teamId: await teamOf(asOwner, 'MKT') })
      ['ai-agents']({ agentId: agent.id })
      ['chat-reflections'].get();
    expect(listed.data).toMatchObject([{ status: 'success', turns: 2, reason: 'idle' }]);
  });

  it('is not handed out while an answer of the chat waits', async () => {
    const { asOwner, asRunner, agent } = await setup();
    const { threadId } = await converse(asOwner, asRunner, agent.id, 2);
    await makeDue(threadId);
    await chat(asOwner, agent.id).post({ prompt: 'Still there?', threadId });
    expect((await asRunner['agent-chat-reflections'].claim.post()).data).toEqual({
      reflection: null,
    });
  });

  it('runs at once after many turns', async () => {
    const { asOwner, asRunner, agent } = await setup({ chatReflectionEveryTurns: 3 });
    const { threadId } = await converse(asOwner, asRunner, agent.id, 3);
    const [queued] = await waiting(threadId);
    expect(queued?.reason).toBe('turns');
    expect((await asRunner['agent-chat-reflections'].claim.post()).data!.reflection).not.toBeNull();
  });

  it('queues nothing for an agent that does not learn or turned it off', async () => {
    for (const policy of [{ learning: false }, { chatReflection: false }]) {
      await resetDb();
      const { asOwner, asRunner, agent } = await setup(policy);
      const { threadId } = await converse(asOwner, asRunner, agent.id, 2);
      expect(await waiting(threadId)).toEqual([]);
    }
  });
});
