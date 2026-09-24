import { and, asc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { agentRun, aiAgent, db, issue, project, user } from '@repo/db';
import type { KnowledgeItem, KnowledgeSource } from '@helena/sdk';
import { mentionLinks, taskTarget } from '../text';
import { cursorId, iso, nextCursor, numericIds, pageLimit, routes } from './common';

// The agents' runs: what each was asked and what it answered, read by the project's AI
// agent permission like the activity timeline. The full transcript of a run (tool calls,
// reasoning) is hub/hermes-in-helena's; once it stores transcripts, they extend this
// item's text or register as a source of their own.

const changed = sql`greatest(${agentRun.createdAt}, coalesce(${agentRun.startedAt}, ${agentRun.createdAt}), coalesce(${agentRun.finishedAt}, ${agentRun.createdAt}))`;

async function runRows(where: SQL | undefined, limit?: number) {
  const query = db
    .select({
      id: agentRun.id,
      prompt: agentRun.prompt,
      output: agentRun.output,
      blockedQuestion: agentRun.blockedQuestion,
      status: agentRun.status,
      trigger: agentRun.trigger,
      model: agentRun.model,
      createdAt: agentRun.createdAt,
      changedAt: sql<Date>`${changed}`.mapWith((value: string | Date) => new Date(value)),
      projectId: agentRun.projectId,
      agentId: aiAgent.id,
      agentName: user.name,
      teamId: project.teamId,
      key: project.key,
      issueTitle: issue.title,
      sequenceNumber: issue.sequenceNumber,
    })
    .from(agentRun)
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .innerJoin(project, eq(project.id, agentRun.projectId))
    .leftJoin(issue, eq(issue.id, agentRun.issueId))
    .where(where)
    .orderBy(asc(agentRun.id));
  return limit ? query.limit(limit) : query;
}

type RunRow = Awaited<ReturnType<typeof runRows>>[number];

function runItem(row: RunRow): KnowledgeItem {
  const identifier = row.sequenceNumber !== null ? `${row.key}-${row.sequenceNumber}` : null;
  const parts = [row.prompt, row.output ?? '', row.blockedQuestion ?? ''].filter(Boolean);
  return {
    id: String(row.id),
    title: row.issueTitle ?? `${row.agentName} #${row.id}`,
    text: parts.join('\n\n---\n\n'),
    href:
      identifier !== null && row.sequenceNumber !== null
        ? routes.issue(row.key, row.sequenceNumber)
        : routes.activity(row.key, row.agentId),
    mimeType: 'text/markdown',
    scope: {
      teamId: row.teamId,
      projectId: row.projectId,
      visibility: 'project',
      permission: 'ai_agents',
    },
    provenance: {
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.changedAt),
      author: `agent:${row.agentId}`,
      runId: row.id,
    },
    metadata: {
      agentId: row.agentId,
      agentName: row.agentName,
      status: row.status,
      trigger: row.trigger,
      model: row.model,
      identifier,
      projectKey: row.key,
    },
    links: [
      ...(identifier ? [{ target: taskTarget(identifier), kind: 'parent' as const }] : []),
      ...mentionLinks(parts.join('\n')).filter(
        (link) => !identifier || link.target !== taskTarget(identifier),
      ),
    ],
  };
}

export const runSource: KnowledgeSource = {
  id: 'run',
  label: { i18n: 'knowledge.source.run' },
  icon: 'bot',
  async list(ctx) {
    const limit = pageLimit(ctx);
    const rows = await runRows(
      and(gt(agentRun.id, cursorId(ctx)), ctx.since ? sql`${changed} >= ${ctx.since}` : undefined),
      limit,
    );
    return { items: rows.map(runItem), cursor: nextCursor(rows, limit, (row) => row.id) };
  },
  async get(id) {
    const [row] = await runRows(eq(agentRun.id, Number(id) || 0));
    return row ? runItem(row) : null;
  },
  async present(ids) {
    const numbers = numericIds(ids);
    if (numbers.length === 0) return [];
    const rows = await db
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(inArray(agentRun.id, numbers));
    return rows.map((row) => String(row.id));
  },
};
