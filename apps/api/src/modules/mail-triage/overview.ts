import {
  db,
  helenaMailClassification,
  mailThread,
  mailAccount,
  pipelineRun,
  pipelineRunStep,
} from '@repo/db';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { getClassView } from '#modules/decisions/settings';
import { MAIL_CLASS } from '#modules/decisions/classes';
import { iso } from '#shared/lib';
import { compactMailSnippet } from '#modules/mail/threads/compact';

// One latest classification per thread; totals count threads, not historical messages.
export async function mailTriageOverview(teamId: number, projectId: number, accountId?: number) {
  const latest = db
    .select({
      threadId: helenaMailClassification.threadId,
      status: helenaMailClassification.status,
      category: helenaMailClassification.category,
      priority: helenaMailClassification.priority,
      rank: sql<number>`row_number() over (partition by ${helenaMailClassification.threadId} order by ${helenaMailClassification.createdAt} desc, ${helenaMailClassification.id} desc)`.as(
        'rank',
      ),
    })
    .from(helenaMailClassification)
    .where(eq(helenaMailClassification.teamId, teamId))
    .as('latest');
  const conditions: SQL[] = [eq(mailThread.teamId, teamId), eq(mailThread.projectId, projectId)];
  if (accountId !== undefined) conditions.push(eq(mailThread.accountId, accountId));
  const where = and(...conditions);
  const join = and(eq(latest.threadId, mailThread.id), eq(latest.rank, 1));
  const [groups, unresolved, runs, accounts, settings] = await Promise.all([
    db
      .select({
        status: sql<string>`coalesce(${latest.status}, 'unclassified')`,
        category: latest.category,
        priority: latest.priority,
        count: sql<number>`count(*)::int`,
      })
      .from(mailThread)
      .leftJoin(latest, join)
      .where(where)
      .groupBy(latest.status, latest.category, latest.priority),
    db
      .select({
        threadId: mailThread.id,
        accountId: mailThread.accountId,
        subject: mailThread.subject,
        snippet: mailThread.snippet,
        lastMessageAt: mailThread.lastMessageAt,
        status: sql<string>`coalesce(${latest.status}, 'unclassified')`,
      })
      .from(mailThread)
      .leftJoin(latest, join)
      .where(and(where, sql`coalesce(${latest.status}, 'unclassified') <> 'classified'`))
      .orderBy(desc(mailThread.lastMessageAt), desc(mailThread.id))
      .limit(25),
    db
      .select({
        id: pipelineRun.id,
        status: pipelineRun.status,
        createdAt: pipelineRun.createdAt,
        finishedAt: pipelineRun.finishedAt,
        error: pipelineRun.error,
        triage: sql<unknown>`(select ${pipelineRunStep.state}->'mailTriage' from ${pipelineRunStep} where ${pipelineRunStep.runId} = ${pipelineRun.id} and ${pipelineRunStep.state}->'mailTriage' is not null order by ${pipelineRunStep.finishedAt} desc nulls last limit 1)`,
      })
      .from(pipelineRun)
      .where(
        and(
          eq(pipelineRun.projectId, projectId),
          eq(pipelineRun.kind, 'routine'),
          sql`${pipelineRun.title} like 'Mail-Triage · %'`,
        ),
      )
      .orderBy(desc(pipelineRun.createdAt))
      .limit(5),
    db
      .select({ id: mailAccount.id, address: mailAccount.address, enabled: mailAccount.enabled })
      .from(mailAccount)
      .where(
        and(
          eq(mailAccount.teamId, teamId),
          sql`(${mailAccount.projectId} = ${projectId} or exists (select 1 from ${mailThread} where ${mailThread.accountId} = ${mailAccount.id} and ${mailThread.projectId} = ${projectId}))`,
          ...(accountId === undefined ? [] : [eq(mailAccount.id, accountId)]),
        ),
      ),
    getClassView(teamId, MAIL_CLASS),
  ]);
  const counts = {
    status: {} as Record<string, number>,
    category: {} as Record<string, number>,
    priority: {} as Record<string, number>,
  };
  let total = 0;
  for (const group of groups) {
    total += group.count;
    for (const dimension of ['status', 'category', 'priority'] as const) {
      const key = group[dimension] ?? 'unclassified';
      counts[dimension][key] = (counts[dimension][key] ?? 0) + group.count;
    }
  }
  const unresolvedCount = total - (counts.status.classified ?? 0);
  return {
    projectId,
    accountId: accountId ?? null,
    accounts,
    total,
    counts,
    unresolved: {
      total: unresolvedCount,
      hasMore: unresolvedCount > unresolved.length,
      items: unresolved.map((row) => ({
        ...row,
        snippet: compactMailSnippet(row.snippet),
        lastMessageAt: iso(row.lastMessageAt),
      })),
    },
    // Routine outcomes belong to the project, even when thread counts filter one account.
    runsScope: 'project' as const,
    lastRuns: runs.map((row) => ({
      ...row,
      triage: compactRoutineTriage(row.triage),
      createdAt: iso(row.createdAt),
      finishedAt: row.finishedAt ? iso(row.finishedAt) : null,
    })),
    settings,
  };
}

function compactRoutineTriage(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  return {
    calls: row.calls,
    messages: Array.isArray(row.messageIds) ? row.messageIds.length : 0,
    tasks: Array.isArray(row.issueIds) ? row.issueIds.length : 0,
    receipts: Array.isArray(row.receiptIds) ? row.receiptIds.length : 0,
    failed: row.failed,
    reviewRequired: row.reviewRequired,
    hasMore: row.hasMore,
  };
}
