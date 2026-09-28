import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  db,
  helenaAlert,
  telegramAlertNotice,
  telegramChannelEvent,
  user,
  userTelegramAccount,
} from '@repo/db';
import { eq } from 'drizzle-orm';
import { createBot, deliverPending } from './bot';

function fakeBot() {
  const bot = createBot('fake:token');
  bot.botInfo = {
    id: 99,
    is_bot: true,
    first_name: 'Helena',
    username: 'helena_test_bot',
  } as never;
  const calls: string[] = [];
  bot.api.config.use(async (_next, method) => {
    calls.push(method);
    return { ok: true, result: true } as never;
  });
  return { bot, calls };
}

function textUpdate(updateId: number, telegramId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: telegramId, type: 'private', first_name: 'Tester' },
      from: { id: telegramId, is_bot: false, first_name: 'Tester' },
      text,
    },
  } as never;
}

describe('Telegram channel with fake Bot API', () => {
  it('ignores unknown senders and queues paired private messages once', async () => {
    const { bot, calls } = fakeBot();
    const telegramId = Math.floor(Math.random() * 1_000_000_000);
    const unknownUpdate = Math.floor(Math.random() * 1_000_000_000);
    await bot.handleUpdate(textUpdate(unknownUpdate, telegramId, 'unknown'));
    const [unknown] = await db
      .select()
      .from(telegramChannelEvent)
      .where(eq(telegramChannelEvent.updateId, unknownUpdate));
    expect(unknown).toBeUndefined();

    const userId = randomUUID();
    await db.insert(user).values({ id: userId, name: 'Tester', email: `${userId}@example.test` });
    await db.insert(userTelegramAccount).values({
      userId,
      chatId: String(telegramId),
      telegramUserId: String(telegramId),
      linkedAt: new Date(),
    });
    const updateId = unknownUpdate + 1;
    await bot.handleUpdate(textUpdate(updateId, telegramId, 'Hello Helena'));
    await bot.handleUpdate(textUpdate(updateId, telegramId, 'Hello Helena'));
    const rows = await db
      .select()
      .from(telegramChannelEvent)
      .where(eq(telegramChannelEvent.updateId, updateId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId, kind: 'message', text: 'Hello Helena' });
    expect(calls).toEqual([]);
    const [reply] = await db
      .insert(telegramChannelEvent)
      .values({
        botId: '99',
        updateId: updateId + 1,
        userId,
        kind: 'message',
        state: 'done',
        responseText: 'Hello from Helena',
      })
      .returning();
    await deliverPending(bot);
    expect(calls).toContain('sendMessage');
    const [delivered] = await db
      .select()
      .from(telegramChannelEvent)
      .where(eq(telegramChannelEvent.id, reply.id));
    expect(delivered.deliveredAt).toBeInstanceOf(Date);
    await db.update(user).set({ role: 'god' }).where(eq(user.id, userId));
    const alertKey = `helena.security|${userId}`;
    await db.insert(helenaAlert).values({
      key: alertKey,
      source: 'helena.security',
      category: 'needs-you',
      subject: 'Security',
      text: 'Review checks',
      notifiedAt: new Date(),
    });
    await deliverPending(bot);
    const [alert] = await db
      .select()
      .from(telegramAlertNotice)
      .where(eq(telegramAlertNotice.alertKey, alertKey));
    expect(alert.sentAt).toBeInstanceOf(Date);
    await bot.handleUpdate({
      update_id: updateId + 2,
      callback_query: {
        id: 'callback-1',
        from: { id: telegramId, is_bot: false, first_name: 'Tester' },
        chat_instance: 'fake',
        data: `alert:${alert.id}:ack`,
        message: {
          message_id: 5,
          date: Math.floor(Date.now() / 1000),
          chat: { id: telegramId, type: 'private', first_name: 'Tester' },
          text: 'Alert',
        },
      },
    } as never);
    const [acknowledged] = await db
      .select()
      .from(telegramAlertNotice)
      .where(eq(telegramAlertNotice.id, alert.id));
    expect(acknowledged.status).toBe('acknowledged');
    expect(calls).toContain('answerCallbackQuery');
    await bot.handleUpdate({
      update_id: updateId + 3,
      callback_query: {
        id: 'forged-approval',
        from: { id: telegramId, is_bot: false, first_name: 'Tester' },
        chat_instance: 'fake',
        data: 'approval:999999:no',
        message: {
          message_id: 6,
          date: Math.floor(Date.now() / 1000),
          chat: { id: telegramId, type: 'private', first_name: 'Tester' },
          text: 'Approval',
        },
      },
    } as never);
    const forged = await db
      .select()
      .from(telegramChannelEvent)
      .where(eq(telegramChannelEvent.updateId, updateId + 3));
    expect(forged).toHaveLength(0);
    await db.delete(helenaAlert).where(eq(helenaAlert.key, alertKey));
    await db.delete(user).where(eq(user.id, userId));
  });
});
