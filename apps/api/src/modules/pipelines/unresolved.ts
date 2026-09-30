import { agentRun, pipelineRun } from '@repo/db';
import { sql } from 'drizzle-orm';

export const unresolvedPipelineFailure = sql<boolean>`
  ${pipelineRun.status} = 'failed'
  and not ${pipelineRun.dryRun}
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
  ${agentRun.status} = 'failed' and ${agentRun.archivedAt} is null`;
