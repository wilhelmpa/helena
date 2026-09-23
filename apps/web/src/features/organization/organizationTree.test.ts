import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Organization } from '@/lib/api/endpoints/organization';
import { buildOrganizationTree, organizationAgentRole } from './organizationTree';

const offline = {
  adapter: null,
  status: 'offline' as const,
  appliedRevision: null,
  capabilities: [],
  detail: null,
  conflicts: [],
  reportedAt: null,
};
const working = {
  pausedAt: null,
  pauseReason: null,
  dailyTokenCeiling: null,
  monthlyTokenCeiling: null,
  tokensToday: 0,
  tokensThisMonth: 0,
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
          role: 'coordinator',
          capabilities: [],
          kind: 'external',
          runtimeAgentId: 'lead',
          projects: [],
          runtimeState: { ...offline, adapter: 'agent_runtime', status: 'online' },
          ...working,
        },
        {
          id: 11,
          userId: 'researcher',
          name: 'Researcher',
          username: 'researcher',
          departmentId: 2,
          reportsToAgentId: 10,
          roleTitle: '',
          role: null,
          capabilities: [],
          kind: 'external',
          runtimeAgentId: 'researcher',
          projects: [],
          runtimeState: offline,
          ...working,
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
          role: null,
          capabilities: [],
          kind: 'external',
          runtimeAgentId: null,
          projects: [],
          runtimeState: offline,
          ...working,
        },
      ],
    } as Organization;
    assert.equal(buildOrganizationTree(organization)[0].department, null);
  });

  test('reads the agent team role from the organization assignment', () => {
    const agent = (role: Organization['agents'][number]['role']) =>
      ({ role }) as Organization['agents'][number];

    assert.equal(organizationAgentRole(agent('coordinator')), 'coordinator');
    assert.equal(organizationAgentRole(agent('specialist')), 'specialist');
    assert.equal(organizationAgentRole(agent('reviewer')), 'reviewer');
    assert.equal(organizationAgentRole(agent(null)), 'pool');
  });
});
