import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Organization } from '@/lib/api/endpoints/organization';
import {
  buildOrganizationTree,
  countAgents,
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
          ...agentBase,
          id: 10,
          userId: 'lead',
          name: 'Lead',
          username: 'lead',
          departmentId: 2,
          roleTitle: 'Lead',
          role: 'coordinator',
          runtimeAgentId: 'lead',
          runtimeState: { ...offline, adapter: 'agent_runtime', status: 'online' },
        },
        {
          ...agentBase,
          id: 11,
          userId: 'researcher',
          name: 'Researcher',
          username: 'researcher',
          departmentId: 2,
          reportsToAgentId: 10,
          runtimeAgentId: 'researcher',
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
      agents: [{ ...agentBase, id: 10, userId: 'free', name: 'Unassigned', username: 'free' }],
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
        username: 'vol-koordinator',
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
          username: 'vol-koordinator',
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

    test('Home is the root of the chart, with coordinator and specialist nested under it', () => {
      const tree = buildOrganizationTree(organization);
      // Home is not "without a department": it is the first root, and there is no
      // "no department" bucket when everyone else hangs under it.
      assert.equal(tree[0].kind, 'home');
      assert.equal(
        tree.find((node) => node.kind === 'none'),
        undefined,
      );
      assert.equal(tree[0].agents.length, 1);
      const homeNode = tree[0].agents[0];
      assert.equal(homeNode?.agent.username, 'master');
      const coordinatorNode = homeNode?.reports[0];
      assert.equal(coordinatorNode?.agent.username, 'vol-koordinator');
      assert.equal(coordinatorNode?.reports[0]?.agent.username, 'coder-vol');
    });

    test('a coordinator of a project in a department hangs under Home inside that department', () => {
      const withDepartment = {
        ...organization,
        departments: [
          {
            id: 1,
            name: 'Volition',
            description: '',
            parentId: null,
            position: 0,
            createdAt: '',
            updatedAt: '',
          },
        ],
        projects: [
          { id: 5, key: 'VOL', name: 'volition.one', departmentId: 1 },
          { id: 3, key: 'PRIV', name: 'Privat', departmentId: null },
        ],
        agents: organization.agents
          .map((agent) =>
            agent.id === 4 || agent.id === 10
              ? {
                  ...agent,
                  projects: [{ id: 5, key: 'VOL', name: 'volition.one', instructions: '' }],
                }
              : agent.id === 1
                ? {
                    ...agent,
                    projects: [
                      { id: 5, key: 'VOL', name: 'volition.one', instructions: '' },
                      { id: 3, key: 'PRIV', name: 'Privat', instructions: '' },
                    ],
                  }
                : agent,
          )
          .concat({
            ...agentBase,
            id: 3,
            username: 'priv-koordinator',
            name: 'PRIV Coordinator',
            role: 'coordinator',
            reportsToAgentId: 1,
            projects: [{ id: 3, key: 'PRIV', name: 'Privat', instructions: '' }],
          }),
      } as Organization;
      const tree = buildOrganizationTree(withDepartment);
      const home = tree[0].agents[0];
      assert.equal(tree[0].kind, 'home');
      assert.equal(home.agent.username, 'master');
      // The VOL coordinator (its project is in "Volition") and its specialist sit in the
      // department under Home; the PRIV coordinator (no department) reports directly.
      assert.equal(home.departments?.[0].department?.name, 'Volition');
      assert.equal(home.departments?.[0].agents[0].agent.username, 'vol-koordinator');
      assert.equal(home.departments?.[0].agents[0].reports[0].agent.username, 'coder-vol');
      assert.equal(countAgents(home.departments![0]), 2);
      assert.deepEqual(
        home.reports.map((report) => report.agent.username),
        ['priv-koordinator'],
      );
      assert.equal(
        tree.find((node) => node.kind === 'department'),
        undefined,
      );
    });

    test('an agent pointing at an unknown department stays visible', () => {
      const tree = buildOrganizationTree({
        ...organization,
        agents: organization.agents.map((agent) =>
          agent.id === 4 ? { ...agent, departmentId: 99 } : agent,
        ),
      } as Organization);
      assert.equal(tree[0].agents[0].reports[0]?.agent.username, 'vol-koordinator');
    });

    test('the pool template lands in its own bucket, not in "no department" or "unassigned"', () => {
      const tree = buildOrganizationTree(organization);
      const templatesNode = tree.find((node) => node.kind === 'templates');
      assert.equal(templatesNode?.agents.length, 1);
      assert.equal(templatesNode?.agents[0].agent.username, 'coder');
    });
  });
});
