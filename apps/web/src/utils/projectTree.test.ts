import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Project } from '@/lib/api/endpoints/projects';
import { projectTree } from './projectTree';

const project = (key: string, departmentId: number | null, departmentName: string | null) =>
  ({ key, teamId: 1, departmentId, departmentName }) as Project;

describe('projectTree', () => {
  test('groups projects by department, groups by name, ungrouped last in list order', () => {
    const tree = projectTree([
      project('FAM', null, null),
      project('VOL', 2, 'Volition'),
      project('ACME', 3, 'Kunden'),
      project('VERVE', 2, 'Volition'),
    ]);
    assert.deepEqual(
      tree.groups.map((group) => [group.name, group.projects.map((entry) => entry.key)]),
      [
        ['Kunden', ['ACME']],
        ['Volition', ['VOL', 'VERVE']],
      ],
    );
    assert.deepEqual(
      tree.ungrouped.map((entry) => entry.key),
      ['FAM'],
    );
  });
});
