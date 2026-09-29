import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProjectPoolGoal } from '@/lib/api/endpoints/projectGoals';
import { compareGoals, goalsOfScope } from './goalMeta';

const goal = (
  id: number,
  title: string,
  status: ProjectPoolGoal['status'],
  scope: ProjectPoolGoal['scope'],
) => ({ id, title, status, scope, path: [], progress: null }) as unknown as ProjectPoolGoal;

describe('goal order', () => {
  it('leads with what is being worked on, then what is planned, paused and done, by title within one', () => {
    const goals = [
      goal(1, 'Zeta', 'achieved', 'project'),
      goal(2, 'Beta', 'active', 'project'),
      goal(3, 'Alpha', 'active', 'project'),
      goal(4, 'Gamma', 'paused', 'project'),
      goal(5, 'Delta', 'planned', 'project'),
    ];
    assert.deepEqual(
      goals.sort(compareGoals).map((g) => g.title),
      ['Alpha', 'Beta', 'Delta', 'Gamma', 'Zeta'],
    );
  });

  it('keeps the goals of a scope apart', () => {
    const goals = [
      goal(1, 'A', 'active', 'team'),
      goal(2, 'B', 'active', 'project'),
      goal(3, 'C', 'active', 'department'),
    ];
    assert.deepEqual(
      goalsOfScope(goals, 'project').map((g) => g.id),
      [2],
    );
    assert.deepEqual(
      goalsOfScope(goals, 'team').map((g) => g.id),
      [1],
    );
  });
});
