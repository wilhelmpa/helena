// The contract of an agent-team stage (engine/builtin/steps/agent-team.ts): the team a task
// runs with, the prompt a stage's agent gets and how its answer is read. Pure, with no
// database, so Lokale KI's eval of a coordinator's first plan (`coordinator-triage`,
// modules/local-ai/evals.ts) asks a model exactly what a coordinate stage asks and reads the
// answer the same way, from the command line too.

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

export const DEFAULT_POLICY: TeamPolicy = {
  maxAttempts: 3,
  initialBackoffMs: 1_000,
  maxBackoffMs: 30_000,
  backoffMultiplier: 2,
  timeoutSeconds: 900,
  reviewRequired: true,
  autonomy: 'review',
};

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

// ---- stage contract ---------------------------------------------------------------

const REFERENCE = /^[a-z][a-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function record(value: unknown): Record<string, unknown> | null {
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

export type Phase = StageResult['phase'];

export interface StageInput {
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
