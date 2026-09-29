import type { GoalStatus } from '@/lib/api/endpoints/issues';
import type { ProjectPoolGoal } from '@/lib/api/endpoints/projectGoals';

// Display metadata for the status of a goal (an organization goal). Colors are raw hex so they
// can drive a dot; the label of a status is a message under `organization.statuses`.
export const GOAL_STATUS_META: Record<GoalStatus, { color: string }> = {
  planned: { color: '#6366f1' },
  active: { color: '#eab308' },
  achieved: { color: '#22c55e' },
  paused: { color: '#a1a1aa' },
};

// The lane and list order of goals: the ones being worked on lead, then what is planned, then
// what waits, then what is done.
export const GOAL_STATUS_ORDER: GoalStatus[] = ['active', 'planned', 'paused', 'achieved'];

export function compareGoals(
  a: { status: GoalStatus; title: string },
  b: { status: GoalStatus; title: string },
): number {
  return (
    GOAL_STATUS_ORDER.indexOf(a.status) - GOAL_STATUS_ORDER.indexOf(b.status) ||
    a.title.localeCompare(b.title)
  );
}

// The goals of one scope in list order.
export function goalsOfScope(goals: ProjectPoolGoal[], scope: ProjectPoolGoal['scope']) {
  return goals.filter((goal) => goal.scope === scope).sort(compareGoals);
}
