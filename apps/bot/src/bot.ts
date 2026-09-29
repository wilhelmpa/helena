import { Bot } from 'grammy';
import {
  confirmTelegramLink,
  decideAlertNotice,
  linkedUser,
  markNoticeSent,
  markAlertSent,
  markReplyDelivered,
  pendingApprovalNotices,
  pendingAlertNotices,
  pendingTelegramReplies,
  queueTelegramDecision,
  queueTelegramMessage,
} from './db';

function alertSummary(source: string): string {
  if (source === 'helena.logins') return 'A model login needs attention.';
  if (source === 'helena.security') return 'Security checks need attention.';
  if (source === 'helena.local-ai') return 'A local AI server needs attention.';
  return 'Review Helena for details.';
}

const HELP = 'Connect this bot from Helena settings with a one-time pairing code.';

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private' || !ctx.from) {
      console.warn(`[bot] ignored unpaired /start from Telegram user ${ctx.from?.id ?? 'unknown'}`);
      return;
    }
    const code = ctx.match.trim();
    if (!code) {
      if (await linkedUser(String(ctx.from.id), String(ctx.chat.id))) await ctx.reply(HELP);
      else console.warn(`[bot] ignored unknown Telegram user ${ctx.from.id}`);
      return;
    }
    const result = await confirmTelegramLink({
      code,
      chatId: String(ctx.chat.id),
      telegramUserId: String(ctx.from.id),
      username: ctx.from.username ?? null,
      firstName: ctx.from.first_name ?? null,
    });
    if (result.ok) await ctx.reply('Connected to Helena. Send a message to start a chat.');
    else console.warn(`[bot] ignored invalid pairing from Telegram user ${ctx.from.id}`);
  });

  bot.on('message:text', async (ctx) => {
    if (ctx.chat.type !== 'private' || !ctx.from) {
      console.warn(`[bot] ignored message from Telegram user ${ctx.from?.id ?? 'unknown'}`);
      return;
    }
    const userId = await linkedUser(String(ctx.from.id), String(ctx.chat.id));
    if (!userId) {
      console.warn(`[bot] ignored unknown Telegram user ${ctx.from.id}`);
      return;
    }
    const text = ctx.message.text.trim();
    if (text.length === 0 || text.length > 32_000) return;
    await queueTelegramMessage(String(ctx.me.id), ctx.update.update_id, userId, text, {
      telegramUserId: String(ctx.from.id),
      chatId: String(ctx.chat.id),
    });
  });

  bot.on('message', (ctx) => {
    console.warn(
      `[bot] ignored unsupported message from Telegram user ${ctx.from?.id ?? 'unknown'}`,
    );
  });

  bot.on('callback_query:data', async (ctx) => {
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (!chatId || ctx.callbackQuery.message?.chat.type !== 'private') return;
    const userId = await linkedUser(String(ctx.from.id), String(chatId));
    if (!userId) {
      console.warn(`[bot] ignored unknown Telegram user ${ctx.from.id}`);
      return;
    }
    const alert = /^alert:(\d+):(ack|dismiss)$/.exec(ctx.callbackQuery.data);
    if (alert) {
      const decided = await decideAlertNotice(Number(alert[1]), userId, alert[2] === 'ack');
      await ctx.answerCallbackQuery({
        text: decided ? 'Response saved.' : 'Alert is unavailable.',
      });
      return;
    }
    const match = /^approval:(\d+):(yes|no)$/.exec(ctx.callbackQuery.data);
    if (!match) return;
    const queued = await queueTelegramDecision(
      String(ctx.me.id),
      ctx.update.update_id,
      userId,
      Number(match[1]),
      match[2] === 'yes',
      { telegramUserId: String(ctx.from.id), chatId: String(chatId) },
    );
    await ctx.answerCallbackQuery({
      text: queued ? 'Decision received.' : 'Approval is unavailable.',
    });
  });

  bot.catch(() => {
    console.error('[bot] update failed');
  });
  return bot;
}

export function approvalTextChunks(text: string): string[] {
  const characters = Array.from(text);
  const chunks: string[] = [];
  for (let offset = 0; offset < characters.length; offset += 1750) {
    chunks.push(characters.slice(offset, offset + 1750).join(''));
  }
  return chunks;
}

export async function deliverPending(bot: Bot): Promise<void> {
  for (const notice of await pendingApprovalNotices()) {
    try {
      if (!notice.chatId) continue;
      const chunks = approvalTextChunks(
        `Approval #${notice.approvalId}: ${notice.action}\n${notice.details}`,
      );
      for (const [index, text] of chunks.entries())
        await bot.api.sendMessage(
          notice.chatId,
          text,
          index === chunks.length - 1
            ? {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: 'Approve', callback_data: `approval:${notice.approvalId}:yes` },
                      { text: 'Reject', callback_data: `approval:${notice.approvalId}:no` },
                    ],
                  ],
                },
              }
            : undefined,
        );
      await markNoticeSent(notice.id);
    } catch {
      console.error('[bot] delivery failed');
    }
  }
  for (const alert of await pendingAlertNotices()) {
    try {
      if (!alert.chatId) continue;
      await bot.api.sendMessage(
        alert.chatId,
        `Helena needs you: ${alertSummary(alert.source)}`.slice(0, 4000),
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Acknowledge', callback_data: `alert:${alert.id}:ack` },
                { text: 'Dismiss', callback_data: `alert:${alert.id}:dismiss` },
              ],
            ],
          },
        },
      );
      await markAlertSent(alert.id);
    } catch {
      console.error('[bot] delivery failed');
    }
  }
  for (const reply of await pendingTelegramReplies()) {
    try {
      if (!reply.chatId) continue;
      if (
        reply.answerStatus &&
        reply.answerStatus !== 'success' &&
        reply.answerStatus !== 'failed' &&
        reply.answerStatus !== 'canceled'
      )
        continue;
      const text =
        reply.responseText ??
        (reply.answerStatus === 'failed' || reply.answerStatus === 'canceled'
          ? 'Helena could not answer this message.'
          : reply.content);
      if (!text) continue;
      for (let offset = 0; offset < text.length; offset += 3500) {
        await bot.api.sendMessage(reply.chatId, text.slice(offset, offset + 3500));
      }
      await markReplyDelivered(reply.eventId);
    } catch {
      console.error('[bot] delivery failed');
    }
  }
}
