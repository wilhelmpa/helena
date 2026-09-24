import { and, asc, eq, gt, gte, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { db, mailMessage, mailThread, project } from '@repo/db';
import type { KnowledgeItem, KnowledgeSource } from '@helena/sdk';
import { mentionLinks } from '../text';
import { cursorId, iso, nextCursor, numericIds, pageLimit, routes } from './common';

// The imported mail, one item per message, grouped by thread. Project mail is read by
// the project's mail permission; Home mail (a thread in no project) by the team's owners
// and admins, like the inbox (apps/api/src/modules/mail/access.ts).

async function messageRows(where: SQL | undefined, limit?: number) {
  const query = db
    .select({
      id: mailMessage.id,
      subject: mailMessage.subject,
      fromName: mailMessage.fromName,
      fromAddress: mailMessage.fromAddress,
      addressText: mailMessage.addressText,
      textBody: mailMessage.textBody,
      messageId: mailMessage.messageId,
      sentAt: mailMessage.sentAt,
      createdAt: mailMessage.createdAt,
      hasAttachments: mailMessage.hasAttachments,
      threadId: mailThread.id,
      threadUpdatedAt: mailThread.updatedAt,
      teamId: mailThread.teamId,
      projectId: mailThread.projectId,
      key: project.key,
    })
    .from(mailMessage)
    .innerJoin(mailThread, eq(mailThread.id, mailMessage.threadId))
    .leftJoin(project, eq(project.id, mailThread.projectId))
    .where(and(isNull(mailMessage.deletedAt), where))
    .orderBy(asc(mailMessage.id));
  return limit ? query.limit(limit) : query;
}

type MessageRow = Awaited<ReturnType<typeof messageRows>>[number];

function messageItem(row: MessageRow): KnowledgeItem {
  const from = row.fromName ? `${row.fromName} <${row.fromAddress}>` : row.fromAddress;
  const changed = row.threadUpdatedAt > row.createdAt ? row.threadUpdatedAt : row.createdAt;
  return {
    id: String(row.id),
    title: row.subject,
    text: `${from}\n${row.addressText}\n\n${row.textBody}`,
    href: routes.mail(row.key, row.threadId),
    mimeType: 'message/rfc822',
    scope:
      row.projectId !== null
        ? {
            teamId: row.teamId,
            projectId: row.projectId,
            visibility: 'project',
            permission: 'mail',
          }
        : { teamId: row.teamId, projectId: null, visibility: 'team', permission: 'mail' },
    provenance: {
      createdAt: iso(row.sentAt),
      updatedAt: iso(changed),
      author: 'extern',
      origin: row.messageId,
    },
    group: `mail:${row.threadId}`,
    metadata: {
      threadId: row.threadId,
      from,
      projectKey: row.key,
      hasAttachments: row.hasAttachments,
    },
    links: mentionLinks(`${row.subject}\n${row.textBody}`),
  };
}

export const mailSource: KnowledgeSource = {
  id: 'mail',
  label: { i18n: 'knowledge.source.mail' },
  icon: 'mail',
  async list(ctx) {
    const limit = pageLimit(ctx);
    const rows = await messageRows(
      and(
        gt(mailMessage.id, cursorId(ctx)),
        // A thread moved to another project changes where its messages belong.
        ctx.since
          ? or(gte(mailMessage.createdAt, ctx.since), gte(mailThread.updatedAt, ctx.since))
          : undefined,
      ),
      limit,
    );
    return { items: rows.map(messageItem), cursor: nextCursor(rows, limit, (row) => row.id) };
  },
  async get(id) {
    const [row] = await messageRows(eq(mailMessage.id, Number(id) || 0));
    return row ? messageItem(row) : null;
  },
  async present(ids) {
    const numbers = numericIds(ids);
    if (numbers.length === 0) return [];
    const rows = await db
      .select({ id: mailMessage.id })
      .from(mailMessage)
      .where(and(inArray(mailMessage.id, numbers), isNull(mailMessage.deletedAt)));
    return rows.map((row) => String(row.id));
  },
};
