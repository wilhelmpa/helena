import { describe, it, expect, beforeEach } from 'bun:test';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent, teamOf } from '#tests/helpers/agents';
import { controlApi } from '#tests/helpers/control';
import { db, organizationProjectAssignment } from '@repo/db';

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

  it('serves a secret-free runtime policy and records generic adapter status', async () => {
    const { asOwner, asRunner, agent, teamId } = await setup();
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({
        model: 'openai/gpt-5.6-sol',
        memoryEnabled: true,
        memoryLastMessages: 20,
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
      memory: { enabled: true, lastMessages: 20 },
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

    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({ instructions: 'Always answer in English.' });
    const second = await asRunner['agent-runtime'].policy.get();
    expect(second.data!.revision).not.toBe(first.data!.revision);
    expect(second.data!.runtimePolicy.files[0].content).toContain('Always answer in English.');
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
    expect(res.status).toBe(204);

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

  it('refuses a caller that is not an agent', async () => {
    const { asOwner } = await setup();
    expect((await asOwner['agent-runs'].claim.post()).status).toBe(403);
  });

  it('hands a scheduled run to the runner with the task as its prompt', async () => {
    const { asOwner, asRunner, agent } = await setup();
    const schedule = await asOwner.projects({ projectKey: 'MKT' })['agent-schedules'].post({
      agentId: agent.id,
      name: 'Nightly triage',
      prompt: 'Triage the new issues.',
      cron: '0 9 * * *',
    });
    expect(schedule.status).toBe(201);
    await asOwner
      .projects({ projectKey: 'MKT' })
      ['agent-schedules']({ scheduleId: schedule.data!.id })
      .run.post();

    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;
    expect(run).toMatchObject({ trigger: 'manual', issueId: null, issueIdentifier: null });
    expect(run.prompt).toContain('Triage the new issues.');
  });
});
