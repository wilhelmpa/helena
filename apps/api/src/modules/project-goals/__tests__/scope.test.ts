import { describe, expect, it } from 'bun:test';
import type { ScopedGoal } from '#modules/goals/scope';
import { contributions, defaultProjectGoal, projectPoolGoals } from '../scope';

const goal = (id: number, extra: Partial<ScopedGoal> = {}): ScopedGoal => ({
  id,
  title: `Goal ${id}`,
  description: '',
  status: 'active',
  projectId: null,
  departmentId: null,
  parentGoalId: null,
  targetDate: null,
  ...extra,
});

describe('project goals read-through', () => {
  it('chooses the nearest available goal and prefers active goals at that scope', () => {
    const departments = [
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
    ];
    const goals = [
      goal(1),
      goal(2, { departmentId: 1 }),
      goal(3, { departmentId: 2, status: 'planned' }),
      goal(4, { departmentId: 2, status: 'active' }),
      goal(5, { projectId: 10, status: 'planned' }),
    ];
    expect(defaultProjectGoal(goals, 10, 2, departments)?.id).toBe(5);
    expect(defaultProjectGoal(goals, 11, 2, departments)?.id).toBe(4);
    expect(defaultProjectGoal(goals, 11, null, departments)?.id).toBe(1);
  });
  it('keeps stable IDs, duplicate titles and all owner statuses without copying', () => {
    const goals = [
      goal(1, { title: 'Same', status: 'paused' }),
      goal(2, { title: 'Same', projectId: 10, status: 'achieved', parentGoalId: 1 }),
    ];
    const snapshot = structuredClone(goals);
    expect(projectPoolGoals(goals, 10, null, []).map((g) => [g.id, g.status, g.path])).toEqual([
      [1, 'paused', []],
      [2, 'achieved', ['Same']],
    ]);
    expect(goals).toEqual(snapshot);
  });

  it('includes team, own project and department ancestors, never sibling scope or foreign parent names', () => {
    const goals = [
      goal(1),
      goal(2, { departmentId: 1 }),
      goal(3, { departmentId: 2 }),
      goal(4, { departmentId: 3 }),
      goal(5, { projectId: 11, departmentId: 2, title: 'Private other project' }),
      goal(6, { projectId: 10, parentGoalId: 5 }),
      goal(7, { projectId: 10, parentGoalId: 2 }),
    ];
    const visible = projectPoolGoals(goals, 10, 2, [
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
      { id: 3, parentId: 1 },
    ]);
    expect(visible.map((g) => g.id)).toEqual([1, 2, 3, 6, 7]);
    expect(visible.find((g) => g.id === 6)).toMatchObject({ parentGoalId: null, path: [] });
    expect(visible.find((g) => g.id === 7)?.path).toEqual(['Goal 2']);
    expect(JSON.stringify(visible)).not.toContain('Private other project');
  });

  it('handles missing parents and corrupted cycles without adding visibility', () => {
    const rows = projectPoolGoals(
      [goal(1, { parentGoalId: 2 }), goal(2, { parentGoalId: 1 }), goal(3, { parentGoalId: 99 })],
      10,
      null,
      [],
    );
    expect(rows.map((g) => g.path)).toEqual([['Goal 2'], ['Goal 1'], []]);
    expect(rows[2]!.parentGoalId).toBeNull();
  });

  it('counts a task only once, gives explicit choices priority, excludes canceled and invisible goals', () => {
    const tasks = [
      { id: 1, state: 'completed', explicitGoalId: 1, inheritedGoalId: 1 },
      { id: 1, state: 'completed', explicitGoalId: 1, inheritedGoalId: 1 },
      { id: 2, state: 'started', explicitGoalId: null, inheritedGoalId: 1 },
      { id: 3, state: 'completed', explicitGoalId: 2, inheritedGoalId: 1 },
      { id: 4, state: 'completed', explicitGoalId: 99, inheritedGoalId: 1 },
      { id: 5, state: 'canceled', explicitGoalId: null, inheritedGoalId: 1 },
      { id: 6, state: 'completed', explicitGoalId: null, inheritedGoalId: null },
    ];
    const snapshot = structuredClone(tasks);
    expect([...contributions(tasks, new Set([1, 2]))]).toEqual([
      [1, { total: 2, done: 1 }],
      [2, { total: 1, done: 1 }],
    ]);
    expect(tasks).toEqual(snapshot);
  });
});
