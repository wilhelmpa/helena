import { db, issueActivity, pipelineRunStep } from '@repo/db';
import { sql } from 'drizzle-orm';
import { notifyComment } from '#modules/notifications/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { LIMITS, type NotifyStep } from '#modules/pipelines/definition';
import { renderTemplate } from '#modules/pipelines/render';
import { clip, loadRun, renderContext, stepRow, writeStep } from '../../run-context';
import {
  StepFailure,
  type StepContext,
  type StepExecution,
  type WorkflowStepType,
} from '../../sdk';

// A notification: a comment on the run's task that addresses the chosen people, so it
// reaches their inbox and their email or Telegram like a mention. The task's watchers
// hear of it as of any comment.

type Step = NotifyStep & { [field: string]: unknown };

const RECIPIENTS = ['assignee', 'watchers', 'members'] as const;

interface NotifyState {
  commentId?: number;
  notified?: boolean;
}

async function send(runId: string, step: NotifyStep, at: StepExecution): Promise<string> {
  const existing = await stepRow(runId, at);
  const state = (existing?.state ?? {}) as NotifyState;
  if (existing?.status === 'succeeded' && state.notified) return existing.summary ?? '';
  const context = await loadRun(runId);
  if (!context.task) throw new StepFailure('The workflow run has no task');
  const body = clip(
    renderTemplate(step.message, await renderContext(context, at.seq)).trim(),
    4_000,
  );
  if (context.run.dryRun) {
    await writeStep(runId, step, at, {
      status: 'simulated',
      outcome: 'success',
      summary: body,
      finishedAt: new Date(),
    });
    return body;
  }
  let commentId = state.commentId;
  if (!commentId)
    commentId = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ state: pipelineRunStep.state })
        .from(pipelineRunStep)
        .where(
          sql`${pipelineRunStep.runId} = ${runId} AND ${pipelineRunStep.stepId} = ${at.stepId} AND ${pipelineRunStep.iteration} = ${at.iteration}`,
        )
        .for('update');
      const stored = (row?.state ?? {}) as NotifyState;
      if (stored.commentId) return stored.commentId;
      const [comment] = await tx
        .insert(issueActivity)
        .values({
          issueId: context.task!.id,
          kind: 'comment',
          actorName: `Workflow: ${context.name}`,
          body,
        })
        .returning({ id: issueActivity.id });
      await writeStep(runId, step, at, { state: { commentId: comment!.id } }, tx);
      return comment!.id;
    });
  const recipients =
    step.to.kind === 'assignee'
      ? context.task.assigneeUserId
        ? [context.task.assigneeUserId]
        : []
      : step.to.kind === 'members'
        ? step.to.userIds
        : [];
  await notifyComment(
    context.project.id,
    { issueId: context.task.id, id: commentId, actorUserId: null, body },
    { memberIds: recipients, agentUserIds: [] },
  );
  await writeStep(runId, step, at, {
    status: 'succeeded',
    outcome: 'success',
    summary: body,
    state: { commentId, notified: true },
    finishedAt: new Date(),
  });
  await bumpControlPlaneRevision(context.project.id);
  return body;
}

export const notifyStep: WorkflowStepType<Step> = {
  type: 'notify',
  ui: { builder: true, icon: 'bell' },
  producesResult: true,
  read(value, reader, scope) {
    const to =
      value.to && typeof value.to === 'object' ? (value.to as Record<string, unknown>) : null;
    const kind = reader.choice(to?.kind, 'to.kind', RECIPIENTS);
    const message = reader.text(value.message, 'message', LIMITS.message);
    if (kind !== 'members') return { to: { kind }, message };
    if (scope.template) reader.issue('member_in_template', 'to.userIds');
    const userIds = Array.isArray(to?.userIds)
      ? to.userIds.filter((id): id is string => typeof id === 'string' && id.length <= 100)
      : [];
    if (userIds.length === 0) reader.issue('required', 'to.userIds');
    if (userIds.length > LIMITS.values)
      reader.issue('too_many', 'to.userIds', { max: LIMITS.values });
    return { to: { kind, userIds }, message };
  },
  templateFields: (step) => [{ field: 'message', text: step.message }],
  async execute(context: StepContext<Step>) {
    const summary = await context.op('send', () =>
      send(context.run.id, context.step, context.execution),
    );
    return { kind: 'continue', outcome: 'success', summary };
  },
};
