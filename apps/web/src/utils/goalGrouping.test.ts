import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Issue } from '@/lib/api/endpoints/issues';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { applyFilters } from './filters';
import {
  buildGroups,
  defaultsFromFilters,
  groupIssues,
  groupKeyOf,
  type GroupLabels,
} from './project';

const labels = { noGoal: 'Kein Ziel' } as unknown as GroupLabels;
const goalA = { id: 1, title: 'Website relaunchen', status: 'active' as const };
const goalB = { id: 2, title: 'Blog aufbauen', status: 'planned' as const };
const issue = (id: number, goal: Issue['goal']) =>
  ({ id, goal, columnId: 1, labelIds: [], fieldValues: [] }) as unknown as Issue;
const project = {
  columns: [{ id: 1, stateType: 'unstarted' }],
  issues: [issue(1, goalA), issue(2, goalB), issue(3, null), issue(4, goalA)],
} as unknown as ProjectDetail;

describe('grouping the tasks by goal', () => {
  it('makes "no goal" lead, then a lane per goal the tasks serve, active ones first', () => {
    const groups = buildGroups(project, 'goal', labels, { conditions: [] });
    assert.deepEqual(
      groups.map((g) => g.name),
      ['Kein Ziel', 'Website relaunchen', 'Blog aufbauen'],
    );
    const byGroup = groupIssues(groups, project.issues, 'goal');
    assert.deepEqual(
      byGroup.get('g1')!.map((i) => i.id),
      [1, 4],
    );
    assert.deepEqual(
      byGroup.get('g-none')!.map((i) => i.id),
      [3],
    );
    assert.equal(groupKeyOf(project.issues[1]!, 'goal'), 'g2');
  });

  it('lets a drop into a lane set the goal, and into "no goal" clear it', () => {
    const groups = buildGroups(project, 'goal', labels, { conditions: [] });
    assert.deepEqual(groups.find((g) => g.key === 'g2')!.assign!.patch, { goalId: 2 });
    assert.deepEqual(groups.find((g) => g.key === 'g-none')!.assign!.patch, { goalId: null });
  });
});

describe('filtering the tasks by goal', () => {
  const where = (values: (number | string | null)[]) => ({
    conditions: [{ id: 'c', field: 'goal', op: 'is' as const, values }],
  });

  it('matches a goal by id, by its status and by none', () => {
    assert.deepEqual(
      applyFilters(project.issues, where([1]), project).map((i) => i.id),
      [1, 4],
    );
    assert.deepEqual(
      applyFilters(project.issues, where(['status:planned']), project).map((i) => i.id),
      [2],
    );
    assert.deepEqual(
      applyFilters(project.issues, where([null]), project).map((i) => i.id),
      [3],
    );
  });

  it('pins the goal of a task created on a filtered board', () => {
    assert.deepEqual(
      defaultsFromFilters(where([2]), { cycles: [], initiatives: [], goals: [goalA, goalB] }),
      {
        goalId: 2,
      },
    );
    assert.deepEqual(
      defaultsFromFilters(where(['status:active']), {
        cycles: [],
        initiatives: [],
        goals: [goalA, goalB],
      }),
      { goalId: 1 },
    );
  });
});
