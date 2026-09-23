import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  const project = await api.projects.post({ key: 'MKT', name: 'Marketing' });
  const teamId = project.data!.teamId;
  const agent = await createAgent(api, 'MKT', {
    name: 'Researcher',
    username: 'researcher',
    kind: 'external',
  });
  return { api, owner, teamId, project: project.data!, agent: agent.data!.agent };
}

describe('organization', () => {
  beforeEach(resetDb);

  it('edits departments, goals, agent roles, projects and project instructions', async () => {
    const { api, teamId, project, agent } = await setup();
    const organization = api.teams({ teamId }).organization;

    const department = await organization.departments.post({
      name: 'Delivery',
      description: 'Build and operate products.',
    });
    expect(department.status).toBe(201);

    const goal = await organization.goals.post({
      title: 'Ship the customer portal',
      departmentId: department.data!.id,
      projectId: project.id,
      status: 'active',
    });
    expect(goal.status).toBe(201);

    expect(
      (
        await organization.agents({ agentId: agent.id }).put({
          departmentId: department.data!.id,
          reportsToAgentId: null,
          roleTitle: 'Lead researcher',
          runtimeAgentId: 'marketing-researcher',
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await organization.projects({ projectId: project.id }).put({
          departmentId: department.data!.id,
          instructions: 'Use the approved release checklist.',
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await organization
          .agents({ agentId: agent.id })
          .projects({ projectId: project.id })
          .patch({ instructions: 'Research only verified customer needs.' })
      ).status,
    ).toBe(204);

    const snapshot = await organization.get();
    expect(snapshot.status).toBe(200);
    expect(snapshot.data?.departments).toMatchObject([{ name: 'Delivery' }]);
    expect(snapshot.data?.goals).toMatchObject([
      { title: 'Ship the customer portal', status: 'active', projectId: project.id },
    ]);
    expect(snapshot.data?.agents).toHaveLength(2);
    expect(
      snapshot.data?.agents?.some(
        (entry) => entry.username === 'hermes-mkt-coordinator' && entry.kind === 'external',
      ),
    ).toBe(true);
    expect(snapshot.data?.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: agent.id,
          roleTitle: 'Lead researcher',
          runtimeAgentId: 'marketing-researcher',
          projects: [
            expect.objectContaining({
              id: project.id,
              instructions: 'Research only verified customer needs.',
            }),
          ],
        }),
      ]),
    );
    expect(snapshot.data?.projects).toMatchObject([
      {
        id: project.id,
        departmentId: department.data!.id,
        instructions: 'Use the approved release checklist.',
      },
    ]);
  });

  it('sets an agent team role and capabilities and keeps them when omitted', async () => {
    const { api, teamId, agent } = await setup();
    const organization = api.teams({ teamId }).organization;
    const assignment = organization.agents({ agentId: agent.id });
    const read = async () =>
      (await organization.get()).data!.agents.find((entry) => entry.id === agent.id);

    expect(await read()).toMatchObject({ role: null, capabilities: [] });
    expect(
      (
        await assignment.put({
          role: 'specialist',
          capabilities: ['frontend', 'qa-2', 'frontend'],
        })
      ).status,
    ).toBe(204);
    expect(await read()).toMatchObject({
      role: 'specialist',
      capabilities: ['frontend', 'qa-2'],
    });

    expect((await assignment.put({ roleTitle: 'Tester' })).status).toBe(204);
    expect(await read()).toMatchObject({
      roleTitle: 'Tester',
      role: 'specialist',
      capabilities: ['frontend', 'qa-2'],
    });

    expect((await assignment.put({ role: null, capabilities: [] })).status).toBe(204);
    expect(await read()).toMatchObject({ role: null, capabilities: [] });

    const sixteen = Array.from({ length: 16 }, (_, index) => `skill-${index}`);
    expect((await assignment.put({ role: 'reviewer', capabilities: sixteen })).status).toBe(204);
    expect(await read()).toMatchObject({ role: 'reviewer', capabilities: sixteen });
  });

  it('marks the Home master and pool templates so neither counts as unassigned', async () => {
    const { api, teamId, agent } = await setup();
    const template = await api.teams({ teamId })['ai-agents'].post({
      name: 'Coder',
      username: 'coder',
      kind: 'external',
      template: true,
    });
    expect(template.status).toBe(201);

    const snapshot = await api.teams({ teamId }).organization.get();
    expect(snapshot.status).toBe(200);
    const byUsername = (username: string) =>
      snapshot.data!.agents.find((entry) => entry.username === username);

    // The Home master carries no organization_agent_assignment row and no
    // reportsToAgentId, exactly like a real orphan would — only isHome tells them apart.
    expect(byUsername('master')).toMatchObject({ isHome: true, template: false });
    // A pool template runs in no project and reports to no one either, but must be
    // marked as a template, not as unassigned.
    expect(byUsername('coder')).toMatchObject({ isHome: false, template: true });
    // The project's auto-created coordinator reports to master.
    expect(byUsername('hermes-mkt-coordinator')).toMatchObject({
      isHome: false,
      template: false,
      reportsToAgentId: byUsername('master')!.id,
    });
    const researcher = snapshot.data!.agents.find((entry) => entry.id === agent.id);
    expect(researcher).toMatchObject({ isHome: false, template: false });
  });

  it("makes a new project's Hermes coordinator the coordinator of its agent team", async () => {
    const { api, teamId } = await setup();
    const coordinator = (await api.teams({ teamId }).organization.get()).data!.agents.find(
      (entry) => entry.username === 'hermes-mkt-coordinator',
    );

    expect(coordinator).toMatchObject({ role: 'coordinator', capabilities: [], roleTitle: '' });
  });

  it('groups a project under a department in the project list and keeps its instructions', async () => {
    const { api, teamId, project } = await setup();
    const organization = api.teams({ teamId }).organization;
    const department = (await organization.departments.post({ name: 'Volition' })).data!;
    const assignment = organization.projects({ projectId: project.id });

    expect((await assignment.put({ instructions: 'Ship the portal.' })).status).toBe(204);
    expect((await assignment.put({ departmentId: department.id })).status).toBe(204);

    const listed = (await api.projects.get()).data!.find((entry) => entry.key === 'MKT');
    expect(listed).toMatchObject({
      departmentId: department.id,
      departmentName: 'Volition',
      teamManager: true,
    });
    const stored = (await organization.get()).data!.projects.find(
      (entry) => entry.id === project.id,
    );
    expect(stored).toMatchObject({ departmentId: department.id, instructions: 'Ship the portal.' });

    expect((await assignment.put({ departmentId: null })).status).toBe(204);
    expect((await api.projects.get()).data!.find((entry) => entry.key === 'MKT')).toMatchObject({
      departmentId: null,
      departmentName: null,
    });
  });

  it('rejects an unknown team role and invalid capabilities', async () => {
    const { api, teamId, agent } = await setup();
    const assignment = api.teams({ teamId }).organization.agents({ agentId: agent.id });

    expect((await assignment.put({ role: 'manager' as unknown as 'coordinator' })).status).toBe(
      400,
    );
    expect((await assignment.put({ capabilities: ['Frontend'] })).status).toBe(400);
    expect((await assignment.put({ capabilities: ['front end'] })).status).toBe(400);
    expect((await assignment.put({ capabilities: [''] })).status).toBe(400);
    expect((await assignment.put({ capabilities: ['x'.repeat(33)] })).status).toBe(400);
    expect(
      (
        await assignment.put({
          capabilities: Array.from({ length: 17 }, (_, index) => `skill-${index}`),
        })
      ).status,
    ).toBe(400);
  });

  it('rejects cycles in departments and reporting lines', async () => {
    const { api, teamId, agent } = await setup();
    const second = await createAgent(api, 'MKT', {
      name: 'Writer',
      username: 'writer',
      kind: 'external',
    });
    const organization = api.teams({ teamId }).organization;
    const parent = await organization.departments.post({ name: 'Parent' });
    const child = await organization.departments.post({
      name: 'Child',
      parentId: parent.data!.id,
    });

    expect(
      (
        await organization
          .departments({ departmentId: parent.data!.id })
          .patch({ parentId: child.data!.id })
      ).status,
    ).toBe(400);

    await organization.agents({ agentId: agent.id }).put({
      reportsToAgentId: second.data!.agent.id,
    });
    expect(
      (
        await organization
          .agents({ agentId: second.data!.agent.id })
          .put({ reportsToAgentId: agent.id })
      ).status,
    ).toBe(400);
  });

  it('stores goal ancestry and rejects a goal cycle', async () => {
    const { api, teamId } = await setup();
    const organization = api.teams({ teamId }).organization;
    const parent = await organization.goals.post({ title: 'Company outcome' });
    const child = await organization.goals.post({
      title: 'Team outcome',
      parentGoalId: parent.data!.id,
    });
    expect((await organization.get()).data!.goals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: child.data!.id, parentGoalId: parent.data!.id }),
      ]),
    );
    expect(
      (
        await organization
          .goals({ goalId: parent.data!.id })
          .patch({ parentGoalId: child.data!.id })
      ).status,
    ).toBe(400);
  });

  it('rejects references from another team and hides the organization from outsiders', async () => {
    const { api, teamId, agent } = await setup();
    const otherOwner = await signUpTestUser({ name: 'Other owner' });
    const otherApi = authedApi(otherOwner.cookie);
    const otherProject = await otherApi.projects.post({ key: 'OTH', name: 'Other' });
    const otherDepartment = await otherApi
      .teams({ teamId: otherProject.data!.teamId })
      .organization.departments.post({ name: 'Other department' });

    expect(
      (
        await api
          .teams({ teamId })
          .organization.agents({ agentId: agent.id })
          .put({ departmentId: otherDepartment.data!.id })
      ).status,
    ).toBe(400);
    expect((await otherApi.teams({ teamId }).organization.get()).status).toBe(404);
  });
});
