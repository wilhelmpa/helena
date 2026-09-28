import { agentRun, aiAgent, db, issueWorkClaim } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { maxTurnsLimit, runBudgetSecondsLimit } from '#modules/agents/model';
import { runLimit } from '#modules/agents/core/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import type { RuntimeFailure } from '@helena/sdk';
import { agentModelRefusal } from '#modules/model-availability/service';
import { policyDecider } from './registry';
import { StepFailure } from './sdk';

// The agent runs the engine queues for its steps: an agent step of a workflow and the
// stages of an agent team. They go through the same queue as every other run of the
// agent, so the Hermes runner claims them, and the pause, the token ceilings and the
// autopilot policy refuse them the same way.

export interface StepRunRequest {
  agentId: number;
  projectId: number;
  issueId: number | null;
  prompt: string;
  maxTurns?: number | null;
  runBudgetSeconds?: number | null;
  // Another model an agent of the team runs, for this run only.
  model?: string | null;
  // The model and reasoning effort the step was planned for; a run is refused when the
  // agent is configured differently.
  expect?: { model?: string | null; reasoning?: string | null };
  // The kind of work the run is for Lokale KI (agent_run.work_class): a coordinator's first
  // plan is `coordinator-triage`.
  workClass?: string | null;
}

async function teamRunsModel(teamId: number, model: string): Promise<boolean> {
  const [row] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(and(eq(aiAgent.teamId, teamId), eq(aiAgent.model, model)))
    .limit(1);
  return row !== undefined;
}

// Checks and queues the run. Refusals are StepFailures: the step cannot go on, and a
// person retries it once the reason is gone.
export async function queueStepRun(request: StepRunRequest): Promise<number> {
  const [agent] = await db
    .select({
      id: aiAgent.id,
      username: aiAgent.username,
      kind: aiAgent.kind,
      teamId: aiAgent.teamId,
      model: aiAgent.model,
      runtimePolicy: aiAgent.runtimePolicy,
    })
    .from(aiAgent)
    .where(eq(aiAgent.id, request.agentId));
  if (!agent || agent.kind !== 'external')
    throw new StepFailure('The agent of the step is not a Hermes agent');
  const configuredReasoning =
    agent.runtimePolicy && typeof agent.runtimePolicy === 'object'
      ? ((agent.runtimePolicy as { reasoningEffort?: unknown }).reasoningEffort ?? null)
      : null;
  if (
    (request.expect?.model && request.expect.model !== agent.model) ||
    (request.expect?.reasoning && request.expect.reasoning !== configuredReasoning)
  )
    throw new StepFailure(`The execution settings of @${agent.username} do not match the run`);
  const model = request.model?.trim() || null;
  if (model && !(await teamRunsModel(agent.teamId, model)))
    throw new StepFailure(`No agent of the team runs the model ${model}`);
  // A model the provider already refused this account is not tried again here: the stage
  // fails at once, naming it (a run or chat answer on it that succeeds clears the finding).
  const refusal = await agentModelRefusal({
    model: model ?? agent.model,
    runtimePolicy: agent.runtimePolicy,
  });
  if (refusal)
    throw new ModelRefusedFailure(agent.username, refusal.model, refusal.provider, refusal.detail);
  const decision = await policyDecider().decide({
    agentId: agent.id,
    projectId: request.projectId,
    actionCategory: 'run',
    taskId: request.issueId,
  });
  if (decision.decision === 'deny')
    throw new StepFailure(`@${agent.username} is paused: ${decision.reason}`);
  const [run] = await db
    .insert(agentRun)
    .values({
      agentId: agent.id,
      projectId: request.projectId,
      issueId: request.issueId,
      prompt: request.prompt,
      trigger: 'manual',
      maxTurns: runLimit(request.maxTurns ?? null, maxTurnsLimit),
      runBudgetSeconds: runLimit(request.runBudgetSeconds ?? null, runBudgetSecondsLimit),
      model,
      workClass: request.workClass ?? null,
    })
    .returning({ id: agentRun.id });
  await bumpControlPlaneRevision(request.projectId);
  return run!.id;
}

// A step on a model the provider refused this account. The failure rides on the step's state
// (`failure`), so the run view words it in the reader's language.
export class ModelRefusedFailure extends StepFailure {
  readonly failure: RuntimeFailure;

  constructor(username: string, model: string, provider: string, detail: string | null) {
    super(
      `@${username} runs ${model}, which ${provider || 'the provider'} does not serve this ` +
        `account${detail ? ` (${detail})` : ''}. Choose another model for the agent; ` +
        'retrying does not help.',
    );
    this.failure = { code: 'model-unavailable', retryable: false, model };
  }
}

export interface StepRunStatus {
  id: number;
  // pending while queued or held by a runner; then success, failed or canceled.
  status: 'pending' | 'success' | 'failed' | 'canceled';
  output: string | null;
  error: string | null;
  // Why it failed, where the runtime's words said; not retryable means no new attempt.
  failure: RuntimeFailure | null;
  blockedQuestion: string | null;
  claimedAt: string | null;
  finishedAt: string | null;
}

export async function stepRunStatus(runId: number): Promise<StepRunStatus> {
  const [row] = await db
    .select({
      id: agentRun.id,
      status: agentRun.status,
      output: agentRun.output,
      error: agentRun.lastError,
      blockedQuestion: agentRun.blockedQuestion,
      claimedAt: agentRun.claimedAt,
      finishedAt: agentRun.finishedAt,
      failure: agentRun.failure,
    })
    .from(agentRun)
    .where(eq(agentRun.id, runId));
  if (!row)
    return {
      id: runId,
      status: 'canceled',
      output: null,
      error: 'The agent run is gone',
      failure: null,
      blockedQuestion: null,
      claimedAt: null,
      finishedAt: null,
    };
  return {
    id: row.id,
    status: row.status as StepRunStatus['status'],
    output: row.output,
    error: row.error,
    failure: (row.failure as RuntimeFailure | null) ?? null,
    blockedQuestion: row.blockedQuestion,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

// Cancels a queued or running agent run. A runner holding it learns of the cancel from
// its next heartbeat; a finished run keeps its outcome.
export async function cancelStepRun(runId: number): Promise<void> {
  const row = await db.transaction(async (tx) => {
    const [canceled] = await tx
      .update(agentRun)
      .set({ status: 'canceled', finishedAt: new Date() })
      .where(and(eq(agentRun.id, runId), eq(agentRun.status, 'pending')))
      .returning({ projectId: agentRun.projectId });
    if (canceled) await tx.delete(issueWorkClaim).where(eq(issueWorkClaim.runId, runId));
    return canceled;
  });
  if (row) await bumpControlPlaneRevision(row.projectId);
}

// The end of the agent's answer, where the step asked for its summary.
export function summaryOf(text: string | null | undefined, limit = 4_000): string {
  const value = (text ?? '').trim();
  return value.length > limit ? `…${value.slice(-(limit - 1))}` : value;
}
