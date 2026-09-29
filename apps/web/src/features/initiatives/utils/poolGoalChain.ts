import type { ProjectGoalContext } from '@/lib/api/endpoints/projectGoals';

// The Helena goal a project goal serves, as its ladder from the top: the goals above it
// (`path`) and the goal itself. Null while it serves none.
export function poolGoalChain(
  context: ProjectGoalContext | undefined,
  initiativeId: number,
): { goalId: number; steps: string[] } | null {
  const link = context?.links.find((item) => item.initiativeId === initiativeId);
  const goal = link ? context?.goals.find((item) => item.id === link.goalId) : undefined;
  return goal ? { goalId: goal.id, steps: [...goal.path, goal.title] } : null;
}
