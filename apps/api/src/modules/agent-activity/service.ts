import {
  agentChatMessage,
  agentChatThread,
  agentRun,
  aiAgent,
  db,
  issue,
  project,
  projectMember,
  teamMember,
  user,
} from '@repo/db';
import { and, desc, eq, exists, inArray, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { num } from '#shared/lib';
import { closings } from '#modules/analytics/service';
import { agentRunStatus as runStatus } from '#modules/pipelines/runs';
import { projectIdsWithPermission } from '#modules/members/service';
import {
  compareEntries,
  emptyEntry,
  type ActivityCursor,
  type ActivityEntry,
  type ActivityFilters,
  type ActivityPage,
} from './entry';
import type { ActivityKind } from './model';
import { purgeActivityEntries } from '#modules/trash/service';
import { workflowRunEntries } from './workflow-runs';
import { unresolvedAgentFailure } from '#modules/pipelines/unresolved';
import { unresolvedChatFailure } from './attention';

// One timeline of what the agents did: their chat answers, their runs, and the runs of
// the Helena engine (agent teams, workflows, routines), merged newest first.

function sortKey(createdAt: AnyColumn, id: SQL) {
  const at = sql`date_trunc('milliseconds', ${createdAt})`;
  return {
    at,
    id: sql`(${id}) COLLATE "C"`,
    iso: sql<string>`to_char(${at} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  };
}

function olderThan(key: ReturnType<typeof sortKey>, cursor: ActivityCursor | null) {
  if (!cursor) return undefined;
  return sql`(${key.at} < ${cursor.at}::timestamptz OR (${key.at} = ${cursor.at}::timestamptz AND ${key.id} < ${cursor.id} COLLATE "C"))`;
}

function elapsed(startedAt: Date | null, finishedAt: Date | null): number | null {
  return startedAt && finishedAt ? finishedAt.getTime() - startedAt.getTime() : null;
}

async function agentRunEntries(
  projectIds: number[],
  filters: ActivityFilters,
  limit: number,
): Promise<ActivityEntry[]> {
  if (projectIds.length === 0) return [];
  const key = sortKey(agentRun.createdAt, sql`'run:' || ${agentRun.id}`);
  const rows = await db
    .select({
      id: agentRun.id,
      at: key.iso,
      status: agentRun.status,
      requiresAttention: unresolvedAgentFailure,
      attempts: agentRun.attempts,
      nextAttemptAt: agentRun.nextAttemptAt,
      lastError: agentRun.lastError,
      trigger: agentRun.trigger,
      maxTurns: agentRun.maxTurns,
      runBudgetSeconds: agentRun.runBudgetSeconds,
      startedAt: agentRun.startedAt,
      finishedAt: agentRun.finishedAt,
      inputTokens: agentRun.inputTokens,
      outputTokens: agentRun.outputTokens,
      projectId: project.id,
      projectKey: project.key,
      projectName: project.name,
      agentId: aiAgent.id,
      agentUsername: aiAgent.username,
      agentName: user.name,
      issueId: issue.id,
      issueSequence: issue.sequenceNumber,
      issueTitle: issue.title,
    })
    .from(agentRun)
    .innerJoin(project, eq(project.id, agentRun.projectId))
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .leftJoin(issue, eq(issue.id, agentRun.issueId))
    .where(
      and(
        inArray(agentRun.projectId, projectIds),
        filters.agentId ? eq(agentRun.agentId, filters.agentId) : undefined,
        // An archived run was dealt with; it stays in the counts, not in the feed.
        isNull(agentRun.archivedAt),
        olderThan(key, filters.cursor),
      ),
    )
    .orderBy(desc(key.at), desc(key.id))
    .limit(limit + 1);
  return rows.map((row) => ({
    ...emptyEntry,
    id: `run:${row.id}`,
    kind: 'agent-run' as const,
    at: row.at,
    status: runStatus(row),
    requiresAttention: row.requiresAttention,
    project: { id: row.projectId, key: row.projectKey, name: row.projectName },
    agent: { id: row.agentId, username: row.agentUsername, name: row.agentName },
    issue:
      row.issueId != null && row.issueSequence != null && row.issueTitle != null
        ? {
            id: row.issueId,
            identifier: `${row.projectKey}-${row.issueSequence}`,
            sequenceNumber: row.issueSequence,
            title: row.issueTitle,
          }
        : null,
    trigger: row.trigger,
    maxTurns: row.maxTurns,
    runBudgetSeconds: row.runBudgetSeconds,
    durationMs: elapsed(row.startedAt, row.finishedAt),
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
  }));
}

// The reader's own chat answers: a chat belongs to one member and one agent, not to a
// project. A project shows the chats with the agents working in it, Home the chats
// with the agents of the reader's teams.
async function chatEntries(
  userId: string,
  within: { id: number; key: string; name: string } | null,
  filters: ActivityFilters,
  limit: number,
): Promise<ActivityEntry[]> {
  const key = sortKey(agentChatMessage.createdAt, sql`'chat:' || ${agentChatMessage.id}`);
  const reachable = within
    ? exists(
        db
          .select({ one: sql`1` })
          .from(projectMember)
          .where(
            and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, within.id)),
          ),
      )
    : exists(
        db
          .select({ one: sql`1` })
          .from(teamMember)
          .where(and(eq(teamMember.teamId, aiAgent.teamId), eq(teamMember.userId, userId))),
      );
  const rows = await db
    .select({
      id: agentChatMessage.id,
      at: key.iso,
      status: agentChatMessage.status,
      requiresAttention: unresolvedChatFailure,
      threadId: agentChatMessage.threadId,
      startedAt: agentChatMessage.startedAt,
      finishedAt: agentChatMessage.finishedAt,
      agentId: aiAgent.id,
      agentUsername: aiAgent.username,
      agentName: user.name,
    })
    .from(agentChatMessage)
    .innerJoin(agentChatThread, eq(agentChatThread.id, agentChatMessage.threadId))
    .innerJoin(aiAgent, eq(aiAgent.id, agentChatMessage.agentId))
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(
      and(
        eq(agentChatMessage.role, 'assistant'),
        eq(agentChatThread.userId, userId),
        filters.agentId ? eq(agentChatMessage.agentId, filters.agentId) : undefined,
        reachable,
        olderThan(key, filters.cursor),
      ),
    )
    .orderBy(desc(key.at), desc(key.id))
    .limit(limit + 1);
  return rows.map((row) => ({
    ...emptyEntry,
    id: `chat:${row.id}`,
    kind: 'chat' as const,
    at: row.at,
    status: row.status,
    requiresAttention: row.requiresAttention,
    project: within,
    agent: { id: row.agentId, username: row.agentUsername, name: row.agentName },
    threadId: row.threadId,
    durationMs: elapsed(row.startedAt, row.finishedAt),
  }));
}

async function readTimeline(input: {
  userId: string;
  runProjectIds: number[];
  chatProject: { id: number; key: string; name: string } | null;
  workflowProjectIds: number[];
  filters: ActivityFilters;
}): Promise<ActivityPage> {
  const { filters } = input;
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const wants = (kind: ActivityKind) => !filters.kind || filters.kind === kind;
  const [runs, chats, workflows, purges] = await Promise.all([
    wants('agent-run') ? agentRunEntries(input.runProjectIds, filters, limit) : [],
    wants('chat') ? chatEntries(input.userId, input.chatProject, filters, limit) : [],
    workflowRunEntries(input.workflowProjectIds, filters, limit),
    wants('workflow-run') && !filters.agentId
      ? purgeActivityEntries(
          input.runProjectIds,
          input.userId,
          filters.cursor,
          limit + 1,
          input.chatProject === null,
        )
      : [],
  ]);
  const purgeEntries: ActivityEntry[] = purges.map((entry) => ({
    ...emptyEntry,
    ...entry,
    kind: 'workflow-run',
    status: 'succeeded',
    workflowId: 'volition.trash-cleanup',
  }));
  const merged = [...runs, ...chats, ...workflows, ...purgeEntries].sort(compareEntries);
  const items = merged.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: merged.length > limit && last ? { at: last.at, id: last.id } : null,
    notice: null,
  };
}

export async function listProjectActivity(
  current: { id: number; key: string; name: string },
  userId: string,
  includeWorkflows: boolean,
  filters: ActivityFilters,
): Promise<ActivityPage> {
  return readTimeline({
    userId,
    runProjectIds: [current.id],
    chatProject: { id: current.id, key: current.key, name: current.name },
    workflowProjectIds: includeWorkflows ? [current.id] : [],
    filters,
  });
}

// Across every project in which the reader's role grants reading agents; the workflow
// runs of those that also grant reading workflows.
export async function listActivity(userId: string, filters: ActivityFilters) {
  const [agentProjects, workflowProjects] = await Promise.all([
    projectIdsWithPermission(userId, 'ai_agents', 'read'),
    projectIdsWithPermission(userId, 'actions', 'read'),
  ]);
  return readTimeline({
    userId,
    runProjectIds: agentProjects,
    chatProject: null,
    workflowProjectIds: workflowProjects.filter((id) => agentProjects.includes(id)),
    filters,
  });
}

// The tokens the project's agent runs used this month, and per task closed this month
// that agents worked on: every run of such a task counts, whenever it ran.
export async function getAgentUsage(projectId: number) {
  const [row] = (await db.execute(sql`
    WITH month AS (SELECT date_trunc('month', now(), 'UTC') AS since),
    closed AS (
      SELECT c.issue_id FROM (${closings(projectId)}) c, month WHERE c.closed_at >= month.since
    ),
    closed_runs AS (
      SELECT r.issue_id, coalesce(r.input_tokens, 0) + coalesce(r.output_tokens, 0) AS tokens
        FROM agent_run r JOIN closed ON closed.issue_id = r.issue_id
       WHERE r.input_tokens IS NOT NULL OR r.output_tokens IS NOT NULL
    )
    SELECT
      to_char((SELECT since FROM month) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS since,
      (SELECT coalesce(sum(r.input_tokens), 0)::float8 FROM agent_run r, month
        WHERE r.project_id = ${projectId} AND r.finished_at >= month.since) AS input_tokens,
      (SELECT coalesce(sum(r.output_tokens), 0)::float8 FROM agent_run r, month
        WHERE r.project_id = ${projectId} AND r.finished_at >= month.since) AS output_tokens,
      (SELECT count(DISTINCT issue_id)::int FROM closed_runs) AS closed_tasks,
      (SELECT coalesce(sum(tokens), 0)::float8 FROM closed_runs) AS closed_task_tokens
  `)) as unknown as {
    since: string;
    input_tokens: number;
    output_tokens: number;
    closed_tasks: number;
    closed_task_tokens: number;
  }[];
  const closedTasks = num(row!.closed_tasks);
  return {
    since: row!.since,
    inputTokens: num(row!.input_tokens),
    outputTokens: num(row!.output_tokens),
    closedTasks,
    tokensPerClosedTask:
      closedTasks > 0 ? Math.round(num(row!.closed_task_tokens) / closedTasks) : null,
  };
}
