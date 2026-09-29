import { expect, test } from 'bun:test';
import { auditAgent, type AuditAgent, type PoolRole } from '../skills-audit';

const role: PoolRole = {
  name: 'coder',
  skills: ['test-driven-development', 'systematic-debugging', 'requesting-code-review'],
  instructions: 'Role instructions',
};
const template: AuditAgent = {
  id: 1,
  teamId: 1,
  name: 'Coder',
  username: 'coder',
  template: true,
  sourceTemplateId: null,
  templateOverrides: [],
  skills: [],
  tools: [4],
  instructions: role.instructions,
  runtimePolicy: {
    toolAllow: ['shell'],
    files: [{ kind: 'instructions', path: 'AGENTS.md', content: 'Template guidance' }],
  },
  projects: [],
};
const agent: AuditAgent = {
  ...template,
  id: 2,
  name: 'Coder VOL',
  username: 'coder-vol',
  template: false,
  sourceTemplateId: 1,
  skills: [{ id: 88, name: 'owner-skill' }],
  instructions: 'Owner instructions',
  tools: [],
  runtimePolicy: {
    toolDeny: ['shell'],
    files: [{ kind: 'instructions', path: 'SOUL.md', content: 'Owner soul' }],
  },
  projects: [{ key: 'VOL', instructions: 'Project guidance' }],
  context: { role: 'coder', goals: true, workdir: '/tmp/volition' },
};

test('audit proposes only missing assignments and retains owner instructions and extras', () => {
  const result = auditAgent(agent, [agent, template], [role]);
  expect(result.addSkills).toEqual(role.skills);
  expect(result.extra).toEqual(['owner-skill']);
  expect(result.instructions).toBeNull();
  expect(result.addGrants).toEqual([]);
  expect(result.addFiles.map((entry) => entry.path)).toEqual(['AGENTS.md']);
  expect(result.addTools).toEqual([4]);
  expect(result.origin).toBe('template:1; pool:coder');
});

test('explicit owner groups and disabled skills prevent repair', () => {
  const changed = { ...agent, templateOverrides: ['skills', 'tools', 'instructions', 'approvals'] };
  const result = auditAgent(changed, [changed, template], [role]);
  expect(result.missing).toEqual(role.skills);
  for (const field of ['addSkills', 'addTools', 'addFiles', 'addGrants'] as const)
    expect(result[field]).toEqual([]);
  expect(
    auditAgent(
      { ...agent, runtimePolicy: { skillsDisabled: ['systematic-debugging'] } },
      [agent, template],
      [role],
    ).addSkills,
  ).not.toContain('systematic-debugging');
});

test('audit reports missing context and never borrows another team template', () => {
  const result = auditAgent(
    { ...agent, teamId: 2, context: undefined, projects: [] },
    [template],
    [role],
  );
  expect(result.addSkills).toEqual([]);
  expect(result.addTools).toEqual([]);
  expect(result.findings).toContain('Project membership missing');
  expect(result.findings).toContain('Source template missing');
  expect(result.findings).toContain('Working folder missing or unverified');
});

test('an explicit coordinator role resolves the planner pool without guessing from its display name', () => {
  const coordinator = { ...agent, sourceTemplateId: null, context: { role: 'coordinator' } };
  const report = auditAgent(
    coordinator,
    [],
    [{ ...role, name: 'planner', skills: ['plan-goals'] }],
  );
  expect(report.missing).toEqual(['plan-goals']);
  expect(report.origin).toBe('pool:planner');
});
