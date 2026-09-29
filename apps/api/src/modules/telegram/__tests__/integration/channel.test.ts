import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'bun:test';
import {
  approvalRequest,
  agentRun,
  projectMember,
  agentChatThread,
  agentChatMessage,
  db,
  telegramApprovalNotice,
  telegramChannelEvent,
  userTelegramAccount,
  writeSecret,
} from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { bootstrapHomeAgent } from '../../../../scripts/bootstrap-home-agent';
import { enqueueTelegramApproval, processTelegramEvents } from '../../channel';
import { createBot, deliverPending } from '../../../../../../bot/src/bot';
import { queueTelegramDecision, queueTelegramMessage } from '../../../../../../bot/src/db';

beforeEach(resetDb);

describe('Telegram channel queue', () => {
  it('routes a paired account to Helena by default', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const home = await bootstrapHomeAgent();
    if (home.status !== 'ready') throw new Error('Helena was not provisioned');
    const pairingId = randomUUID();
    await db.insert(userTelegramAccount).values({
      pairingId,
      userId: owner.userId,
      chatId: '777777',
      telegramUserId: '777777',
      linkedAt: new Date(),
    });
    const [event] = await db
      .insert(telegramChannelEvent)
      .values({
        botId: '99',
        pairingId,
        updateId: 777777,
        userId: owner.userId,
        kind: 'message',
        text: 'Hello Helena',
      })
      .returning();
    await processTelegramEvents();
    const [stored] = await db
      .select()
      .from(telegramChannelEvent)
      .where(eq(telegramChannelEvent.id, event.id));
    const [answer] = await db
      .select()
      .from(agentChatMessage)
      .where(eq(agentChatMessage.id, stored.answerMessageId!));
    expect(answer.agentId).toBe(home.agentId);
  });

  it('sends paired messages into the selected agent chat and applies authorized approval decisions', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const asOwner = authedApi(owner.cookie);
    await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
    const projectId = (await asOwner.projects.get()).data!.find(
      (project) => project.key === 'MKT',
    )!.id;
    const created = await createAgent(asOwner, 'MKT', {
      name: 'Worker',
      username: 'worker',
      kind: 'external',
      triggerOnMention: true,
    });
    const agentId = created.data!.agent.id;
    const pairingId = randomUUID();
    await db.insert(userTelegramAccount).values({
      pairingId,
      userId: owner.userId,
      chatId: '123456',
      telegramUserId: '123456',
      linkedAt: new Date(),
    });
    const target = await asOwner.telegram.account.target.put({ agentId, projectKey: 'MKT' });
    expect(target.data).toEqual({ agentId, projectId });
    const [message] = await db
      .insert(telegramChannelEvent)
      .values({
        botId: '99',
        pairingId,
        updateId: 1001,
        userId: owner.userId,
        kind: 'message',
        text: 'Hello Worker',
      })
      .returning();
    await processTelegramEvents();
    const [stored] = await db
      .select()
      .from(telegramChannelEvent)
      .where(eq(telegramChannelEvent.id, message.id));
    expect(stored.state).toBe('done');
    expect(stored.answerMessageId).toBeNumber();
    const [answer] = await db
      .select()
      .from(agentChatMessage)
      .where(eq(agentChatMessage.id, stored.answerMessageId!));
    expect(answer.role).toBe('assistant');

    const [approval] = await db
      .insert(approvalRequest)
      .values({ projectId, agentId, kind: 'send', action: 'Send offer', details: 'To customer' })
      .returning();
    await enqueueTelegramApproval(approval.id, [owner.userId]);
    expect(await db.select().from(telegramApprovalNotice)).toHaveLength(0);
    await writeSecret(
      'telegram.bot',
      { enabled: true, botToken: 'fake:token', botUsername: 'helena_test_bot' },
      { enabled: true, hasBotToken: true, botUsername: 'helena_test_bot' },
    );
    await enqueueTelegramApproval(approval.id, [owner.userId]);
    const notices = await db
      .select()
      .from(telegramApprovalNotice)
      .where(eq(telegramApprovalNotice.approvalId, approval.id));
    expect(notices).toHaveLength(1);
    const bot = createBot('fake:token');
    bot.botInfo = {
      id: 99,
      is_bot: true,
      first_name: 'Helena',
      username: 'helena_test_bot',
    } as never;
    const methods: string[] = [];
    bot.api.config.use(async (_next, method) => {
      methods.push(method);
      return { ok: true, result: true } as never;
    });
    await deliverPending(bot);
    expect(methods).toContain('sendMessage');
    await bot.handleUpdate({
      update_id: 1002,
      callback_query: {
        id: 'approval-callback',
        from: { id: 123456, is_bot: false, first_name: 'Owner' },
        chat_instance: 'fake',
        data: `approval:${approval.id}:no`,
        message: {
          message_id: 10,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 123456, type: 'private', first_name: 'Owner' },
          text: 'Approval',
        },
      },
    } as never);
    expect(methods).toContain('answerCallbackQuery');
    const [decision] = await db
      .select()
      .from(telegramChannelEvent)
      .where(eq(telegramChannelEvent.updateId, 1002));
    await processTelegramEvents();
    const [decided] = await db
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, approval.id));
    expect(decided.status).toBe('rejected');
    const [confirmed] = await db
      .select()
      .from(telegramChannelEvent)
      .where(eq(telegramChannelEvent.id, decision.id));
    expect(confirmed.responseText).toBe('Rejected.');
  });
});

async function pairedProject() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  const created = (
    await createAgent(api, 'MKT', { name: 'Worker', username: 'worker', kind: 'external' })
  ).data!;
  const sender = { chatId: '123456', telegramUserId: '123456' };
  await db
    .insert(userTelegramAccount)
    .values({ userId: owner.userId, ...sender, linkedAt: new Date() });
  await api.telegram.account.target.put({ agentId: created.agent.id, projectKey: 'MKT' });
  const [approval] = await db
    .insert(approvalRequest)
    .values({
      projectId: project.id,
      agentId: created.agent.id,
      kind: 'send',
      action: 'Send offer',
    })
    .returning();
  await db.insert(telegramApprovalNotice).values({ approvalId: approval.id, userId: owner.userId });
  return { owner, api, project, agent: created.agent, approval, sender };
}

it('commits one approval and follow-up for concurrent repeated callbacks', async () => {
  const s = await pairedProject();
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      queueTelegramDecision('99', i, s.owner.userId, s.approval.id, true, s.sender),
    ),
  );
  await Promise.all(Array.from({ length: 4 }, () => processTelegramEvents()));
  const [approval] = await db
    .select()
    .from(approvalRequest)
    .where(eq(approvalRequest.id, s.approval.id));
  expect(approval.status).toBe('approved');
  expect(await db.select().from(agentRun)).toHaveLength(1);
  const events = await db.select().from(telegramChannelEvent);
  expect(events).toHaveLength(12);
  expect(events.filter((event) => event.responseText === 'Approved.')).toHaveLength(1);
  expect(
    events.filter((event) => event.responseText === 'Approval was already decided.'),
  ).toHaveLength(11);
});

for (const revoke of ['unlink', 'relink', 'demote'] as const) {
  it(`rejects an already queued approval after ${revoke}`, async () => {
    const s = await pairedProject();
    expect(
      await queueTelegramDecision('99', 1, s.owner.userId, s.approval.id, true, s.sender),
    ).toBe(true);
    if (revoke === 'unlink')
      await db.delete(userTelegramAccount).where(eq(userTelegramAccount.userId, s.owner.userId));
    if (revoke === 'relink')
      await db
        .update(userTelegramAccount)
        .set({
          chatId: '654321',
          telegramUserId: '654321',
          pairingId: randomUUID(),
        })
        .where(eq(userTelegramAccount.userId, s.owner.userId));
    if (revoke === 'demote')
      await db
        .update(projectMember)
        .set({ role: 'member' })
        .where(eq(projectMember.userId, s.owner.userId));
    await processTelegramEvents();
    const [approval] = await db
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, s.approval.id));
    expect(approval.status).toBe('pending');
    expect(await db.select().from(agentRun)).toHaveLength(0);
    const [event] = await db.select().from(telegramChannelEvent);
    expect(event.state).toBe('done');
    expect(event.responseText).not.toBe('Approved.');
  });
}

it('refuses callbacks from paired non-owners, even with a stale notice', async () => {
  const s = await pairedProject();
  await db
    .update(projectMember)
    .set({ role: 'member' })
    .where(eq(projectMember.userId, s.owner.userId));
  expect(await queueTelegramDecision('99', 1, s.owner.userId, s.approval.id, true, s.sender)).toBe(
    false,
  );
  expect(await db.select().from(telegramChannelEvent)).toHaveLength(0);
});

it('stores a replayed message once while multiple processors poll', async () => {
  const s = await pairedProject();
  await Promise.all(
    Array.from({ length: 8 }, () =>
      queueTelegramMessage('99', 1, s.owner.userId, 'Hello', s.sender),
    ),
  );
  await Promise.all(Array.from({ length: 4 }, () => processTelegramEvents()));
  expect(await db.select().from(agentChatMessage)).toHaveLength(2);
  const [event] = await db.select().from(telegramChannelEvent);
  expect(event.state).toBe('done');
  expect(event.answerMessageId).toBeNumber();
});

it('rolls back a chat if saving the queue result fails', async () => {
  const s = await pairedProject();
  await queueTelegramMessage('99', 1, s.owner.userId, 'Hello', s.sender);
  await db.execute(sql`CREATE FUNCTION test_telegram_save_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.answer_message_id IS NOT NULL THEN RAISE EXCEPTION 'Test queue write failed'; END IF; RETURN NEW; END $$`);
  await db.execute(sql`CREATE TRIGGER test_telegram_save_failure BEFORE UPDATE ON telegram_channel_event
    FOR EACH ROW EXECUTE FUNCTION test_telegram_save_failure()`);
  try {
    await processTelegramEvents();
    expect(await db.select().from(agentChatMessage)).toHaveLength(0);
    expect(await db.select().from(agentChatThread)).toHaveLength(0);
    const [account] = await db.select().from(userTelegramAccount);
    expect(account.currentThreadId).toBeNull();
    const [event] = await db.select().from(telegramChannelEvent);
    expect(event.responseText).toBe('Ava could not process this request.');
  } finally {
    await db.execute(sql`DROP TRIGGER test_telegram_save_failure ON telegram_channel_event`);
    await db.execute(sql`DROP FUNCTION test_telegram_save_failure()`);
  }
});

it('does not deliver an old response to a newly paired Telegram identity', async () => {
  const s = await pairedProject();
  await queueTelegramMessage('99', 1, s.owner.userId, 'Hello', s.sender);
  await db.update(telegramChannelEvent).set({ state: 'done', responseText: 'Private reply' });
  await db
    .update(userTelegramAccount)
    .set({ pairingId: randomUUID(), chatId: '999', telegramUserId: '999' });
  await db.delete(telegramApprovalNotice);
  const bot = createBot('fake:token');
  const calls: string[] = [];
  bot.api.config.use(async (_next, method) => {
    calls.push(method);
    return { ok: true, result: true } as never;
  });
  await deliverPending(bot);
  expect(calls).toEqual([]);
});

it('validates Telegram targets before querying integer IDs', async () => {
  const s = await pairedProject();
  for (const agentId of [0, 1.5, 2_147_483_648]) {
    expect((await s.api.telegram.account.target.put({ agentId, projectKey: 'MKT' })).status).toBe(
      400,
    );
  }
  expect(
    (await s.api.telegram.account.target.put({ agentId: s.agent.id, projectKey: '' })).status,
  ).toBe(400);
});
