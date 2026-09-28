import { beforeEach, describe, expect, it } from 'bun:test';
import {
  approvalRequest,
  agentChatMessage,
  db,
  telegramApprovalNotice,
  telegramChannelEvent,
  userTelegramAccount,
  writeSecret,
} from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { bootstrapHomeAgent } from '../../../../scripts/bootstrap-home-agent';
import { enqueueTelegramApproval, processTelegramEvents } from '../../channel';
import { createBot, deliverPending } from '../../../../../../bot/src/bot';

beforeEach(resetDb);

describe('Telegram channel queue', () => {
  it('routes a paired account to Helena by default', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const home = await bootstrapHomeAgent();
    if (home.status !== 'ready') throw new Error('Helena was not provisioned');
    await db.insert(userTelegramAccount).values({
      userId: owner.userId,
      chatId: '777777',
      telegramUserId: '777777',
      linkedAt: new Date(),
    });
    const [event] = await db
      .insert(telegramChannelEvent)
      .values({
        botId: '99',
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
    await db.insert(userTelegramAccount).values({
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
