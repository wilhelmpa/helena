import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Organization } from '@/lib/api/endpoints/organization';
import { buildOrganizationTree } from './organizationTree';

const offline = {
  adapter: null,
  status: 'offline' as const,
  appliedRevision: null,
  capabilities: [],
  detail: null,
  reportedAt: null,
};

describe('buildOrganizationTree', () => {
  test('nests departments and reporting lines without duplicating agents', () => {
    const organization = {
      teamId: 1,
      departments: [
        {
          id: 1,
          name: 'Company',
          description: '',
          parentId: null,
          position: 0,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 2,
          name: 'Research',
          description: '',
          parentId: 1,
          position: 0,
          createdAt: '',
          updatedAt: '',
        },
      ],
      goals: [],
      projects: [],
      agents: [
        {
          id: 10,
          userId: 'lead',
          name: 'Lead',
          username: 'lead',
          departmentId: 2,
          reportsToAgentId: null,
          roleTitle: 'Lead',
          kind: 'external',
          runtimeAgentId: 'lead',
          projects: [],
          runtimeState: { ...offline, adapter: 'openclaw', status: 'online' },
        },
        {
          id: 11,
          userId: 'researcher',
          name: 'Researcher',
          username: 'researcher',
          departmentId: 2,
          reportsToAgentId: 10,
          roleTitle: '',
          kind: 'external',
          runtimeAgentId: 'researcher',
          projects: [],
          runtimeState: offline,
        },
      ],
    } as Organization;

    const tree = buildOrganizationTree(organization);
    assert.equal(tree[0].department?.name, 'Company');
    assert.equal(tree[0].children[0].department?.name, 'Research');
    assert.equal(tree[0].children[0].agents[0].agent.name, 'Lead');
    assert.equal(tree[0].children[0].agents[0].reports[0].agent.name, 'Researcher');
  });

  test('keeps agents without a department in a separate root', () => {
    const organization = {
      teamId: 1,
      departments: [],
      goals: [],
      projects: [],
      agents: [
        {
          id: 10,
          userId: 'free',
          name: 'Unassigned',
          username: 'free',
          departmentId: null,
          reportsToAgentId: null,
          roleTitle: '',
          kind: 'external',
          runtimeAgentId: null,
          projects: [],
          runtimeState: offline,
        },
      ],
    } as Organization;
    assert.equal(buildOrganizationTree(organization)[0].department, null);
  });
});
