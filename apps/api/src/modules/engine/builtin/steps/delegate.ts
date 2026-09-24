import { aiAgent, db, issueActivity, pipelineRun, pipelineRunStep, projectMember } from '@repo/db';
import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { listColumns, type ColumnRow } from '#modules/columns/service';
import {
  createIssue,
  enqueueDelegateRun,
  getIssue,
  restoreIssue,
  updateIssue,
  type IssueRow,
} from '#modules/issues/service';
import { getMembership } from '#modules/members/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import type { DelegateStep } from '#modules/pipelines/definition';
import { loadRun, stepRow, writeStep } from '../../run-context';
import {
  StepFailure,
  type StepContext,
  type StepExecution,
  type WorkflowStepType,
} from '../../sdk';

// The work of a routine: every fire creates a task in the project's first unstarted
// state, delegated to the agent, or reopens the routine's task and delegates it again.
// While the routine's task is open (the one it names, or the one its newest earlier fire
// created) the fire changes nothing and is recorded as skipped. The delegation goes
// through the normal delegation path, so a coordinator of a project that runs agent
// teams gets the task through its team.

type Step = DelegateStep & { [field: string]: unknown };

export interface DelegateResult {
  outcome: 'created' | 'reopened' | 'skipped';
  skipReason: 'task-open' | null;
  taskId: number;
}

interface DelegateState {
  taskId?: number;
  commented?: boolean;
}

function isOpenTask(task: IssueRow, columns: ColumnRow[]): boolean {
  const stateType = columns.find((column) => column.id === task.columnId)?.stateType;
  return !task.archivedAt && stateType !== 'completed' && stateType !== 'canceled';
}

// The task the routine's newest earlier fire worked on: the one it created, reopened or
// left alone because it was open.
async function previousTask(runId: string, scheduleId: string | null): Promise<number | null> {
  if (!scheduleId) return null;
  const [row] = await db
    .select({ issueId: pipelineRun.issueId })
    .from(pipelineRun)
    .where(
      and(
        eq(pipelineRun.scheduleId, scheduleId),
        ne(pipelineRun.id, runId),
        isNotNull(pipelineRun.issueId),
        inArray(pipelineRun.status, ['succeeded', 'skipped']),
      ),
    )
    .orderBy(desc(pipelineRun.scheduledFor), desc(pipelineRun.createdAt))
    .limit(1);
  return row?.issueId ?? null;
}

class Replayed extends Error {}

async function finish(
  runId: string,
  step: DelegateStep,
  at: StepExecution,
  projectId: number,
  result: DelegateResult,
): Promise<DelegateResult> {
  await db
    .update(pipelineRun)
    .set({ issueId: result.taskId, updatedAt: new Date() })
    .where(eq(pipelineRun.id, runId));
  await writeStep(runId, step, at, {
    status: 'succeeded',
    outcome: result.outcome,
    state: { taskId: result.taskId, result },
    finishedAt: new Date(),
  });
  await bumpControlPlaneRevision(projectId);
  return result;
}

async function dispatch(
  runId: string,
  step: DelegateStep,
  at: StepExecution,
): Promise<DelegateResult | null> {
  const existing = await stepRow(runId, at);
  const stored = (existing?.state ?? {}) as DelegateState & { result?: DelegateResult };
  if (existing?.status === 'succeeded' && stored.result) return stored.result;
  const context = await loadRun(runId);
  const { project, run } = context;
  if (run.dryRun) {
    await writeStep(runId, step, at, {
      status: 'simulated',
      outcome: 'success',
      summary: step.title,
      finishedAt: new Date(),
    });
    return null;
  }
  const [agent] = await db
    .select({ id: aiAgent.id, userId: aiAgent.userId })
    .from(aiAgent)
    .innerJoin(
      projectMember,
      and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, project.id)),
    )
    .where(eq(aiAgent.id, step.agentId));
  if (!agent) throw new StepFailure('The agent of the routine does not work in this project');
  const actor =
    run.actorUserId && (await getMembership(project.id, run.actorUserId)) ? run.actorUserId : null;
  const columns = await listColumns(project.id);

  // A task this fire created before a restart: only its delegation may be missing.
  if (stored.taskId && step.mode === 'new') {
    const created = await getIssue(stored.taskId);
    if (created) await enqueueDelegateRun(created, actor);
    return finish(runId, step, at, project.id, {
      outcome: 'created',
      skipReason: null,
      taskId: stored.taskId,
    });
  }

  const routineTaskId =
    step.mode === 'reopen' ? step.taskId : await previousTask(runId, run.scheduleId);
  const current = routineTaskId ? await getIssue(routineTaskId) : null;
  if (step.mode === 'reopen' && (!current || current.projectId !== project.id))
    throw new StepFailure('The task the routine reopens no longer exists');
  if (current && !stored.commented && isOpenTask(current, columns))
    return finish(runId, step, at, project.id, {
      outcome: 'skipped',
      skipReason: 'task-open',
      taskId: current.id,
    });
  const unstarted = columns.find((column) => column.stateType === 'unstarted');
  if (!unstarted) throw new StepFailure('Project has no unstarted state');

  if (step.mode === 'new') {
    let taskId: number | null = null;
    try {
      const created = await createIssue(
        project,
        {
          columnId: unstarted.id,
          title: step.title,
          description: step.instructions,
          delegateUserId: agent.userId,
        },
        actor,
        {
          afterInsert: async (tx, issueId) => {
            const [row] = await tx
              .select({ state: pipelineRunStep.state })
              .from(pipelineRunStep)
              .where(
                sql`${pipelineRunStep.runId} = ${runId} AND ${pipelineRunStep.stepId} = ${at.stepId} AND ${pipelineRunStep.iteration} = ${at.iteration}`,
              )
              .for('update');
            if ((row?.state as DelegateState | null)?.taskId) throw new Replayed();
            await writeStep(runId, step, at, { state: { taskId: issueId } }, tx);
            await tx
              .update(pipelineRun)
              .set({ issueId, updatedAt: new Date() })
              .where(eq(pipelineRun.id, runId));
          },
        },
      );
      taskId = created.id;
    } catch (error) {
      if (!(error instanceof Replayed)) throw error;
      taskId = ((await stepRow(runId, at))?.state as DelegateState | null)?.taskId ?? null;
    }
    if (!taskId) throw new StepFailure('The task of the routine could not be created');
    return finish(runId, step, at, project.id, { outcome: 'created', skipReason: null, taskId });
  }

  const task = current!;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ state: pipelineRunStep.state })
      .from(pipelineRunStep)
      .where(
        sql`${pipelineRunStep.runId} = ${runId} AND ${pipelineRunStep.stepId} = ${at.stepId} AND ${pipelineRunStep.iteration} = ${at.iteration}`,
      )
      .for('update');
    if ((row?.state as DelegateState | null)?.commented) return;
    await tx.insert(issueActivity).values({
      issueId: task.id,
      kind: 'comment',
      actorName: 'Schedule',
      body: `Reopened by the schedule "${step.title}".\n\n${step.instructions}`,
    });
    await writeStep(runId, step, at, { state: { taskId: task.id, commented: true } }, tx);
  });
  if (task.archivedAt) await restoreIssue(task.id, actor);
  const after = await updateIssue(
    task.id,
    { columnId: unstarted.id, delegateUserId: agent.userId },
    actor,
  );
  if (after && task.delegateUserId === agent.userId) await enqueueDelegateRun(after, actor);
  return finish(runId, step, at, project.id, {
    outcome: 'reopened',
    skipReason: null,
    taskId: task.id,
  });
}

export const delegateStep: WorkflowStepType<Step> = {
  type: 'delegate',
  // Routines are made on the Schedules page; the builder does not offer the step.
  ui: { builder: false, icon: 'send' },
  producesResult: true,
  read(value, reader) {
    const mode = reader.choice(value.mode, 'mode', ['new', 'reopen'] as const);
    const taskId =
      typeof value.taskId === 'number' && Number.isSafeInteger(value.taskId) ? value.taskId : null;
    if (mode === 'reopen' && taskId === null) reader.issue('required', 'taskId');
    return {
      agentId: reader.integer(value.agentId, 'agentId', { minimum: 1, maximum: 2 ** 31 - 1 }),
      title: reader.text(value.title, 'title', 300),
      instructions: reader.text(value.instructions, 'instructions', 20_000),
      mode,
      taskId: mode === 'reopen' ? taskId : null,
    };
  },
  async execute(context: StepContext<Step>) {
    const result = await context.op('dispatch', () =>
      dispatch(context.run.id, context.step, context.execution),
    );
    if (!result) return { kind: 'end', status: 'succeeded', result: { outcome: 'dry-run' } };
    return {
      kind: 'end',
      status: result.outcome === 'skipped' ? 'skipped' : 'succeeded',
      result,
    };
  },
};
