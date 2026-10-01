import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  agentMemoryRevision,
  aiAgent,
  db,
  helenaAgentSession,
  helenaAgentSessionItem,
  helenaFact,
  helenaFactEntity,
  helenaFactEntityLink,
  project,
  user,
} from '@repo/db';
import type { KnowledgeItem, KnowledgeSource } from '@helena/sdk';
import { cursorId, iso, nextCursor, numericIds, pageLimit, routes } from './common';

// What Helena's own agent loop keeps (docs/helena-decisions/zentrale-laufzeit.md §7) as
// knowledge sources, so the index embeds it and one hybrid search (full text + vectors, with
// the reader's reach) finds it:
//
//   agent-session  a session of the loop, its messages as text, read like the agent's runs
//                  (chat sessions private to the agent; tasks by project or team)
//   agent-memory   the newest version of each memory file and daily note, private to the
//                  agent (its own recall; the owner reads it in the memory editor)
//   fact           a fact of the fact store: every member of its project, the team's by the
//                  team (the fact store's own rule, apps/api native-runtime/facts.ts)
//
// The API reindexes an item right after it wrote it (reindexItems); the regular sweep
// catches up after downtime.

const SESSION_TEXT_LIMIT = 200_000;
const sessionUpdated = sql`date_trunc('milliseconds', ${helenaAgentSession.updatedAt})`;

async function sessionRows(
  ids: string[] | null,
  afterUpdated?: Date | null,
  limit?: number,
  afterId?: string,
) {
  const query = db
    .select({
      id: helenaAgentSession.id,
      agentId: helenaAgentSession.agentId,
      teamId: helenaAgentSession.teamId,
      projectId: helenaAgentSession.projectId,
      kind: helenaAgentSession.kind,
      runId: helenaAgentSession.runId,
      chatThreadId: helenaAgentSession.chatThreadId,
      model: helenaAgentSession.model,
      summary: helenaAgentSession.summary,
      createdAt: helenaAgentSession.createdAt,
      updatedAt: helenaAgentSession.updatedAt,
      key: project.key,
      agentName: user.name,
      agentUserId: aiAgent.userId,
    })
    .from(helenaAgentSession)
    .innerJoin(aiAgent, eq(aiAgent.id, helenaAgentSession.agentId))
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .leftJoin(project, eq(project.id, helenaAgentSession.projectId))
    .where(
      and(
        ids ? inArray(helenaAgentSession.id, ids) : undefined,
        afterUpdated
          ? or(
              gt(sessionUpdated, afterUpdated.toISOString()),
              afterId
                ? and(
                    eq(sessionUpdated, afterUpdated.toISOString()),
                    gt(helenaAgentSession.id, afterId),
                  )
                : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(asc(sessionUpdated), asc(helenaAgentSession.id));
  return limit ? query.limit(limit) : query;
}

type SessionRow = Awaited<ReturnType<typeof sessionRows>>[number];

export function agentSessionScope(
  row: Pick<SessionRow, 'teamId' | 'projectId' | 'kind' | 'chatThreadId' | 'agentUserId'>,
): KnowledgeItem['scope'] {
  const privateSession = row.kind !== 'run' || row.chatThreadId !== null;
  return {
    teamId: row.teamId,
    projectId: row.projectId,
    visibility: privateSession ? 'private' : row.projectId === null ? 'team' : 'project',
    ...(privateSession ? { ownerId: row.agentUserId } : {}),
    permission: 'ai_agents',
  };
}

async function sessionItem(row: SessionRow): Promise<KnowledgeItem> {
  const items = await db
    .select({ role: helenaAgentSessionItem.role, text: helenaAgentSessionItem.text })
    .from(helenaAgentSessionItem)
    .where(eq(helenaAgentSessionItem.sessionId, row.id))
    .orderBy(asc(helenaAgentSessionItem.seq));
  let text = row.summary ? `${row.summary}\n\n` : '';
  for (const item of items) {
    if (!item.text) continue;
    text += `${item.role}: ${item.text}\n`;
    if (text.length > SESSION_TEXT_LIMIT) break;
  }
  const first = items.find((item) => item.role === 'user')?.text ?? '';
  return {
    id: row.id,
    title: `${row.agentName}: ${first.replace(/\s+/g, ' ').slice(0, 80) || row.kind}`,
    text: text.slice(0, SESSION_TEXT_LIMIT),
    href:
      row.chatThreadId !== null
        ? routes.chat(row.key, row.agentId, row.chatThreadId)
        : row.key
          ? routes.activity(row.key, row.agentId)
          : '/activity',
    mimeType: 'text/markdown',
    scope: agentSessionScope(row),
    provenance: {
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      author: `agent:${row.agentId}`,
      runId: row.runId,
    },
    group: row.runId !== null ? `run:${row.runId}` : null,
    metadata: {
      agentId: row.agentId,
      kind: row.kind,
      model: row.model,
      projectKey: row.key,
    },
  };
}

export const agentSessionSource: KnowledgeSource = {
  id: 'agent-session',
  label: { i18n: 'knowledge.source.agentSession' },
  icon: 'messages-square',
  async list(ctx) {
    const limit = pageLimit(ctx);
    // Sessions change as they grow, so they page by their change time (the cursor).
    const [timestamp, afterId] = ctx.cursor?.split('|') ?? [];
    const after = timestamp ? new Date(timestamp) : (ctx.since ?? null);
    const rows = await sessionRows(null, after, limit, afterId);
    const items = await Promise.all(rows.map(sessionItem));
    return {
      items,
      cursor:
        rows.length < limit
          ? null
          : `${rows[rows.length - 1]!.updatedAt.toISOString()}|${rows[rows.length - 1]!.id}`,
    };
  },
  async get(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [row] = await sessionRows([id]);
    return row ? sessionItem(row) : null;
  },
};

// ── memory ──

const MEMORY_ID = /^(\d+):(MEMORY\.md|USER\.md|notes\/\d{4}-\d{2}-\d{2}\.md)$/;

async function memoryItem(agentId: number, file: string): Promise<KnowledgeItem | null> {
  const [row] = await db
    .select({
      content: agentMemoryRevision.content,
      createdAt: agentMemoryRevision.createdAt,
      teamId: aiAgent.teamId,
      userId: aiAgent.userId,
      agentName: user.name,
    })
    .from(agentMemoryRevision)
    .innerJoin(aiAgent, eq(aiAgent.id, agentMemoryRevision.agentId))
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(and(eq(agentMemoryRevision.agentId, agentId), eq(agentMemoryRevision.file, file)))
    .orderBy(desc(agentMemoryRevision.id))
    .limit(1);
  if (!row || !row.content.trim()) return null;
  return {
    id: `${agentId}:${file}`,
    title: `${row.agentName} · ${file}`,
    text: row.content,
    href: `/agents?agent=${agentId}&tab=memory`,
    mimeType: 'text/markdown',
    scope: { teamId: row.teamId, projectId: null, visibility: 'private', ownerId: row.userId },
    provenance: {
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.createdAt),
      author: `agent:${agentId}`,
    },
    group: `memory:${agentId}`,
    metadata: { agentId, file },
  };
}

export const agentMemorySource: KnowledgeSource = {
  id: 'agent-memory',
  label: { i18n: 'knowledge.source.agentMemory' },
  icon: 'brain',
  async list(ctx) {
    const limit = pageLimit(ctx);
    // One entry per agent and file: the newest revision's id pages through them.
    const latest = db
      .selectDistinctOn([agentMemoryRevision.agentId, agentMemoryRevision.file], {
        id: agentMemoryRevision.id,
        agentId: agentMemoryRevision.agentId,
        file: agentMemoryRevision.file,
      })
      .from(agentMemoryRevision)
      .where(
        and(
          gt(agentMemoryRevision.id, cursorId(ctx)),
          ctx.since ? gt(agentMemoryRevision.createdAt, ctx.since) : undefined,
        ),
      )
      .orderBy(agentMemoryRevision.agentId, agentMemoryRevision.file, desc(agentMemoryRevision.id))
      .as('latest_memory');
    const rows = await db.select().from(latest).orderBy(asc(latest.id)).limit(limit);
    const items = (await Promise.all(rows.map((row) => memoryItem(row.agentId, row.file)))).filter(
      (item): item is KnowledgeItem => item !== null,
    );
    const maxId = rows.reduce((max, row) => Math.max(max, row.id), 0);
    return { items, cursor: rows.length < limit ? null : String(maxId) };
  },
  async get(id) {
    const match = MEMORY_ID.exec(id);
    return match ? memoryItem(Number(match[1]), match[2]!) : null;
  },
};

// ── facts ──

async function factRows(where: ReturnType<typeof and>, limit?: number) {
  const query = db
    .select({
      id: helenaFact.id,
      teamId: helenaFact.teamId,
      projectId: helenaFact.projectId,
      agentId: helenaFact.agentId,
      content: helenaFact.content,
      category: helenaFact.category,
      tags: helenaFact.tags,
      trust: helenaFact.trust,
      createdAt: helenaFact.createdAt,
      updatedAt: helenaFact.updatedAt,
      key: project.key,
      entities: sql<
        string[]
      >`coalesce((select array_agg(${helenaFactEntity.name} order by ${helenaFactEntity.name}) from ${helenaFactEntityLink} join ${helenaFactEntity} on ${helenaFactEntity.id} = ${helenaFactEntityLink.entityId} where ${helenaFactEntityLink.factId} = ${helenaFact.id}), '{}')`,
    })
    .from(helenaFact)
    .leftJoin(project, eq(project.id, helenaFact.projectId))
    .where(and(isNull(helenaFact.deletedAt), where))
    .orderBy(asc(helenaFact.id));
  return limit ? query.limit(limit) : query;
}

type FactItemRow = Awaited<ReturnType<typeof factRows>>[number];

function factItem(row: FactItemRow): KnowledgeItem {
  return {
    id: String(row.id),
    title: row.content.slice(0, 80),
    text: [row.content, row.entities.join(', '), row.tags.join(' ')].filter(Boolean).join('\n'),
    href: row.agentId ? `/agents?agent=${row.agentId}&tab=memory&fact=${row.id}` : '/agents',
    mimeType: 'text/plain',
    // Every member of the project reads its facts (the fact store's own rule), the team's
    // are read like Home's items of no project.
    scope: {
      teamId: row.teamId,
      projectId: row.projectId,
      visibility: row.projectId === null ? 'team' : 'project',
      permission: null,
    },
    provenance: {
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      author: row.agentId ? `agent:${row.agentId}` : null,
    },
    metadata: {
      category: row.category,
      trust: Math.round(row.trust * 100) / 100,
      entities: row.entities,
      projectKey: row.key,
    },
  };
}

export const factSource: KnowledgeSource = {
  id: 'fact',
  label: { i18n: 'knowledge.source.fact' },
  icon: 'lightbulb',
  async list(ctx) {
    const limit = pageLimit(ctx);
    const rows = await factRows(
      and(
        gt(helenaFact.id, cursorId(ctx)),
        ctx.since ? gt(helenaFact.updatedAt, ctx.since) : undefined,
      ),
      limit,
    );
    return { items: rows.map(factItem), cursor: nextCursor(rows, limit, (row) => row.id) };
  },
  async get(id) {
    const [row] = await factRows(eq(helenaFact.id, Number(id) || 0));
    return row ? factItem(row) : null;
  },
  async present(ids) {
    const numbers = numericIds(ids);
    if (numbers.length === 0) return [];
    const rows = await db
      .select({ id: helenaFact.id })
      .from(helenaFact)
      .where(and(inArray(helenaFact.id, numbers), isNull(helenaFact.deletedAt)));
    return rows.map((row) => String(row.id));
  },
};
