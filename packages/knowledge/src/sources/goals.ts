import { asc, eq, gt, gte, and, inArray, type SQL } from 'drizzle-orm';
import { db, organizationGoal, project } from '@repo/db';
import type { KnowledgeItem, KnowledgeSource } from '@helena/sdk';
import { cursorId, iso, nextCursor, numericIds, pageLimit } from './common';

// People of a team may read all its goals. Agents have narrower goal scope through
// list_goals, so the index keeps these under the human-only goal_person reach.
async function rows(where: SQL | undefined, limit?: number) {
  const query = db
    .select({ goal: organizationGoal, projectKey: project.key })
    .from(organizationGoal)
    .leftJoin(project, eq(project.id, organizationGoal.projectId))
    .where(where)
    .orderBy(asc(organizationGoal.id));
  return limit ? query.limit(limit) : query;
}

type Row = Awaited<ReturnType<typeof rows>>[number];

function toItem(row: Row): KnowledgeItem {
  const goal = row.goal;
  return {
    id: String(goal.id),
    title: goal.title,
    text: `${goal.title}\n\n${goal.description}`,
    href: row.projectKey
      ? `/project/${encodeURIComponent(row.projectKey)}/organization`
      : '/organization',
    mimeType: 'text/markdown',
    scope: {
      teamId: goal.teamId,
      projectId: null,
      visibility: 'team',
      permission: 'goal_person',
    },
    provenance: { createdAt: iso(goal.createdAt), updatedAt: iso(goal.updatedAt) },
    metadata: {
      status: goal.status,
      projectKey: row.projectKey,
      projectId: goal.projectId,
      departmentId: goal.departmentId,
      targetDate: goal.targetDate,
    },
  };
}

export const goalSource: KnowledgeSource = {
  id: 'goal',
  label: { i18n: 'knowledge.source.goal' },
  icon: 'target',
  async list(ctx) {
    const limit = pageLimit(ctx);
    const found = await rows(
      and(
        gt(organizationGoal.id, cursorId(ctx)),
        ctx.since ? gte(organizationGoal.updatedAt, ctx.since) : undefined,
      ),
      limit,
    );
    return { items: found.map(toItem), cursor: nextCursor(found, limit, (row) => row.goal.id) };
  },
  async get(id) {
    const [row] = await rows(eq(organizationGoal.id, Number(id) || 0));
    return row ? toItem(row) : null;
  },
  async present(ids) {
    const numbers = numericIds(ids);
    if (!numbers.length) return [];
    const found = await db
      .select({ id: organizationGoal.id })
      .from(organizationGoal)
      .where(inArray(organizationGoal.id, numbers));
    return found.map((row) => String(row.id));
  },
};
