import {
  db,
  helenaReceipt,
  mailAccount,
  mailAttachment,
  mailMessage,
  mailThread,
  mailThreadIssue,
} from '@repo/db';
import { bindsReceiptMail } from '@repo/mail';
import { and, eq, inArray, lt, notExists, or, sql } from 'drizzle-orm';

/** Automatic cache prune only. Explicit account reset remains a separate operation. */
export async function deletePrunableMessage(id: number, cutoff: Date) {
  const [initial] = await db
    .select({ threadId: mailMessage.threadId, projectId: mailThread.projectId })
    .from(mailMessage)
    .innerJoin(mailThread, eq(mailThread.id, mailMessage.threadId))
    .where(eq(mailMessage.id, id));
  if (!initial) return null;
  return db.transaction(async (tx) => {
    // Same admission as receipt intake. Acquire before locking source rows.
    if (initial.projectId !== null)
      await tx.execute(sql`select pg_advisory_xact_lock(748220, ${initial.projectId})`);
    const [thread] = await tx
      .select()
      .from(mailThread)
      .where(eq(mailThread.id, initial.threadId))
      .for('share');
    if (!thread || thread.projectId !== initial.projectId) return null;
    const [message] = await tx
      .select()
      .from(mailMessage)
      .where(and(eq(mailMessage.id, id), lt(mailMessage.sentAt, cutoff)))
      .for('update');
    if (!message || message.threadId !== thread.id) return null;
    const [account] = await tx
      .select({ id: mailAccount.id, teamId: mailAccount.teamId })
      .from(mailAccount)
      .where(eq(mailAccount.id, message.accountId))
      .for('share');
    const attachments = await tx
      .select()
      .from(mailAttachment)
      .where(eq(mailAttachment.messageId, id));
    const receipts =
      thread.projectId === null
        ? []
        : await tx
            .select()
            .from(helenaReceipt)
            .where(
              and(
                eq(helenaReceipt.projectId, thread.projectId),
                eq(helenaReceipt.source, 'mail'),
                or(
                  attachments.length
                    ? inArray(
                        helenaReceipt.mailAttachmentId,
                        attachments.map((a) => a.id),
                      )
                    : sql`false`,
                  sql`${helenaReceipt.details}->'mailSource'->'messageId' = ${JSON.stringify(id)}::jsonb`,
                ),
              ),
            );
    if (
      account &&
      receipts.some((receipt) => bindsReceiptMail(receipt, message, thread, account, attachments))
    )
      return null;
    const [deleted] = await tx
      .delete(mailMessage)
      .where(
        and(
          eq(mailMessage.id, id),
          lt(mailMessage.sentAt, cutoff),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(mailThreadIssue)
              .where(eq(mailThreadIssue.threadId, message.threadId)),
          ),
        ),
      )
      .returning();
    return deleted ? { message: deleted, attachments } : null;
  });
}
