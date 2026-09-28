import { beforeEach, describe, expect, it } from 'bun:test';
import type { TemplateBundle } from '@helena/sdk';
import { api, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

const fixture: TemplateBundle = {
  format: 'helena.template-bundle',
  formatVersion: 1,
  name: 'research-department',
  displayName: 'Research',
  version: '1.0.0',
  description: 'Research department',
  license: 'MIT',
  author: { name: 'Test' },
  skills: [],
  mcpServers: {},
  agents: [
    {
      name: 'researcher',
      description: 'Researcher',
      instructions: 'Research assigned work.',
      model: null,
      effort: null,
      maxTurns: null,
      disallowedTools: [],
      skills: [],
      mcpServers: [],
      helena: {
        displayName: 'Researcher',
        roleTitle: 'Researcher',
        capabilities: ['research'],
        runBudgetSeconds: null,
        triggers: { mention: true, assign: true },
      },
    },
  ],
  department: {
    name: 'Research',
    description: 'Find facts',
    restrictedSkills: true,
    allowedSkills: [],
    budgets: [{ metric: 'tokens', period: 'month', limit: 10000 }],
    agents: [
      {
        name: 'researcher',
        role: 'specialist',
        reportsTo: null,
        projects: ['RSH'],
        heartbeat: {
          intervalMinutes: 60,
          timezone: 'UTC',
          days: [1, 2, 3, 4, 5],
          start: '09:00',
          end: '17:00',
          instructions: 'Review open research tasks.',
        },
        budgets: [{ metric: 'tokens', period: 'day', limit: 1000 }],
      },
    ],
    goals: [
      {
        title: 'Review findings',
        description: 'Check the evidence',
        status: 'active',
        targetDate: null,
        parent: null,
        project: null,
      },
    ],
    routines: [
      {
        key: 'daily-review',
        project: 'RSH',
        agent: 'researcher',
        title: 'Review queue',
        instructions: 'Review the queue.',
        cron: '0 9 * * 1-5',
        timezone: 'UTC',
        catchUp: 'skip',
      },
    ],
  },
};

beforeEach(resetDb);

describe('department template bundles', () => {
  it('previews, imports, exports and repeats without writes', async () => {
    const user = await signUpTestUser();
    const owner = authedApi(user.cookie, {
      origin: (process.env.APP_URL ?? '').split(',')[0]!,
      'sec-fetch-site': 'same-origin',
    });
    const project = (await owner.projects.post({ key: 'RSH', name: 'Research' })).data!;
    const routes = owner.teams({ teamId: project.teamId })['template-bundles'].departments;
    const preview = await routes.import.post({ bundle: fixture, dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.data?.written).toBe(0);
    expect(preview.data?.lines.join('\n')).toContain('create department Research');
    const imported = await routes.import.post({ bundle: fixture });
    expect(imported.status).toBe(200);
    expect(imported.data?.warnings).toBe(0);
    expect(imported.data?.written).toBeGreaterThan(0);
    const org = (await owner.teams({ teamId: project.teamId }).organization.get()).data!;
    const department = org.departments.find((entry) => entry.name === 'Research')!;
    expect(
      (
        await owner.teams({ teamId: project.teamId }).organization.goals.post({
          title: 'Project finding',
          departmentId: department.id,
          projectId: project.id,
        })
      ).status,
    ).toBe(201);
    expect(org.agents.find((entry) => entry.username === 'researcher')).toMatchObject({
      departmentId: department.id,
      heartbeatIntervalMinutes: 60,
    });
    const exported = await routes({ departmentId: department.id }).export.get();
    expect(exported.status).toBe(200);
    expect(exported.data).toMatchObject({
      department: {
        name: 'Research',
        restrictedSkills: true,
        budgets: [{ metric: 'tokens', period: 'month', limit: 10000 }],
        routines: [{ title: 'Review queue' }],
      },
      agents: [{ name: 'researcher' }],
    });
    expect(JSON.stringify(exported.data)).not.toContain('apiKey');
    expect(JSON.stringify(exported.data)).not.toContain('runtimeAgentId');
    expect(exported.data).toMatchObject({ mcpServers: {} });
    expect(JSON.stringify(exported.data)).toContain('"project":"RSH"');
    const again = await routes.import.post({ bundle: fixture });
    expect(again.data?.written).toBe(0);
    expect(again.data?.warnings).toBe(0);
    const fromExport = await routes.import.post({ bundle: exported.data });
    expect(fromExport.data?.written).toBe(0);
  });

  it('requires a session and a department bundle', async () => {
    const owner = authedApi((await signUpTestUser()).cookie);
    const project = (await owner.projects.post({ key: 'RSH', name: 'Research' })).data!;
    const path = api.teams({ teamId: project.teamId })['template-bundles'].departments;
    expect((await path.import.post({ bundle: fixture })).status).toBe(401);
    const withoutDepartment = { ...fixture, department: undefined };
    expect(
      (
        await owner
          .teams({ teamId: project.teamId })
          ['template-bundles'].departments.import.post({ bundle: withoutDepartment })
      ).status,
    ).toBe(400);
  });

  it('enforces a department skill allowlist when assigning skills', async () => {
    const owner = authedApi((await signUpTestUser()).cookie, {
      origin: (process.env.APP_URL ?? '').split(',')[0]!,
      'sec-fetch-site': 'same-origin',
    });
    const project = (await owner.projects.post({ key: 'RSH', name: 'Research' })).data!;
    const team = owner.teams({ teamId: project.teamId });
    expect(
      (await team['template-bundles'].departments.import.post({ bundle: fixture })).status,
    ).toBe(200);
    const org = (await team.organization.get()).data!;
    const departmentId = org.departments.find((entry) => entry.name === 'Research')!.id;
    const agentId = org.agents.find((entry) => entry.username === 'researcher')!.id;
    const skill = await team['agent-skills'].post({
      source: 'inline',
      markdown: '---\nname: triage\ndescription: Triage tasks\n---\nTriage tasks.',
    });
    expect(skill.status).toBe(201);
    const agentSkills = team['ai-agents']({ agentId }).skills;
    expect((await agentSkills.put({ skillIds: [skill.data!.id] })).status).toBe(403);
    expect(
      (
        await team.organization.departments({ departmentId }).skills.put({
          restricted: true,
          skillIds: [skill.data!.id],
        })
      ).status,
    ).toBe(200);
    expect((await agentSkills.put({ skillIds: [skill.data!.id] })).status).toBe(200);
  });

  it('restores reporting lines and nested department goals', async () => {
    const owner = authedApi((await signUpTestUser()).cookie, {
      origin: (process.env.APP_URL ?? '').split(',')[0]!,
      'sec-fetch-site': 'same-origin',
    });
    const project = (await owner.projects.post({ key: 'RSH', name: 'Research' })).data!;
    const bundle = structuredClone(fixture);
    bundle.agents.push({
      ...bundle.agents[0]!,
      name: 'research-lead',
      helena: {
        ...bundle.agents[0]!.helena,
        displayName: 'Research lead',
        roleTitle: 'Lead',
        capabilities: ['research-lead'],
      },
    });
    bundle.department!.agents[0]!.reportsTo = 'research-lead';
    bundle.department!.agents.push({
      ...bundle.department!.agents[0]!,
      name: 'research-lead',
      role: 'coordinator',
      reportsTo: null,
      budgets: [],
    });
    bundle.department!.goals.push({
      title: 'Write report',
      description: 'Publish findings',
      status: 'planned',
      targetDate: null,
      parent: 'Review findings',
      project: null,
    });
    const team = owner.teams({ teamId: project.teamId });
    const result = await team['template-bundles'].departments.import.post({ bundle });
    expect(result.status).toBe(200);
    expect(result.data?.warnings).toBe(0);
    const org = (await team.organization.get()).data!;
    const lead = org.agents.find((entry) => entry.username === 'research-lead')!;
    expect(org.agents.find((entry) => entry.username === 'researcher')?.reportsToAgentId).toBe(
      lead.id,
    );
    const parent = org.goals.find((entry) => entry.title === 'Review findings')!;
    expect(org.goals.find((entry) => entry.title === 'Write report')?.parentGoalId).toBe(parent.id);
    expect((await team['template-bundles'].departments.import.post({ bundle })).data?.written).toBe(
      0,
    );
  });
});
