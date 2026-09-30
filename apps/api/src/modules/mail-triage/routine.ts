import {
  agentRun,
  aiAgent,
  projectColumn as column,
  db,
  issue,
  label,
  pipelineRun,
  pipelineRunStep,
} from '@repo/db';
import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { blockedLabelNames } from '@helena/locales/defaults';
import { listColumns } from '#modules/columns/service';
import { createIssue, getIssue, setIssueLabels, updateIssue } from '#modules/issues/service';
import { createComment } from '#modules/issues/activity';
import { getProjectById } from '#modules/projects/service';
import type { TriageBatchResponse } from './model';
import { isMailTriageRoutine } from './routine-policy';

type Batch = typeof TriageBatchResponse.static;
interface Summary {
  calls: number;
  messageIds: number[];
  issueIds: number[];
  receiptIds: number[];
  failed: number;
  reviewRequired: number;
  hasMore: boolean;
  error?: string;
}

async function closeControlTask(taskId: number, projectId: number) {
  const task = await getIssue(taskId);
  if (!task || task.projectId !== projectId || task.archivedAt) return;
  const completed = (await listColumns(projectId)).find((c) => c.stateType === 'completed');
  if (!completed) throw new Error('Mail triage control task has no completed state');
  const blocked = await db
    .select({ id: label.id })
    .from(label)
    .where(
      and(
        eq(label.projectId, projectId),
        inArray(
          sql`lower(${label.name})`,
          blockedLabelNames().map((name) => name.toLowerCase()),
        ),
      ),
    );
  if (task.labelIds.some((id) => blocked.some((label) => label.id === id)))
    await setIssueLabels(
      projectId,
      task.id,
      task.labelIds.filter((id) => !blocked.some((label) => label.id === id)),
      { system: 'Workflow' },
      false,
    );
  await updateIssue(task.id, { columnId: completed.id }, { system: 'Workflow' }, { quiet: true });
}

export async function recordRoutineTriage(
  projectId: number,
  userId: string,
  header: string | null,
  batch: Batch,
): Promise<void> {
  const runId = Number(header);
  if (!Number.isSafeInteger(runId) || runId <= 0) return;
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        fireId: pipelineRunStep.runId,
        stepId: pipelineRunStep.stepId,
        iteration: pipelineRunStep.iteration,
        state: pipelineRunStep.state,
        taskId: pipelineRun.issueId,
        title: pipelineRun.title,
      })
      .from(agentRun)
      .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
      .innerJoin(
        pipelineRunStep,
        sql`${pipelineRunStep.state}->'agentRunIds' @> ${JSON.stringify([runId])}::jsonb`,
      )
      .innerJoin(pipelineRun, eq(pipelineRun.id, pipelineRunStep.runId))
      .where(
        and(
          eq(agentRun.id, runId),
          eq(aiAgent.userId, userId),
          eq(agentRun.projectId, projectId),
          eq(agentRun.status, 'pending'),
          isNotNull(agentRun.claimedAt),
          eq(pipelineRun.kind, 'routine'),
          eq(pipelineRun.projectId, projectId),
          inArray(pipelineRun.status, ['pending', 'running', 'waiting']),
          eq(pipelineRunStep.kind, 'delegate'),
        ),
      )
      .for('update', { of: pipelineRunStep });
    if (!row?.taskId || !isMailTriageRoutine(row.title)) return null;
    const state = (row.state ?? {}) as Record<string, unknown>;
    const prior = state.mailTriage as Summary | undefined;
    const summary: Summary = {
      calls: (prior?.calls ?? 0) + 1,
      messageIds: [
        ...new Set([...(prior?.messageIds ?? []), ...batch.results.map((r) => r.messageId)]),
      ],
      issueIds: [
        ...new Set([
          ...(prior?.issueIds ?? []),
          ...batch.results.flatMap((r) => (r.issueId === null ? [] : [r.issueId])),
        ]),
      ],
      receiptIds: [...new Set([...(prior?.receiptIds ?? []), ...batch.receiptIds])],
      failed: (prior?.failed ?? 0) + batch.failed,
      reviewRequired: (prior?.reviewRequired ?? 0) + batch.reviewRequired,
      hasMore: batch.hasMore,
      error: prior?.error ?? batch.results.find((r) => r.error)?.error,
    };
    await tx
      .update(pipelineRunStep)
      .set({ state: { ...state, mailTriage: summary } })
      .where(
        and(
          eq(pipelineRunStep.runId, row.fireId),
          eq(pipelineRunStep.stepId, row.stepId),
          eq(pipelineRunStep.iteration, row.iteration),
        ),
      );
    return { taskId: row.taskId, summary };
  });
  if (saved && saved.summary.failed === 0 && !saved.summary.hasMore)
    await closeControlTask(saved.taskId, projectId);
}

async function routineState(runId: string) {
  const [row] = await db
    .select({
      run: pipelineRun,
      stepId: pipelineRunStep.stepId,
      iteration: pipelineRunStep.iteration,
      state: pipelineRunStep.state,
    })
    .from(pipelineRun)
    .innerJoin(
      pipelineRunStep,
      and(eq(pipelineRunStep.runId, pipelineRun.id), eq(pipelineRunStep.stepId, 'dispatch')),
    )
    .where(and(eq(pipelineRun.id, runId), eq(pipelineRun.kind, 'routine')));
  return row && isMailTriageRoutine(row.run.title) ? row : null;
}

export async function routineTriageError(runId: string): Promise<string | null> {
  const row = await routineState(runId);
  if (!row) return null;
  const summary = (row.state as { mailTriage?: Summary } | null)?.mailTriage;
  if (!summary?.calls) return 'Mail triage was not executed by the routine agent';
  if (summary.failed)
    return `Mail triage failed for ${summary.failed} operations${summary.error ? `: ${summary.error}` : ''}`;
  if (summary.hasMore) return 'Mail triage stopped with unprocessed mail';
  return null;
}

export async function finishRoutineTriage(runId: string, error: string | null): Promise<boolean> {
  const row = await routineState(runId);
  if (!row?.run.issueId) return false;
  const state = (row.state ?? {}) as Record<string, unknown>;
  if (state.mailTriageReported) return true;
  const summary = state.mailTriage as Summary | undefined;
  const projectId = row.run.projectId;
  let incidentId: number | null = null;
  let incidentHref: string | null = null;
  if (error) {
    const title = 'Mail triage: technical run failed';
    incidentId = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`volition-mail-triage-incident:${projectId}`}, 0))`,
      );
      const [existing] = await tx
        .select({ id: issue.id })
        .from(issue)
        .innerJoin(column, eq(column.id, issue.columnId))
        .where(
          and(
            eq(issue.projectId, projectId),
            eq(issue.title, title),
            isNull(issue.archivedAt),
            ne(column.stateType, 'completed'),
            ne(column.stateType, 'canceled'),
          ),
        )
        .limit(1);
      if (existing) return existing.id;
      const unstarted = (await listColumns(projectId)).find((c) => c.stateType === 'unstarted');
      if (!unstarted) throw new Error('Mail triage incident has no unstarted state');
      const project = await getProjectById(projectId);
      if (!project) throw new Error('Mail triage project no longer exists');
      const task = await createIssue(
        project,
        {
          title,
          columnId: unstarted.id,
          description: `Routine ${row.run.scheduleId}; run ${runId}.\n${error}`,
          priority: 'high',
        },
        row.run.actorUserId,
        { fromWorkflow: true },
      );
      return task.id;
    });
    const incident = await getIssue(incidentId);
    if (incident)
      incidentHref = `/project/${incident.identifier.split('-')[0]}/issue/${incident.sequenceNumber}`;
    await createComment({
      issueId: incidentId,
      body: `${new Date().toISOString()} · ${runId}: ${error.slice(0, 2000)}`,
    });
  }
  await createComment({
    issueId: row.run.issueId,
    body: [
      `${new Date().toISOString()} · Mail triage · ${runId}: ${error ? 'failed' : 'completed successfully'}.`,
      `${summary?.messageIds.length ?? 0} messages checked; ${summary?.issueIds.length ?? 0} tasks; ${summary?.receiptIds.length ?? 0} receipts; ${summary?.reviewRequired ?? 0} uncertain classifications in the inbox.`,
      ...(error
        ? [
            `Error: ${error.slice(0, 2000)}. Incident: ${incidentHref ?? `#${incidentId}`}. This control cycle has ended; the next scheduled cycle may retry.`,
          ]
        : []),
    ].join('\n'),
  });
  await closeControlTask(row.run.issueId, projectId);
  await db
    .update(pipelineRunStep)
    .set({ state: { ...state, mailTriageReported: true } })
    .where(
      and(
        eq(pipelineRunStep.runId, runId),
        eq(pipelineRunStep.stepId, row.stepId),
        eq(pipelineRunStep.iteration, row.iteration),
      ),
    );
  return true;
}
