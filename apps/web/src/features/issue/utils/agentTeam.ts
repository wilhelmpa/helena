import type { AgentTeamRun } from '@/lib/api/endpoints/issues';

// The stages of an agent-team run a person follows, in order.
export const AGENT_TEAM_STEPS = ['coordinate', 'specialize', 'review', 'synchronize'] as const;

export type AgentTeamStep = (typeof AGENT_TEAM_STEPS)[number];

const ACTIVE = new Set(['pending', 'running', 'waiting']);

export function isAgentTeamRunActive(run: AgentTeamRun) {
  return ACTIVE.has(run.status);
}

export function agentTeamStepStatus(run: AgentTeamRun, step: AgentTeamStep) {
  return run.steps.find((item) => item.id === step)?.status ?? 'pending';
}

const KNOWN_STATUS = [
  'pending',
  'running',
  'waiting',
  'succeeded',
  'success',
  'failed',
  'canceled',
  'skipped',
] as const;

// A status the panel has a label for: the engine's run statuses and the agent runs'.
export function isKnownStatus(status: string): status is (typeof KNOWN_STATUS)[number] {
  return (KNOWN_STATUS as readonly string[]).includes(status);
}

// What the Hermes runs of a workflow run read and wrote together; null where none of
// them reported counts.
export function agentTeamTokens(run: AgentTeamRun): { input: number; output: number } | null {
  const counted = run.stages.filter(
    (stage) => stage.inputTokens != null || stage.outputTokens != null,
  );
  if (counted.length === 0) return null;
  return {
    input: counted.reduce((sum, stage) => sum + (stage.inputTokens ?? 0), 0),
    output: counted.reduce((sum, stage) => sum + (stage.outputTokens ?? 0), 0),
  };
}
