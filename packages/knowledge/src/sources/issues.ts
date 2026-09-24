import { and, asc, eq, gt, gte, inArray, type SQL } from 'drizzle-orm';
import { db, issue, issueActivity, project, projectColumn } from '@repo/db';
import type { KnowledgeItem, KnowledgeSource } from '@helena/sdk';
import { mentionLinks, taskTarget } from '../text';
import { authorRefs, cursorId, iso, nextCursor, numericIds, pageLimit, routes } from './common';

// Tasks and their comments. A task is read by the project's work item permission, like
// the board; archived tasks stay findable and say so. The comments of a task share its
// group, so a search shows a task once, at its best match.

const identifierOf = (key: string, sequence: number) => `${key}-${sequence}`;
const taskGroup = (issueId: number) => `issue:${issueId}`;

async function issueRows(where: SQL | undefined, limit?: number) {
  const query = db
    .select({
      id: issue.id,
      title: issue.title,
      description: issue.description,
      sequenceNumber: issue.sequenceNumber,
      priority: issue.priority,
      archivedAt: issue.archivedAt,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      parentId: issue.parentId,
      projectId: issue.projectId,
      teamId: project.teamId,
      key: project.key,
      status: projectColumn.name,
    })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .leftJoin(projectColumn, eq(projectColumn.id, issue.columnId))
    .where(where)
    .orderBy(asc(issue.id));
  return limit ? query.limit(limit) : query;
}

type IssueRow = Awaited<ReturnType<typeof issueRows>>[number];

function issueItem(row: IssueRow): KnowledgeItem {
  const identifier = identifierOf(row.key, row.sequenceNumber);
  return {
    id: String(row.id),
    title: row.title,
    // The identifier leads the text, so `VOL-12` finds the task.
    text: `${identifier}\n\n${row.description}`,
    href: routes.issue(row.key, row.sequenceNumber),
    mimeType: 'text/markdown',
    scope: {
      teamId: row.teamId,
      projectId: row.projectId,
      visibility: 'project',
      permission: 'work_items',
    },
    provenance: { createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) },
    group: taskGroup(row.id),
    metadata: {
      identifier,
      projectKey: row.key,
      status: row.status ?? null,
      priority: row.priority,
      archived: row.archivedAt !== null,
    },
    links: mentionLinks(row.description).filter((link) => link.target !== taskTarget(identifier)),
  };
}

export const issueSource: KnowledgeSource = {
  id: 'issue',
  label: { i18n: 'knowledge.source.issue' },
  icon: 'square-check',
  async list(ctx) {
    const limit = pageLimit(ctx);
    const rows = await issueRows(
      and(gt(issue.id, cursorId(ctx)), ctx.since ? gte(issue.updatedAt, ctx.since) : undefined),
      limit,
    );
    return { items: rows.map(issueItem), cursor: nextCursor(rows, limit, (row) => row.id) };
  },
  async get(id) {
    const [row] = await issueRows(eq(issue.id, Number(id) || 0));
    return row ? issueItem(row) : null;
  },
  async present(ids) {
    const numbers = numericIds(ids);
    if (numbers.length === 0) return [];
    const rows = await db.select({ id: issue.id }).from(issue).where(inArray(issue.id, numbers));
    return rows.map((row) => String(row.id));
  },
  async resolveLink(ref) {
    const match = /^([A-Z][A-Z0-9_]*)-(\d+)$/.exec(ref.trim().toUpperCase());
    if (!match) return null;
    const [row] = await db
      .select({ id: issue.id })
      .from(issue)
      .innerJoin(project, eq(project.id, issue.projectId))
      .where(and(eq(project.key, match[1]!), eq(issue.sequenceNumber, Number(match[2]))));
    return row ? String(row.id) : null;
  },
};

async function commentRows(where: SQL | undefined, limit?: number) {
  const query = db
    .select({
      id: issueActivity.id,
      body: issueActivity.body,
      actorUserId: issueActivity.actorUserId,
      actorName: issueActivity.actorName,
      replyToId: issueActivity.replyToId,
      createdAt: issueActivity.createdAt,
      editedAt: issueActivity.editedAt,
      issueId: issue.id,
      issueTitle: issue.title,
      sequenceNumber: issue.sequenceNumber,
      projectId: issue.projectId,
      teamId: project.teamId,
      key: project.key,
    })
    .from(issueActivity)
    .innerJoin(issue, eq(issue.id, issueActivity.issueId))
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(and(eq(issueActivity.kind, 'comment'), where))
    .orderBy(asc(issueActivity.id));
  return limit ? query.limit(limit) : query;
}

type CommentRow = Awaited<ReturnType<typeof commentRows>>[number];

async function commentItems(rows: CommentRow[]): Promise<KnowledgeItem[]> {
  const authors = await authorRefs(rows.map((row) => row.actorUserId));
  return rows.map((row) => {
    const identifier = identifierOf(row.key, row.sequenceNumber);
    return {
      id: String(row.id),
      title: row.issueTitle,
      text: row.body ?? '',
      href: `${routes.issue(row.key, row.sequenceNumber)}#comment-${row.id}`,
      mimeType: 'text/markdown',
      scope: {
        teamId: row.teamId,
        projectId: row.projectId,
        visibility: 'project',
        permission: 'work_items',
      },
      provenance: {
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.editedAt ?? row.createdAt),
        author: row.actorUserId ? authors.get(row.actorUserId) : null,
      },
      group: taskGroup(row.issueId),
      metadata: { identifier, projectKey: row.key, authorName: row.actorName },
      links: [
        { target: `issue:${row.issueId}`, kind: 'parent' },
        ...(row.replyToId ? [{ target: `comment:${row.replyToId}`, kind: 'reply' as const }] : []),
        ...mentionLinks(row.body ?? '').filter((link) => link.target !== taskTarget(identifier)),
      ],
    };
  });
}

export const commentSource: KnowledgeSource = {
  id: 'comment',
  label: { i18n: 'knowledge.source.comment' },
  icon: 'message-square',
  async list(ctx) {
    const limit = pageLimit(ctx);
    const since = ctx.since;
    const rows = await commentRows(
      and(
        gt(issueActivity.id, cursorId(ctx)),
        since ? gte(issueActivity.createdAt, since) : undefined,
      ),
      limit,
    );
    // An edit keeps the creation time: the comments edited since then come with the
    // first page.
    const edited =
      since && cursorId(ctx) === 0 ? await commentRows(gte(issueActivity.editedAt, since)) : [];
    const seen = new Set(rows.map((row) => row.id));
    const all = [...rows, ...edited.filter((row) => !seen.has(row.id))];
    return { items: await commentItems(all), cursor: nextCursor(rows, limit, (row) => row.id) };
  },
  async get(id) {
    const rows = await commentRows(eq(issueActivity.id, Number(id) || 0));
    const [item] = await commentItems(rows);
    return item ?? null;
  },
  async present(ids) {
    const numbers = numericIds(ids);
    if (numbers.length === 0) return [];
    const rows = await db
      .select({ id: issueActivity.id })
      .from(issueActivity)
      .where(and(inArray(issueActivity.id, numbers), eq(issueActivity.kind, 'comment')));
    return rows.map((row) => String(row.id));
  },
};
