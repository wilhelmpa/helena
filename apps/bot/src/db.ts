import { randomUUID } from 'node:crypto';
import { and, eq, gt, ne, isNull, isNotNull, inArray, or, asc, sql } from 'drizzle-orm';
import {
  db,
  projectMember,
  user,
  userTelegramAccount,
  telegramChannelEvent,
  telegramApprovalNotice,
  telegramAlertNotice,
  helenaAlert,
  approvalRequest,
  agentChatMessage,
} from '@repo/db';

// The account links the bot redeems. The instance bot settings it polls are read
// through @repo/db, which the api writes them with.

export interface ConfirmLinkInput {
  code: string;
  chatId: string;
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
}

export type ConfirmLinkResult =
  { ok: true; userId: string } | { ok: false; reason: 'invalid' | 'taken' };

// Completes a link: matches the code the api minted, then writes the chat id onto that
// user's row and clears the code so it cannot be replayed. 'invalid' covers an
// unknown, already-used, or expired code — the user is told to start again either
// way. 'taken' means this Telegram account is already linked to someone else.
export async function confirmTelegramLink(input: ConfirmLinkInput): Promise<ConfirmLinkResult> {
  if (!/^[1-9][0-9]*$/.test(input.telegramUserId) || input.chatId !== input.telegramUserId)
    return { ok: false, reason: 'invalid' };
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram-pair:${input.telegramUserId}`}, 0))`,
    );
    const rows = await tx
      .select({ userId: userTelegramAccount.userId })
      .from(userTelegramAccount)
      .where(
        and(
          eq(userTelegramAccount.linkCode, input.code),
          gt(userTelegramAccount.linkCodeExpiresAt, new Date()),
        ),
      );
    const pending = rows[0];
    if (!pending) return { ok: false, reason: 'invalid' };

    const conflict = await tx
      .select({ userId: userTelegramAccount.userId })
      .from(userTelegramAccount)
      .where(
        and(
          eq(userTelegramAccount.telegramUserId, input.telegramUserId),
          ne(userTelegramAccount.userId, pending.userId),
        ),
      );
    if (conflict.length > 0) return { ok: false, reason: 'taken' };

    const linked = await tx
      .update(userTelegramAccount)
      .set({
        chatId: input.chatId,
        telegramUserId: input.telegramUserId,
        pairingId: randomUUID(),
        currentThreadId: null,
        username: input.username,
        firstName: input.firstName,
        linkedAt: new Date(),
        linkCode: null,
        linkCodeExpiresAt: null,
      })
      .where(
        and(
          eq(userTelegramAccount.userId, pending.userId),
          eq(userTelegramAccount.linkCode, input.code),
          gt(userTelegramAccount.linkCodeExpiresAt, new Date()),
        ),
      )
      .returning({ userId: userTelegramAccount.userId });
    return linked[0] ? { ok: true, userId: linked[0].userId } : { ok: false, reason: 'invalid' };
  });
}

export async function linkedUser(telegramUserId: string, chatId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: userTelegramAccount.userId })
    .from(userTelegramAccount)
    .where(
      and(
        eq(userTelegramAccount.telegramUserId, telegramUserId),
        eq(userTelegramAccount.chatId, chatId),
      ),
    );
  return row?.userId ?? null;
}

interface Sender {
  telegramUserId: string;
  chatId: string;
}

export async function queueTelegramMessage(
  botId: string,
  updateId: number,
  userId: string,
  message: string,
  sender: Sender,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO telegram_channel_event (bot_id, update_id, user_id, kind, text, pairing_id)
    SELECT ${botId}, ${updateId}, user_id, 'message', ${message}, pairing_id
    FROM user_telegram_account
    WHERE user_id = ${userId} AND telegram_user_id = ${sender.telegramUserId}
      AND chat_id = ${sender.chatId} AND linked_at IS NOT NULL
    ON CONFLICT (bot_id, update_id) DO NOTHING
  `);
}

export async function queueTelegramDecision(
  botId: string,
  updateId: number,
  userId: string,
  approvalId: number,
  approved: boolean,
  sender: Sender,
): Promise<boolean> {
  const rows = await db.execute(sql`
    INSERT INTO telegram_channel_event (bot_id, update_id, user_id, kind, approval_id, approved, pairing_id)
    SELECT ${botId}, ${updateId}, t.user_id, 'decision', a.id, ${approved}, t.pairing_id
    FROM telegram_approval_notice n
    JOIN approval_request a ON a.id = n.approval_id AND a.status = 'pending' AND a.kind <> 'budget'
    JOIN project_member pm ON pm.project_id = a.project_id AND pm.user_id = n.user_id AND pm.role = 'owner'
    JOIN user_telegram_account t ON t.user_id = n.user_id
    WHERE n.approval_id = ${approvalId} AND n.user_id = ${userId}
      AND t.telegram_user_id = ${sender.telegramUserId} AND t.chat_id = ${sender.chatId}
      AND t.linked_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ai_agent agent WHERE agent.user_id = t.user_id)
    ON CONFLICT (bot_id, update_id) DO NOTHING
    RETURNING id
  `);
  return rows.length > 0;
}

export async function pendingTelegramReplies() {
  return db
    .select({
      eventId: telegramChannelEvent.id,
      chatId: userTelegramAccount.chatId,
      content: agentChatMessage.content,
      answerStatus: agentChatMessage.status,
      responseText: telegramChannelEvent.responseText,
    })
    .from(telegramChannelEvent)
    .innerJoin(userTelegramAccount, eq(userTelegramAccount.userId, telegramChannelEvent.userId))
    .leftJoin(agentChatMessage, eq(agentChatMessage.id, telegramChannelEvent.answerMessageId))
    .where(
      and(
        eq(telegramChannelEvent.state, 'done'),
        isNotNull(userTelegramAccount.telegramUserId),
        eq(userTelegramAccount.pairingId, telegramChannelEvent.pairingId),
        isNull(telegramChannelEvent.deliveredAt),
        or(
          isNotNull(telegramChannelEvent.responseText),
          inArray(agentChatMessage.status, ['success', 'failed', 'canceled']),
        ),
      ),
    )
    .orderBy(asc(telegramChannelEvent.id))
    .limit(20);
}

export async function markReplyDelivered(eventId: number): Promise<void> {
  await db
    .update(telegramChannelEvent)
    .set({ deliveredAt: new Date() })
    .where(and(eq(telegramChannelEvent.id, eventId), isNull(telegramChannelEvent.deliveredAt)));
}

export async function pendingApprovalNotices() {
  return db
    .select({
      id: telegramApprovalNotice.id,
      chatId: userTelegramAccount.chatId,
      approvalId: telegramApprovalNotice.approvalId,
      action: approvalRequest.action,
      details: approvalRequest.details,
    })
    .from(telegramApprovalNotice)
    .innerJoin(approvalRequest, eq(approvalRequest.id, telegramApprovalNotice.approvalId))
    .innerJoin(userTelegramAccount, eq(userTelegramAccount.userId, telegramApprovalNotice.userId))
    .innerJoin(
      projectMember,
      and(
        eq(projectMember.projectId, approvalRequest.projectId),
        eq(projectMember.userId, userTelegramAccount.userId),
        eq(projectMember.role, 'owner'),
      ),
    )
    .where(
      and(
        isNull(telegramApprovalNotice.sentAt),
        eq(approvalRequest.status, 'pending'),
        ne(approvalRequest.kind, 'budget'),
        isNotNull(userTelegramAccount.telegramUserId),
        isNotNull(userTelegramAccount.linkedAt),
      ),
    )
    .limit(20);
}

export async function markNoticeSent(id: number): Promise<void> {
  await db
    .update(telegramApprovalNotice)
    .set({ sentAt: new Date() })
    .where(and(eq(telegramApprovalNotice.id, id), isNull(telegramApprovalNotice.sentAt)));
}

export async function pendingAlertNotices() {
  await db.execute(sql`
    INSERT INTO telegram_alert_notice (alert_key, alert_opened_at, user_id)
    SELECT a.key, a.opened_at, t.user_id
    FROM helena_alert a
    CROSS JOIN user_telegram_account t
    JOIN "user" u ON u.id = t.user_id
    WHERE a.category = 'needs-you' AND a.notified_at IS NOT NULL AND a.resolved_at IS NULL
      AND t.chat_id IS NOT NULL AND t.telegram_user_id IS NOT NULL AND u.role = 'god'
    ON CONFLICT DO NOTHING
  `);
  return db
    .select({
      id: telegramAlertNotice.id,
      chatId: userTelegramAccount.chatId,
      source: helenaAlert.source,
    })
    .from(telegramAlertNotice)
    .innerJoin(user, and(eq(user.id, telegramAlertNotice.userId), eq(user.role, 'god')))
    .innerJoin(userTelegramAccount, eq(userTelegramAccount.userId, telegramAlertNotice.userId))
    .innerJoin(
      helenaAlert,
      and(
        eq(helenaAlert.key, telegramAlertNotice.alertKey),
        eq(helenaAlert.openedAt, telegramAlertNotice.alertOpenedAt),
      ),
    )
    .where(
      and(
        isNull(telegramAlertNotice.sentAt),
        isNotNull(userTelegramAccount.telegramUserId),
        isNotNull(userTelegramAccount.linkedAt),
        eq(telegramAlertNotice.status, 'pending'),
        isNull(helenaAlert.resolvedAt),
        isNotNull(helenaAlert.notifiedAt),
      ),
    )
    .limit(20);
}

export async function markAlertSent(id: number): Promise<void> {
  await db
    .update(telegramAlertNotice)
    .set({ sentAt: new Date() })
    .where(and(eq(telegramAlertNotice.id, id), isNull(telegramAlertNotice.sentAt)));
}

export async function decideAlertNotice(
  id: number,
  userId: string,
  acknowledged: boolean,
): Promise<boolean> {
  const [row] = await db
    .update(telegramAlertNotice)
    .set({
      status: acknowledged ? 'acknowledged' : 'dismissed',
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(telegramAlertNotice.id, id),
        eq(telegramAlertNotice.userId, userId),
        eq(telegramAlertNotice.status, 'pending'),
        sql`EXISTS (SELECT 1 FROM "user" u JOIN user_telegram_account t ON t.user_id = u.id
          WHERE u.id = ${userId} AND u.role = 'god' AND t.telegram_user_id IS NOT NULL
            AND t.chat_id IS NOT NULL AND t.linked_at IS NOT NULL)`,
        sql`EXISTS (SELECT 1 FROM helena_alert a WHERE a.key = ${telegramAlertNotice.alertKey}
          AND a.opened_at = ${telegramAlertNotice.alertOpenedAt} AND a.resolved_at IS NULL)`,
      ),
    )
    .returning({ id: telegramAlertNotice.id });
  return Boolean(row);
}
