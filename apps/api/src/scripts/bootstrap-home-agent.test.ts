import { beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { aiAgent, db, teamMember } from '@repo/db';
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
      kind: 'external',
      ownerUserId: owner.userId,
      runnerScope: 'owner',
      memoryEnabled: true,
      memoryLastMessages: 50,
      triggerOnMention: true,
      triggerOnAssign: false,
    });
    expect((rowsAfterFirst[0]!.runtimePolicy as AgentRuntimePolicy).files).toEqual([
      { kind: 'instructions', path: 'SOUL.md', content: HOME_AGENT_SOUL },
    ]);
    expect(createHash('sha256').update(HOME_AGENT_SOUL).digest('hex')).toBe(
      '36c1f5a2e92cd1d018311eaf4c8f1e8886672eae78212e033c681d0e3d5d506f',
    );

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
    expect(first?.agent.username).toBe('hermes-coord-coordinator');
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
});

describe('Project agent bootstrap', () => {
  beforeEach(resetDb);

  async function setup() {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    const created = await api.projects.post({ key: 'CODE', name: 'Code' });
    const other = await api.projects.post({
      key: 'OTHER',
      name: 'Other',
      autoAssignTeamAgents: false,
    });
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
    });
  });
});
