import {
  aiAgent,
  db,
  issue,
  pipeline,
  pipelineRun,
  pipelineRunStep,
  project,
  user,
} from '@repo/db';
import { alias } from 'drizzle-orm/pg-core';
import { and, desc, eq, exists, inArray, or, sql, type SQL } from 'drizzle-orm';
import { agentTeamStages } from '#modules/control-plane-workflows/agent-team';
import { emptyEntry, type ActivityEntry, type ActivityFilters } from './entry';

// The runs of the Helena engine in a timeline: agent teams, builder workflows and
// routines, read from Helena's own run history like the agent runs and chats beside
// them.

const lead = alias(user, 'lead');
const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'rejected', 'skipped']);

function total(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value != null);
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

export async function workflowRunEntries(
  projectIds: number[],
  filters: ActivityFilters,
  limit: number,
): Promise<ActivityEntry[]> {
  if (projectIds.length === 0 || filters.kind === 'chat' || filters.kind === 'agent-run') return [];
  const at = sql<string>`to_char(${pipelineRun.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  const id = sql<string>`'workflow:' || ${pipelineRun.id}`;
  const conditions: (SQL | undefined)[] = [inArray(pipelineRun.projectId, projectIds)];
  if (filters.kind === 'agent-team-run') conditions.push(eq(pipelineRun.kind, 'agent_team'));
  if (filters.kind === 'workflow-run') conditions.push(sql`${pipelineRun.kind} <> 'agent_team'`);
  if (filters.agentId != null)
    conditions.push(
      or(
        eq(pipelineRun.agentId, filters.agentId),
        exists(
          db
            .select({ one: sql`1` })
            .from(pipelineRunStep)
            .where(
              and(
                eq(pipelineRunStep.runId, pipelineRun.id),
                eq(pipelineRunStep.agentId, filters.agentId),
              ),
            ),
        ),
      ),
    );
  if (filters.cursor)
    conditions.push(
      sql`(${pipelineRun.createdAt}, ${id} COLLATE "C") < (${new Date(filters.cursor.at)}, ${filters.cursor.id} COLLATE "C")`,
    );
  const rows = await db
    .select({
      run: pipelineRun,
      at,
      entryId: id,
      projectKey: project.key,
      projectName: project.name,
      pipelineName: pipeline.name,
      issueTitle: issue.title,
      sequenceNumber: issue.sequenceNumber,
      agentUsername: aiAgent.username,
      agentName: lead.name,
    })
    .from(pipelineRun)
    .innerJoin(project, eq(project.id, pipelineRun.projectId))
    .leftJoin(pipeline, eq(pipeline.id, pipelineRun.pipelineId))
    .leftJoin(issue, eq(issue.id, pipelineRun.issueId))
    .leftJoin(aiAgent, eq(aiAgent.id, pipelineRun.agentId))
    .leftJoin(lead, eq(lead.id, aiAgent.userId))
    .where(and(...conditions))
    .orderBy(desc(pipelineRun.createdAt), sql`${id} COLLATE "C" DESC`)
    .limit(limit + 1);
  const stages = await agentTeamStages(
    rows.filter(({ run }) => run.kind === 'agent_team').map(({ run }) => run.id),
  );
  return rows.map(({ run, ...row }): ActivityEntry => {
    const own = stages.get(run.id) ?? [];
    const policy = ((
      run.definition as { steps?: { team?: { policy?: Record<string, unknown> } }[] } | null
    )?.steps?.[0]?.team?.policy ?? {}) as Record<string, unknown>;
    return {
      ...emptyEntry,
      id: row.entryId,
      kind: run.kind === 'agent_team' ? 'agent-team-run' : 'workflow-run',
      at: row.at,
      status: run.status,
      project: { id: run.projectId, key: row.projectKey, name: row.projectName },
      agent:
        run.agentId && row.agentUsername
          ? {
              id: run.agentId,
              username: row.agentUsername,
              name: row.agentName ?? row.agentUsername,
            }
          : null,
      issue:
        run.issueId && row.sequenceNumber != null
          ? {
              id: run.issueId,
              identifier: `${row.projectKey}-${row.sequenceNumber}`,
              sequenceNumber: row.sequenceNumber,
              title: row.issueTitle ?? '',
            }
          : null,
      trigger: run.trigger,
      maxTurns: typeof policy.maxTurns === 'number' ? policy.maxTurns : null,
      runBudgetSeconds:
        typeof policy.runBudgetSeconds === 'number' ? policy.runBudgetSeconds : null,
      workflowId:
        run.kind === 'agent_team' ? 'agent-team' : run.kind === 'routine' ? 'routine' : 'workflow',
      workflowRunId: run.id,
      durationMs:
        TERMINAL.has(run.status) && run.finishedAt
          ? run.finishedAt.getTime() - run.createdAt.getTime()
          : null,
      inputTokens: total(own.map((stage) => stage.inputTokens)),
      outputTokens: total(own.map((stage) => stage.outputTokens)),
    };
  });
}
