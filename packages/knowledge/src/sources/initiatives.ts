import { and, asc, eq, gt, gte, inArray, type SQL } from 'drizzle-orm';
import { db, initiative, project } from '@repo/db';
import type { KnowledgeItem, KnowledgeSource } from '@helena/sdk';
import { cursorId, iso, nextCursor, numericIds, pageLimit } from './common';

async function rows(where: SQL | undefined, limit?: number) {
  const query = db
    .select({ item: initiative, key: project.key, teamId: project.teamId })
    .from(initiative)
    .innerJoin(project, eq(project.id, initiative.projectId))
    .where(where)
    .orderBy(asc(initiative.id));
  return limit ? query.limit(limit) : query;
}

type Row = Awaited<ReturnType<typeof rows>>[number];

function toItem(row: Row): KnowledgeItem {
  const goal = row.item;
  return {
    id: String(goal.id),
    title: goal.title,
    text: `${goal.title}\n\n${goal.description}`,
    href: `/project/${encodeURIComponent(row.key)}/initiatives`,
    mimeType: 'text/markdown',
    scope: {
      teamId: row.teamId,
      projectId: goal.projectId,
      visibility: 'project',
      permission: 'initiatives',
    },
    provenance: { createdAt: iso(goal.createdAt), updatedAt: iso(goal.updatedAt) },
    metadata: { projectKey: row.key, status: goal.status, priority: goal.priority },
  };
}

export const initiativeSource: KnowledgeSource = {
  id: 'initiative',
  label: { i18n: 'knowledge.source.initiative' },
  icon: 'target',
  async list(ctx) {
    const limit = pageLimit(ctx);
    const found = await rows(
      and(
        gt(initiative.id, cursorId(ctx)),
        ctx.since ? gte(initiative.updatedAt, ctx.since) : undefined,
      ),
      limit,
    );
    return { items: found.map(toItem), cursor: nextCursor(found, limit, (row) => row.item.id) };
  },
  async get(id) {
    const [row] = await rows(eq(initiative.id, Number(id) || 0));
    return row ? toItem(row) : null;
  },
  async present(ids) {
    const numbers = numericIds(ids);
    if (!numbers.length) return [];
    const found = await db
      .select({ id: initiative.id })
      .from(initiative)
      .where(inArray(initiative.id, numbers));
    return found.map((row) => String(row.id));
  },
};
