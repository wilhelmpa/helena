import { aiAgent, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { normalizeRuntimePolicy } from '#modules/agents/core/service';
import {
  LIMITS,
  maxTurnsLimit,
  runBudgetSecondsLimit,
  type AgentStep,
  type Assignee,
} from '#modules/pipelines/definition';
import { renderTemplate } from '#modules/pipelines/render';
import {
  cancelStepRun,
  ModelRefusedFailure,
  queueStepRun,
  stepRunStatus,
  summaryOf,
} from '../../agent-runs';
import {
  assigneeAgent,
  clip,
  loadRun,
  renderContext,
  setRunStatus,
  stepRow,
  writeStep,
} from '../../run-context';
import {
  StepFailure,
  type FieldReader,
  type StepContext,
  type StepExecution,
  type WorkflowStepType,
} from '../../sdk';
import { engineWaitSeconds } from '../../dbos';

// An agent task: the agent of the step's role (or the agent a project workflow names)
// gets the rendered instruction as a run of its own, and the step waits for it. Its
// answer's end is the step's summary, which later steps read.

type Step = AgentStep & { [field: string]: unknown };

function readAssignee(raw: unknown, reader: FieldReader): Assignee {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (typeof value?.role === 'string') return { role: value.role };
  if (typeof value?.agentId === 'number' && Number.isInteger(value.agentId) && value.agentId > 0)
    return { agentId: value.agentId };
  reader.issue('required', 'assignee');
  return { role: '' };
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
  return {
    maxTurns: lower(step.maxTurns, own.maxTurns),
    runBudgetSeconds: lower(step.runBudgetSeconds, own.runBudgetSeconds),
    model: step.model,
  };
}

type Prepared = { dryRun: true } | { dryRun: false; agentRunId: number; deadline: number };

// Queues the agent run of this attempt, once: a prepare that ran before a crash left its
// run on the step row, and that run is the attempt's.
async function prepare(runId: string, step: AgentStep, at: StepExecution): Promise<Prepared> {
  const context = await loadRun(runId);
  const existing = await stepRow(runId, at);
  const attempt = existing?.attempt ?? 1;
  if (existing?.agentRunId && (existing.state as { attempt?: number } | null)?.attempt === attempt)
    return {
      dryRun: false,
      agentRunId: existing.agentRunId,
      deadline: existing.startedAt.getTime() + step.timeoutMinutes * 60_000,
    };
  if (!context.task) throw new StepFailure('The workflow run has no task');
  const agent = await assigneeAgent(context, step.assignee);
  const instruction = renderTemplate(step.instruction, await renderContext(context, at.seq));
  if (!agent) {
    const reason =
      'role' in step.assignee
        ? `No agent of the project fills the role ${step.assignee.role}`
        : 'The agent of the step does not work in this project';
    // A test run of a template the project does not use yet shows what is missing and
    // goes on.
    await writeStep(runId, step, at, {
      status: context.run.dryRun ? 'simulated' : 'failed',
      outcome: context.run.dryRun ? 'success' : 'failed',
      summary: context.run.dryRun ? clip(instruction) : null,
      error: reason,
      finishedAt: new Date(),
    });
    if (!context.run.dryRun) throw new StepFailure(reason);
    return { dryRun: true };
  }
  if (context.run.dryRun) {
    await writeStep(runId, step, at, {
      status: 'simulated',
      agentId: agent.id,
      outcome: 'success',
      summary: clip(instruction),
      finishedAt: new Date(),
    });
    return { dryRun: true };
  }
  const prompt = [
    `Workflow "${context.name}", step "${step.name}", on task ${context.task.identifier}.`,
    instruction,
    'End your answer with a short summary of what you did. The workflow passes it to its next steps.',
  ].join('\n\n');
  const policy = await stepPolicy(step, agent.id);
  let agentRunId: number;
  try {
    agentRunId = await queueStepRun({
      agentId: agent.id,
      projectId: context.project.id,
      issueId: context.task.id,
      prompt,
      ...policy,
    });
  } catch (error) {
    await writeStep(runId, step, at, {
      status: 'failed',
      agentId: agent.id,
      outcome: 'failed',
      error: clip(error instanceof Error ? error.message : String(error), 2_000),
      // A model the provider refused this account: the run view words it (runs.ts stepFailure).
      ...(error instanceof ModelRefusedFailure && { state: { runtimeFailure: error.failure } }),
      finishedAt: new Date(),
    });
    throw error;
  }
  await writeStep(runId, step, at, {
    status: 'running',
    agentId: agent.id,
    agentRunId,
    state: { attempt },
    error: null,
    finishedAt: null,
  });
  await setRunStatus(runId, 'running');
  return {
    dryRun: false,
    agentRunId,
    deadline: (existing?.startedAt.getTime() ?? Date.now()) + step.timeoutMinutes * 60_000,
  };
}

type Checked =
  { done: false } | { done: true; outcome: 'success' | 'failed' | 'blocked'; summary: string };

// Where the agent run is. A step that outlived its timeout cancels its run and fails.
async function check(
  runId: string,
  step: AgentStep,
  at: StepExecution,
  prepared: { agentRunId: number; deadline: number },
): Promise<Checked> {
  const run = await stepRunStatus(prepared.agentRunId);
  const record = async (
    outcome: 'success' | 'failed' | 'blocked',
    summary: string,
    error?: string,
  ) => {
    await writeStep(runId, step, at, {
      status: outcome === 'success' ? 'succeeded' : 'failed',
      outcome,
      summary: clip(summary),
      error: error ? clip(error, 2_000) : null,
      finishedAt: new Date(),
    });
    return { done: true as const, outcome, summary };
  };
  if (run.status === 'pending') {
    if (Date.now() < prepared.deadline) return { done: false };
    await cancelStepRun(prepared.agentRunId);
    return record('failed', 'The agent step timed out', 'The agent step timed out');
  }
  if (run.status === 'success' && run.blockedQuestion)
    return record('blocked', run.blockedQuestion);
  if (run.status === 'success') return record('success', summaryOf(run.output));
  if (run.status === 'failed') {
    const message = run.error || 'The agent run failed';
    return record('failed', message, message);
  }
  return record('failed', 'The agent run was canceled', 'The agent run was canceled');
}

export const agentStep: WorkflowStepType<Step> = {
  type: 'agent',
  ui: { builder: true, icon: 'bot' },
  producesResult: true,
  read(value, reader, scope) {
    const assignee = readAssignee(value.assignee, reader);
    if ('agentId' in assignee && scope.template) reader.issue('agent_in_template', 'assignee');
    return {
      assignee,
      instruction: reader.text(value.instruction, 'instruction', LIMITS.text),
      maxTurns: reader.optionalInteger(value.maxTurns, 'maxTurns', maxTurnsLimit),
      runBudgetSeconds: reader.optionalInteger(
        value.runBudgetSeconds,
        'runBudgetSeconds',
        runBudgetSecondsLimit,
      ),
      model:
        value.model === undefined || value.model === null || value.model === ''
          ? null
          : reader.text(value.model, 'model', 200),
      timeoutMinutes: reader.integer(value.timeoutMinutes, 'timeoutMinutes', LIMITS.timeoutMinutes),
    };
  },
  templateFields: (step) => [{ field: 'instruction', text: step.instruction }],
  roleReferences: (step) =>
    'role' in step.assignee ? [{ field: 'assignee', role: step.assignee.role }] : [],
  async execute(context: StepContext<Step>) {
    const { step, execution } = context;
    const prepared = await context.op('prepare', () => prepare(context.run.id, step, execution));
    if (prepared.dryRun) return { kind: 'continue', outcome: 'success' };
    for (;;) {
      const checked = await context.op('check', () =>
        check(context.run.id, step, execution, prepared),
      );
      if (checked.done)
        return { kind: 'continue', outcome: checked.outcome, summary: checked.summary };
      await context.waitForSignal('agent-run', engineWaitSeconds(60));
    }
  },
  async cancel(runId, execution) {
    const row = await stepRow(runId, execution);
    if (row?.agentRunId) await cancelStepRun(row.agentRunId);
  },
};
