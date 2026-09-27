import { beforeEach, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { agentChatThread, db } from '@repo/db';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';

process.env.AGENT_CHAT_CLAIM_WAIT_MS = '50';
process.env.AGENT_CHAT_CLAIM_POLL_MS = '10';
beforeEach(resetDb);

it('preserves the current owner JEV policy and revision when a pre-change batch is replayed', async () => {
  const owner = await signUpTestUser({ name: 'Recovery owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'REC', name: 'Recovery' });
  const created = await createAgent(asOwner, 'REC', {
    name: 'Recovery agent',
    username: 'recovery',
    kind: 'external',
  });
  const runner = apiKeyApi(created.data!.apiKey!);
  const sent = (
    await asOwner
      .projects({ projectKey: 'REC' })
      ['ai-agents']({
        agentId: created.data!.agent.id,
      })
      .chat.post({ prompt: 'Synthetic recovery' })
  ).data!;
  const claimed = (await runner['agent-chats'].claim.post()).data!.message!;
  const api = runner['agent-chats']({ messageId: claimed.id });
  const batch = {
    delivery: { claim: claimed.attempts, offset: 0 },
    sessionId: 'synthetic-session',
    events: [{ type: 'TEXT_MESSAGE_CONTENT' as const, messageId: 'm', delta: 'Once' }],
  };
  expect((await api.events.post(batch)).status).toBe(200);
  expect(
    (await asOwner.chats({ threadId: sent.threadId }).patch({ jevFirstStage: 'off' })).status,
  ).toBe(204);
  const [policy] = await db
    .select()
    .from(agentChatThread)
    .where(eq(agentChatThread.id, sent.threadId));
  expect((await api.events.post(batch)).status).toBe(200);
  expect(
    (await api.result.post({ status: 'success' }, { query: { claim: claimed.attempts } })).status,
  ).toBe(204);
  const [after] = await db
    .select()
    .from(agentChatThread)
    .where(eq(agentChatThread.id, sent.threadId));
  expect(after?.jevFirstStage).toBe('off');
  expect(after?.jevFirstStageRevision).toBe(policy?.jevFirstStageRevision);
});
