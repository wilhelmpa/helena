import { agentRun, pipelineRun } from '@repo/db';
import { sql, type AnyColumn } from 'drizzle-orm';

function unfinishedIssue(issueId: AnyColumn) {
  return sql<boolean>`(${issueId} is null or exists (
    select 1 from issue task join project_column task_column on task_column.id = task.column_id
    where task.id = ${issueId} and task.archived_at is null
      and task_column.state_type not in ('completed', 'canceled')
  ))`;
}

export const unresolvedPipelineFailure = sql<boolean>`
  ${pipelineRun.status} = 'failed'
  and not ${pipelineRun.dryRun}
  and ${unfinishedIssue(pipelineRun.issueId)}
  and not exists (
    select 1 from pipeline_run recovered
    where recovered.status = 'succeeded' and not recovered.dry_run
      and recovered.project_id = ${pipelineRun.projectId}
      and recovered.kind = ${pipelineRun.kind}
      and recovered.pipeline_id is not distinct from ${pipelineRun.pipelineId}
      and recovered.agent_id is not distinct from ${pipelineRun.agentId}
      and recovered.created_at > ${pipelineRun.createdAt}
      and recovered.finished_at >= coalesce(${pipelineRun.finishedAt}, ${pipelineRun.createdAt})
      and (
        (${pipelineRun.issueId} is not null and recovered.issue_id = ${pipelineRun.issueId})
        or (${pipelineRun.scheduleId} is not null and recovered.schedule_id = ${pipelineRun.scheduleId}
          and recovered.scheduled_for is not distinct from ${pipelineRun.scheduledFor})
      )
  )`;

export const unresolvedAgentFailure = sql<boolean>`
  ${agentRun.status} = 'failed' and ${agentRun.archivedAt} is null
  and ${unfinishedIssue(agentRun.issueId)}`;
