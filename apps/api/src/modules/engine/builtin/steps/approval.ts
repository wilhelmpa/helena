import { db, pipelineRunStep } from '@repo/db';
import { and, eq, lt } from 'drizzle-orm';
import { getMembership } from '#modules/members/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { LIMITS, type ApprovalStep } from '#modules/pipelines/definition';
import { renderTemplate } from '#modules/pipelines/render';
import { policyDecider } from '../../registry';
import { clip, loadRun, renderContext, setRunStatus, stepRow, writeStep } from '../../run-context';
import { type StepContext, type StepExecution, type WorkflowStepType } from '../../sdk';
import { engineWaitSeconds } from '../../dbos';

// An approval gate: the run waits until a person with the actions edit permission
// approves or rejects the step on the Approvals page, unless the policy engine
// (autopilot) decides it. A rejection ends the run, or sends it back to an earlier step
// of its path until the step's loops are used up. The note is `{{step.<id>.note}}`.

type Step = ApprovalStep & { [field: string]: unknown };

interface Decision {
  approved: boolean;
}

// Opens the gate once: the rendered message on a waiting row. A test run approves at
// once; the policy engine may approve or refuse without a person.
async function open(runId: string, step: ApprovalStep, at: StepExecution) {
  const context = await loadRun(runId);
  const existing = await stepRow(runId, at);
  const decided = decisionOf(existing);
  if (decided) return { decided, loops: await reworkLoops(runId, step.id, at.iteration) };
  const message =
    (existing?.status === 'waiting' ? existing.summary : null) ??
    clip(
      renderTemplate(step.message, await renderContext(context, at.seq)).trim() ||
        `Approve step "${step.name}" of workflow "${context.name}".`,
      2_000,
    );
  const loops = await reworkLoops(runId, step.id, at.iteration);
  if (context.run.dryRun) {
    await writeStep(runId, step, at, {
      status: 'simulated',
      outcome: 'approved',
      summary: message,
      finishedAt: new Date(),
    });
    return { decided: { approved: true }, loops };
  }
  const policy = await policyDecider().decide({
    agentId: null,
    projectId: context.project.id,
    actionCategory: 'approve',
    taskId: context.task?.id ?? null,
    subject: message,
  });
  if (policy.decision !== 'ask') {
    const approved = policy.decision === 'allow';
    await writeStep(runId, step, at, {
      status: 'succeeded',
      outcome: approved ? 'approved' : 'rejected',
      summary: message,
      note: policy.reason ?? null,
      finishedAt: new Date(),
    });
    return { decided: { approved }, loops };
  }
  await writeStep(runId, step, at, { status: 'waiting', summary: message });
  await setRunStatus(runId, 'waiting');
  await bumpControlPlaneRevision(context.project.id);
  return { decided: null, loops };
}

function decisionOf(row: typeof pipelineRunStep.$inferSelect | null): Decision | null {
  if (!row || (row.status !== 'succeeded' && row.status !== 'simulated')) return null;
  if (row.outcome !== 'approved' && row.outcome !== 'rejected') return null;
  return { approved: row.outcome === 'approved' };
}

// How often this approval sent the run back before this execution.
async function reworkLoops(runId: string, stepId: string, iteration: number): Promise<number> {
  const rows = await db
    .select({ outcome: pipelineRunStep.outcome })
    .from(pipelineRunStep)
    .where(
      and(
        eq(pipelineRunStep.runId, runId),
        eq(pipelineRunStep.stepId, stepId),
        lt(pipelineRunStep.iteration, iteration),
      ),
    );
  return rows.filter((row) => row.outcome === 'rejected').length;
}

// Records a person's decision on the waiting step of a run (the Approvals page). The
// run reads it when it wakes. Null when the step does not wait.
export async function recordApprovalDecision(
  runId: string,
  projectId: number,
  at: { stepId: string; iteration: number },
  input: { approved: boolean; note?: string | null; decidedBy: string },
): Promise<boolean> {
  const person = (await getMembership(projectId, input.decidedBy)) ? input.decidedBy : null;
  const updated = await db
    .update(pipelineRunStep)
    .set({
      status: 'succeeded',
      outcome: input.approved ? 'approved' : 'rejected',
      decidedBy: person,
      note: input.note?.trim() ? input.note.trim().slice(0, 2_000) : null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(pipelineRunStep.runId, runId),
        eq(pipelineRunStep.stepId, at.stepId),
        eq(pipelineRunStep.iteration, at.iteration),
        eq(pipelineRunStep.status, 'waiting'),
      ),
    )
    .returning({ runId: pipelineRunStep.runId });
  return updated.length > 0;
}

export const approvalStep: WorkflowStepType<Step> = {
  type: 'approval',
  ui: { builder: true, icon: 'shield-check' },
  producesResult: true,
  read(value, reader) {
    const onReject =
      value.onReject && typeof value.onReject === 'object'
        ? (value.onReject as Record<string, unknown>)
        : null;
    const action = reader.choice(onReject?.action, 'onReject.action', ['end', 'goto'] as const);
    return {
      message: reader.text(value.message ?? '', 'message', LIMITS.message, false),
      onReject:
        action === 'end'
          ? { action }
          : {
              action,
              stepId: typeof onReject?.stepId === 'string' ? onReject.stepId : '',
              maxLoops: reader.integer(onReject?.maxLoops, 'onReject.maxLoops', {
                minimum: 1,
                maximum: LIMITS.maxLoops,
              }),
            },
    };
  },
  templateFields: (step) => [{ field: 'message', text: step.message }],
  checkDefinition(step, path) {
    if (step.onReject.action !== 'goto') return [];
    const target = step.onReject.stepId;
    return path.some((before) => before.id === target)
      ? []
      : [{ code: 'invalid_rework_target', stepId: step.id, field: 'onReject.stepId' }];
  },
  async execute(context: StepContext<Step>) {
    const { step, execution } = context;
    const opened = await context.op('open', () => open(context.run.id, step, execution));
    let decided = opened.decided;
    while (!decided) {
      await context.waitForSignal('decision', engineWaitSeconds(6 * 3600));
      decided = await context.op('check', async () =>
        decisionOf(await stepRow(context.run.id, execution)),
      );
    }
    await context.op('resume', () => setRunStatus(context.run.id, 'running'));
    if (decided.approved) return { kind: 'continue', outcome: 'success' };
    const rework = step.onReject;
    if (rework.action === 'goto' && opened.loops < rework.maxLoops)
      return { kind: 'goto', stepId: rework.stepId };
    return { kind: 'end', status: 'rejected' };
  },
};
