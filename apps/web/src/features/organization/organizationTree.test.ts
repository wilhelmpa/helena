import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Organization } from '@/lib/api/endpoints/organization';
import {
  buildOrganizationTree,
  organizationAgentRole,
  organizationAgentStatus,
} from './organizationTree';

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

// Common fields every fixture below needs, so each test only spells out what it is
// actually about (isHome / template / reportsToAgentId).
const agentBase = {
  userId: 'u',
  name: 'Agent',
  kind: 'external' as const,
  isHome: false,
  template: false,
  departmentId: null,
  reportsToAgentId: null,
  roleTitle: '',
  role: null,
  capabilities: [],
  runtimeAgentId: null,
  projects: [],
  runtimeState: offline,
  ...working,
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

  describe('organizationAgentStatus', () => {
    test('the Home master is always assigned, even without an assignment row', () => {
      const master = { ...agentBase, id: 1, username: 'master', isHome: true } as const;
      assert.equal(organizationAgentStatus(master), 'home');
    });

    test('a coordinator reporting to Home is assigned', () => {
      const coordinator = {
        ...agentBase,
        id: 4,
        username: 'hermes-vol-coordinator',
        role: 'coordinator',
        reportsToAgentId: 1,
      } as const;
      assert.equal(organizationAgentStatus(coordinator), 'assigned');
    });

    test('a specialist reporting to a coordinator is assigned', () => {
      const specialist = {
        ...agentBase,
        id: 10,
        username: 'coder-vol',
        role: 'specialist',
        reportsToAgentId: 6,
      } as const;
      assert.equal(organizationAgentStatus(specialist), 'assigned');
    });

    test('a pool template is a template, not unassigned, even without a manager', () => {
      const template = {
        ...agentBase,
        id: 8,
        username: 'coder',
        role: 'specialist',
        template: true,
      } as const;
      assert.equal(organizationAgentStatus(template), 'template');
    });

    test('an agent with no manager, no template flag and no Home flag is a real orphan', () => {
      const orphan = { ...agentBase, id: 20, username: 'stray' } as const;
      assert.equal(organizationAgentStatus(orphan), 'unassigned');
    });
  });

  describe('buildOrganizationTree agent buckets', () => {
    const organization = {
      teamId: 1,
      departments: [],
      goals: [],
      projects: [],
      agents: [
        { ...agentBase, id: 1, username: 'master', name: 'Master', isHome: true },
        {
          ...agentBase,
          id: 4,
          username: 'hermes-vol-coordinator',
          name: 'VOL Coordinator',
          role: 'coordinator',
          reportsToAgentId: 1,
        },
        {
          ...agentBase,
          id: 10,
          username: 'coder-vol',
          name: 'Coder VOL',
          role: 'specialist',
          reportsToAgentId: 4,
        },
        {
          ...agentBase,
          id: 8,
          username: 'coder',
          name: 'Coder (template)',
          role: 'specialist',
          template: true,
        },
        { ...agentBase, id: 20, username: 'stray', name: 'Stray' },
      ],
    } as Organization;

    test('a complete structure produces zero real orphans', () => {
      const tree = buildOrganizationTree(organization);
      const unassignedNode = tree.find((node) => node.kind === 'unassigned');
      // Only "stray" is a real orphan; master/coordinator/specialist/template must not
      // appear here.
      assert.equal(unassignedNode?.agents.length, 1);
      assert.equal(unassignedNode?.agents[0].agent.username, 'stray');
    });

    test('Home, coordinator and specialist land in the "no department" bucket together', () => {
      const tree = buildOrganizationTree(organization);
      const noneNode = tree.find((node) => node.kind === 'none');
      const usernames = noneNode?.agents.map((node) => node.agent.username).sort();
      assert.deepEqual(usernames, ['hermes-vol-coordinator', 'master']);
      // The specialist nests under its coordinator's `reports`, not as its own root.
      const coordinatorNode = noneNode?.agents.find(
        (node) => node.agent.username === 'hermes-vol-coordinator',
      );
      assert.equal(coordinatorNode?.reports[0]?.agent.username, 'coder-vol');
    });

    test('the pool template lands in its own bucket, not in "no department" or "unassigned"', () => {
      const tree = buildOrganizationTree(organization);
      const templatesNode = tree.find((node) => node.kind === 'templates');
      assert.equal(templatesNode?.agents.length, 1);
      assert.equal(templatesNode?.agents[0].agent.username, 'coder');
    });
  });
});
