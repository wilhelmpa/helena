import { afterEach, describe, it, expect, beforeEach } from 'bun:test';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent, projectIdOf, teamOf } from '#tests/helpers/agents';
import { controlApi } from '#tests/helpers/control';
import { db, organizationProjectAssignment } from '@repo/db';
import { expireExhaustedRuns } from '../../service';

// The runner queue: a process on the operator's machine authenticates with the
// external agent's API key, claims one run at a time, and reports the result. Runs
// are queued the normal way — a mention on an issue — since the runner routes only
// drain the queue, they never fill it.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = await asOwner.projects({ projectKey: 'MKT' }).get();
  const columnId = view.data!.columns[0].id;
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Ext Bot',
    username: 'ext',
    kind: 'external',
    triggerOnMention: true,
  });
  return {
    asOwner,
    columnId,
    projectId: view.data!.project.id,
    teamId: view.data!.project.teamId,
    agent: created.data!.agent,
    asRunner: apiKeyApi(created.data!.apiKey!),
  };
}

// Queues one run for the agent by mentioning it on a new issue.
async function queueRun(asOwner: Api, columnId: number, username: string) {
  const issue = (
    await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Landing page' })
  ).data!;
  await asOwner.issues({ issueId: issue.id }).comments.post({ body: `please review @${username}` });
  return issue;
}

describe('agent runner queue', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('claims a queued run with its issue and prompt', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    const issue = await queueRun(asOwner, columnId, agent.username);

    const res = await asRunner['agent-runs'].claim.post();
    expect(res.status).toBe(200);
    expect(res.data!.run).toMatchObject({
      trigger: 'mention',
      issueId: issue.id,
      sourceActivityId: expect.any(Number),
      attempts: 1,
    });
    expect(res.data!.run!.issueIdentifier).toBe(`MKT-${issue.sequenceNumber}`);
    // The prompt is framed the way an internal agent's is: what happened, what to do
    // about it, and the trigger text itself.
    expect(res.data!.run!.prompt).toContain('You were mentioned');
    expect(res.data!.run!.prompt).toContain('please review');
    expect(res.data!.run!.systemPrompt).toContain('Run mode');
  });

  it("names the issue's area in the prompt", async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    const areaId = (
      await asOwner.projects({ projectKey: 'MKT' })['view-folders'].post({ name: 'Backend' })
    ).data!.id;
    const issue = (
      await asOwner
        .projects({ projectKey: 'MKT' })
        .issues.post({ columnId, title: 'Landing page', folderId: areaId })
    ).data!;
    await asOwner
      .issues({ issueId: issue.id })
      .comments.post({ body: `please review @${agent.username}` });

    const res = await asRunner['agent-runs'].claim.post();
    expect(res.data!.run!.prompt).toContain('Area: Backend (folder backend)');
    expect(res.data!.run!.workdir).toBe('backend');
  });

  it('starts an agent of several projects in its own working directory', async () => {
    const { asOwner, columnId } = await setup();
    await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const projectIds = [await projectIdOf(asOwner, 'MKT'), await projectIdOf(asOwner, 'OPS')];
    const shared = (
      await createAgent(asOwner, 'MKT', {
        name: 'Shared Bot',
        username: 'shared',
        kind: 'external',
        triggerOnMention: true,
        projectIds,
      })
    ).data!;
    const areaId = (
      await asOwner.projects({ projectKey: 'MKT' })['view-folders'].post({ name: 'Backend' })
    ).data!.id;
    const issue = (
      await asOwner
        .projects({ projectKey: 'MKT' })
        .issues.post({ columnId, title: 'Landing page', folderId: areaId })
    ).data!;
    await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'please review @shared' });

    const res = await apiKeyApi(shared.apiKey!)['agent-runs'].claim.post();
    expect(res.data!.run!.prompt).toContain('Area: Backend (folder backend)');
    expect(res.data!.run!.workdir).toBeNull();
  });

  it('leaves the area out of the prompt of an issue outside any area', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);

    const res = await asRunner['agent-runs'].claim.post();
    expect(res.data!.run!.prompt).not.toContain('Area:');
    expect(res.data!.run!.workdir).toBeNull();
  });

  it('serves a secret-free runtime policy and records generic adapter status', async () => {
    const { asOwner, asRunner, agent, teamId } = await setup();
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({
        model: 'openai/gpt-5.6-sol',
        runtimePolicy: {
          reasoningEffort: 'high',
          toolAllow: ['browser'],
          toolDeny: [],
          mcpGrants: ['itsaplan__get_issue'],
          files: [{ kind: 'instructions', path: 'instructions/team.md', content: '# Team rules' }],
        },
      });

    const skill = await asOwner.teams({ teamId })['agent-skills'].post({
      source: 'inline',
      markdown: '---\nname: Triage\ndescription: Triage work\n---\n\n# Skill',
    });
    const skillId = skill.data!.id;
    await asOwner
      .teams({ teamId })
      ['agent-skills']({ skillId })
      .references.post({
        file: new File(['# Checklist'], 'checklist.md', { type: 'text/markdown' }),
      });
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .skills.put({ skillIds: [skillId] });

    const policy = await asRunner['agent-runtime'].policy.get();
    expect(policy.status).toBe(200);
    expect(typeof policy.data!.revision).toBe('string');
    expect(policy.data).toMatchObject({
      model: 'openai/gpt-5.6-sol',
      runtimePolicy: { reasoningEffort: 'high', mcpGrants: ['itsaplan__get_issue'] },
      skills: [
        {
          id: skillId,
          slug: `plan-${skillId}`,
          name: 'Triage',
          markdown: expect.stringContaining('# Skill'),
          files: [{ path: 'refs/checklist.md', content: '# Checklist' }],
        },
      ],
    });
    expect(JSON.stringify(policy.data)).not.toContain('apiKey');
    expect(JSON.stringify(policy.data)).not.toContain('s3Key');
    // Every managed file reaches Hermes folded into the one SOUL.md of its profile.
    expect(policy.data!.runtimePolicy.files).toEqual([
      { kind: 'instructions', path: 'SOUL.md', content: expect.any(String) },
    ]);
    expect(policy.data!.runtimePolicy.files[0].content).toContain(
      '## instructions/team.md\n\n# Team rules',
    );

    const reported = await asRunner['agent-runtime'].status.post({
      adapter: 'agent_runtime',
      status: 'online',
      appliedRevision: policy.data!.revision,
      capabilities: ['model', 'reasoning', 'managed-markdown'],
      detail: null,
      conflicts: [{ path: 'SOUL.md', content: '# Edited in Hermes' }],
    });
    expect(reported.status).toBe(200);
    expect(reported.data).toMatchObject({ adapter: 'agent_runtime', status: 'online' });

    const saved = await asOwner.teams({ teamId })['ai-agents']({ agentId: agent.id }).get();
    expect(saved.data!.runtimeState).toMatchObject({
      adapter: 'agent_runtime',
      status: 'online',
      appliedRevision: policy.data!.revision,
      conflicts: [{ path: 'SOUL.md', content: '# Edited in Hermes' }],
    });
  });

  it('stores the inventory the runner reports, within its bounds', async () => {
    const { asOwner, asRunner, agent, teamId } = await setup();
    const status = {
      adapter: 'hermes',
      status: 'online' as const,
      appliedRevision: null,
      capabilities: [],
      detail: null,
    };
    const skill = (index: number) => ({
      name: `skill-${index}`,
      category: 'research',
      description: 'x'.repeat(300),
      origin: 'bundled' as const,
    });
    const inventory = {
      toolsets: ['browser', 'file', 'terminal'],
      mcpServers: ['itsaplan'],
      skills: [
        ...Array.from({ length: 299 }, (_, index) => skill(index)),
        { name: 'release-notes', category: null, description: '', origin: 'agent' as const },
      ],
      memory: [
        { file: 'MEMORY.md' as const, content: 'y'.repeat(16384), truncated: true },
        { file: 'USER.md' as const, content: '', truncated: false },
      ],
    };
    const read = async () =>
      (await asOwner.teams({ teamId })['ai-agents']({ agentId: agent.id }).get()).data!.runtimeState
        .inventory;

    expect(await read()).toBeNull();
    const reported = await asRunner['agent-runtime'].status.post({ ...status, inventory });
    expect(reported.status).toBe(200);
    expect(await read()).toEqual(inventory);

    const refused = [
      { ...inventory, skills: [...inventory.skills, skill(300)] },
      { ...inventory, skills: [{ ...skill(0), description: 'x'.repeat(301) }] },
      { ...inventory, skills: [{ ...skill(0), origin: 'imported' }] },
      {
        ...inventory,
        memory: [{ file: 'MEMORY.md', content: 'y'.repeat(16385), truncated: false }],
      },
      { ...inventory, memory: [{ file: 'SOUL.md', content: '', truncated: false }] },
      { ...inventory, toolsets: [''] },
      { ...inventory, mcpServers: Array.from({ length: 65 }, (_, index) => `mcp-${index}`) },
    ];
    for (const body of refused) {
      const res = await asRunner['agent-runtime'].status.post({
        ...status,
        inventory: body as typeof inventory,
      });
      expect(res.status).toBe(400);
    }
    expect(await read()).toEqual(inventory);

    // Hermes' scheduler is never offered.
    await asRunner['agent-runtime'].status.post({
      ...status,
      inventory: { ...inventory, toolsets: ['cronjob', ...inventory.toolsets] },
    });
    expect(await read()).toEqual(inventory);

    // A runner that reads no inventory reports none, which clears the one stored.
    await asRunner['agent-runtime'].status.post(status);
    expect(await read()).toBeNull();
  });

  it('hands the denied toolsets to the runner with the policy', async () => {
    const { asOwner, asRunner, agent, teamId } = await setup();
    const before = await asRunner['agent-runtime'].policy.get();
    expect(before.data!.runtimePolicy.toolDeny).toEqual([]);

    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({
        runtimePolicy: {
          reasoningEffort: null,
          toolAllow: [],
          toolDeny: ['terminal', 'computer_use'],
          mcpGrants: [],
          files: [],
        },
      });

    const after = await asRunner['agent-runtime'].policy.get();
    expect(after.data!.runtimePolicy.toolDeny).toEqual(['terminal', 'computer_use']);
    expect(after.data!.revision).not.toBe(before.data!.revision);
  });

  it("builds the profile's SOUL.md from the agent, its projects and its own SOUL.md", async () => {
    const { asOwner, asRunner, agent, teamId } = await setup();
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({
        instructions: 'Always answer in German.',
        runtimePolicy: {
          reasoningEffort: null,
          toolAllow: [],
          toolDeny: [],
          mcpGrants: [],
          files: [{ kind: 'instructions', path: 'SOUL.md', content: 'You are the release agent.' }],
        },
      });

    const first = await asRunner['agent-runtime'].policy.get();
    const soul = first.data!.runtimePolicy.files[0].content;
    expect(soul).toStartWith('You are the release agent.');
    expect(soul).toContain('## Instructions\n\nAlways answer in German.');
    expect(soul).toContain('(key MKT)');
    expect(soul).toContain('## Chat');
    expect(soul).toContain('## Approvals');
    expect(soul).toContain('call request_approval');

    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({ instructions: 'Always answer in English.' });
    const second = await asRunner['agent-runtime'].policy.get();
    expect(second.data!.revision).not.toBe(first.data!.revision);
    expect(second.data!.runtimePolicy.files[0].content).toContain('Always answer in English.');
  });

  it("lists the project's areas with their folders in the SOUL.md", async () => {
    const { asOwner, asRunner } = await setup();
    const before = await asRunner['agent-runtime'].policy.get();
    expect(before.data!.runtimePolicy.files[0].content).not.toContain('## Areas');

    await asOwner.projects({ projectKey: 'MKT' })['view-folders'].post({ name: 'Backend' });

    const after = await asRunner['agent-runtime'].policy.get();
    expect(after.data!.runtimePolicy.files[0].content).toContain('- MKT: Backend (folder backend)');
    expect(after.data!.revision).not.toBe(before.data!.revision);
  });

  it('hands the configured external model and reasoning to each queued run', async () => {
    const { asOwner, asRunner, agent, columnId, teamId } = await setup();
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({
        model: 'anthropic/claude-opus-4.6',
        runtimePolicy: {
          reasoningEffort: 'high',
          toolAllow: [],
          toolDeny: [],
          mcpGrants: [],
          files: [],
        },
      });
    await queueRun(asOwner, columnId, agent.username);

    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
    expect(run).toMatchObject({
      model: 'anthropic/claude-opus-4.6',
      thinkingLevel: 'high',
    });
  });

  it("hands a stage's run limits, or else the agent's defaults, to the runner", async () => {
    const { asOwner, asRunner, agent, columnId, teamId } = await setup();
    const issue = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Team task' })
    ).data!;
    const stage = (key: string, policy: Record<string, unknown>) =>
      controlApi().internal.orchestration['agent-run'].post({
        projectRef: 'project:MKT',
        task: { taskRef: `task:MKT-${issue.sequenceNumber}` },
        agent: { agentRef: `agent:${agent.username}` },
        idempotencyKey: key.repeat(64),
        prompt: 'Complete the assignment.',
        policy: { leaseSeconds: 300, heartbeatSeconds: 60, maxAttempts: 3, ...policy },
      });

    expect((await stage('b', { maxTurns: 0 })).status).toBe(400);
    expect((await stage('b', { maxTurns: 201 })).status).toBe(400);
    expect((await stage('b', { runBudgetSeconds: 59 })).status).toBe(400);
    expect((await stage('b', { runBudgetSeconds: 7_201 })).status).toBe(400);
    expect((await stage('a', { maxTurns: 200, runBudgetSeconds: 7_200 })).status).toBe(200);
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      trigger: 'manual',
      maxTurns: 200,
      runBudgetSeconds: 7_200,
    });

    await queueRun(asOwner, columnId, agent.username);
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      trigger: 'mention',
      maxTurns: null,
      runBudgetSeconds: null,
    });

    const policy = { reasoningEffort: null, toolAllow: [], toolDeny: [], mcpGrants: [], files: [] };
    expect(
      (
        await asOwner
          .teams({ teamId })
          ['ai-agents']({ agentId: agent.id })
          .patch({ runtimePolicy: { ...policy, maxTurns: 0 } })
      ).status,
    ).toBe(400);
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({ runtimePolicy: { ...policy, maxTurns: 1, runBudgetSeconds: 60 } });
    expect((await stage('c', { maxTurns: 20 })).status).toBe(200);
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      maxTurns: 20,
      runBudgetSeconds: 60,
    });
    await queueRun(asOwner, columnId, agent.username);
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toMatchObject({
      trigger: 'mention',
      maxTurns: 1,
      runBudgetSeconds: 60,
    });
  });

  it('logs on the issue that the agent picked the run up and how it ended', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    const issue = await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    await asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'failed',
      error: 'claude exited with 1',
    });

    const feed = await asOwner.issues({ issueId: issue.id }).feed.get({ query: {} });
    expect(feed.data!.items).toContainEqual(
      expect.objectContaining({ action: 'agent_started', actorUserId: agent.userId }),
    );
    expect(feed.data!.items).toContainEqual(
      expect.objectContaining({
        action: 'agent_finished',
        payload: { subject: { value: 'failed' } },
        actorUserId: agent.userId,
      }),
    );
  });

  it("mixes the agent's own instructions into the system prompt", async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await asOwner
      .teams({ teamId: await teamOf(asOwner, 'MKT') })
      ['ai-agents']({ agentId: agent.id })
      .patch({ instructions: 'Always answer in German.' });
    await queueRun(asOwner, columnId, agent.username);

    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
    expect(run.systemPrompt).toContain('Always answer in German.');
    expect(run.systemPrompt).toContain('Marketing');
  });

  it('mixes project-wide and agent-specific instructions into the system prompt', async () => {
    const { asOwner, asRunner, agent, columnId, projectId, teamId } = await setup();
    await db.insert(organizationProjectAssignment).values({
      teamId,
      projectId,
      instructions: 'Use the approved release checklist.',
    });
    await asOwner
      .projects({ projectKey: 'MKT' })
      .members({ userId: agent.userId })
      .description.patch({ description: 'Report completed checks to the project coordinator.' });
    await queueRun(asOwner, columnId, agent.username);

    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
    expect(run.systemPrompt).toContain('## Project scope: MKT');
    expect(run.systemPrompt).toContain('### Project-wide instructions');
    expect(run.systemPrompt).toContain('Use the approved release checklist.');
    expect(run.systemPrompt).toContain('### Your assignment in this project');
    expect(run.systemPrompt).toContain('Report completed checks to the project coordinator.');
  });

  it('returns null when the queue is empty', async () => {
    const { asRunner } = await setup();
    const res = await asRunner['agent-runs'].claim.post();
    expect(res.status).toBe(200);
    expect(res.data!.run).toBeNull();
  });

  it('hands a claimed run to no one else until its lease expires', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);

    expect((await asRunner['agent-runs'].claim.post()).data!.run).not.toBeNull();
    expect((await asRunner['agent-runs'].claim.post()).data!.run).toBeNull();
  });

  it('records a success and shows it in the run history', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    const res = await asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'success',
      output: 'Opened PR #12',
    });
    expect(res.status).toBe(200);
    // No session, so there is nothing for a reflection to continue.
    expect(res.data).toEqual({ reflection: null });

    const history = await asOwner
      .teams({ teamId: await teamOf(asOwner, 'MKT') })
      ['ai-agents']({ agentId: agent.id })
      .runs.get({ query: {} });
    expect(history.data!.items[0]).toMatchObject({
      id: run.id,
      status: 'success',
      output: 'Opened PR #12',
    });
  });

  it('records a failure with its error', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    await asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'failed',
      error: 'claude exited with 1',
    });

    const history = await asOwner
      .teams({ teamId: await teamOf(asOwner, 'MKT') })
      ['ai-agents']({ agentId: agent.id })
      .runs.get({ query: {} });
    expect(history.data!.items[0]).toMatchObject({
      status: 'failed',
      lastError: 'claude exited with 1',
    });
  });

  it('rejects a result for a run that is already finished', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
    await asRunner['agent-runs']({ runId: run.id }).result.post({ status: 'success' });

    const res = await asRunner['agent-runs']({ runId: run.id }).result.post({ status: 'success' });
    expect(res.status).toBe(404);
  });

  it("rejects another agent's run", async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
    const other = await createAgent(asOwner, 'MKT', {
      name: 'Other Bot',
      username: 'other',
      kind: 'external',
    });
    const asOtherRunner = apiKeyApi(other.data!.apiKey!);

    expect(
      (await asOtherRunner['agent-runs']({ runId: run.id }).result.post({ status: 'success' }))
        .status,
    ).toBe(404);
    expect((await asOtherRunner['agent-runs']({ runId: run.id }).heartbeat.post()).status).toBe(
      404,
    );
  });

  it('keeps a claimed run leased through a heartbeat', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    for (let beat = 0; beat < 2; beat++) {
      const res = await asRunner['agent-runs']({ runId: run.id }).heartbeat.post();
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ canceled: false });
    }
  });

  it('answers canceled on the heartbeat of a run canceled while it executes', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    const issue = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Team task' })
    ).data!;
    await controlApi().internal.orchestration['agent-run'].post({
      projectRef: 'project:MKT',
      task: { taskRef: `task:MKT-${issue.sequenceNumber}` },
      agent: { agentRef: `agent:${agent.username}` },
      idempotencyKey: 'a'.repeat(64),
      prompt: 'Complete the assignment.',
      policy: { leaseSeconds: 300, heartbeatSeconds: 60, maxAttempts: 3 },
    });
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    await controlApi().internal.orchestration['agent-run'].cancel.post({
      runId: run.id,
      projectRef: 'project:MKT',
    });

    const beat = await asRunner['agent-runs']({ runId: run.id }).heartbeat.post();
    expect(beat.status).toBe(200);
    expect(beat.data).toEqual({ canceled: true });
    const result = await asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'success',
      output: 'Too late',
    });
    expect(result.status).toBe(404);
  });

  it('refuses the heartbeat of a run that finished', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
    await asRunner['agent-runs']({ runId: run.id }).result.post({ status: 'success' });

    expect((await asRunner['agent-runs']({ runId: run.id }).heartbeat.post()).status).toBe(404);
  });

  it('records presence on the agent when its runner polls', async () => {
    const { asOwner, asRunner, agent } = await setup();
    expect(
      (
        await asOwner
          .teams({ teamId: await teamOf(asOwner, 'MKT') })
          ['ai-agents']({ agentId: agent.id })
          .get()
      ).data!.lastSeenAt,
    ).toBeNull();

    await asRunner['agent-runs'].claim.post();

    const after = await asOwner
      .teams({ teamId: await teamOf(asOwner, 'MKT') })
      ['ai-agents']({ agentId: agent.id })
      .get();
    expect(after.data!.lastSeenAt).not.toBeNull();
  });

  describe('leases', () => {
    // A lease of one second, waited out, is how these tests make a claimed run claimable
    // again without waiting for a real lease.
    function withShortLease(maxAttempts = '3') {
      process.env.AGENT_RUN_LEASE_SECONDS = '1';
      process.env.AGENT_RUN_MAX_ATTEMPTS = maxAttempts;
    }
    const leaseRunsOut = () => Bun.sleep(1_100);
    afterEach(() => {
      delete process.env.AGENT_RUN_LEASE_SECONDS;
      delete process.env.AGENT_RUN_MAX_ATTEMPTS;
    });

    it('stops a runner whose run was claimed again, and takes the result of the new claim', async () => {
      const { asOwner, asRunner, agent, columnId } = await setup();
      await queueRun(asOwner, columnId, agent.username);
      withShortLease();
      const first = (await asRunner['agent-runs'].claim.post()).data!.run!;
      await leaseRunsOut();
      const second = (await asRunner['agent-runs'].claim.post()).data!.run!;
      expect(second).toMatchObject({ id: first.id, attempts: 2, claim: 2 });
      const runs = asRunner['agent-runs']({ runId: first.id });

      const stale = await runs.heartbeat.post(undefined, { query: { claim: 1 } });
      expect(stale.data).toEqual({ canceled: true });
      const late = await runs.result.post({ status: 'success' }, { query: { claim: 1 } });
      expect(late.status).toBe(404);
      const current = await runs.result.post(
        { status: 'success', output: 'Done once' },
        { query: { claim: 2 } },
      );
      expect(current.status).toBe(200);
      expect(current.data!.reflection).toBeNull();
    });

    it('extends a lease that ran out while nobody claimed the run', async () => {
      const { asOwner, asRunner, agent, columnId } = await setup();
      await queueRun(asOwner, columnId, agent.username);
      withShortLease();
      const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
      await leaseRunsOut();
      delete process.env.AGENT_RUN_LEASE_SECONDS;

      const beat = await asRunner['agent-runs']({ runId: run.id }).heartbeat.post(undefined, {
        query: { claim: 1 },
      });
      expect(beat.data).toEqual({ canceled: false });
      expect((await asRunner['agent-runs'].claim.post()).data!.run).toBeNull();
    });

    it('stops a runner whose run finished under another claim', async () => {
      const { asOwner, asRunner, agent, columnId } = await setup();
      await queueRun(asOwner, columnId, agent.username);
      const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
      await asRunner['agent-runs']({ runId: run.id }).result.post({ status: 'success' });

      const beat = await asRunner['agent-runs']({ runId: run.id }).heartbeat.post(undefined, {
        query: { claim: 1 },
      });
      expect(beat.data).toEqual({ canceled: true });
    });

    it('hands a released run back at once without counting the attempt, as interrupted', async () => {
      const { asOwner, asRunner, agent, columnId } = await setup();
      await queueRun(asOwner, columnId, agent.username);
      const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
      const runs = asRunner['agent-runs']({ runId: run.id });

      expect((await runs.release.post({}, { query: { claim: 2 } })).status).toBe(404);
      expect((await runs.release.post({}, { query: { claim: 1 } })).status).toBe(204);
      const again = (await asRunner['agent-runs'].claim.post()).data!.run!;
      expect(again).toMatchObject({ id: run.id, attempts: 1, claim: 2 });
      const stale = await runs.heartbeat.post(undefined, { query: { claim: 1 } });
      expect(stale.data).toEqual({ canceled: true });
      expect(run.systemPrompt).not.toContain('Interrupted run');
      expect(again.systemPrompt).toContain('Interrupted run');
    });

    it('tells the agent that an earlier attempt was interrupted', async () => {
      const { asOwner, asRunner, agent, columnId } = await setup();
      await queueRun(asOwner, columnId, agent.username);
      withShortLease();
      const first = (await asRunner['agent-runs'].claim.post()).data!.run!;
      await leaseRunsOut();
      const second = (await asRunner['agent-runs'].claim.post()).data!.run!;
      expect(first.systemPrompt).not.toContain('Interrupted run');
      expect(second.systemPrompt).toContain('Interrupted run');
    });

    it('fails a run whose runner never came back', async () => {
      const { asOwner, asRunner, agent, columnId } = await setup();
      const issue = await queueRun(asOwner, columnId, agent.username);
      withShortLease('1');
      await asRunner['agent-runs'].claim.post();
      await leaseRunsOut();

      expect(await expireExhaustedRuns()).toBe(1);
      const history = await asOwner
        .teams({ teamId: await teamOf(asOwner, 'MKT') })
        ['ai-agents']({ agentId: agent.id })
        .runs.get({ query: {} });
      expect(history.data!.items[0]).toMatchObject({
        issueId: issue.id,
        status: 'failed',
        lastError: 'Runner did not report a result',
      });
      expect(await expireExhaustedRuns()).toBe(0);
    });

    it('fences the run-janitor: two of it racing on the same exhausted run fails it once', async () => {
      const { asOwner, asRunner, agent, columnId } = await setup();
      const issue = await queueRun(asOwner, columnId, agent.username);
      withShortLease('1');
      await asRunner['agent-runs'].claim.post();
      await leaseRunsOut();

      // Both calls see the run as pending before either commits; Postgres serializes the
      // two UPDATEs on the row, and the second re-checks status = 'pending' once it gets
      // the lock, so only the first still matches it.
      const failedCounts = await Promise.all([expireExhaustedRuns(), expireExhaustedRuns()]);
      expect(failedCounts.reduce((sum, count) => sum + count, 0)).toBe(1);

      const feed = await asOwner.issues({ issueId: issue.id }).feed.get({ query: {} });
      const finishedEntries = feed.data!.items.filter((item) => item.action === 'agent_finished');
      expect(finishedEntries).toHaveLength(1);
    });

    it('lets one of two runners claiming at once take the run', async () => {
      const { asOwner, asRunner, agent, columnId } = await setup();
      await queueRun(asOwner, columnId, agent.username);
      const claims = await Promise.all(
        Array.from({ length: 4 }, () => asRunner['agent-runs'].claim.post()),
      );
      expect(claims.filter((claim) => claim.data!.run !== null)).toHaveLength(1);
    });
  });

  it('refuses a caller that is not an agent', async () => {
    const { asOwner } = await setup();
    expect((await asOwner['agent-runs'].claim.post()).status).toBe(403);
  });
});

// A reflection is a short follow-up turn, in the run's own session, in which the agent
// keeps what the run taught it. Plan decides whether one is worth it from the agent's
// policy and the run, and the runner reports it back on its own route.
describe('run reflection', () => {
  beforeEach(async () => {
    await resetDb();
  });

  const basePolicy = {
    reasoningEffort: null,
    toolAllow: [],
    toolDeny: [],
    mcpGrants: [],
    files: [],
  };

  async function setPolicy(
    asOwner: Api,
    teamId: number,
    agentId: number,
    patch: Record<string, unknown>,
  ) {
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId })
      .patch({ runtimePolicy: { ...basePolicy, ...patch } });
  }

  it('asks for a reflection after a run of many tool calls, the default mode', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    const res = await asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'success',
      output: 'Done',
      sessionId: 'sess-1',
      toolCalls: 10,
    });
    expect(res.data!.reflection).toEqual({
      prompt: expect.any(String),
      maxTurns: 8,
      runBudgetSeconds: 120,
    });

    const history = await asOwner
      .teams({ teamId: await teamOf(asOwner, 'MKT') })
      ['ai-agents']({ agentId: agent.id })
      .runs.get({ query: {} });
    expect(history.data!.items[0].reflection).toMatchObject({
      status: 'pending',
      reason: 'complex',
      saved: [],
    });
  });

  it('asks for none after a short, successful run with no session', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    const res = await asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'success',
      toolCalls: 2,
    });
    expect(res.data!.reflection).toBeNull();
  });

  it('asks for a reflection after a failed run that made a tool call, never for one that made none', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const providerFailure = (await asRunner['agent-runs'].claim.post()).data!.run!;
    const failedAtWork = await asRunner['agent-runs']({ runId: providerFailure.id }).result.post({
      status: 'failed',
      error: 'network error',
      sessionId: 'sess-2',
      toolCalls: 0,
    });
    expect(failedAtWork.data!.reflection).toBeNull();

    await queueRun(asOwner, columnId, agent.username);
    const failed = (await asRunner['agent-runs'].claim.post()).data!.run!;
    const res = await asRunner['agent-runs']({ runId: failed.id }).result.post({
      status: 'failed',
      error: 'wrote the wrong file',
      sessionId: 'sess-3',
      toolCalls: 1,
    });
    expect(res.data!.reflection).not.toBeNull();
  });

  it('asks for a reflection on rework, in failure mode too, whatever the tool calls', async () => {
    const { asOwner, asRunner, agent, columnId, teamId } = await setup();
    await setPolicy(asOwner, teamId, agent.id, { reflection: 'failure' });
    const issue = await queueRun(asOwner, columnId, agent.username);
    const first = (await asRunner['agent-runs'].claim.post()).data!.run!;
    await asRunner['agent-runs']({ runId: first.id }).result.post({
      status: 'success',
      sessionId: 'sess-4',
      toolCalls: 1,
    });

    await asOwner.issues({ issueId: issue.id }).comments.post({
      body: `please try again @${agent.username}`,
    });
    const rework = (await asRunner['agent-runs'].claim.post()).data!.run!;
    const res = await asRunner['agent-runs']({ runId: rework.id }).result.post({
      status: 'success',
      sessionId: 'sess-5',
      toolCalls: 1,
    });
    expect(res.data!.reflection).not.toBeNull();

    // 'failure' mode never reflects on a merely long, successful first run.
    const other = await queueRun(asOwner, columnId, agent.username);
    const long = (await asRunner['agent-runs'].claim.post()).data!.run!;
    const longRes = await asRunner['agent-runs']({ runId: long.id }).result.post({
      status: 'success',
      sessionId: 'sess-6',
      toolCalls: 50,
    });
    expect(longRes.data!.reflection).toBeNull();
    void other;
  });

  it("asks for none with the agent's policy set to 'off'", async () => {
    const { asOwner, asRunner, agent, columnId, teamId } = await setup();
    await setPolicy(asOwner, teamId, agent.id, { reflection: 'off' });
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    const res = await asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'success',
      sessionId: 'sess-7',
      toolCalls: 50,
    });
    expect(res.data!.reflection).toBeNull();
  });

  it("asks for none with the agent's own learning turned off", async () => {
    const { asOwner, asRunner, agent, columnId, teamId } = await setup();
    await setPolicy(asOwner, teamId, agent.id, { learning: false });
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    const res = await asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'success',
      sessionId: 'sess-8',
      toolCalls: 50,
    });
    expect(res.data!.reflection).toBeNull();
  });

  it('records what the runner reports back, and adds its tokens to the run', async () => {
    const { asOwner, asRunner, agent, columnId, teamId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
    await asRunner['agent-runs']({ runId: run.id }).result.post({
      status: 'success',
      sessionId: 'sess-9',
      toolCalls: 10,
      usage: { inputTokens: 1000, outputTokens: 200 },
    });

    const res = await asRunner['agent-runs']({ runId: run.id }).reflection.post({
      status: 'success',
      usage: { inputTokens: 300, outputTokens: 40 },
      saved: [{ tool: 'memory', action: 'write', target: 'MEMORY.md' }],
      summary: 'Saved a note about the API shape.',
    });
    expect(res.status).toBe(204);

    const history = await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .runs.get({ query: {} });
    const found = history.data!.items[0];
    expect(found.reflection).toMatchObject({
      status: 'success',
      saved: [{ tool: 'memory', action: 'write', target: 'MEMORY.md' }],
      summary: 'Saved a note about the API shape.',
      tokens: 340,
    });
    // The reflection's tokens are added to the run's own.
    expect(found.contextTokens).toBe(1000 + 200 + 300 + 40);
  });

  it('refuses a second report of the same reflection, and one that was never asked for', async () => {
    const { asOwner, asRunner, agent, columnId } = await setup();
    await queueRun(asOwner, columnId, agent.username);
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    // Never asked: the run finished with no session for a reflection to continue.
    await asRunner['agent-runs']({ runId: run.id }).result.post({ status: 'success' });
    expect(
      (
        await asRunner['agent-runs']({ runId: run.id }).reflection.post({
          status: 'success',
          usage: null,
          saved: [],
        })
      ).status,
    ).toBe(404);

    await queueRun(asOwner, columnId, agent.username);
    const other = (await asRunner['agent-runs'].claim.post()).data!.run!;
    await asRunner['agent-runs']({ runId: other.id }).result.post({
      status: 'success',
      sessionId: 'sess-10',
      toolCalls: 10,
    });
    const first = await asRunner['agent-runs']({ runId: other.id }).reflection.post({
      status: 'success',
      usage: null,
      saved: [],
    });
    expect(first.status).toBe(204);
    const second = await asRunner['agent-runs']({ runId: other.id }).reflection.post({
      status: 'failed',
      usage: null,
      saved: [],
      error: 'too late',
    });
    expect(second.status).toBe(404);
  });
});
