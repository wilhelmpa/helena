import { db, aiAgent, agentRun, projectMember, issue, projectColumn } from '@repo/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { iso } from '#shared/lib';

export async function automationHealth(projectId: number) {
  const offline = await db
    .select({ id: aiAgent.id, name: aiAgent.username, lastSeenAt: aiAgent.lastSeenAt })
    .from(aiAgent)
    .innerJoin(
      projectMember,
      and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, projectId)),
    )
    .where(
      and(
        eq(aiAgent.template, false),
        isNull(aiAgent.pausedAt),
        sql`coalesce(${aiAgent.lastSeenAt}, ${aiAgent.createdAt}) < now() - interval '10 minutes'`,
      ),
    );
  const runs = await db
    .select({
      id: agentRun.id,
      agentId: agentRun.agentId,
      issueId: agentRun.issueId,
      status: agentRun.status,
      createdAt: agentRun.createdAt,
      finishedAt: agentRun.finishedAt,
      hasError: sql<boolean>`${agentRun.lastError} IS NOT NULL`,
    })
    .from(agentRun)
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .leftJoin(issue, eq(issue.id, agentRun.issueId))
    .leftJoin(projectColumn, eq(projectColumn.id, issue.columnId))
    .where(
      and(
        eq(agentRun.projectId, projectId),
        isNull(aiAgent.pausedAt),
        sql`(${agentRun.issueId} IS NULL OR (${issue.archivedAt} IS NULL AND ${projectColumn.stateType} NOT IN ('completed', 'canceled')))`,
        sql`((${agentRun.status} = 'pending' AND ${agentRun.createdAt} < now() - interval '2 hours')
        OR (${agentRun.status} = 'failed' AND ${agentRun.finishedAt} > now() - interval '24 hours'))`,
        sql`NOT EXISTS (SELECT 1 FROM agent_run newer WHERE newer.agent_id = ${agentRun.agentId}
        AND newer.project_id = ${agentRun.projectId} AND newer.issue_id IS NOT DISTINCT FROM ${agentRun.issueId}
        AND newer.id > ${agentRun.id} AND newer.status IN ('success', 'pending'))`,
      ),
    )
    .orderBy(agentRun.id)
    .limit(101);
  return {
    checkedAt: new Date().toISOString(),
    offlineAgents: offline.map((item) => ({
      ...item,
      lastSeenAt: item.lastSeenAt ? iso(item.lastSeenAt) : null,
    })),
    runs: runs
      .slice(0, 100)
      .map((item) => ({
        ...item,
        createdAt: iso(item.createdAt),
        finishedAt: item.finishedAt ? iso(item.finishedAt) : null,
      })),
    truncated: runs.length > 100,
  };
}
