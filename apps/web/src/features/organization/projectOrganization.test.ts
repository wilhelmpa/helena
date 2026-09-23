import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Organization } from '@/lib/api/endpoints/organization';
import { organizationForProject } from './projectOrganization';

const timestamp = '2026-09-22T00:00:00.000Z';
const offlineRuntime = {
  adapter: null,
  status: 'offline' as const,
  appliedRevision: null,
  capabilities: [],
  detail: null,
  conflicts: [],
  reportedAt: null,
};
const organization: Organization = {
  teamId: 1,
  departments: [
    {
      id: 1,
      name: 'Parent',
      description: '',
      parentId: null,
      position: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 2,
      name: 'Selected',
      description: '',
      parentId: 1,
      position: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 3,
      name: 'Other',
      description: '',
      parentId: null,
      position: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  projects: [
    { id: 10, key: 'SEL', name: 'Selected', description: '', departmentId: 2, instructions: '' },
    { id: 20, key: 'OTH', name: 'Other', description: '', departmentId: 3, instructions: '' },
  ],
  goals: [
    {
      id: 100,
      title: 'Selected goal',
      description: '',
      departmentId: 2,
      projectId: 10,
      parentGoalId: null,
      status: 'active',
      targetDate: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 200,
      title: 'Other goal',
      description: '',
      departmentId: 3,
      projectId: 20,
      parentGoalId: null,
      status: 'active',
      targetDate: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 300,
      title: 'Team goal',
      description: '',
      departmentId: 1,
      projectId: null,
      parentGoalId: null,
      status: 'active',
      targetDate: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  agents: [
    {
      id: 1000,
      userId: 'selected',
      name: 'Selected agent',
      username: 'selected',
      kind: 'internal',
      departmentId: 2,
      reportsToAgentId: null,
      roleTitle: '',
      runtimeAgentId: null,
      runtimeState: offlineRuntime,
      projects: [
        { id: 10, key: 'SEL', name: 'Selected', instructions: '' },
        { id: 20, key: 'OTH', name: 'Other', instructions: '' },
      ],
    },
    {
      id: 2000,
      userId: 'other',
      name: 'Other agent',
      username: 'other',
      kind: 'internal',
      departmentId: 3,
      reportsToAgentId: null,
      roleTitle: '',
      runtimeAgentId: null,
      runtimeState: offlineRuntime,
      projects: [{ id: 20, key: 'OTH', name: 'Other', instructions: '' }],
    },
  ],
};

describe('organizationForProject', () => {
  test('keeps only the selected project and its goals and agents', () => {
    const result = organizationForProject(organization, 'SEL');

    assert.deepEqual(
      result.projects.map((project) => project.key),
      ['SEL'],
    );
    assert.deepEqual(
      result.goals.map((goal) => goal.id),
      [100],
    );
    assert.deepEqual(
      result.agents.map((agent) => agent.id),
      [1000],
    );
    assert.deepEqual(
      result.agents[0]?.projects.map((project) => project.key),
      ['SEL'],
    );
  });

  test('keeps referenced departments and their ancestors without cross-project departments', () => {
    assert.deepEqual(
      organizationForProject(organization, 'SEL').departments.map(({ id }) => id),
      [1, 2],
    );
  });

  test('returns an empty project scope for an unknown key', () => {
    const result = organizationForProject(organization, 'MISSING');
    assert.deepEqual(result.projects, []);
    assert.deepEqual(result.goals, []);
    assert.deepEqual(result.agents, []);
    assert.deepEqual(result.departments, []);
  });
});
