import { and, asc, eq, gt, gte, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { agentChatMessage, agentChatThread, aiAgent, db, project, user } from '@repo/db';
import type { KnowledgeItem, KnowledgeSource } from '@helena/sdk';
import { mentionLinks } from '../text';
import { cursorId, iso, nextCursor, numericIds, pageLimit, routes } from './common';

// The chats with agents, one item per finished turn, grouped by chat. A chat is its
// member's own, so every turn is private to that member, wherever it was started. A
// deleted chat leaves the index with its turns; an archived one stays findable.

const finished = sql`coalesce(${agentChatMessage.finishedAt}, ${agentChatMessage.createdAt})`;

async function turnRows(where: SQL | undefined, limit?: number) {
  const query = db
    .select({
      id: agentChatMessage.id,
      role: agentChatMessage.role,
      content: agentChatMessage.content,
      model: agentChatMessage.model,
      createdAt: agentChatMessage.createdAt,
      finishedAt: agentChatMessage.finishedAt,
      threadId: agentChatThread.id,
      threadTitle: agentChatThread.title,
      threadUpdatedAt: agentChatThread.updatedAt,
      archivedAt: agentChatThread.archivedAt,
      userId: agentChatThread.userId,
      projectId: agentChatThread.projectId,
      agentId: aiAgent.id,
      teamId: aiAgent.teamId,
      agentName: user.name,
      key: project.key,
    })
    .from(agentChatMessage)
    .innerJoin(agentChatThread, eq(agentChatThread.id, agentChatMessage.threadId))
    .innerJoin(aiAgent, eq(aiAgent.id, agentChatThread.agentId))
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .leftJoin(project, eq(project.id, agentChatThread.projectId))
    .where(
      and(
        eq(agentChatMessage.status, 'success'),
        ne(agentChatMessage.content, ''),
        isNull(agentChatThread.deletedAt),
        where,
      ),
    )
    .orderBy(asc(agentChatMessage.id));
  return limit ? query.limit(limit) : query;
}

type TurnRow = Awaited<ReturnType<typeof turnRows>>[number];

function turnItem(row: TurnRow): KnowledgeItem {
  const done = row.finishedAt ?? row.createdAt;
  return {
    id: String(row.id),
    title: row.threadTitle?.trim() || row.agentName,
    text: row.content,
    href: routes.chat(row.key, row.agentId, row.threadId),
    mimeType: 'text/markdown',
    scope: {
      teamId: row.teamId,
      projectId: row.projectId,
      visibility: 'private',
      ownerId: row.userId,
    },
    provenance: {
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.threadUpdatedAt > done ? row.threadUpdatedAt : done),
      author: row.role === 'user' ? `user:${row.userId}` : `agent:${row.agentId}`,
    },
    group: `chat:${row.threadId}`,
    metadata: {
      threadId: row.threadId,
      role: row.role,
      agentId: row.agentId,
      agentName: row.agentName,
      projectKey: row.key,
      model: row.model,
      archived: row.archivedAt !== null,
    },
    links: mentionLinks(row.content),
  };
}

export const chatSource: KnowledgeSource = {
  id: 'chat',
  label: { i18n: 'knowledge.source.chat' },
  icon: 'messages-square',
  async list(ctx) {
    const limit = pageLimit(ctx);
    const rows = await turnRows(
      and(
        gt(agentChatMessage.id, cursorId(ctx)),
        ctx.since
          ? or(
              sql`${finished} >= ${ctx.since.toISOString()}::timestamptz`,
              gte(agentChatThread.updatedAt, ctx.since),
            )
          : undefined,
      ),
      limit,
    );
    return { items: rows.map(turnItem), cursor: nextCursor(rows, limit, (row) => row.id) };
  },
  async get(id) {
    const [row] = await turnRows(eq(agentChatMessage.id, Number(id) || 0));
    return row ? turnItem(row) : null;
  },
  async present(ids) {
    const numbers = numericIds(ids);
    if (numbers.length === 0) return [];
    const rows = await db
      .select({ id: agentChatMessage.id })
      .from(agentChatMessage)
      .innerJoin(agentChatThread, eq(agentChatThread.id, agentChatMessage.threadId))
      .where(and(inArray(agentChatMessage.id, numbers), isNull(agentChatThread.deletedAt)));
    return rows.map((row) => String(row.id));
  },
};
