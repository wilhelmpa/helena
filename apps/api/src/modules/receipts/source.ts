import {
  db,
  issue,
  mailAttachment,
  mailMessage,
  mailThread,
  mailThreadIssue,
  project,
} from '@repo/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { assertMailAccess } from '#modules/mail/access';
import { assertPermission, type AuthUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { detailsOf, type ReceiptRow } from './views';

export interface ReceiptSourceLinks {
  messageId: number;
  threadId: number;
  issues: { id: number; projectKey: string; sequenceNumber: number; identifier: string }[];
}

function sourceId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
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

  let messageId: number;
  let expectedThreadId: number | undefined;
  if (receipt.mailAttachmentId !== null) {
    const [attachment] = await db
      .select({ messageId: mailAttachment.messageId })
      .from(mailAttachment)
      .where(
        and(
          eq(mailAttachment.id, receipt.mailAttachmentId),
          eq(mailAttachment.sha256, receipt.sha256),
          eq(mailAttachment.size, receipt.size),
        ),
      );
    if (!attachment) return null;
    messageId = attachment.messageId;
  } else {
    const source = detailsOf(receipt).mailSource;
    if (!source || !sourceId(source.messageId) || !sourceId(source.threadId)) return null;
    messageId = source.messageId;
    expectedThreadId = source.threadId;
  }

  const [source] = await db
    .select({ messageId: mailMessage.id, threadId: mailThread.id })
    .from(mailMessage)
    .innerJoin(mailThread, eq(mailThread.id, mailMessage.threadId))
    .where(
      and(
        eq(mailMessage.id, messageId),
        eq(mailMessage.teamId, receipt.teamId),
        eq(mailThread.teamId, receipt.teamId),
        eq(mailMessage.accountId, mailThread.accountId),
        eq(mailThread.projectId, receipt.projectId),
        isNull(mailMessage.deletedAt),
        expectedThreadId === undefined ? undefined : eq(mailThread.id, expectedThreadId),
      ),
    );
  if (!source) return null;

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
