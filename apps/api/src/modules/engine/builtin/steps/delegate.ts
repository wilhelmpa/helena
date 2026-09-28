import {
  agentRun,
  aiAgent,
  db,
  issueActivity,
  pipelineRun,
  pipelineRunStep,
  projectMember,
} from '@repo/db';
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
import { WORK_CLASS } from '#modules/local-ai/work-classes';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { publishDomainEvent as publishBusEvent } from '#shared/helena';
import type { DelegateStep } from '#modules/pipelines/definition';
import { routineMentions, startRoutineMentions } from '#modules/routines/mentions';
import { loadRun, stepRow, writeStep } from '../../run-context';
import {
  StepFailure,
  type StepContext,
  type StepExecution,
  type WorkflowStepType,
} from '../../sdk';

// The work of a routine: every fire creates a task in the project's first unstarted
// state, delegated to the agent, or reopens the routine's task and delegates it again.
// A new-task routine skips while its previous task is open. A scheduled reopen skips
// while an agent is working on its task; a manual reopen always delegates it. The delegation goes
// through the normal delegation path, so a coordinator of a project that runs agent
// teams gets the task through its team. The agent's run is the routine's work for Lokale KI
// (class `routines`): while that is on, it starts on the local model, with the agent's own
// model as its fallback (docs/helena-decisions/local-ai-platform.md §7.1). Later runs on the
// task (a reply, a review) are ordinary work. The agents the instructions @mention start on
// the task as well, as the routine's author's mentions (routines/mentions.ts). A routine's
// work is quiet: its task subscribes nobody and its reopening tells no watcher
// (docs/helena-decisions/routine-mentions.md).

type Step = DelegateStep & { [field: string]: unknown };

const ROUTINE_RUN = { workClass: WORK_CLASS.routines };

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

// Tells the bus that the routine created or reopened its task (`helena.routine.fired`),
// once per fire: the event's id is the run's, so a replay stores nothing new.
async function announce(
  runId: string,
  projectId: number,
  step: DelegateStep,
  result: DelegateResult,
) {
  if (result.outcome === 'skipped') return;
  const [row] = await db
    .select({ scheduleId: pipelineRun.scheduleId, actor: pipelineRun.actorUserId })
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));
  const task = await getIssue(result.taskId);
  await publishBusEvent({
    id: `routine-fired:${runId}`,
    type: 'helena.routine.fired',
    projectId,
    subject: `routines/${row?.scheduleId ?? runId}`,
    actor: row?.actor ? `user:${row.actor}` : 'system',
    data: {
      routineId: row?.scheduleId ?? null,
      fireId: runId,
      agentId: step.agentId || null,
      projectId,
      taskRef: task ? `task:${task.identifier}` : `task:${result.taskId}`,
      mode: result.outcome === 'reopened' ? 'reopen' : 'new',
    },
  });
}

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
  await announce(runId, projectId, step, result);
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
    if (created) await enqueueDelegateRun(created, actor, ROUTINE_RUN);
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
  const [activeRun] =
    current && step.mode === 'reopen' && run.trigger === 'schedule' && !stored.commented
      ? await db
          .select({ id: agentRun.id })
          .from(agentRun)
          .where(
            and(eq(agentRun.issueId, current.id), inArray(agentRun.status, ['pending', 'running'])),
          )
          .limit(1)
      : [];
  if (
    current &&
    !stored.commented &&
    (step.mode === 'new' ? isOpenTask(current, columns) : !!activeRun)
  )
    return finish(runId, step, at, project.id, {
      outcome: 'skipped',
      skipReason: 'task-open',
      taskId: current.id,
    });
  const unstarted = columns.find((column) => column.stateType === 'unstarted');
  if (!unstarted) throw new StepFailure('Project has no unstarted state');
  // Resolved before the task is written: the runs of the agents it names are queued in
  // the transaction that writes it.
  const targets = await routineMentions(project, step.instructions, actor, agent.id);
  const mentions = (tx: Parameters<typeof startRoutineMentions>[0], issueId: number) =>
    startRoutineMentions(tx, {
      runId,
      parent: at,
      projectId: project.id,
      issueId,
      instructions: step.instructions,
      targets,
    });

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
          delegation: ROUTINE_RUN,
          // The routine files the task, not its author: nobody follows it by that.
          subscribeAuthor: false,
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
            await mentions(tx, issueId);
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
    await mentions(tx, task.id);
  });
  if (task.archivedAt) await restoreIssue(task.id, actor);
  const after = await updateIssue(
    task.id,
    { columnId: unstarted.id, delegateUserId: agent.userId },
    actor,
    { delegation: ROUTINE_RUN, quiet: true },
  );
  if (after && task.delegateUserId === agent.userId)
    await enqueueDelegateRun(after, actor, ROUTINE_RUN);
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
