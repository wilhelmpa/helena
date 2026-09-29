import {
  aiAgent,
  db,
  getDisplayName,
  issueActivity,
  pipelineRunStep,
  projectMember,
} from '@repo/db';
import { and, eq, like, sql } from 'drizzle-orm';
import { listColumns } from '#modules/columns/service';
import { updateIssue } from '#modules/issues/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import type { AgentTeamStep } from '#modules/pipelines/definition';
import type { RuntimeFailure } from '@helena/sdk';
import { cancelStepRun, ModelRefusedFailure, queueStepRun, stepRunStatus } from '../../agent-runs';
import { clip, loadRun, stepRow, writeStep } from '../../run-context';
import {
  StepFailure,
  type StepContext,
  type StepExecution,
  type WorkflowStepType,
} from '../../sdk';
import { engineWaitSeconds } from '../../dbos';
import { routineMentionedOnTask } from '#modules/routines/agent-runs';
import { WORK_CLASS } from '#modules/local-ai/work-classes';
import { findState } from '@helena/locales/defaults';
import {
  DEFAULT_POLICY,
  parseStage,
  record,
  stagePrompt,
  type Delegation,
  type Evidence,
  type Phase,
  type StageInput,
  type StageResult,
  type TeamMember,
  type TeamPayload,
  type TeamPolicy,
} from './agent-team-contract';

// The agent team of a task. The coordinator plans the work as assignments for the
// project's specialists (or the task goes straight to the one specialist that fits),
// the specialists work in dependency order, independent assignments in parallel, the
// coordinator reviews the evidence against every acceptance criterion, and the summary
// and evidence go to the task, which moves to Review (or Done, when the project lets
// the team finish accepted work). Every stage is an agent run of its own, recorded as a
// part of this step (`team.coordinate`, `team.s1` …, `team.review`, `team.sync`); a stage
// whose run failed or answered unusably is run again with backoff up to the policy's
// attempts, and "Erneut versuchen" on a failed team run keeps the stages that finished.

type Step = AgentTeamStep & { [field: string]: unknown };

export {
  DEFAULT_POLICY,
  parseStage,
  stagePrompt,
  type Delegation,
  type Evidence,
  type StageResult,
  type TeamMember,
  type TeamPayload,
  type TeamPolicy,
} from './agent-team-contract';

export interface HistoryEntry {
  executionId: string;
  phase: 'route' | 'coordinate' | 'specialize' | 'review' | 'synchronize';
  status: string;
  attempt: number;
  startedAt: string;
  completedAt: string;
  summary: string;
}

// A stage waits in the runner queue before its budget starts, so its timeout is at least
// five minutes longer than the budget.
export function stagePolicy(policy: Partial<TeamPolicy>): TeamPolicy {
  const merged = { ...DEFAULT_POLICY, ...policy };
  if (!merged.runBudgetSeconds) return merged;
  const timeoutSeconds = Math.min(7_200, merged.runBudgetSeconds + 300);
  return { ...merged, timeoutSeconds: Math.max(merged.timeoutSeconds, timeoutSeconds) };
}

// The specialist that gets the whole task without a coordinator stage: the only one of
// the team, or the only one whose capabilities match a label of the task. Null when the
// coordinator has to plan the work.
export function routeTask(input: TeamPayload): { agentRef: string; reason: string } | null {
  if (input.specialists.length === 1)
    return { agentRef: input.specialists[0]!.agentRef, reason: 'the team has one specialist' };
  const labels = new Set(input.task.labels.map((label) => label.toLowerCase()));
  const matches = input.specialists.filter((specialist) =>
    specialist.capabilities.some((capability) => labels.has(capability.toLowerCase())),
  );
  if (matches.length !== 1) return null;
  return { agentRef: matches[0]!.agentRef, reason: 'only its capabilities match the task labels' };
}

// The delegations in execution order: each wave holds the assignments whose dependencies
// all belong to earlier waves. Rejects duplicate ids, unknown dependencies and cycles.
export function dependencyWaves(delegations: Delegation[]): Delegation[][] {
  const ids = new Set<string>();
  for (const item of delegations) {
    if (ids.has(item.assignmentId))
      throw new StepFailure(`Assignment ${item.assignmentId} is delegated twice`);
    ids.add(item.assignmentId);
  }
  for (const item of delegations) {
    const unknown = item.dependsOn.find((dependency) => !ids.has(dependency));
    if (unknown)
      throw new StepFailure(
        `Assignment ${item.assignmentId} depends on unknown assignment ${unknown}`,
      );
  }
  const waves: Delegation[][] = [];
  const done = new Set<string>();
  let pending = delegations;
  while (pending.length > 0) {
    const wave = pending.filter((item) =>
      item.dependsOn.every((dependency) => done.has(dependency)),
    );
    if (wave.length === 0) throw new StepFailure('Assignment dependencies form a cycle');
    waves.push(wave);
    for (const item of wave) done.add(item.assignmentId);
    pending = pending.filter((item) => !done.has(item.assignmentId));
  }
  return waves;
}

// ---- stages ----------------------------------------------------------------------

interface StageState {
  phase: Phase;
  assignmentId?: string;
  input: StageInput;
  // The team step's attempt the stage last started in: a retry of the team restarts a
  // stage that failed in an earlier attempt.
  teamAttempt: number;
  // When a failed attempt of the stage is tried again.
  retryAt?: number;
  deadline?: number;
  result?: StageResult;
  failure?: string;
  // Why the stage failed, where the runtime's words said (a model the provider does not
  // serve this account): the run view words it in the reader's language.
  runtimeFailure?: RuntimeFailure;
}

const STAGE_NAMES: Record<Phase, string> = {
  coordinate: 'Coordinator plans',
  specialize: 'Specialist works',
  review: 'Coordinator reviews',
};

async function resolveAgent(projectId: number, agentRef: string) {
  const [row] = await db
    .select({ id: aiAgent.id, userId: aiAgent.userId })
    .from(aiAgent)
    .innerJoin(
      projectMember,
      and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, projectId)),
    )
    .where(eq(aiAgent.username, agentRef.slice('agent:'.length)))
    .limit(1);
  return row ?? null;
}

function backoff(policy: TeamPolicy, attempt: number): number {
  return Math.min(
    policy.maxBackoffMs,
    Math.ceil(policy.initialBackoffMs * policy.backoffMultiplier ** (attempt - 1)),
  );
}

// Queues the agent run of a stage's current attempt. The coordinator's first plan is Lokale
// KI's `coordinator-triage` (docs/helena-decisions/local-ai-platform.md §7.1): while that is
// on, its first attempt starts on the local model; a plan the stage cannot use is tried
// again, and every later attempt runs on the coordinator's configured model.
async function queueStage(
  runId: string,
  projectId: number,
  row: { stepId: string; iteration: number; seq: number; name: string },
  state: StageState,
  attempt: number,
): Promise<void> {
  const { team } = state.input;
  const agent = await resolveAgent(projectId, state.input.agent.agentRef);
  if (!agent) throw new StepFailure(`${state.input.agent.agentRef} does not work in this project`);
  const context = await loadRun(runId);
  // The agents a routine's fire started on the task by a mention do their parts already.
  const startedByRoutine =
    state.phase === 'coordinate' && context.task
      ? await routineMentionedOnTask(context.task.id)
      : [];
  let agentRunId: number;
  try {
    agentRunId = await queueStepRun({
      agentId: agent.id,
      projectId,
      issueId: context.task?.id ?? null,
      prompt: stagePrompt(
        state.input,
        `project:${context.project.key}`,
        startedByRoutine,
        await getDisplayName(),
      ),
      maxTurns: team.policy.maxTurns ?? null,
      runBudgetSeconds: team.policy.runBudgetSeconds ?? null,
      expect: { model: team.execution.model, reasoning: team.execution.reasoning },
      workClass:
        state.phase === 'coordinate' && attempt === 1 ? WORK_CLASS.coordinatorTriage : null,
    });
  } catch (error) {
    // A model the provider refused this account: the stage fails at once, saying so.
    if (error instanceof ModelRefusedFailure) {
      await writeStep(runId, { type: 'agent', name: row.name }, row, {
        status: 'failed',
        agentId: agent.id,
        outcome: 'failed',
        attempt,
        error: clip(error.message, 2_000),
        state: { ...state, failure: error.message, runtimeFailure: error.failure },
        finishedAt: new Date(),
      });
    }
    throw error;
  }
  await writeStep(runId, { type: 'agent', name: row.name }, row, {
    status: 'running',
    agentId: agent.id,
    agentRunId,
    attempt,
    error: null,
    startedAt: new Date(),
    finishedAt: null,
    state: {
      ...state,
      retryAt: undefined,
      deadline: Date.now() + team.policy.timeoutSeconds * 1_000,
    },
  });
}

// Starts the stages of one wave, once: a stage row that exists is left as it is, unless
// it failed in an earlier attempt of the team, which starts it again.
async function startStages(
  runId: string,
  projectId: number,
  parent: StepExecution,
  teamAttempt: number,
  stages: { part: string; state: Omit<StageState, 'teamAttempt'> }[],
): Promise<void> {
  for (const stage of stages) {
    const at = { stepId: `${parent.stepId}.${stage.part}`, iteration: parent.iteration };
    const existing = await stepRow(runId, at);
    const state = { ...stage.state, teamAttempt };
    const row = {
      ...at,
      seq: parent.seq,
      name:
        stage.state.phase === 'specialize'
          ? `${STAGE_NAMES.specialize}: ${stage.state.assignmentId}`
          : STAGE_NAMES[stage.state.phase],
    };
    if (existing) {
      const stored = existing.state as StageState | null;
      if (existing.status !== 'failed' || (stored?.teamAttempt ?? 0) >= teamAttempt) continue;
      await queueStage(runId, projectId, row, state, existing.attempt + 1);
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${runId}:${at.stepId}`}, 0))`,
      );
      const [again] = await tx
        .select({ runId: pipelineRunStep.runId })
        .from(pipelineRunStep)
        .where(
          and(
            eq(pipelineRunStep.runId, runId),
            eq(pipelineRunStep.stepId, at.stepId),
            eq(pipelineRunStep.iteration, at.iteration),
          ),
        );
      if (again) return;
      await writeStep(
        runId,
        { type: 'agent', name: row.name },
        { ...at, seq: parent.seq },
        {
          status: 'running',
          attempt: 1,
          state,
        },
        tx,
      );
    });
    await queueStage(runId, projectId, row, state, 1);
  }
}

interface Progress {
  done: boolean;
  failure: string | null;
  results: StageResult[];
  // How long until a stage's retry is due, when one waits.
  wakeInMs: number | null;
}

// Moves the stages on: records the answer of a finished run, retries a failed attempt
// with backoff, and fails a stage whose attempts are used up or whose agent is blocked.
async function advanceStages(
  runId: string,
  projectId: number,
  stageIds: string[],
  iteration: number,
): Promise<Progress> {
  const results: StageResult[] = [];
  let failure: string | null = null;
  let wakeInMs: number | null = null;
  let done = true;
  for (const stepId of stageIds) {
    const row = await stepRow(runId, { stepId, iteration });
    if (!row) throw new Error(`The stage ${stepId} was not started`);
    const state = row.state as StageState;
    const policy = state.input.team.policy;
    if (row.status === 'succeeded' && state.result) {
      results.push(state.result);
      continue;
    }
    if (row.status === 'failed') {
      failure ??= state.failure ?? row.error ?? `The stage ${stepId} failed`;
      continue;
    }
    done = false;
    const at = { stepId, iteration, seq: row.seq, name: row.name };
    if (!row.agentRunId) {
      const due = (state.retryAt ?? 0) - Date.now();
      if (due > 0) {
        wakeInMs = Math.min(wakeInMs ?? due, due);
        continue;
      }
      await queueStage(runId, projectId, at, state, row.attempt + 1);
      continue;
    }
    const run = await stepRunStatus(row.agentRunId);
    let attemptError: string | null = null;
    if (run.status === 'pending') {
      if (Date.now() < (state.deadline ?? Infinity)) continue;
      await cancelStepRun(row.agentRunId);
      attemptError = 'The stage timed out';
    } else if (run.status === 'success' && run.blockedQuestion) {
      const message = `@${state.input.agent.agentRef.slice('agent:'.length)} is blocked and needs input: ${run.blockedQuestion}`;
      await writeStep(runId, { type: 'agent', name: row.name }, at, {
        status: 'failed',
        outcome: 'blocked',
        summary: clip(run.blockedQuestion),
        error: clip(message, 2_000),
        state: { ...state, failure: message },
        finishedAt: new Date(),
      });
      failure ??= message;
      continue;
    } else if (run.status === 'success') {
      try {
        const parsed = parseStage(state.input, run.output);
        const result: StageResult = {
          executionId: `run:${run.id}`,
          phase: state.phase,
          attempt: row.attempt,
          startedAt: run.claimedAt ?? row.startedAt.toISOString(),
          completedAt: run.finishedAt ?? new Date().toISOString(),
          ...parsed,
          ...(state.assignmentId ? { assignmentId: state.assignmentId } : {}),
        };
        await writeStep(runId, { type: 'agent', name: row.name }, at, {
          status: 'succeeded',
          outcome: 'success',
          summary: clip(result.summary),
          state: { ...state, result },
          finishedAt: new Date(),
        });
        results.push(result);
        continue;
      } catch (error) {
        attemptError = error instanceof Error ? error.message : String(error);
      }
    } else
      attemptError =
        run.error ||
        (run.status === 'canceled' ? 'The agent run was canceled' : 'The agent run failed');
    // A failure no retry passes (the provider does not serve the model to this account)
    // ends the stage after this attempt, whatever attempts the policy has left.
    const final = run.status === 'failed' && run.failure?.retryable === false ? run.failure : null;
    if (final) {
      const message = `The stage ${row.name} failed: ${finalFailureText(final, attemptError)}`;
      await writeStep(runId, { type: 'agent', name: row.name }, at, {
        status: 'failed',
        outcome: 'failed',
        error: clip(message, 2_000),
        state: { ...state, failure: message, runtimeFailure: final },
        finishedAt: new Date(),
      });
      failure ??= message;
      continue;
    }
    if (row.attempt < policy.maxAttempts) {
      const delay = backoff(policy, row.attempt);
      await writeStep(runId, { type: 'agent', name: row.name }, at, {
        status: 'running',
        agentRunId: null,
        error: clip(attemptError, 2_000),
        state: { ...state, retryAt: Date.now() + delay },
      });
      wakeInMs = Math.min(wakeInMs ?? delay, delay);
      continue;
    }
    const message = `The stage ${row.name} failed after ${row.attempt} attempts: ${attemptError}`;
    await writeStep(runId, { type: 'agent', name: row.name }, at, {
      status: 'failed',
      outcome: 'failed',
      error: clip(message, 2_000),
      state: { ...state, failure: message },
      finishedAt: new Date(),
    });
    failure ??= message;
  }
  return { done: done && failure === null, failure, results, wakeInMs };
}

// What a stage that no retry can pass says: the model the provider refused, in the
// provider's own words.
function finalFailureText(failure: RuntimeFailure, error: string): string {
  const said = failure.detail ?? error.split('\n')[0] ?? error;
  if (failure.code === 'model-unavailable')
    return `${failure.model ? `the model ${failure.model}` : 'the model'} is not available for this account (${said}); retrying does not help, choose another model for the agent`;
  return `the provider refused the request for good (${said}); retrying does not help`;
}

async function awaitStages(
  context: StepContext<Step>,
  label: string,
  stageIds: string[],
): Promise<StageResult[]> {
  const { run, execution } = context;
  for (;;) {
    const progress = await context.op(`${label}:progress`, () =>
      advanceStages(run.id, run.project.id, stageIds, execution.iteration),
    );
    if (progress.failure) throw new StepFailure(progress.failure);
    if (progress.done) return progress.results;
    const seconds =
      progress.wakeInMs === null ? 60 : Math.max(1, Math.ceil(progress.wakeInMs / 1_000));
    await context.waitForSignal('agent-run', engineWaitSeconds(Math.min(60, seconds)));
  }
}

function history(result: StageResult): HistoryEntry {
  return {
    executionId: result.executionId,
    phase: result.phase,
    status: result.status,
    attempt: result.attempt,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    summary: result.summary,
  };
}

// ---- synchronization -------------------------------------------------------------

function syncComment(summary: string, evidence: Evidence[]): string {
  const entries = evidence.slice(0, 40).map((item) => `- ${item.label}: ${item.ref}`);
  return [
    '## Agent team result',
    summary.slice(0, 8_000),
    entries.length ? `### Evidence\n${entries.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

interface SyncState {
  commentId?: number;
  moved?: boolean;
  synchronizedAt?: string;
}

// Writes the result to the task once and moves it to Review, or to Done.
async function synchronize(
  runId: string,
  parent: StepExecution,
  state: 'review' | 'done',
  summary: string,
  evidence: Evidence[],
): Promise<string> {
  const at = { stepId: `${parent.stepId}.sync`, iteration: parent.iteration, seq: parent.seq };
  const context = await loadRun(runId);
  if (!context.task) throw new StepFailure('The agent team run has no task');
  const task = context.task;
  const columns = await listColumns(context.project.id);
  const target =
    state === 'done'
      ? columns.find((column) => column.stateType === 'completed')
      : // The review state, under any language's default name when the project has no
        // state called Review.
        findState(columns, 'Review');
  if (!target)
    throw new StepFailure(`Project has no ${state === 'done' ? 'completed' : 'Review'} state`);
  const name = state === 'done' ? 'Result to the task (Done)' : 'Result to the task (Review)';
  const stored = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${runId}:${at.stepId}`}, 0))`,
    );
    const [row] = await tx
      .select({ state: pipelineRunStep.state })
      .from(pipelineRunStep)
      .where(
        and(
          eq(pipelineRunStep.runId, runId),
          eq(pipelineRunStep.stepId, at.stepId),
          eq(pipelineRunStep.iteration, at.iteration),
        ),
      );
    const existing = (row?.state ?? null) as SyncState | null;
    if (existing?.commentId) return existing;
    const [comment] = await tx
      .insert(issueActivity)
      .values({
        issueId: task.id,
        kind: 'comment',
        actorName: 'Agent team',
        body: syncComment(summary, evidence),
      })
      .returning({ id: issueActivity.id });
    const next: SyncState = { commentId: comment!.id };
    await writeStep(runId, { type: 'action', name }, at, { status: 'running', state: next }, tx);
    return next;
  });
  if (!stored.moved) {
    if (task.columnId !== target.id)
      await updateIssue(task.id, { columnId: target.id }, { system: 'Agent team' });
  }
  const synchronizedAt = stored.synchronizedAt ?? new Date().toISOString();
  await writeStep(runId, { type: 'action', name }, at, {
    status: 'succeeded',
    outcome: 'success',
    summary: clip(summary),
    state: { ...stored, moved: true, synchronizedAt },
    finishedAt: new Date(),
  });
  await bumpControlPlaneRevision(context.project.id);
  return synchronizedAt;
}

// ---- the step ----------------------------------------------------------------------

function member(team: TeamPayload, agentRef: string): TeamMember {
  const found =
    team.coordinator.agentRef === agentRef
      ? team.coordinator
      : team.specialists.find((item) => item.agentRef === agentRef);
  if (!found) throw new StepFailure('A specialist assignment has no project team member');
  return found;
}

export const agentTeamStep: WorkflowStepType<Step> = {
  type: 'agent_team',
  // The engine creates it for a task delegated to a coordinator.
  ui: { builder: false, icon: 'users' },
  producesResult: true,
  read(value) {
    return { team: record(value.team) ?? {} };
  },
  async execute(context: StepContext<Step>) {
    const { run, execution, attempt } = context;
    const team = context.step.team as unknown as TeamPayload;
    const policy = stagePolicy(team.policy);
    const payload: TeamPayload = { ...team, policy };
    const stageId = (part: string) => `${execution.stepId}.${part}`;
    const entries: HistoryEntry[] = [];

    // coordinate
    let delegations: Delegation[];
    const routed = routeTask(payload);
    if (routed) {
      const now = await context.op('route', async () => new Date().toISOString());
      delegations = [
        {
          assignmentId: 'assignment-1',
          agentRef: routed.agentRef,
          objective: 'Complete the task: meet its objective and every acceptance criterion.',
          acceptanceCriteria: payload.task.acceptanceCriteria,
          dependsOn: [],
        },
      ];
      entries.push({
        executionId: 'helena:route',
        phase: 'route',
        status: 'completed',
        attempt: 1,
        startedAt: now,
        completedAt: now,
        summary: `Routed to ${routed.agentRef} without a coordinator stage: ${routed.reason}.`,
      });
    } else if (run.dryRun) {
      delegations = payload.specialists.map((specialist, index) => ({
        assignmentId: `dry-run-${index + 1}`,
        agentRef: specialist.agentRef,
        objective: payload.task.objective.slice(0, 4_000),
        acceptanceCriteria: payload.task.acceptanceCriteria,
        dependsOn: [],
      }));
    } else {
      await context.op('coordinate:start', () =>
        startStages(run.id, run.project.id, execution, attempt, [
          {
            part: 'coordinate',
            state: {
              phase: 'coordinate',
              input: { phase: 'coordinate', team: payload, agent: payload.coordinator },
            },
          },
        ]),
      );
      const [plan] = await awaitStages(context, 'coordinate', [stageId('coordinate')]);
      delegations =
        plan!.delegations.length > 0
          ? plan!.delegations
          : [
              {
                assignmentId: 'coordinator-work',
                agentRef: payload.coordinator.agentRef,
                objective: payload.task.objective,
                acceptanceCriteria: payload.task.acceptanceCriteria,
                dependsOn: [],
              },
            ];
      dependencyWaves(delegations);
      entries.push(history(plan!));
    }

    // specialize
    const specialistResults: StageResult[] = [];
    if (!run.dryRun) {
      const index = new Map(delegations.map((item, position) => [item.assignmentId, position + 1]));
      for (const [wave, assignments] of dependencyWaves(delegations).entries()) {
        const finished = new Map(specialistResults.map((item) => [item.assignmentId, item]));
        await context.op(`specialize:${wave}:start`, () =>
          startStages(
            run.id,
            run.project.id,
            execution,
            attempt,
            assignments.map((assignment) => {
              const dependencyResults = assignment.dependsOn.map((assignmentId) => {
                const { summary, evidence } = finished.get(assignmentId)!;
                return { assignmentId, summary, evidence };
              });
              return {
                part: `s${index.get(assignment.assignmentId)}`,
                state: {
                  phase: 'specialize' as const,
                  assignmentId: assignment.assignmentId,
                  input: {
                    phase: 'specialize' as const,
                    team: payload,
                    agent: member(payload, assignment.agentRef),
                    assignment,
                    ...(dependencyResults.length > 0 ? { dependencyResults } : {}),
                  },
                },
              };
            }),
          ),
        );
        specialistResults.push(
          ...(await awaitStages(
            context,
            `specialize:${wave}`,
            assignments.map((assignment) => stageId(`s${index.get(assignment.assignmentId)}`)),
          )),
        );
      }
      entries.push(...specialistResults.map(history));
    }

    // review
    let review: StageResult | null = null;
    if (!run.dryRun && policy.reviewRequired) {
      await context.op('review:start', () =>
        startStages(run.id, run.project.id, execution, attempt, [
          {
            part: 'review',
            state: {
              phase: 'review',
              input: {
                phase: 'review',
                team: payload,
                agent: payload.coordinator,
                specialistResults,
              },
            },
          },
        ]),
      );
      [review] = (await awaitStages(context, 'review', [stageId('review')])) as [StageResult];
      entries.push(history(review));
    }

    // synchronize
    const evidence = specialistResults.flatMap((item) => item.evidence);
    if (run.dryRun) {
      return {
        kind: 'end',
        status: 'succeeded',
        result: {
          status: 'dry-run-complete',
          taskRef: payload.task.taskRef,
          summary: `Validated ${delegations.length} specialist assignments; no agent was asked.`,
          evidence: [],
          history: entries,
          planSync: { state: 'simulated', synchronizedAt: null },
        },
      };
    }
    const state =
      policy.autonomy === 'done' && review?.review?.accepted
        ? ('done' as const)
        : ('review' as const);
    const summary = review?.review
      ? review.review.notes || review.summary
      : specialistResults
          .map((item) => item.summary)
          .join('\n\n')
          .slice(0, 4_000);
    const synchronizedAt = await context.op('synchronize', () =>
      synchronize(run.id, execution, state, summary, evidence),
    );
    await context.op('record', async () => {
      await writeStep(run.id, context.step, execution, {
        status: 'succeeded',
        outcome: state,
        summary: clip(summary),
        finishedAt: new Date(),
      });
    });
    return {
      kind: 'end',
      status: 'succeeded',
      result: {
        status: state,
        taskRef: payload.task.taskRef,
        summary,
        evidence,
        history: entries,
        planSync: { state, synchronizedAt },
      },
    };
  },
  async cancel(runId, execution) {
    const rows = await db
      .select({ agentRunId: pipelineRunStep.agentRunId })
      .from(pipelineRunStep)
      .where(
        and(
          eq(pipelineRunStep.runId, runId),
          like(pipelineRunStep.stepId, `${execution.stepId}.%`),
          eq(pipelineRunStep.iteration, execution.iteration),
        ),
      );
    for (const row of rows) if (row.agentRunId) await cancelStepRun(row.agentRunId);
  },
};
