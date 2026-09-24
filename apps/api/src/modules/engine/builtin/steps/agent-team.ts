import { aiAgent, db, issueActivity, pipelineRunStep, projectMember } from '@repo/db';
import { and, eq, like, sql } from 'drizzle-orm';
import { listColumns } from '#modules/columns/service';
import { updateIssue } from '#modules/issues/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import type { AgentTeamStep } from '#modules/pipelines/definition';
import { cancelStepRun, queueStepRun, stepRunStatus } from '../../agent-runs';
import { clip, loadRun, stepRow, writeStep } from '../../run-context';
import {
  StepFailure,
  type StepContext,
  type StepExecution,
  type WorkflowStepType,
} from '../../sdk';

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

export interface TeamMember {
  agentRef: string;
  role: string;
  capabilities: string[];
}

export interface TeamPolicy {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  backoffMultiplier: number;
  timeoutSeconds: number;
  reviewRequired: boolean;
  autonomy: 'review' | 'done';
  maxTurns?: number;
  runBudgetSeconds?: number;
}

export interface TeamPayload {
  schemaVersion: 1;
  task: {
    taskRef: string;
    title: string;
    objective: string;
    acceptanceCriteria: string[];
    labels: string[];
  };
  coordinator: TeamMember;
  specialists: TeamMember[];
  policy: TeamPolicy;
  execution: { model?: string; reasoning?: string };
}

export interface Delegation {
  assignmentId: string;
  agentRef: string;
  objective: string;
  acceptanceCriteria: string[];
  dependsOn: string[];
}

export interface Evidence {
  kind: 'comment' | 'artifact' | 'test' | 'link';
  ref: string;
  label: string;
}

export interface StageResult {
  executionId: string;
  phase: 'coordinate' | 'specialize' | 'review';
  status: 'completed' | 'needs-review';
  attempt: number;
  startedAt: string;
  completedAt: string;
  summary: string;
  evidence: Evidence[];
  delegations: Delegation[];
  review?: { accepted: boolean; notes: string };
  assignmentId?: string;
}

export interface HistoryEntry {
  executionId: string;
  phase: 'route' | 'coordinate' | 'specialize' | 'review' | 'synchronize';
  status: string;
  attempt: number;
  startedAt: string;
  completedAt: string;
  summary: string;
}

export const DEFAULT_POLICY: TeamPolicy = {
  maxAttempts: 3,
  initialBackoffMs: 1_000,
  maxBackoffMs: 30_000,
  backoffMultiplier: 2,
  timeoutSeconds: 900,
  reviewRequired: true,
  autonomy: 'review',
};

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

// ---- stage contract ---------------------------------------------------------------

const REFERENCE = /^[a-z][a-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]*$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}

class InvalidOutput extends Error {}

// The one JSON object a stage answers with, alone or in a ```json fence.
function strictJson(raw: string | null): Record<string, unknown> {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 256 * 1024)
    throw new InvalidOutput('The agent returned no usable answer');
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(trimmed);
  const source = fenced ? fenced[1]!.trim() : trimmed;
  try {
    const value = record(JSON.parse(source));
    if (!value) throw new Error();
    return value;
  } catch {
    throw new InvalidOutput('The agent did not answer with one JSON object');
  }
}

function evidenceOf(value: unknown): Evidence[] {
  if (!Array.isArray(value) || value.length > 100) return [];
  return value.map((item) => {
    const row = record(item);
    const kind =
      row && ['comment', 'artifact', 'test', 'link'].includes(String(row.kind))
        ? (row.kind as Evidence['kind'])
        : null;
    const ref = text(row?.ref, 2_000);
    const label = text(row?.label, 300);
    if (!kind || !ref || !label) throw new InvalidOutput('The agent returned invalid evidence');
    return { kind, ref, label };
  });
}

function delegationsOf(value: unknown, allowed: Set<string>): Delegation[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12)
    throw new InvalidOutput('The coordinator returned no valid assignments');
  const ids = new Set<string>();
  return value.map((item) => {
    const row = record(item);
    const assignmentId = text(row?.assignmentId, 120);
    const agentRef = text(row?.agentRef, 160);
    const objective = text(row?.objective, 4_000);
    const acceptanceCriteria = Array.isArray(row?.acceptanceCriteria)
      ? row.acceptanceCriteria.map((entry) => text(entry, 1_000))
      : [];
    const dependsOn = Array.isArray(row?.dependsOn)
      ? row.dependsOn.map((entry) => text(entry, 120))
      : [];
    if (
      !assignmentId ||
      ids.has(assignmentId) ||
      !agentRef ||
      !REFERENCE.test(agentRef) ||
      !allowed.has(agentRef) ||
      !objective ||
      acceptanceCriteria.length < 1 ||
      acceptanceCriteria.length > 30 ||
      acceptanceCriteria.some((entry) => !entry) ||
      dependsOn.length > 20 ||
      dependsOn.some((entry) => !entry)
    )
      throw new InvalidOutput('The coordinator returned an invalid assignment');
    ids.add(assignmentId);
    return {
      assignmentId,
      agentRef,
      objective,
      acceptanceCriteria: acceptanceCriteria as string[],
      dependsOn: dependsOn as string[],
    };
  });
}

type Phase = StageResult['phase'];

interface StageInput {
  phase: Phase;
  team: TeamPayload;
  agent: TeamMember;
  assignment?: Delegation;
  dependencyResults?: { assignmentId: string; summary: string; evidence: Evidence[] }[];
  specialistResults?: StageResult[];
}

// The prompt of a stage: the task, what the stage is to do, and the exact JSON it has
// to answer with.
export function stagePrompt(stage: StageInput, projectRef: string): string {
  const contract =
    stage.phase === 'coordinate'
      ? '{"summary":"...","delegations":[{"assignmentId":"...","agentRef":"agent:...","objective":"...","acceptanceCriteria":["..."],"dependsOn":[]}]}'
      : stage.phase === 'review'
        ? '{"summary":"...","evidence":[],"review":{"accepted":true,"notes":"..."}}'
        : '{"summary":"...","evidence":[{"kind":"test","ref":"...","label":"..."}]}';
  const { task } = stage.team;
  return [
    'Execute this project-bound agent-team stage. Return exactly one JSON object and no prose or markdown.',
    `Phase: ${stage.phase}`,
    `Project: ${projectRef}`,
    `Task: ${task.taskRef}`,
    `Task title: ${task.title}`,
    `Objective: ${task.objective}`,
    `Acceptance criteria: ${JSON.stringify(task.acceptanceCriteria)}`,
    stage.phase === 'coordinate'
      ? 'Only plan assignments. Helena executes each delegation after this stage. Do not call delegate_task, spawn agents, execute assignments, or mutate the task in this stage.'
      : 'Complete only this stage. Helena owns delegation and task synchronization; do not spawn additional agents or change the task status.',
    stage.phase === 'coordinate'
      ? 'List in dependsOn the assignmentIds that must finish before an assignment can start. Assignments without dependencies run in parallel; a dependent assignment receives the summaries and evidence of the assignments it depends on.'
      : '',
    stage.phase === 'coordinate'
      ? `Allowed specialists: ${JSON.stringify(stage.team.specialists)}`
      : '',
    stage.assignment ? `Assignment: ${JSON.stringify(stage.assignment)}` : '',
    stage.dependencyResults?.length
      ? `Results of the assignments this assignment depends on: ${JSON.stringify(stage.dependencyResults)}`
      : '',
    stage.specialistResults ? `Specialist results: ${JSON.stringify(stage.specialistResults)}` : '',
    `Output contract: ${contract}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// Reads a stage's answer against its contract.
export function parseStage(
  stage: StageInput,
  output: string | null,
): Pick<StageResult, 'summary' | 'evidence' | 'delegations' | 'review' | 'status'> {
  const parsed = strictJson(output);
  const summary = text(parsed.summary, 4_000);
  if (!summary) throw new InvalidOutput('The agent answered without a summary');
  const allowed = new Set(stage.team.specialists.map((member) => member.agentRef));
  const result: Pick<StageResult, 'summary' | 'evidence' | 'delegations' | 'review' | 'status'> = {
    summary,
    evidence: evidenceOf(parsed.evidence),
    delegations: stage.phase === 'coordinate' ? delegationsOf(parsed.delegations, allowed) : [],
    status: 'completed',
  };
  if (stage.phase === 'review') {
    const review = record(parsed.review);
    if (
      !review ||
      typeof review.accepted !== 'boolean' ||
      typeof review.notes !== 'string' ||
      review.notes.length > 4_000
    )
      throw new InvalidOutput('The coordinator returned an invalid review');
    result.review = { accepted: review.accepted, notes: review.notes };
    result.status = review.accepted ? 'completed' : 'needs-review';
  }
  return result;
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

// Queues the agent run of a stage's current attempt.
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
  const agentRunId = await queueStepRun({
    agentId: agent.id,
    projectId,
    issueId: context.task?.id ?? null,
    prompt: stagePrompt(state.input, `project:${context.project.key}`),
    maxTurns: team.policy.maxTurns ?? null,
    runBudgetSeconds: team.policy.runBudgetSeconds ?? null,
    expect: { model: team.execution.model, reasoning: team.execution.reasoning },
  });
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
    await context.waitForSignal('agent-run', Math.min(60, seconds));
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
      : columns.find((column) => column.name.trim().toLowerCase() === 'review');
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
  const found = team.specialists.find((item) => item.agentRef === agentRef);
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
      delegations = plan!.delegations;
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
