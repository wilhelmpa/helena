import { createHash } from 'node:crypto';
import {
  agentRun,
  aiAgent,
  db,
  issueActivity,
  pipeline,
  pipelineRun,
  pipelineRunStep,
  pipelineVersion,
  projectPipeline,
  projectSetting,
} from '@repo/db';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { listColumns } from '#modules/columns/service';
import {
  createIssue,
  getIssue,
  setIssueLabels,
  updateIssue,
  type IssueRow,
} from '#modules/issues/service';
import { normalizeRuntimePolicy } from '#modules/agents/core/service';
import { getMembership } from '#modules/members/service';
import { getProjectByKey } from '#modules/projects/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import {
  findStep,
  producesResult,
  type ActionStep,
  type AgentStep,
  type ApprovalStep,
  type ConditionStep,
  type PipelineDefinition,
  type PipelineStep,
  type WaitStep,
} from './definition';
import { loadProjectContext, resolveRoles, type ProjectContext } from './project-context';
import { renderTemplate, type RenderContext, type StepResult } from './render';
import { finishRun } from './runs';
import { wakeTime } from './wait';

// The operations Mastra's plan-pipeline workflow calls through the Hermes team bridge
// while it runs a workflow: it decides which step runs next, and Plan evaluates and
// applies each step against its own data and records the result. An operation asked
// again for the same step execution answers what the first one did.

const RUN_ID = /^[A-Za-z0-9_-]{1,200}$/;
const STEP_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PROJECT_REF = /^project:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SUMMARY_LIMIT = 4_000;
// Task actions are written by this system actor. A change it makes starts no workflow,
// so two workflows cannot start each other in turn.
export const WORKFLOW_ACTOR = { system: 'Workflow' } as const;

type Json = Record<string, unknown>;
type StepRow = typeof pipelineRunStep.$inferSelect;

function record(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

function positive(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new HttpError(400, `${field} is invalid`);
  return value;
}

function clip(text: string, limit = SUMMARY_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

interface RunContext {
  run: typeof pipelineRun.$inferSelect;
  project: NonNullable<Awaited<ReturnType<typeof getProjectByKey>>>;
  pipelineName: string;
  version: number;
  definition: PipelineDefinition;
  roles: Record<string, number>;
  task: IssueRow | null;
}

// A run a person canceled executes nothing more, even when Mastra had started it before
// the cancel reached it. Its results and its end are still recorded.
async function loadRun(input: Json, live = true): Promise<RunContext> {
  const runId = typeof input.runId === 'string' && RUN_ID.test(input.runId) ? input.runId : null;
  const projectRef =
    typeof input.projectRef === 'string' && PROJECT_REF.test(input.projectRef)
      ? input.projectRef
      : null;
  if (!runId || !projectRef) throw new HttpError(400, 'Invalid pipeline request');
  const [row] = await db
    .select({
      run: pipelineRun,
      pipelineName: pipeline.name,
      version: pipelineVersion.version,
      definition: pipelineVersion.definition,
      roles: projectPipeline.roles,
    })
    .from(pipelineRun)
    .innerJoin(pipeline, eq(pipeline.id, pipelineRun.pipelineId))
    .innerJoin(pipelineVersion, eq(pipelineVersion.id, pipelineRun.versionId))
    .leftJoin(
      projectPipeline,
      and(
        eq(projectPipeline.projectId, pipelineRun.projectId),
        eq(projectPipeline.pipelineId, pipelineRun.pipelineId),
      ),
    )
    .where(eq(pipelineRun.id, runId));
  const project = await getProjectByKey(projectRef.slice('project:'.length));
  if (!row || !project || row.run.projectId !== project.id)
    throw new HttpError(404, 'Workflow run not found');
  if (live && row.run.status === 'canceled')
    throw new HttpError(409, 'The workflow run was canceled');
  return {
    run: row.run,
    project,
    pipelineName: row.pipelineName,
    version: row.version,
    definition: row.definition as PipelineDefinition,
    roles: row.roles ?? {},
    task: row.run.issueId ? await getIssue(row.run.issueId) : null,
  };
}

function taskRef(context: RunContext): string | null {
  return context.task ? `task:${context.task.identifier}` : null;
}

function stepOf<K extends PipelineStep['type']>(
  context: RunContext,
  stepId: unknown,
  kind: K,
): Extract<PipelineStep, { type: K }> {
  const step =
    typeof stepId === 'string' && STEP_ID.test(stepId)
      ? findStep(context.definition.steps, stepId)
      : undefined;
  if (!step) throw new HttpError(404, 'The workflow has no such step');
  if (step.type !== kind) throw new HttpError(409, `Step ${step.id} is not a ${kind} step`);
  return step as Extract<PipelineStep, { type: K }>;
}

interface Execution {
  stepId: string;
  iteration: number;
  seq: number;
}

function execution(input: Json): Execution {
  return {
    stepId: String(input.stepId),
    iteration: positive(input.iteration, 'iteration'),
    seq: positive(input.seq, 'seq'),
  };
}

async function stepRow(runId: string, at: Execution): Promise<StepRow | null> {
  const [row] = await db
    .select()
    .from(pipelineRunStep)
    .where(
      and(
        eq(pipelineRunStep.runId, runId),
        eq(pipelineRunStep.stepId, at.stepId),
        eq(pipelineRunStep.iteration, at.iteration),
      ),
    );
  return row ?? null;
}

type StepValues = Partial<
  Omit<typeof pipelineRunStep.$inferInsert, 'runId' | 'stepId' | 'iteration'>
>;

async function writeStep(
  context: RunContext,
  step: PipelineStep,
  at: Execution,
  values: StepValues,
  executor: Pick<typeof db, 'insert'> = db,
): Promise<void> {
  const row = {
    kind: step.type,
    name: step.name,
    seq: at.seq,
    status: 'running',
    ...values,
  };
  await executor
    .insert(pipelineRunStep)
    .values({ runId: context.run.id, stepId: at.stepId, iteration: at.iteration, ...row })
    .onConflictDoUpdate({
      target: [pipelineRunStep.runId, pipelineRunStep.stepId, pipelineRunStep.iteration],
      set: row,
    });
}

async function setRunStatus(context: RunContext, status: 'running' | 'waiting'): Promise<void> {
  await db
    .update(pipelineRun)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(pipelineRun.id, context.run.id),
        sql`${pipelineRun.status} IN ('pending', 'running', 'waiting')`,
      ),
    );
}

function asResult(row: StepRow): StepResult {
  return { summary: row.summary ?? '', outcome: row.outcome ?? '', note: row.note ?? '' };
}

// The variables of a step: the task as it is now, and the results the run recorded
// before this execution. `previous` is the newest result of an agent, approval or
// action step.
async function renderContext(context: RunContext, seq: number): Promise<RenderContext> {
  const rows = await db
    .select()
    .from(pipelineRunStep)
    .where(and(eq(pipelineRunStep.runId, context.run.id), lt(pipelineRunStep.seq, seq)))
    .orderBy(desc(pipelineRunStep.seq));
  const steps: Record<string, StepResult> = {};
  for (const row of [...rows].reverse()) steps[row.stepId] = asResult(row);
  const previous = rows.find((row) => {
    const step = findStep(context.definition.steps, row.stepId);
    return step !== undefined && producesResult(step);
  });
  const columns = context.task ? await listColumns(context.project.id) : [];
  return {
    task: {
      title: context.task?.title ?? '',
      description: context.task?.description ?? '',
      identifier: context.task?.identifier ?? '',
      status: columns.find((column) => column.id === context.task?.columnId)?.name ?? '',
    },
    previous: previous ? asResult(previous) : null,
    steps,
  };
}

async function projectContext(context: RunContext): Promise<ProjectContext> {
  return loadProjectContext({
    id: context.project.id,
    key: context.project.key,
    teamId: context.project.teamId,
  });
}

// ---- begin ------------------------------------------------------------------------

class RunExists extends Error {}

// A schedule fire: Mastra starts it with the workflow only. The run gets a task of its
// own, created with the run in one transaction, and the workflow's newest version.
async function beginScheduledRun(input: Json, runId: string) {
  const projectRef = String(input.projectRef ?? '');
  const project = PROJECT_REF.test(projectRef)
    ? await getProjectByKey(projectRef.slice('project:'.length))
    : null;
  if (!project) throw new HttpError(404, 'Project not found');
  const pipelineId = positive(input.pipelineId, 'pipelineId');
  const [row] = await db
    .select({
      pipeline,
      usage: projectPipeline,
      versionId: pipelineVersion.id,
      definition: pipelineVersion.definition,
    })
    .from(projectPipeline)
    .innerJoin(pipeline, eq(pipeline.id, projectPipeline.pipelineId))
    .innerJoin(
      pipelineVersion,
      and(
        eq(pipelineVersion.pipelineId, pipeline.id),
        eq(pipelineVersion.version, pipeline.version),
      ),
    )
    .where(
      and(eq(projectPipeline.projectId, project.id), eq(projectPipeline.pipelineId, pipelineId)),
    );
  const trigger = (row?.definition as PipelineDefinition | undefined)?.trigger;
  if (!row?.usage.enabled || trigger?.type !== 'schedule')
    throw new HttpError(409, 'The workflow does not run on a schedule in this project');
  const unstarted = (await listColumns(project.id)).find(
    (column) => column.stateType === 'unstarted',
  );
  if (!unstarted) throw new HttpError(409, 'Project has no unstarted state');
  const actor =
    row.usage.updatedBy && (await getMembership(project.id, row.usage.updatedBy))
      ? row.usage.updatedBy
      : null;
  try {
    await createIssue(
      project,
      {
        columnId: unstarted.id,
        title: trigger.title,
        description: `Created by the scheduled workflow "${row.pipeline.name}".`,
      },
      actor,
      {
        fromWorkflow: true,
        afterInsert: async (tx, issueId) => {
          const inserted = await tx
            .insert(pipelineRun)
            .values({
              id: runId,
              pipelineId,
              versionId: row.versionId,
              projectId: project.id,
              issueId,
              trigger: 'schedule',
              dryRun: input.dryRun === true,
              status: 'running',
              actorUserId: actor,
            })
            .onConflictDoNothing()
            .returning({ id: pipelineRun.id });
          if (inserted.length === 0) throw new RunExists();
        },
      },
    );
  } catch (error) {
    if (!(error instanceof RunExists)) throw error;
  }
}

async function begin(input: Json) {
  const runId = typeof input.runId === 'string' && RUN_ID.test(input.runId) ? input.runId : null;
  if (!runId) throw new HttpError(400, 'Invalid pipeline request');
  const [existing] = await db
    .select({ id: pipelineRun.id })
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));
  // Plan writes every run it starts before Mastra begins it; Mastra names the run of a
  // schedule fire sched_<schedule>_<time>.
  if (!existing && !runId.startsWith('sched_')) throw new HttpError(404, 'Workflow run not found');
  if (!existing) await beginScheduledRun(input, runId);
  const context = await loadRun(input);
  if (context.run.status === 'pending') await setRunStatus(context, 'running');
  await bumpControlPlaneRevision(context.project.id);
  return {
    run: {
      id: context.run.id,
      pipelineId: context.run.pipelineId,
      pipelineName: context.pipelineName,
      version: context.version,
      taskRef: taskRef(context),
      dryRun: context.run.dryRun,
    },
    definition: context.definition,
  };
}

// ---- agent ------------------------------------------------------------------------

// The key under which /internal/orchestration/agent-run queues the agent run of one
// attempt of a step execution.
export function agentRunKey(runId: string, at: Execution, attempt: number): string {
  return createHash('sha256')
    .update(`plan-pipeline\0${runId}\0${at.stepId}\0${at.iteration}\0${attempt}`)
    .digest('hex');
}

// The agent run of an earlier attempt that is still queued, when the bridge that waited
// for it stopped: a retry replaces it, so it must not run beside the new one.
async function cancelQueuedRun(projectId: number, idempotencyKey: string): Promise<void> {
  const [stored] = await db
    .select({ value: projectSetting.value })
    .from(projectSetting)
    .where(
      and(
        eq(projectSetting.projectId, projectId),
        eq(projectSetting.key, `mastra-agent-run:${idempotencyKey}`),
      ),
    );
  const runId = Number((stored?.value as { runId?: unknown } | undefined)?.runId);
  if (!Number.isSafeInteger(runId)) return;
  await db
    .update(agentRun)
    .set({ status: 'canceled', finishedAt: new Date() })
    .where(and(eq(agentRun.id, runId), eq(agentRun.status, 'pending')));
}

async function agent(input: Json) {
  const context = await loadRun(input);
  const at = execution(input);
  const step: AgentStep = stepOf(context, at.stepId, 'agent');
  if (!context.task) throw new HttpError(409, 'The workflow run has no task');
  const existing = await stepRow(context.run.id, at);
  // A failed or canceled execution asked for again is a retry: it gets an agent run of
  // its own. Anything else is the same execution asked again, after a restart.
  const attempt =
    existing && ['failed', 'canceled'].includes(existing.status)
      ? existing.attempt + 1
      : (existing?.attempt ?? 1);
  const projectAgents = await projectContext(context);
  const agentRow =
    'role' in step.assignee
      ? resolveRoles(context.definition.roles, context.roles, projectAgents).find(
          (role) => 'role' in step.assignee && role.key === step.assignee.role,
        )?.agent
      : projectAgents.agents.find(
          (candidate) => 'agentId' in step.assignee && candidate.id === step.assignee.agentId,
        );
  if (!agentRow) {
    const reason =
      'role' in step.assignee
        ? `No agent of the project fills the role ${step.assignee.role}`
        : 'The agent of the step does not work in this project';
    await writeStep(context, step, at, {
      status: 'failed',
      attempt,
      error: reason,
      finishedAt: new Date(),
    });
    throw new HttpError(409, reason);
  }
  const instruction = renderTemplate(step.instruction, await renderContext(context, at.seq));
  const prompt = [
    `Workflow "${context.pipelineName}", step "${step.name}", on task ${context.task.identifier}.`,
    instruction,
    'End your answer with a short summary of what you did. The workflow passes it to its next steps.',
  ].join('\n\n');
  const key = agentRunKey(context.run.id, at, attempt);
  const started = !existing || existing.attempt !== attempt;
  if (existing?.idempotencyKey && started)
    await cancelQueuedRun(context.project.id, existing.idempotencyKey);
  await writeStep(context, step, at, {
    status: context.run.dryRun ? 'simulated' : 'running',
    attempt,
    agentId: agentRow.id,
    idempotencyKey: context.run.dryRun ? null : key,
    outcome: context.run.dryRun ? 'success' : null,
    summary: context.run.dryRun ? clip(instruction) : null,
    error: null,
    ...(started ? { startedAt: new Date() } : {}),
    finishedAt: context.run.dryRun ? new Date() : null,
  });
  await setRunStatus(context, 'running');
  await bumpControlPlaneRevision(context.project.id);
  return {
    dryRun: context.run.dryRun,
    attempt,
    idempotencyKey: key,
    agentRef: `agent:${agentRow.username}`,
    taskRef: taskRef(context),
    prompt,
    timeoutSeconds: step.timeoutMinutes * 60,
    policy: await stepPolicy(step, agentRow.id),
  };
}

// The limits of the step's agent run. A step may lower the agent's own turn and time
// limits, not raise them.
async function stepPolicy(step: AgentStep, agentId: number) {
  const [row] = await db
    .select({ runtimePolicy: aiAgent.runtimePolicy })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  const own = normalizeRuntimePolicy(row?.runtimePolicy);
  const lower = (value: number | null, limit: number | null | undefined) =>
    value === null ? null : limit ? Math.min(value, limit) : value;
  const maxTurns = lower(step.maxTurns, own.maxTurns);
  const runBudgetSeconds = lower(step.runBudgetSeconds, own.runBudgetSeconds);
  return {
    ...(maxTurns ? { maxTurns } : {}),
    ...(runBudgetSeconds ? { runBudgetSeconds } : {}),
    ...(step.model ? { model: step.model } : {}),
  };
}

// ---- condition --------------------------------------------------------------------

// What an approval or action left as `previous` for an outcome condition.
function outcomeOf(row: StepRow): string {
  if (row.kind === 'approval') return row.outcome === 'approved' ? 'success' : 'failed';
  return row.outcome ?? (row.status === 'failed' ? 'failed' : 'success');
}

async function condition(input: Json) {
  const context = await loadRun(input);
  const at = execution(input);
  const step: ConditionStep = stepOf(context, at.stepId, 'condition');
  const existing = await stepRow(context.run.id, at);
  if (existing?.status === 'succeeded') return { matched: existing.outcome === 'true' };
  const test = step.condition;
  let matched = false;
  if (test.kind === 'task') {
    const task = context.task;
    const projectData = await projectContext(context);
    const current: string[] = !task
      ? []
      : test.field === 'status'
        ? projectData.statuses.filter((s) => s.id === task.columnId).map((s) => s.name)
        : test.field === 'statusType'
          ? projectData.statuses.filter((s) => s.id === task.columnId).map((s) => s.stateType)
          : test.field === 'labels'
            ? projectData.labels.filter((l) => task.labelIds.includes(l.id)).map((l) => l.name)
            : test.field === 'area'
              ? projectData.areas.filter((a) => a.id === task.folderId).map((a) => a.name)
              : task.priority
                ? [task.priority]
                : [];
    const overlaps = test.values.some((value) => current.some((item) => same(item, value)));
    matched = test.op === 'is' ? overlaps : !overlaps;
  } else {
    const [previous] = await db
      .select()
      .from(pipelineRunStep)
      .where(
        and(
          eq(pipelineRunStep.runId, context.run.id),
          lt(pipelineRunStep.seq, at.seq),
          sql`${pipelineRunStep.kind} IN ('agent', 'approval', 'action')`,
        ),
      )
      .orderBy(desc(pipelineRunStep.seq))
      .limit(1);
    if (previous && test.kind === 'outcome')
      matched = (test.outcomes as string[]).includes(outcomeOf(previous));
    if (previous && test.kind === 'keyword')
      matched = (previous.summary ?? '').toLowerCase().includes(test.keyword.toLowerCase());
  }
  await writeStep(context, step, at, {
    status: 'succeeded',
    outcome: matched ? 'true' : 'false',
    summary: null,
    finishedAt: new Date(),
  });
  await bumpControlPlaneRevision(context.project.id);
  return { matched };
}

// ---- action -----------------------------------------------------------------------

class StepExists extends Error {}

function describeAction(step: ActionStep): string {
  const { action } = step;
  switch (action.kind) {
    case 'set_status':
      return `Set the status to ${action.status}`;
    case 'add_labels':
      return `Add the labels ${action.labels.join(', ')}`;
    case 'remove_labels':
      return `Remove the labels ${action.labels.join(', ')}`;
    case 'set_assignee':
      return action.assignee ? 'Set the assignee' : 'Remove the assignee';
    case 'comment':
      return 'Add a comment';
    case 'create_subtask':
      return `Create the subtask "${action.title}"`;
  }
}

async function applyAction(
  context: RunContext,
  step: ActionStep,
  at: Execution,
  task: IssueRow,
): Promise<string> {
  const { action } = step;
  const variables = await renderContext(context, at.seq);
  const projectData = await projectContext(context);
  const done = (summary: string) =>
    writeStep(context, step, at, {
      status: 'succeeded',
      outcome: 'success',
      summary,
      finishedAt: new Date(),
    }).then(() => summary);
  switch (action.kind) {
    case 'set_status': {
      const column = projectData.statuses.find((status) => same(status.name, action.status));
      if (!column) throw new HttpError(409, `The project has no status ${action.status}`);
      if (task.columnId !== column.id)
        await updateIssue(task.id, { columnId: column.id }, WORKFLOW_ACTOR);
      return done(`Status set to ${column.name}`);
    }
    case 'add_labels':
    case 'remove_labels': {
      const named = projectData.labels.filter((item) =>
        action.labels.some((name) => same(name, item.name)),
      );
      const ids = new Set(task.labelIds);
      for (const item of named)
        if (action.kind === 'add_labels') ids.add(item.id);
        else ids.delete(item.id);
      await setIssueLabels(context.project.id, task.id, [...ids], null);
      const names = named.map((item) => item.name).join(', ') || '-';
      return done(
        action.kind === 'add_labels' ? `Labels added: ${names}` : `Labels removed: ${names}`,
      );
    }
    case 'set_assignee': {
      const { assignee } = action;
      let userId: string | null = null;
      if (assignee && 'role' in assignee) {
        const role = resolveRoles(context.definition.roles, context.roles, projectData).find(
          (item) => item.key === assignee.role,
        );
        if (!role?.agent)
          throw new HttpError(409, `No agent of the project fills the role ${assignee.role}`);
        userId = role.agent.userId;
      } else if (assignee) {
        if (!projectData.members.some((member) => member.id === assignee.userId))
          throw new HttpError(409, 'The assignee is not a member of this project');
        userId = assignee.userId;
      }
      await updateIssue(task.id, { assigneeUserId: userId }, WORKFLOW_ACTOR);
      return done(userId ? 'Assignee set' : 'Assignee removed');
    }
    case 'comment': {
      const body = renderTemplate(action.body, variables);
      try {
        await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(pipelineRunStep)
            .values({
              runId: context.run.id,
              stepId: at.stepId,
              iteration: at.iteration,
              seq: at.seq,
              kind: step.type,
              name: step.name,
              status: 'succeeded',
              outcome: 'success',
              summary: clip(body),
              finishedAt: new Date(),
            })
            .onConflictDoNothing()
            .returning({ runId: pipelineRunStep.runId });
          if (inserted.length === 0) throw new StepExists();
          await tx.insert(issueActivity).values({
            issueId: task.id,
            kind: 'comment',
            actorName: `Workflow: ${context.pipelineName}`,
            body,
          });
        });
      } catch (error) {
        if (!(error instanceof StepExists)) throw error;
      }
      return clip(body);
    }
    case 'create_subtask': {
      const unstarted = projectData.statuses.find((status) => status.stateType === 'unstarted');
      if (!unstarted) throw new HttpError(409, 'Project has no unstarted state');
      const title = renderTemplate(action.title, variables).slice(0, 300) || step.name;
      const summary = `Subtask created: ${title}`;
      try {
        await createIssue(
          context.project,
          {
            columnId: unstarted.id,
            title,
            description: renderTemplate(action.description, variables),
            parentId: task.parentId ?? task.id,
          },
          null,
          {
            fromWorkflow: true,
            afterInsert: async (tx) => {
              const inserted = await tx
                .insert(pipelineRunStep)
                .values({
                  runId: context.run.id,
                  stepId: at.stepId,
                  iteration: at.iteration,
                  seq: at.seq,
                  kind: step.type,
                  name: step.name,
                  status: 'succeeded',
                  outcome: 'success',
                  summary,
                  finishedAt: new Date(),
                })
                .onConflictDoNothing()
                .returning({ runId: pipelineRunStep.runId });
              if (inserted.length === 0) throw new StepExists();
            },
          },
        );
      } catch (error) {
        if (!(error instanceof StepExists)) throw error;
      }
      return summary;
    }
  }
}

async function action(input: Json) {
  const context = await loadRun(input);
  const at = execution(input);
  const step: ActionStep = stepOf(context, at.stepId, 'action');
  const existing = await stepRow(context.run.id, at);
  if (existing && ['succeeded', 'simulated'].includes(existing.status))
    return { summary: existing.summary ?? '' };
  if (!context.task) throw new HttpError(409, 'The workflow run has no task');
  let summary: string;
  if (context.run.dryRun) {
    summary = describeAction(step);
    await writeStep(context, step, at, {
      status: 'simulated',
      outcome: 'success',
      summary,
      finishedAt: new Date(),
    });
  } else {
    await setRunStatus(context, 'running');
    summary = await applyAction(context, step, at, context.task);
  }
  await bumpControlPlaneRevision(context.project.id);
  return { summary };
}

// ---- approval ---------------------------------------------------------------------

async function approval(input: Json) {
  const context = await loadRun(input);
  const at = execution(input);
  const step: ApprovalStep = stepOf(context, at.stepId, 'approval');
  const existing = await stepRow(context.run.id, at);
  if (input.phase === 'decided') {
    if (typeof input.approved !== 'boolean') throw new HttpError(400, 'approved is invalid');
    const note = typeof input.note === 'string' ? input.note.slice(0, 2_000) : null;
    const decidedBy = typeof input.decidedBy === 'string' ? input.decidedBy : null;
    const person =
      decidedBy && (await getMembership(context.project.id, decidedBy)) ? decidedBy : null;
    await writeStep(context, step, at, {
      status: 'succeeded',
      outcome: input.approved ? 'approved' : 'rejected',
      summary: existing?.summary ?? null,
      note: note ?? existing?.note ?? null,
      decidedBy: person ?? existing?.decidedBy ?? null,
      finishedAt: new Date(),
    });
    await setRunStatus(context, 'running');
    await bumpControlPlaneRevision(context.project.id);
    return {};
  }
  const message =
    existing?.summary ??
    clip(
      renderTemplate(step.message, await renderContext(context, at.seq)).trim() ||
        `Approve step "${step.name}" of workflow "${context.pipelineName}".`,
      2_000,
    );
  if (context.run.dryRun) {
    await writeStep(context, step, at, {
      status: 'simulated',
      outcome: 'approved',
      summary: message,
      finishedAt: new Date(),
    });
  } else if (!existing || existing.status === 'waiting' || existing.status === 'running') {
    await writeStep(context, step, at, { status: 'waiting', summary: message });
    await setRunStatus(context, 'waiting');
  }
  await bumpControlPlaneRevision(context.project.id);
  return { message };
}

// ---- wait -------------------------------------------------------------------------

// The wake time is fixed by the first request, so a wait Mastra continues after a
// restart ends when it would have.
async function wait(input: Json) {
  const context = await loadRun(input);
  const at = execution(input);
  const step: WaitStep = stepOf(context, at.stepId, 'wait');
  const existing = await stepRow(context.run.id, at);
  if (existing?.status === 'succeeded' || existing?.status === 'simulated') return { wakeAt: null };
  const wakeAt = existing ? existing.wakeAt : wakeTime(step.wait, context.task, Date.now());
  if (context.run.dryRun || !wakeAt || wakeAt.getTime() <= Date.now()) {
    await writeStep(context, step, at, {
      status: context.run.dryRun ? 'simulated' : 'succeeded',
      outcome: 'success',
      wakeAt,
      finishedAt: new Date(),
    });
    await bumpControlPlaneRevision(context.project.id);
    return { wakeAt: null };
  }
  await writeStep(context, step, at, { status: 'waiting', wakeAt });
  await setRunStatus(context, 'waiting');
  await bumpControlPlaneRevision(context.project.id);
  return { wakeAt: wakeAt.toISOString() };
}

// ---- record and finish ------------------------------------------------------------

const RECORD_STATUSES = ['running', 'succeeded', 'failed', 'canceled'] as const;
const OUTCOMES = ['success', 'failed', 'blocked'] as const;

// The result of an agent or wait execution Mastra learned itself, or the failure of any
// step.
async function recordStep(input: Json) {
  const context = await loadRun(input, false);
  const at = execution(input);
  const step =
    typeof input.stepId === 'string' ? findStep(context.definition.steps, input.stepId) : undefined;
  if (!step) throw new HttpError(404, 'The workflow has no such step');
  const status = (RECORD_STATUSES as readonly unknown[]).includes(input.status)
    ? (input.status as (typeof RECORD_STATUSES)[number])
    : null;
  if (!status) throw new HttpError(400, 'status is invalid');
  const outcome = (OUTCOMES as readonly unknown[]).includes(input.outcome)
    ? String(input.outcome)
    : null;
  await writeStep(context, step, at, {
    status,
    ...(outcome ? { outcome } : {}),
    ...(typeof input.summary === 'string' ? { summary: clip(input.summary) } : {}),
    error: typeof input.error === 'string' ? clip(input.error, 2_000) : null,
    finishedAt: status === 'running' ? null : new Date(),
  });
  if (status === 'succeeded') await setRunStatus(context, 'running');
  await bumpControlPlaneRevision(context.project.id);
  return {};
}

async function finish(input: Json) {
  const context = await loadRun(input, false);
  const status = ['succeeded', 'rejected', 'failed'].includes(String(input.status))
    ? (input.status as 'succeeded' | 'rejected' | 'failed')
    : null;
  if (!status) throw new HttpError(400, 'status is invalid');
  if (context.run.status === 'canceled') return {};
  await finishRun(
    context.run.id,
    status,
    typeof input.error === 'string' ? clip(input.error, 2_000) : null,
  );
  return {};
}

const OPERATIONS: Record<string, (input: Json) => Promise<unknown>> = {
  begin,
  agent,
  condition,
  action,
  approval,
  wait,
  record: recordStep,
  finish,
};

export async function pipelineControl(body: unknown): Promise<{ status: number; body: unknown }> {
  const input = record(body);
  const operation = typeof input?.operation === 'string' ? OPERATIONS[input.operation] : undefined;
  if (!input || input.schemaVersion !== 1 || !operation)
    return { status: 400, body: { error: 'Invalid pipeline request' } };
  try {
    return { status: 200, body: await operation(input) };
  } catch (error) {
    if (error instanceof HttpError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}
