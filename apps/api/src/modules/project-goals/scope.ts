import {
  concernsAgent,
  departmentsWithAncestors,
  goalPath,
  type ScopedGoal,
} from '#modules/goals/scope';

// Read-through defaults: never manufacture a goal or merge two goals by their title.
// A foreign-project ancestor is not made visible by a child's parent pointer.
export function projectPoolGoals(
  goals: ScopedGoal[],
  projectId: number,
  departmentId: number | null,
  departments: { id: number; parentId: number | null }[],
) {
  const scope = {
    projectIds: new Set([projectId]),
    departmentIds: departmentsWithAncestors(
      departmentId === null ? [] : [departmentId],
      departments,
    ),
  };
  const visible = goals.filter((goal) => concernsAgent(goal, scope));
  const byId = new Map(visible.map((goal) => [goal.id, goal]));
  return visible.map((goal) => ({
    ...goal,
    parentGoalId:
      goal.parentGoalId !== null && byId.has(goal.parentGoalId) ? goal.parentGoalId : null,
    path: goalPath(goal, byId),
  }));
}

export function defaultProjectGoal<T extends ScopedGoal>(
  goals: T[],
  projectId: number,
  departmentId: number | null,
  departments: { id: number; parentId: number | null }[],
): T | null {
  const available = goals.filter((goal) => goal.status === 'active' || goal.status === 'planned');
  const pick = (rows: T[]) =>
    rows.sort(
      (a, b) => Number(b.status === 'active') - Number(a.status === 'active') || a.id - b.id,
    )[0];
  const direct = pick(available.filter((goal) => goal.projectId === projectId));
  if (direct) return direct;
  const parents = new Map(departments.map((row) => [row.id, row.parentId]));
  const seen = new Set<number>();
  let current = departmentId;
  while (current != null && !seen.has(current)) {
    seen.add(current);
    const departmentGoal = pick(
      available.filter((goal) => goal.projectId == null && goal.departmentId === current),
    );
    if (departmentGoal) return departmentGoal;
    current = parents.get(current) ?? null;
  }
  return (
    pick(available.filter((goal) => goal.projectId == null && goal.departmentId == null)) ?? null
  );
}

// Explicit task choices take precedence over an inherited contribution. Count each
// non-archived task once, even when both paths point at the same goal.
export function contributions(
  tasks: {
    id: number;
    state: string;
    explicitGoalId: number | null;
    inheritedGoalId: number | null;
    parentId?: number | null;
  }[],
  goalIds: Set<number>,
  defaultGoalId: number | null = null,
) {
  const result = new Map<number, { total: number; done: number }>();
  const seen = new Set<number>();
  const byTask = new Map(tasks.map((task) => [task.id, task]));
  const resolve = (task: (typeof tasks)[number]): number | null => {
    const lineage = [task];
    const lineageIds = new Set([task.id]);
    let parentId = task.parentId;
    while (parentId != null && !lineageIds.has(parentId)) {
      const parent = byTask.get(parentId);
      if (!parent) break;
      lineage.push(parent);
      lineageIds.add(parentId);
      parentId = parent.parentId;
    }
    for (const row of lineage) {
      if (row.explicitGoalId != null) return row.explicitGoalId;
    }
    for (const row of lineage) {
      if (row.inheritedGoalId != null && goalIds.has(row.inheritedGoalId))
        return row.inheritedGoalId;
    }
    return defaultGoalId;
  };
  for (const task of tasks) {
    if (seen.has(task.id) || task.state === 'canceled') continue;
    seen.add(task.id);
    const goalId = resolve(task);
    if (goalId === null || !goalIds.has(goalId)) continue;
    const count = result.get(goalId) ?? { total: 0, done: 0 };
    count.total++;
    if (task.state === 'completed') count.done++;
    result.set(goalId, count);
  }
  return result;
}
