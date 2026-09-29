import { beforeEach, describe, expect, it } from 'bun:test';
import { aiAgent, db, projectProvisioningJob, teamMember } from '@repo/db';
import { eq } from 'drizzle-orm';

import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { api as anonymous, apiKeyApi, authedApi } from '#tests/helpers/app';
import { controlApi } from '#tests/helpers/control';
import { resetDb } from '#tests/helpers/db';
import type { AgentRuntimePolicy } from '#modules/agents/core/service';

import {
  bootstrapHomeAgent,
  bootstrapProjectAgent,
  bootstrapProjectCoordinator,
  HOME_AGENT_SOUL,
} from './bootstrap-home-agent';

describe('Home agent bootstrap', () => {
  beforeEach(resetDb);

  it('waits while the fresh installation has no owner', async () => {
    expect(await bootstrapHomeAgent()).toEqual({ status: 'pending' });
  });

  it('creates one owner-scoped external Home agent and rotates only its key on retry', async () => {
    const owner = await signUpTestUser({ name: 'Patrick' });

    const first = await bootstrapHomeAgent();
    expect(first.status).toBe('ready');

    const rowsAfterFirst = await db.select().from(aiAgent);
    expect(rowsAfterFirst).toHaveLength(1);
    expect(rowsAfterFirst[0]).toMatchObject({
      username: 'master',
      agentRole: 'home',
      projectScope: 'all',
      kind: 'external',
      ownerUserId: owner.userId,
      runnerScope: 'owner',
      triggerOnMention: true,
      triggerOnAssign: false,
    });
    expect((rowsAfterFirst[0]!.runtimePolicy as AgentRuntimePolicy).files).toEqual([
      { kind: 'instructions', path: 'SOUL.md', content: HOME_AGENT_SOUL },
    ]);
    expect(HOME_AGENT_SOUL).toStartWith('Du bist Ava');

    const customizedPolicy: AgentRuntimePolicy = {
      ...(rowsAfterFirst[0]!.runtimePolicy as AgentRuntimePolicy),
      files: [{ kind: 'instructions' as const, path: 'SOUL.md', content: '# My own persona' }],
    };
    await db
      .update(aiAgent)
      .set({ runtimePolicy: customizedPolicy })
      .where(eq(aiAgent.id, first.status === 'ready' ? first.agentId : -1));

    const second = await bootstrapHomeAgent();
    expect(second.status).toBe('ready');
    if (first.status === 'ready' && second.status === 'ready') {
      expect(second.agentId).toBe(first.agentId);
      expect(second.apiKey).not.toBe(first.apiKey);
    }

    expect(await db.$count(aiAgent, eq(aiAgent.username, 'master'))).toBe(1);
    const [afterRetry] = await db.select().from(aiAgent).where(eq(aiAgent.username, 'master'));
    expect(afterRetry!.runtimePolicy).toEqual(customizedPolicy);
  });

  it('keeps the Home role and all-project scope after a handle change', async () => {
    const owner = await signUpTestUser({ name: 'Patrick' });
    const first = await bootstrapHomeAgent();
    if (first.status !== 'ready') throw new Error('Home agent was not provisioned');
    const api = authedApi(owner.cookie);
    const project = await api.projects.post({ key: 'MKT', name: 'Marketing' });
    const agent = api
      .teams({ teamId: project.data!.teamId })
      ['ai-agents']({ agentId: first.agentId });
    const renamed = await agent.patch({ username: 'renamed-home' });
    expect(renamed.status).toBe(200);
    expect(renamed.data).toMatchObject({ agentRole: 'home', projectScope: 'all' });
    await api.projects.post({ key: 'OPS', name: 'Operations' });
    expect((await agent.get()).data?.projects.map((item) => item.key).sort()).toEqual([
      'MKT',
      'OPS',
    ]);
    const retry = await bootstrapHomeAgent();
    expect(retry.status === 'ready' && retry.agentId).toBe(first.agentId);
  });

  it('makes the coordinators of earlier projects report to the new Home agent', async () => {
    const owner = await signUpTestUser({ name: 'Patrick' });
    const api = authedApi(owner.cookie);
    const teamId = (await api.projects.post({ key: 'MKT', name: 'Marketing' })).data!.teamId;

    const result = await bootstrapHomeAgent();
    if (result.status !== 'ready') throw new Error('Home agent was not provisioned');

    const organization = await api.teams({ teamId }).organization.get();
    expect(
      organization.data!.agents.find((agent) => agent.username === 'mkt-koordinator'),
    ).toMatchObject({ reportsToAgentId: result.agentId });
  });

  it('serves the Home chat directly from the team without creating a project', async () => {
    const owner = await signUpTestUser({ name: 'Patrick' });
    const result = await bootstrapHomeAgent();
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Home agent was not provisioned');

    const [membership] = await db
      .select({ teamId: teamMember.teamId })
      .from(teamMember)
      .where(eq(teamMember.userId, owner.userId))
      .limit(1);
    const home = authedApi(owner.cookie)
      .teams({ teamId: membership!.teamId })
      ['ai-agents']({ agentId: result.agentId });

    const sent = await home.chat.post({ prompt: 'Richte mein System ein' });
    expect(sent.status).toBe(200);
    const threads = await home.threads.get();
    expect(threads.status).toBe(200);
    expect(threads.data?.items).toHaveLength(1);
    expect(threads.data?.items[0]?.title).toBe('Richte mein System ein');
  });
});

describe('Project coordinator bootstrap', () => {
  beforeEach(resetDb);

  async function createdProject() {
    const owner = await signUpTestUser();
    const created = await authedApi(owner.cookie).projects.post({ key: 'COORD', name: 'Coord' });
    expect(created.status).toBe(201);
    return created.data!;
  }

  async function keyWorks(apiKey: string) {
    return (await apiKeyApi(apiKey).projects.get()).status === 200;
  }

  it('keeps a valid key and issues a new one only for a missing or rejected key', async () => {
    const project = await createdProject();

    const first = await bootstrapProjectCoordinator(project.id);
    expect(first?.agent.username).toBe('coord-koordinator');
    const issued = first!.apiKey!;
    expect(await keyWorks(issued)).toBe(true);

    const reused = await bootstrapProjectCoordinator(project.id, issued);
    expect(reused?.agent.id).toBe(first!.agent.id);
    expect(reused?.apiKey).toBeNull();
    expect(await keyWorks(issued)).toBe(true);

    const replaced = await bootstrapProjectCoordinator(project.id, 'itp_not-a-valid-key');
    expect(replaced?.apiKey).toEqual(expect.any(String));
    expect(replaced?.apiKey).not.toBe(issued);
    expect(await keyWorks(issued)).toBe(false);
    expect(await keyWorks(replaced!.apiKey!)).toBe(true);
  });

  it('reuses the coordinator assigned to a project under its legacy handle', async () => {
    const project = await createdProject();
    const first = await bootstrapProjectCoordinator(project.id);
    await db
      .update(aiAgent)
      .set({ username: 'hermes-coord-coordinator' })
      .where(eq(aiAgent.id, first!.agent.id));

    const second = await bootstrapProjectCoordinator(project.id, first!.apiKey!);
    expect(second?.agent).toMatchObject({
      id: first!.agent.id,
      username: 'hermes-coord-coordinator',
    });
    expect(second?.apiKey).toBeNull();
    expect(await db.$count(aiAgent)).toBe(1);
  });

  it("does not accept another agent's key as the coordinator's", async () => {
    const project = await createdProject();
    const home = await bootstrapHomeAgent();
    if (home.status !== 'ready') throw new Error('Home agent was not provisioned');

    const result = await bootstrapProjectCoordinator(project.id, home.apiKey);
    expect(result?.apiKey).toEqual(expect.any(String));
    expect(await keyWorks(home.apiKey)).toBe(true);
  });

  it('reports a missing project', async () => {
    expect(await bootstrapProjectCoordinator(999_999)).toBeNull();
  });

  it('hands over the project-wide instructions and queues the workspace again when they change', async () => {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    const project = (await api.projects.post({ key: 'COORD', name: 'Coord' })).data!;
    expect((await bootstrapProjectCoordinator(project.id))?.projectInstructions).toBe('');

    const [before] = await db
      .select({ id: projectProvisioningJob.id })
      .from(projectProvisioningJob)
      .where(eq(projectProvisioningJob.projectId, project.id));
    await api
      .teams({ teamId: project.teamId })
      .organization.projects({ projectId: project.id })
      .put({ instructions: 'The site is in homepage/.' });
    expect((await bootstrapProjectCoordinator(project.id))?.projectInstructions).toBe(
      'The site is in homepage/.',
    );
    const [after] = await db
      .select({ id: projectProvisioningJob.id, status: projectProvisioningJob.status })
      .from(projectProvisioningJob)
      .where(eq(projectProvisioningJob.projectId, project.id));
    expect(after?.status).toBe('pending');
    expect(after?.id).not.toBe(before?.id);
  });
});

describe('Project agent bootstrap', () => {
  beforeEach(resetDb);

  async function setup() {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    const created = await api.projects.post({ key: 'CODE', name: 'Code' });
    const other = await api.projects.post({ key: 'OTHER', name: 'Other' });
    const agent = await createAgent(api, 'CODE', {
      name: 'Coder',
      username: 'coder',
      kind: 'external',
    });
    return { api, project: created.data!, other: other.data!, agent: agent.data!.agent };
  }

  async function keyWorks(apiKey: string) {
    return (await apiKeyApi(apiKey).projects.get()).status === 200;
  }

  it('keeps a valid key and issues a new one only for a missing or rejected key', async () => {
    const { project, agent } = await setup();

    const first = await bootstrapProjectAgent(project.id, agent.id);
    expect(first?.agent).toEqual({ id: agent.id, userId: agent.userId, username: 'coder' });
    const issued = first!.apiKey!;
    expect(await keyWorks(issued)).toBe(true);

    const reused = await bootstrapProjectAgent(project.id, agent.id, issued);
    expect(reused?.apiKey).toBeNull();
    expect(await keyWorks(issued)).toBe(true);

    const replaced = await bootstrapProjectAgent(project.id, agent.id, 'itp_not-a-valid-key');
    expect(replaced?.apiKey).toEqual(expect.any(String));
    expect(await keyWorks(issued)).toBe(false);
    expect(await keyWorks(replaced!.apiKey!)).toBe(true);
  });

  it('gives no runtime to an agent outside the project, in two projects, the coordinator or Home', async () => {
    const { api, project, other, agent } = await setup();
    expect(await bootstrapProjectAgent(other.id, agent.id)).toBeNull();

    const coordinator = await bootstrapProjectCoordinator(project.id);
    expect(await bootstrapProjectAgent(project.id, coordinator!.agent.id)).toBeNull();

    const home = await bootstrapHomeAgent();
    if (home.status !== 'ready') throw new Error('Home agent was not provisioned');
    await api
      .teams({ teamId: project.teamId })
      ['ai-agents']({ agentId: home.agentId })
      .projects.put({ projectIds: [project.id] });
    expect(await bootstrapProjectAgent(project.id, home.agentId)).toBeNull();

    await api
      .teams({ teamId: project.teamId })
      ['ai-agents']({ agentId: agent.id })
      .projects.put({ projectIds: [project.id, other.id] });
    expect(await bootstrapProjectAgent(project.id, agent.id)).toBeNull();
  });

  it('gives an agent the selected runtime in its provisioning descriptor', async () => {
    const { api, project, agent } = await setup();
    const route = api.teams({ teamId: project.teamId })['ai-agents']({ agentId: agent.id });
    const policy = (await route.get()).data!.runtimePolicy;
    expect((await bootstrapProjectAgent(project.id, agent.id))?.runtime).toBe('hermes');
    for (const runtime of ['claude', 'codex', 'command', 'webhook'] as const) {
      const patched = await route.patch({ runtimePolicy: { ...policy, runtime } });
      expect(patched.data!.runtimePolicy.runtime).toBe(runtime);
      const answer = await bootstrapProjectAgent(project.id, agent.id);
      expect(answer).toMatchObject({ agent: { id: agent.id }, runtime });
    }
    // Hermes again: the default, which the policy leaves out.
    const back = await route.patch({ runtimePolicy: { ...policy, runtime: 'hermes' } });
    expect(back.data!.runtimePolicy).not.toHaveProperty('runtime');
    expect((await bootstrapProjectAgent(project.id, agent.id))?.runtime).toBe('hermes');
  });

  it('answers the provisioning service only with the control token', async () => {
    const { project, agent } = await setup();
    const route = () => controlApi().internal.bootstrap['project-agent'];

    const denied = await anonymous.internal.bootstrap['project-agent'].post({
      projectId: project.id,
      agentId: agent.id,
    });
    expect(denied.status).toBe(401);
    expect((await route().post({ projectId: project.id })).status).toBe(400);
    expect(
      (await route().post({ projectId: project.id, agentId: agent.id, apiKey: 7 })).status,
    ).toBe(400);
    expect((await route().post({ projectId: project.id, agentId: 999_999 })).status).toBe(404);

    const answered = await route().post({ projectId: project.id, agentId: agent.id });
    expect(answered.status).toBe(200);
    expect(answered.data).toMatchObject({
      agent: { id: agent.id, username: 'coder' },
      apiKey: expect.any(String),
      runtime: 'hermes',
    });
  });
});
