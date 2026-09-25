import { describe, expect, it } from 'bun:test';
import {
  MAX_SOUL_GOALS,
  departmentsWithAncestors,
  goalPath,
  goalsSection,
  visibleGoalIds,
  type ScopedGoal,
} from '../../scope';

function goal(id: number, fields: Partial<ScopedGoal> = {}): ScopedGoal {
  return {
    id,
    title: `Goal ${id}`,
    description: '',
    status: 'active',
    departmentId: null,
    projectId: null,
    parentGoalId: null,
    targetDate: null,
    ...fields,
  };
}

describe('departmentsWithAncestors', () => {
  it('adds every department above and stops on a cycle', () => {
    const departments = [
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
      { id: 3, parentId: 2 },
      { id: 4, parentId: 5 },
      { id: 5, parentId: 4 },
    ];
    expect([...departmentsWithAncestors([3], departments)].sort()).toEqual([1, 2, 3]);
    expect([...departmentsWithAncestors([4], departments)].sort()).toEqual([4, 5]);
  });
});

describe('visibleGoalIds', () => {
  const goals = [
    goal(1),
    goal(2, { departmentId: 10, parentGoalId: 1 }),
    goal(3, { projectId: 100, departmentId: 10, parentGoalId: 2 }),
    goal(4, { projectId: 200 }),
    goal(5, { departmentId: 20 }),
    goal(6, { projectId: 200, parentGoalId: 3 }),
  ];

  it("shows the agent's project and department goals, the team's, and the chain above", () => {
    const visible = visibleGoalIds(goals, {
      all: false,
      projectIds: new Set([100]),
      departmentIds: new Set([10]),
    });
    expect([...visible].sort()).toEqual([1, 2, 3]);
  });

  it("does not show another project's goal below one of its own", () => {
    const visible = visibleGoalIds(goals, {
      all: false,
      projectIds: new Set([100]),
      departmentIds: new Set(),
    });
    expect(visible.has(6)).toBe(false);
    // A department goal of a department the agent is not in stays hidden, even above.
    expect(visible.has(2)).toBe(true);
    expect(visible.has(5)).toBe(false);
  });

  it('shows everything to the Home agent', () => {
    const visible = visibleGoalIds(goals, {
      all: true,
      projectIds: new Set(),
      departmentIds: new Set(),
    });
    expect(visible.size).toBe(goals.length);
  });
});

describe('goalPath', () => {
  it('names the goals above, outermost first, and survives a cycle', () => {
    const goals = [goal(1), goal(2, { parentGoalId: 1 }), goal(3, { parentGoalId: 2 })];
    const byId = new Map(goals.map((entry) => [entry.id, entry]));
    expect(goalPath(goals[2]!, byId)).toEqual(['Goal 1', 'Goal 2']);
    const loop = [goal(7, { parentGoalId: 8 }), goal(8, { parentGoalId: 7 })];
    expect(goalPath(loop[0]!, new Map(loop.map((entry) => [entry.id, entry])))).toEqual(['Goal 8']);
  });
});

describe('goalsSection', () => {
  const soul = (id: number, extra: Partial<Parameters<typeof goalsSection>[0][number]> = {}) => ({
    id,
    title: `Relaunch ${id}`,
    description: '',
    path: [],
    project: null,
    department: null,
    targetDate: null,
    ...extra,
  });

  it('is empty without goals', () => {
    expect(goalsSection([])).toBe('');
  });

  it('names each goal with its place, target and description, and the tools', () => {
    const text = goalsSection([
      soul(3, {
        project: 'VOL',
        targetDate: '2026-11-30',
        path: ['Volition wächst', 'Website'],
        description: 'Neue Seite\nmit Blog',
      }),
    ]);
    expect(text).toStartWith('## Goals');
    expect(text).toContain(
      '- #3 "Relaunch 3" — VOL; target 2026-11-30; part of: Volition wächst › Website',
    );
    expect(text).toContain('  Neue Seite mit Blog');
    expect(text).toContain('link_issue_to_goal');
    expect(text).toContain('add_goal_note');
  });

  it('stays within its bounds and says how many were left out', () => {
    const many = Array.from({ length: MAX_SOUL_GOALS + 5 }, (_, index) =>
      soul(index + 1, { description: 'x'.repeat(500) }),
    );
    const text = goalsSection(many);
    expect(text.length).toBeLessThan(4200);
    expect(text).toMatch(/… and \d+ more \(list_goals\)\./);
  });
});
