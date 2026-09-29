import { describe, it, expect, beforeEach } from 'bun:test';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import {
  bootstrapHomeAgent,
  bootstrapProjectCoordinator,
} from '../../../../../scripts/bootstrap-home-agent';

// The structure of a team's agents: the Home agent is the master and is used from Home
// only, each project's coordinator reports to it, and the agents of one project are its
// specialists, created there or copied from a template.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const home = await bootstrapHomeAgent();
  if (home.status !== 'ready') throw new Error('Home agent was not provisioned');
  const project = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  return {
    asOwner,
    teamId: project.teamId,
    project,
    home: { id: home.agentId, api: apiKeyApi(home.apiKey) },
  };
}

const agents = (api: Api, teamId: number) => api.teams({ teamId })['ai-agents'];

async function teamAgent(api: Api, teamId: number, username: string) {
  const listed = await agents(api, teamId).get();
  return listed.data!.find((agent) => agent.username === username)!;
}

async function organizationAgent(api: Api, teamId: number, username: string) {
  const organization = await api.teams({ teamId }).organization.get();
  return organization.data!.agents.find((agent) => agent.username === username)!;
}

describe('Home agent', () => {
  beforeEach(resetDb);

  it('joins every new project', async () => {
    const { asOwner, teamId } = await setup();
    await asOwner.projects.post({ key: 'NEW', name: 'New' });

    const home = await teamAgent(asOwner, teamId, 'master');
    expect(home.projects.map((p) => p.key)).toEqual(['MKT', 'NEW']);
  });

  it('is left out of the agent, assignee, member, workload and organization lists of a project', async () => {
    const { asOwner, teamId, project } = await setup();
    const homeUser = (await teamAgent(asOwner, teamId, 'master')).userId;

    const projectAgents = await agents(asOwner, teamId).get({ query: { projectId: project.id } });
    expect(projectAgents.data!.map((a) => a.username)).toEqual(['mkt-koordinator']);
    const teamAgents = await agents(asOwner, teamId).get();
    expect(teamAgents.data!.map((a) => a.username)).toContain('master');

    const detail = await asOwner.projects({ projectKey: 'MKT' }).get();
    expect(detail.data!.assignees.map((a) => a.userId)).not.toContain(homeUser);
    expect(detail.data!.assignees.map((a) => a.username)).toContain('mkt-koordinator');

    const members = await asOwner.projects({ projectKey: 'MKT' }).members.get();
    expect(members.data!.items.map((m) => m.userId)).not.toContain(homeUser);
    expect(members.data!.total).toBe(2);
    const teamMembers = await asOwner
      .teams({ teamId })
      .projects({ projectId: project.id })
      .members.get();
    expect(teamMembers.data!.items.map((m) => m.userId)).not.toContain(homeUser);

    const workload = await asOwner
      .projects({ projectKey: 'MKT' })
      .analytics['agent-workload'].get();
    expect(workload.data!.map((a) => a.agentName)).toEqual(['Coordinator MKT']);

    const scoped = await asOwner
      .teams({ teamId })
      .organization.get({ query: { projectId: project.id } });
    expect(scoped.data!.agents.map((a) => a.username)).toEqual(['mkt-koordinator']);
    const whole = await asOwner.teams({ teamId }).organization.get();
    expect(whole.data!.agents.map((a) => a.username)).toContain('master');
  });

  it('is not offered as a candidate for a project it left', async () => {
    const { asOwner, teamId } = await setup();
    const homeUser = (await teamAgent(asOwner, teamId, 'master')).userId;
    const removed = await asOwner
      .projects({ projectKey: 'MKT' })
      .members({ userId: homeUser })
      .delete();
    expect(removed.status).toBe(204);

    const candidates = await asOwner.projects({ projectKey: 'MKT' }).members.candidates.get();
    expect(candidates.status).toBe(200);
    expect(candidates.data!.map((c) => c.userId)).not.toContain(homeUser);
  });

  it('still works in a project and signs what it writes there', async () => {
    const { asOwner, home } = await setup();
    const columnId = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!.columns[0].id;

    const issue = await home.api
      .projects({ projectKey: 'MKT' })
      .issues.post({ columnId, title: 'Landing page' });
    expect(issue.status).toBe(201);
    await home.api.issues({ issueId: issue.data!.id }).comments.post({ body: 'Started.' });

    const feed = await asOwner.issues({ issueId: issue.data!.id }).feed.get({ query: {} });
    expect(feed.data!.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ actorName: 'Helena' })]),
    );
  });

  it('keeps its handle to itself', async () => {
    const { asOwner, teamId, home } = await setup();
    const taken = await agents(asOwner, teamId).post({
      name: 'Master',
      username: 'Master',
      kind: 'external',
    });
    expect(taken.status).toBe(409);
    const other = (
      await agents(asOwner, teamId).post({ name: 'Writer', username: 'writer', kind: 'external' })
    ).data!.agent;
    const renamed = await agents(
      asOwner,
      teamId,
    )({ agentId: other.id }).patch({
      username: 'master',
    });
    expect(renamed.status).toBe(409);

    const saved = await agents(
      asOwner,
      teamId,
    )({ agentId: home.id }).patch({
      name: 'Home',
      username: 'master',
    });
    expect(saved.status).toBe(200);
  });

  it('cannot become a template', async () => {
    const { asOwner, teamId, home } = await setup();
    const res = await agents(asOwner, teamId)({ agentId: home.id }).patch({ template: true });
    expect(res.status).toBe(400);
  });
});

describe('project coordinators', () => {
  beforeEach(resetDb);

  it('report to the Home agent from their creation', async () => {
    const { asOwner, teamId, home } = await setup();
    await asOwner.projects.post({ key: 'OPS', name: 'Ops' });

    for (const username of ['mkt-koordinator', 'ops-koordinator']) {
      expect(await organizationAgent(asOwner, teamId, username)).toMatchObject({
        role: 'coordinator',
        reportsToAgentId: home.id,
      });
    }
  });
});

describe('agents created in a project', () => {
  beforeEach(resetDb);

  it('work in that project only, as specialists of its coordinator', async () => {
    const { asOwner, teamId, project } = await setup();
    const created = await agents(asOwner, teamId).post({
      name: 'Writer',
      username: 'writer',
      kind: 'external',
      projectId: project.id,
    });
    expect(created.status).toBe(201);
    expect(created.data!.agent.projects.map((p) => p.key)).toEqual(['MKT']);
    const coordinator = await organizationAgent(asOwner, teamId, 'mkt-koordinator');
    expect(await organizationAgent(asOwner, teamId, 'writer')).toMatchObject({
      role: 'specialist',
      reportsToAgentId: coordinator.id,
    });

    await agents(asOwner, teamId).post({
      name: 'Shared',
      username: 'shared',
      projectIds: [project.id],
    });
    // A specialist stays in its project even when it reports to nobody, and so does an
    // agent attached to it by hand: a new project starts with the Home agent and its own
    // coordinator only.
    await asOwner
      .teams({ teamId })
      .organization.agents({ agentId: created.data!.agent.id })
      .put({ role: 'specialist', reportsToAgentId: null });
    await asOwner.projects.post({ key: 'NEW', name: 'New' });
    expect((await teamAgent(asOwner, teamId, 'writer')).projects.map((p) => p.key)).toEqual([
      'MKT',
    ]);
    expect((await teamAgent(asOwner, teamId, 'shared')).projects.map((p) => p.key)).toEqual([
      'MKT',
    ]);
  });

  it('refuses a project of another team', async () => {
    const { asOwner, teamId } = await setup();
    const other = authedApi((await signUpTestUser()).cookie);
    const foreign = (await other.projects.post({ key: 'OTH', name: 'Other' })).data!;

    const res = await agents(asOwner, teamId).post({
      name: 'Writer',
      username: 'writer',
      kind: 'external',
      projectId: foreign.id,
    });
    expect(res.status).toBe(400);
  });
});

describe('templates', () => {
  beforeEach(resetDb);

  it('work in no project and are not joined to new ones', async () => {
    const { asOwner, teamId, project } = await setup();
    const created = await agents(asOwner, teamId).post({
      name: 'Designer',
      username: 'designer',
      kind: 'external',
      template: true,
    });
    expect(created.status).toBe(201);
    expect(created.data!.agent).toMatchObject({ template: true, projects: [] });

    const attached = await agents(asOwner, teamId).post({
      name: 'Tester',
      username: 'tester',
      kind: 'external',
      template: true,
      projectIds: [project.id],
    });
    expect(attached.status).toBe(400);
    const moved = await agents(
      asOwner,
      teamId,
    )({ agentId: created.data!.agent.id }).patch({
      projectIds: [project.id],
    });
    expect(moved.status).toBe(400);

    await asOwner.projects.post({ key: 'NEW', name: 'New' });
    expect((await teamAgent(asOwner, teamId, 'designer')).projects).toEqual([]);
  });

  it('leave every project when an agent becomes one', async () => {
    const { asOwner, teamId, project } = await setup();
    const created = await agents(asOwner, teamId).post({
      name: 'Designer',
      username: 'designer',
      kind: 'external',
      projectIds: [project.id],
    });

    const res = await agents(
      asOwner,
      teamId,
    )({ agentId: created.data!.agent.id }).patch({
      template: true,
      projectIds: [],
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ template: true, projects: [] });
  });

  it('are not chatted with', async () => {
    const { asOwner, teamId } = await setup();
    const created = await agents(asOwner, teamId).post({
      name: 'Designer',
      username: 'designer',
      kind: 'external',
      template: true,
    });

    const sent = await agents(
      asOwner,
      teamId,
    )({ agentId: created.data!.agent.id }).chat.post({
      prompt: 'Hello',
    });
    expect(sent.status).toBe(400);
  });

  it('are copied into a project as a specialist of its coordinator', async () => {
    const { asOwner, teamId, project } = await setup();
    const runtimePolicy = {
      reasoningEffort: 'high',
      toolAllow: [],
      toolDeny: ['terminal'],
      mcpGrants: ['itsaplan'],
      files: [{ kind: 'instructions' as const, path: 'instructions/style.md', content: '# Style' }],
    };
    const template = (
      await agents(asOwner, teamId).post({
        name: 'Designer',
        username: 'designer',
        kind: 'external',
        template: true,
        instructions: 'Design the screens.',
        model: 'anthropic/claude-opus-4.6',
        runtimePolicy,
      })
    ).data!.agent;
    const skill = await asOwner.teams({ teamId })['agent-skills'].post({
      source: 'inline',
      markdown: '---\nname: Layout\ndescription: Lay out screens\n---\n\n# Skill',
    });
    await agents(
      asOwner,
      teamId,
    )({ agentId: template.id }).skills.put({
      skillIds: [skill.data!.id],
    });
    await asOwner
      .teams({ teamId })
      .organization.agents({ agentId: template.id })
      .put({ roleTitle: 'Designer', capabilities: ['design'] });

    const copied = await agents(
      asOwner,
      teamId,
    )({ agentId: template.id }).copy.post({
      projectId: project.id,
    });
    expect(copied.status).toBe(201);
    expect(copied.data!.apiKey).toEqual(expect.any(String));
    expect(copied.data!.agent).toMatchObject({
      name: 'Designer MKT',
      username: 'designer-mkt',
      template: false,
      instructions: 'Design the screens.',
      model: 'anthropic/claude-opus-4.6',
      runtimePolicy,
      skillCount: 1,
    });
    expect(copied.data!.agent.projects.map((p) => p.key)).toEqual(['MKT']);
    const coordinator = await organizationAgent(asOwner, teamId, 'mkt-koordinator');
    expect(await organizationAgent(asOwner, teamId, 'designer-mkt')).toMatchObject({
      role: 'specialist',
      reportsToAgentId: coordinator.id,
      roleTitle: 'Designer',
      capabilities: ['design'],
    });
    expect(await teamAgent(asOwner, teamId, 'designer')).toMatchObject({
      template: true,
      projects: [],
    });

    const again = await agents(
      asOwner,
      teamId,
    )({ agentId: template.id }).copy.post({
      projectId: project.id,
    });
    expect(again.status).toBe(409);
  });

  it('copy only a template, into a project of the team', async () => {
    const { asOwner, teamId, project } = await setup();
    const shared = (
      await agents(asOwner, teamId).post({ name: 'Shared', username: 'shared', kind: 'external' })
    ).data!.agent;
    const notTemplate = await agents(
      asOwner,
      teamId,
    )({ agentId: shared.id }).copy.post({
      projectId: project.id,
    });
    expect(notTemplate.status).toBe(400);

    const template = (
      await agents(asOwner, teamId).post({
        name: 'Designer',
        username: 'designer',
        kind: 'external',
        template: true,
      })
    ).data!.agent;
    const other = authedApi((await signUpTestUser()).cookie);
    const foreign = (await other.projects.post({ key: 'OTH', name: 'Other' })).data!;
    const elsewhere = await agents(
      asOwner,
      teamId,
    )({ agentId: template.id }).copy.post({
      projectId: foreign.id,
    });
    expect(elsewhere.status).toBe(400);
  });

  it('are copied by a project member whose role may create agents', async () => {
    const { asOwner, teamId, project } = await setup();
    const template = (
      await agents(asOwner, teamId).post({
        name: 'Designer',
        username: 'designer',
        kind: 'external',
        template: true,
      })
    ).data!.agent;
    const role = await createRole(asOwner, 'MKT', {
      name: 'Agent maker',
      permissions: { ai_agents: { read: true, create: true } },
    });
    const member = await addProjectMember(asOwner, 'MKT', role.data!.id);

    const listed = await agents(member, teamId).get();
    expect(listed.data!.map((a) => a.username)).toContain('designer');
    const res = await agents(
      member,
      teamId,
    )({ agentId: template.id }).copy.post({
      projectId: project.id,
    });
    expect(res.status).toBe(201);
  });

  it('are copied only by a member who may create agents', async () => {
    const { asOwner, teamId, project } = await setup();
    const template = (
      await agents(asOwner, teamId).post({
        name: 'Designer',
        username: 'designer',
        kind: 'external',
        template: true,
      })
    ).data!.agent;
    const member = await addProjectMember(asOwner, 'MKT');

    const res = await agents(
      member,
      teamId,
    )({ agentId: template.id }).copy.post({
      projectId: project.id,
    });
    expect(res.status).toBe(403);
  });
});

describe('SOUL.md of the structure', () => {
  beforeEach(resetDb);

  it("tells the Home agent it is the master and names each project's coordinator", async () => {
    const { home } = await setup();

    const policy = await home.api['agent-runtime'].policy.get();
    const soul = policy.data!.runtimePolicy.files[0].content;
    expect(soul).toContain('## Home agent');
    expect(soul).toContain('- MKT — "Marketing": @mkt-koordinator');
    expect(soul).toContain("delegate\nit to the project's coordinator");
  });

  it('tells a coordinator it reports to Home and names its specialists', async () => {
    const { asOwner, teamId, project } = await setup();
    await agents(asOwner, teamId).post({
      name: 'Writer',
      username: 'writer',
      kind: 'external',
      projectId: project.id,
    });
    const coordinator = await bootstrapProjectCoordinator(project.id);

    const policy = await apiKeyApi(coordinator!.apiKey!)['agent-runtime'].policy.get();
    const soul = policy.data!.runtimePolicy.files[0].content;
    expect(soul).toContain(
      'You coordinate the agent team of MKT and report to the Home agent (@master).',
    );
    expect(soul).toContain('Hermes sub-agents with the delegation');
    expect(soul).toContain('instead: @writer.');
  });

  it('tells a specialist whom it reports to and how it hands its work back', async () => {
    const { asOwner, teamId, project } = await setup();
    const created = await agents(asOwner, teamId).post({
      name: 'Writer',
      username: 'writer',
      kind: 'external',
      projectId: project.id,
    });

    const policy = await apiKeyApi(created.data!.apiKey!)['agent-runtime'].policy.get();
    const soul = policy.data!.runtimePolicy.files[0].content;
    expect(soul).toContain('## Agent team');
    expect(soul).toContain('You are a specialist in the agent team of MKT and report to');
    expect(soul).toContain('@mkt-koordinator');
    expect(soul).toContain('Handing your work back:');
    expect(soul).not.toContain('## Home agent');
  });
});
