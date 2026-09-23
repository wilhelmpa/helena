import { setTimeout as sleep } from 'node:timers/promises';

const IDEMPOTENCY = /^[a-f0-9]{64}$/;
const REFERENCE = /^[a-z][a-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class HermesTeamError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HermesTeamError';
    this.status = status;
    this.code = code;
  }
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function string(value, max) {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}

function reference(value, kind) {
  const candidate = string(value, 160);
  return candidate && candidate.startsWith(kind + ':') && REFERENCE.test(candidate) ? candidate : null;
}

function iso(value) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function strictJson(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 256 * 1024)
    throw new HermesTeamError(502, 'invalid_hermes_output', 'Hermes returned invalid output');
  const trimmed = raw.trim();
  const source = trimmed.startsWith('```json\n') && trimmed.endsWith('\n```')
    ? trimmed.slice(8, -4).trim()
    : trimmed;
  try {
    const value = JSON.parse(source);
    if (!record(value)) throw new Error();
    return value;
  } catch {
    throw new HermesTeamError(502, 'invalid_hermes_output', 'Hermes returned invalid output');
  }
}

function evidence(value) {
  if (!Array.isArray(value) || value.length > 100) return [];
  return value.map(item => {
    const row = record(item);
    const kind = row && ['comment', 'artifact', 'test', 'link'].includes(row.kind) ? row.kind : null;
    const ref = string(row?.ref, 2_000);
    const label = string(row?.label, 300);
    if (!kind || !ref || !label)
      throw new HermesTeamError(502, 'invalid_hermes_output', 'Hermes returned invalid evidence');
    return { kind, ref, label };
  });
}

function delegations(value, allowed) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12)
    throw new HermesTeamError(502, 'invalid_hermes_output', 'Hermes returned invalid delegations');
  const ids = new Set();
  return value.map(item => {
    const row = record(item);
    const assignmentId = string(row?.assignmentId, 120);
    const agentRef = reference(row?.agentRef, 'agent');
    const objective = string(row?.objective, 4_000);
    const acceptanceCriteria = Array.isArray(row?.acceptanceCriteria)
      ? row.acceptanceCriteria.map(value => string(value, 1_000))
      : [];
    const dependsOn = Array.isArray(row?.dependsOn)
      ? row.dependsOn.map(value => string(value, 120))
      : [];
    if (
      !assignmentId || ids.has(assignmentId) || !agentRef || !allowed.has(agentRef) || !objective ||
      acceptanceCriteria.length < 1 || acceptanceCriteria.some(value => !value) ||
      dependsOn.length > 20 || dependsOn.some(value => !value)
    ) throw new HermesTeamError(502, 'invalid_hermes_output', 'Hermes returned invalid delegations');
    ids.add(assignmentId);
    return { assignmentId, agentRef, objective, acceptanceCriteria, dependsOn };
  });
}

function validateStage(input) {
  const row = record(input);
  const phase = ['coordinate', 'specialize', 'review'].includes(row?.phase) ? row.phase : null;
  const idempotencyKey = string(row?.idempotencyKey, 64);
  const projectRef = reference(row?.projectRef, 'project');
  const task = record(row?.task);
  const taskRef = reference(task?.taskRef, 'task');
  const agent = record(row?.agent);
  const agentRef = reference(agent?.agentRef, 'agent');
  const policy = record(row?.policy);
  const timeoutSeconds = Number(policy?.timeoutSeconds);
  if (
    row?.schemaVersion !== 1 || !phase || !idempotencyKey || !IDEMPOTENCY.test(idempotencyKey) ||
    !projectRef || !taskRef || !agentRef || !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 30 || timeoutSeconds > 7_200
  ) throw new HermesTeamError(400, 'invalid_stage_request', 'Invalid Hermes stage request');
  return { ...row, phase, idempotencyKey, projectRef, task, taskRef, agent, agentRef, policy, timeoutSeconds };
}

function taskInProject(taskRef, projectRef) {
  return taskRef.slice(5).split('-').slice(0, -1).join('-') === projectRef.slice(8);
}

function validateSynchronization(input) {
  const row = record(input);
  const idempotencyKey = string(row?.idempotencyKey, 64);
  const projectRef = reference(row?.projectRef, 'project');
  const taskRef = reference(row?.taskRef, 'task');
  const state = row?.state === 'review' || row?.state === 'done' ? row.state : null;
  const summary = string(row?.summary, 4_000);
  if (
    row?.schemaVersion !== 1 || !idempotencyKey || !IDEMPOTENCY.test(idempotencyKey) ||
    !projectRef || !taskRef || !taskInProject(taskRef, projectRef) ||
    !state || !summary || !Array.isArray(row?.evidence) || row.evidence.length > 500
  ) throw new HermesTeamError(400, 'invalid_sync_request', 'Invalid Plan synchronization request');
  return { ...row, idempotencyKey, projectRef, taskRef, state, summary };
}

function validateRoutine(input) {
  const row = record(input);
  const idempotencyKey = string(row?.idempotencyKey, 64);
  const projectRef = reference(row?.projectRef, 'project');
  const agentRef = reference(row?.agentRef, 'agent');
  const title = string(row?.title, 300);
  const instructions = string(row?.instructions, 20_000);
  const mode = row?.mode === 'new' || row?.mode === 'reopen' ? row.mode : null;
  const taskRef = row?.taskRef === undefined ? undefined : reference(row.taskRef, 'task');
  const actorId = row?.actorId === undefined ? undefined : string(row.actorId, 200);
  if (
    row?.schemaVersion !== 1 || !idempotencyKey || !IDEMPOTENCY.test(idempotencyKey) ||
    !projectRef || !agentRef || !title || !instructions || !mode ||
    taskRef === null || (taskRef && !taskInProject(taskRef, projectRef)) ||
    (mode === 'reopen' && !taskRef) || actorId === null
  ) throw new HermesTeamError(400, 'invalid_routine_request', 'Invalid routine request');
  return {
    idempotencyKey, projectRef, agentRef, title, instructions, mode,
    ...(taskRef ? { taskRef } : {}),
    ...(actorId ? { actorId } : {}),
  };
}

const PIPELINE_OPERATIONS = new Set(['begin', 'agent', 'condition', 'action', 'approval', 'wait', 'record', 'finish']);

// An operation of plan-pipeline for Plan's pipeline control API, which checks the rest.
function validatePipelineRequest(input) {
  const row = record(input);
  if (
    row?.schemaVersion !== 1 || !PIPELINE_OPERATIONS.has(row.operation) ||
    !reference(row.projectRef, 'project') || !string(row.runId, 200)
  ) throw new HermesTeamError(400, 'invalid_pipeline_request', 'Invalid pipeline request');
  return row;
}

function validatePipelineAgent(input) {
  const row = record(input);
  const idempotencyKey = string(row?.idempotencyKey, 64);
  const projectRef = reference(row?.projectRef, 'project');
  const taskRef = reference(row?.taskRef, 'task');
  const agentRef = reference(row?.agentRef, 'agent');
  const prompt = string(row?.prompt, 48_000);
  const timeoutSeconds = Number(row?.timeoutSeconds);
  const policy = record(row?.policy) ?? {};
  if (
    row?.schemaVersion !== 1 || !idempotencyKey || !IDEMPOTENCY.test(idempotencyKey) ||
    !projectRef || !taskRef || !taskInProject(taskRef, projectRef) || !agentRef || !prompt ||
    !Number.isInteger(timeoutSeconds) || timeoutSeconds < 60 || timeoutSeconds > 86_400
  ) throw new HermesTeamError(400, 'invalid_pipeline_agent_request', 'Invalid pipeline agent request');
  return {
    idempotencyKey, projectRef, taskRef, agentRef, prompt, timeoutSeconds,
    policy: Object.fromEntries(
      ['maxTurns', 'runBudgetSeconds', 'model'].filter(key => policy[key] != null).map(key => [key, policy[key]]),
    ),
  };
}

// The agent's answer ends with the summary the step asked for, so a long one keeps its
// end.
function summaryOf(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  return value.length > 4_000 ? `…${value.slice(-3_999)}` : value;
}

function prompt(stage) {
  const allowed = Array.isArray(stage.allowedSpecialists)
    ? stage.allowedSpecialists.map(item => record(item)).filter(Boolean)
    : [];
  const contract = stage.phase === 'coordinate'
    ? '{"summary":"...","delegations":[{"assignmentId":"...","agentRef":"agent:...","objective":"...","acceptanceCriteria":["..."],"dependsOn":[]}]}'
    : stage.phase === 'review'
      ? '{"summary":"...","evidence":[],"review":{"accepted":true,"notes":"..."}}'
      : '{"summary":"...","evidence":[{"kind":"test","ref":"...","label":"..."}]}';
  return [
    'Execute this project-bound agent-team stage. Return exactly one JSON object and no prose or markdown.',
    `Phase: ${stage.phase}`,
    `Project: ${stage.projectRef}`,
    `Task: ${stage.taskRef}`,
    `Task title: ${string(stage.task.title, 300) ?? ''}`,
    `Objective: ${string(stage.task.objective, 12_000) ?? ''}`,
    `Acceptance criteria: ${JSON.stringify(stage.task.acceptanceCriteria ?? [])}`,
    stage.phase === 'coordinate'
      ? 'Only plan assignments. Mastra executes each delegation after this stage. Do not call delegate_task, spawn agents, execute assignments, or mutate the task in this stage.'
      : 'Complete only this stage. Mastra owns delegation and task synchronization; do not spawn additional agents or change the task status.',
    stage.phase === 'coordinate'
      ? 'List in dependsOn the assignmentIds that must finish before an assignment can start. Assignments without dependencies run in parallel; a dependent assignment receives the summaries and evidence of the assignments it depends on.'
      : '',
    stage.phase === 'coordinate' ? `Allowed specialists: ${JSON.stringify(allowed)}` : '',
    stage.assignment ? `Assignment: ${JSON.stringify(stage.assignment)}` : '',
    Array.isArray(stage.dependencyResults) && stage.dependencyResults.length > 0
      ? `Results of the assignments this assignment depends on: ${JSON.stringify(stage.dependencyResults)}`
      : '',
    stage.specialistResults ? `Specialist results: ${JSON.stringify(stage.specialistResults)}` : '',
    `Output contract: ${contract}`,
  ].filter(Boolean).join('\n\n');
}

function stageResult(stage, run, output) {
  const parsed = strictJson(output);
  const summary = string(parsed.summary, 4_000);
  const claimedAt = iso(run.claimedAt);
  const heartbeatAt = iso(run.heartbeatAt);
  const expiresAt = iso(run.expiresAt);
  const completedAt = iso(run.finishedAt);
  if (!summary || !claimedAt || !heartbeatAt || !expiresAt || !completedAt)
    throw new HermesTeamError(502, 'invalid_run_lease', 'Hermes run lease is incomplete');
  const allowed = new Set(
    Array.isArray(stage.allowedSpecialists)
      ? stage.allowedSpecialists.map(item => reference(record(item)?.agentRef, 'agent')).filter(Boolean)
      : [],
  );
  const result = {
    executionId: `plan-run:${run.runId}`,
    idempotencyKey: stage.idempotencyKey,
    phase: stage.phase,
    status: 'completed',
    attempt: run.attempts,
    startedAt: claimedAt,
    completedAt,
    summary,
    evidence: evidence(parsed.evidence),
    delegations: stage.phase === 'coordinate' ? delegations(parsed.delegations, allowed) : [],
    lease: { claimedAt, heartbeatAt, expiresAt },
  };
  if (stage.phase === 'review') {
    const review = record(parsed.review);
    if (!review || typeof review.accepted !== 'boolean' || typeof review.notes !== 'string' || review.notes.length > 4_000)
      throw new HermesTeamError(502, 'invalid_hermes_output', 'Hermes returned an invalid review');
    result.review = { accepted: review.accepted, notes: review.notes };
    result.status = review.accepted ? 'completed' : 'needs-review';
  }
  return result;
}

export function createHermesTeamService(plan, options = {}) {
  const wait = options.wait ?? ((milliseconds, signal) => sleep(milliseconds, undefined, { signal }).catch(() => {}));
  const now = options.now ?? (() => Date.now());
  return {
    // `signal` is aborted when Mastra stops waiting for the stage, which it does when its
    // workflow run is canceled. The Plan run is canceled then, so no runner executes a
    // stage whose result nobody reads.
    async executeStage(input, signal) {
      const stage = validateStage(input);
      const queued = await plan.enqueue({
        idempotencyKey: stage.idempotencyKey,
        projectRef: stage.projectRef,
        task: { taskRef: stage.taskRef },
        agent: { agentRef: stage.agentRef },
        execution: stage.execution ?? {},
        policy: stage.policy,
        prompt: prompt(stage),
      });
      const deadline = now() + stage.timeoutSeconds * 1_000;
      while (now() < deadline) {
        if (signal?.aborted) {
          await plan.cancel({ runId: queued.runId, projectRef: stage.projectRef });
          throw new HermesTeamError(499, 'stage_canceled', 'The execution stage was canceled');
        }
        const run = await plan.status({ runId: queued.runId, projectRef: stage.projectRef });
        // The agent marked the task blocked and asked a person; its output is no stage result.
        if (run.status === 'success' && run.blockedQuestion)
          throw new HermesTeamError(409, 'hermes_run_blocked', `The agent is blocked and needs input: ${run.blockedQuestion}`);
        if (run.status === 'success') return stageResult(stage, run, run.output);
        if (run.status === 'failed' || run.status === 'canceled')
          throw new HermesTeamError(502, 'hermes_run_failed', 'Hermes could not complete the execution stage');
        await wait(Math.min(2_000, Math.max(100, deadline - now())), signal);
      }
      throw new HermesTeamError(504, 'hermes_run_timeout', 'Hermes execution stage timed out');
    },
    async synchronize(input) {
      return plan.synchronize(validateSynchronization(input));
    },
    async pipeline(input) {
      return plan.pipeline(validatePipelineRequest(input));
    },
    // The agent run of a plan-pipeline agent step. Its outcome is an answer, not an
    // error: the workflow may branch on a failed or blocked run. A step that runs out of
    // time or is abandoned cancels the run.
    async executePipelineAgent(input, signal) {
      const request = validatePipelineAgent(input);
      const queued = await plan.enqueue({
        idempotencyKey: request.idempotencyKey,
        projectRef: request.projectRef,
        task: { taskRef: request.taskRef },
        agent: { agentRef: request.agentRef },
        execution: {},
        policy: request.policy,
        prompt: request.prompt,
      });
      const cancel = () => plan.cancel({ runId: queued.runId, projectRef: request.projectRef }).catch(() => {});
      const deadline = now() + request.timeoutSeconds * 1_000;
      while (now() < deadline) {
        if (signal?.aborted) {
          await cancel();
          throw new HermesTeamError(499, 'stage_canceled', 'The agent step was canceled');
        }
        const run = await plan.status({ runId: queued.runId, projectRef: request.projectRef });
        const answer = (outcome, summary) => ({ agentRunId: queued.runId, outcome, summary: summaryOf(summary) });
        if (run.status === 'success' && run.blockedQuestion) return answer('blocked', run.blockedQuestion);
        if (run.status === 'success') return answer('success', run.output);
        if (run.status === 'failed') return answer('failed', run.error || 'The agent run failed');
        if (run.status === 'canceled') return answer('failed', 'The agent run was canceled');
        await wait(Math.min(2_000, Math.max(100, deadline - now())), signal);
      }
      await cancel();
      throw new HermesTeamError(504, 'hermes_run_timeout', 'The agent step timed out');
    },
    async routine(input) {
      return plan.routine(validateRoutine(input));
    },
  };
}
