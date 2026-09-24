import { beforeEach, describe, expect, it } from 'bun:test';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';

// Whether an agent's runtime runs on its settings: the runner reports the revision it
// applied and what it read back from the runtime profile; Helena compares that with the
// agent's current settings, and "Neu schreiben" reaches the runner as an action.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const project = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Coder',
    username: 'coder',
    kind: 'external',
    triggerOnMention: true,
  });
  const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
  return {
    asOwner,
    teamId: project.data!.teamId,
    agentId: created.data!.agent.id,
    username: created.data!.agent.username,
    columnId: view.columns[0].id,
    asRunner: apiKeyApi(created.data!.apiKey!),
  };
}

const profile = (drift: { key: string; code: string; detail?: string }[] = []) => ({
  hash: `sha256:${'a'.repeat(64)}`,
  checkedAt: new Date().toISOString(),
  drift,
  defaults: { model: 'gpt-5.6-luna', provider: 'openai-codex', reasoning: 'low' },
  mcpServers: [
    { name: 'itsaplan', enabled: true, managed: true },
    { name: 'browser-harness', enabled: false, managed: false },
  ],
});

type StatusBody = Parameters<Api['agent-runtime']['status']['post']>[0];

async function report(asRunner: Api, appliedRevision: string, extra: Partial<StatusBody> = {}) {
  return asRunner['agent-runtime'].status.post({
    adapter: 'hermes',
    status: 'online',
    appliedRevision,
    capabilities: ['profile-drift'],
    detail: null,
    ...extra,
  } as StatusBody);
}

const sync = (api: Api, teamId: number, agentId: number) =>
  api.teams({ teamId })['ai-agents']({ agentId })['runtime-sync'];

describe('agent runtime sync', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('is offline without a runner, pending until it applied, then synced or drifted', async () => {
    const { asOwner, asRunner, teamId, agentId } = await setup();
    expect((await sync(asOwner, teamId, agentId).get()).data!.state).toBe('offline');

    const policy = (await asRunner['agent-runtime'].policy.get()).data!;
    await report(asRunner, 'sha256:older', { profile: profile() } as Partial<StatusBody>);
    expect((await sync(asOwner, teamId, agentId).get()).data).toMatchObject({
      state: 'pending',
      revision: policy.revision,
      appliedRevision: 'sha256:older',
    });

    await report(asRunner, policy.revision, { profile: profile() } as Partial<StatusBody>);
    const synced = (await sync(asOwner, teamId, agentId).get()).data!;
    expect(synced.state).toBe('synced');
    expect(synced.profile?.defaults?.model).toBe('gpt-5.6-luna');

    await report(asRunner, policy.revision, {
      profile: profile([
        { key: 'mcp_servers.browser-harness', code: 'mcp-differs', detail: 'env.BU_CDP_URL' },
      ]),
    } as Partial<StatusBody>);
    const drifted = (await sync(asOwner, teamId, agentId).get()).data!;
    expect(drifted.state).toBe('drift');
    expect(drifted.profile?.drift).toEqual([
      { key: 'mcp_servers.browser-harness', code: 'mcp-differs', detail: 'env.BU_CDP_URL' },
    ]);
    // The agent's own read shows the same report.
    const agent = (await asOwner.teams({ teamId })['ai-agents']({ agentId }).get()).data!;
    expect(agent.runtimeState.profile?.drift).toHaveLength(1);
  });

  it('hands "Neu schreiben" to the runner once and forgets it when done', async () => {
    const { asOwner, asRunner, teamId, agentId } = await setup();
    const before = (await asRunner['agent-runtime'].policy.get()).data!;

    const queued = await sync(asOwner, teamId, agentId).rewrite.post();
    expect(queued.status).toBe(200);
    expect(queued.data!.rewritePending).toBe(true);
    // Twice is still one request.
    await sync(asOwner, teamId, agentId).rewrite.post();

    const policy = (await asRunner['agent-runtime'].policy.get()).data!;
    expect(policy.revision).not.toBe(before.revision);
    expect(policy.actions).toEqual([{ id: expect.any(Number), kind: 'rewrite-profile' }]);

    await report(asRunner, policy.revision, {
      actions: [{ id: policy.actions[0]!.id, error: null }],
    } as Partial<StatusBody>);
    expect((await asRunner['agent-runtime'].policy.get()).data!.actions).toEqual([]);
    expect((await sync(asOwner, teamId, agentId).get()).data!.rewritePending).toBe(false);
  });

  it('shows a run whose session ran on another model or reasoning', async () => {
    const { asOwner, asRunner, teamId, agentId, username, columnId } = await setup();
    const issue = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Fix it' })
    ).data!;
    await asOwner.issues({ issueId: issue.id }).comments.post({ body: `please @${username}` });
    const run = (await asRunner['agent-runs'].claim.post()).data!.run!;

    const result = await asRunner['agent-runs']({ runId: run.id }).result.post(
      {
        status: 'success',
        output: 'done',
        runtime: {
          requested: { model: null, reasoning: 'high' },
          defaults: { model: 'gpt-5.6-luna', provider: 'openai-codex', reasoning: 'low' },
          used: { model: 'gpt-5.6-luna', reasoning: 'low', provider: 'openai-codex' },
        },
      },
      { query: { claim: run.claim } },
    );
    expect(result.status).toBe(200);

    const runs = (await asOwner.teams({ teamId })['ai-agents']({ agentId }).runs.get()).data!;
    expect(runs.items[0]?.modelCheck).toEqual({
      configured: { model: 'gpt-5.6-luna', reasoning: 'high', source: 'default' },
      used: { model: 'gpt-5.6-luna', reasoning: 'low', provider: 'openai-codex' },
      mismatch: ['reasoning'],
    });
  });

  it('refuses a rewrite of a template, which runs nowhere', async () => {
    const { asOwner, teamId } = await setup();
    const template = await asOwner.teams({ teamId })['ai-agents'].post({
      name: 'Pool coder',
      username: 'pool-coder',
      kind: 'external',
      template: true,
    });
    const id = template.data!.agent.id;
    expect((await sync(asOwner, teamId, id).rewrite.post()).status).toBe(409);
    expect((await sync(asOwner, teamId, id).get()).data!.state).toBe('unknown');
  });
});
