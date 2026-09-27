import {
  db,
  issue,
  mailAttachment,
  mailAccount,
  mailMessage,
  mailThread,
  mailThreadIssue,
  project,
} from '@repo/db';
import { and, asc, eq } from 'drizzle-orm';
import { bindsReceiptMail, receiptMailReference } from '@repo/mail';
import { assertMailAccess } from '#modules/mail/access';
import { assertPermission, type AuthUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import type { ReceiptRow } from './views';

export interface ReceiptSourceLinks {
  messageId: number;
  threadId: number;
  archived?: boolean;
  issues: { id: number; projectKey: string; sequenceNumber: number; identifier: string }[];
}

async function mayRead(check: () => Promise<void>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 403 || error.status === 404)) return false;
    throw error;
  }
}

export async function receiptSourceLinks(
  receipt: ReceiptRow,
  user: AuthUser,
  headers: Headers,
): Promise<ReceiptSourceLinks | null> {
  if (receipt.source !== 'mail') return null;
  if (
    !(await mayRead(() =>
      assertMailAccess(receipt.teamId, receipt.projectId, user, 'read', headers),
    ))
  )
    return null;

  const resolved = await resolveReceiptMail(receipt);
  if (!resolved) return null;
  const source = {
    messageId: resolved.message.id,
    threadId: resolved.message.threadId,
    ...(resolved.message.deletedAt === null ? {} : { archived: true }),
  };

  if (!(await mayRead(() => assertPermission(receipt.projectId, user, 'work_items', 'read'))))
    return { ...source, issues: [] };
  const issues = await db
    .select({ id: issue.id, sequenceNumber: issue.sequenceNumber, projectKey: project.key })
    .from(mailThreadIssue)
    .innerJoin(issue, eq(issue.id, mailThreadIssue.issueId))
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(
      and(
        eq(mailThreadIssue.threadId, source.threadId),
        eq(issue.projectId, receipt.projectId),
        eq(project.teamId, receipt.teamId),
      ),
    )
    .orderBy(asc(issue.sequenceNumber));
  return {
    ...source,
    issues: issues.map((linked) => ({
      ...linked,
      identifier: `${linked.projectKey}-${linked.sequenceNumber}`,
    })),
  };
}

/** Metadata binding shared by active navigation and the receipt-only archive reader. */
export async function resolveReceiptMail(receipt: ReceiptRow) {
  if (receipt.source !== 'mail') return null;
  let messageId: number;
  if (receipt.mailAttachmentId !== null) {
    const [attachment] = await db
      .select()
      .from(mailAttachment)
      .where(eq(mailAttachment.id, receipt.mailAttachmentId));
    if (!attachment) return null;
    messageId = attachment.messageId;
  } else {
    const reference = receiptMailReference(receipt.details);
    if (!reference) return null;
    messageId = reference.messageId;
  }
  const [origin] = await db
    .select({
      message: mailMessage,
      thread: mailThread,
      account: { id: mailAccount.id, teamId: mailAccount.teamId },
    })
    .from(mailMessage)
    .innerJoin(mailThread, eq(mailThread.id, mailMessage.threadId))
    .innerJoin(mailAccount, eq(mailAccount.id, mailMessage.accountId))
    .where(eq(mailMessage.id, messageId));
  if (!origin) return null;
  const attachments = await db
    .select()
    .from(mailAttachment)
    .where(eq(mailAttachment.messageId, messageId));
  return bindsReceiptMail(receipt, origin.message, origin.thread, origin.account, attachments)
    ? { ...origin, attachments }
    : null;
}
