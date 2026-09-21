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
          openClawAgentId: 'marketing-researcher',
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
    expect(snapshot.data?.agents).toMatchObject([
      {
        id: agent.id,
        roleTitle: 'Lead researcher',
        openClawAgentId: 'marketing-researcher',
        projects: [{ id: project.id, instructions: 'Research only verified customer needs.' }],
      },
    ]);
    expect(snapshot.data?.projects).toMatchObject([
      {
        id: project.id,
        departmentId: department.data!.id,
        instructions: 'Use the approved release checklist.',
      },
    ]);
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
