import type { AgentTeamRun } from '@/lib/api/endpoints/issues';

// The Mastra steps a person follows, in order; 'prepare-team' only checks the input.
export const AGENT_TEAM_STEPS = ['coordinate', 'specialize', 'review', 'synchronize-plan'] as const;

export type AgentTeamStep = (typeof AGENT_TEAM_STEPS)[number];

const ACTIVE = new Set(['pending', 'running', 'waiting', 'suspended']);

export function isAgentTeamRunActive(run: AgentTeamRun) {
  return ACTIVE.has(run.status);
}

export function agentTeamStepStatus(run: AgentTeamRun, step: AgentTeamStep) {
  return run.steps.find((item) => item.id === step)?.status ?? 'pending';
}
