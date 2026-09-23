import type { ProjectWorkflow } from '@/lib/api/endpoints/controlPlaneWorkflows';

type Configuration = ProjectWorkflow['assignment']['configuration'];

// The agent-team limits as the form edits them: the numbers as typed, the budget in
// minutes.
export interface AgentTeamPolicyDraft {
  autonomy: 'review' | 'done';
  reviewRequired: boolean;
  maxTurns: string;
  budgetMinutes: string;
}

export function agentTeamPolicyDraft(configuration: Configuration): AgentTeamPolicyDraft {
  return {
    autonomy: configuration.autonomy ?? 'review',
    reviewRequired: configuration.reviewRequired ?? true,
    maxTurns: configuration.maxTurns?.toString() ?? '',
    budgetMinutes: configuration.runBudgetSeconds
      ? Math.round(configuration.runBudgetSeconds / 60).toString()
      : '',
  };
}

function bounded(value: string, min: number, max: number): number | null {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : null;
}

// The draft in the shape the API accepts: an empty field is no limit, a number is kept
// within the API's bounds, and Done without a review becomes Review.
export function agentTeamPolicyConfiguration(draft: AgentTeamPolicyDraft): Configuration {
  const minutes = bounded(draft.budgetMinutes, 1, 120);
  return {
    autonomy: draft.reviewRequired ? draft.autonomy : 'review',
    reviewRequired: draft.reviewRequired,
    maxTurns: bounded(draft.maxTurns, 1, 200),
    runBudgetSeconds: minutes == null ? null : minutes * 60,
  };
}
