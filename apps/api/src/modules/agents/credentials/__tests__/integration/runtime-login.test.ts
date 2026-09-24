import { describe, it, expect, beforeEach } from 'bun:test';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';

// A "Laufzeit-Anmeldung": the login of the Claude Code or Codex runtime of the agents it is
// granted to. The owner stores it in Zugänge; an agent's runner receives it for the run or
// chat answer it holds and hands it to that one command (packages/runner/src/cli-login.ts).

process.env.AGENT_CHAT_CLAIM_WAIT_MS = '50';
process.env.AGENT_CHAT_CLAIM_POLL_MS = '10';

const TOKEN = 'sk-ant-oat01-the-owners-setup-token-4711';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const mkt = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  return { asOwner, teamId: mkt.teamId, projectId: mkt.id };
}

const credentials = (api: Api, teamId: number) => api.teams({ teamId }).credentials;

async function agentOn(
  asOwner: Api,
  teamId: number,
  username: string,
  runtime: 'hermes' | 'claude' | 'codex',
) {
  const created = await createAgent(asOwner, 'MKT', {
    name: `Agent ${username}`,
    username,
    kind: 'external',
    triggerOnMention: true,
  });
  const agent = created.data!.agent;
  const route = asOwner.teams({ teamId })['ai-agents']({ agentId: agent.id });
  const policy = (await route.get()).data!.runtimePolicy;
  await route.patch({ runtimePolicy: { ...policy, runtime } });
  return { ...agent, asRunner: apiKeyApi(created.data!.apiKey!) };
}

async function claimedRun(asOwner: Api, agent: { username: string; asRunner: Api }) {
  const columnId = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!.columns[0].id;
  const issue = (
    await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Build it' })
  ).data!;
  await asOwner.issues({ issueId: issue.id }).comments.post({ body: `go @${agent.username}` });
  return (await agent.asRunner['agent-runs'].claim.post()).data!.run!;
}

const runtimeLogin = (agent: { asRunner: Api }, query: { runId?: number } = {}) =>
  agent.asRunner['agent-runtime']['runtime-login'].get({ query });

describe('runtime logins', () => {
  beforeEach(resetDb);

  it('stores a Claude Code token and never returns it', async () => {
    const { asOwner, teamId } = await setup();
    const res = await credentials(asOwner, teamId).post({
      kind: 'runtime_login',
      label: 'Claude Code (Max)',
      runtime: 'claude',
      method: 'oauth_token',
      value: TOKEN,
    });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      kind: 'runtime_login',
      runtime: 'claude',
      method: 'oauth_token',
      secrets: ['value'],
    });
    const list = await credentials(asOwner, teamId).get({ query: { kind: 'runtime_login' } });
    expect(list.data).toMatchObject({ total: 1 });
    expect(JSON.stringify([res.data, list.data])).not.toContain(TOKEN);
  });

  it('checks the runtime and how it signs in', async () => {
    const { asOwner, teamId } = await setup();
    const post = (body: Record<string, unknown>) =>
      credentials(asOwner, teamId).post({
        kind: 'runtime_login',
        label: 'Login',
        ...body,
      } as never);
    for (const body of [
      { method: 'oauth_token', value: 'x' },
      { runtime: 'claude', value: 'x' },
      { runtime: 'claude', method: 'oauth_token' },
      { runtime: 'claude', method: 'oauth_token', value: '   ' },
      // Codex' ChatGPT login is made on the agent's own runtime, not stored here.
      { runtime: 'codex', method: 'oauth_token', value: 'x' },
      { runtime: 'claude', method: 'oauth_token', value: 'x', username: 'u' },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect((await post({ runtime: 'codex', method: 'api_key', value: 'sk-proj-x' })).status).toBe(
      201,
    );
  });

  it('is granted only to agents that run on its runtime', async () => {
    const { asOwner, teamId } = await setup();
    const hermes = await agentOn(asOwner, teamId, 'writer', 'hermes');
    const claude = await agentOn(asOwner, teamId, 'coder', 'claude');
    const id = (
      await credentials(asOwner, teamId).post({
        kind: 'runtime_login',
        label: 'Claude Code',
        runtime: 'claude',
        method: 'oauth_token',
        value: TOKEN,
      })
    ).data!.id;
    const grants = asOwner.teams({ teamId }).credentials({ credentialId: id }).grants;
    expect((await grants.put({ agentIds: [hermes.id] })).status).toBe(400);
    const granted = await grants.put({ agentIds: [claude.id] });
    expect(granted.data!.grants.map((grant) => grant.agentId)).toEqual([claude.id]);
  });

  it("hands the runner the agent's login for the run it holds, and only then its value", async () => {
    const { asOwner, teamId } = await setup();
    const coder = await agentOn(asOwner, teamId, 'coder', 'claude');
    const other = await agentOn(asOwner, teamId, 'tester', 'claude');
    const id = (
      await credentials(asOwner, teamId).post({
        kind: 'runtime_login',
        label: 'Claude Code',
        runtime: 'claude',
        method: 'oauth_token',
        value: TOKEN,
      })
    ).data!.id;
    await asOwner
      .teams({ teamId })
      .credentials({ credentialId: id })
      .grants.put({
        agentIds: [coder.id],
      });

    // Without work: only whether one is granted, for the agent's health.
    const state = await runtimeLogin(coder);
    expect(state.data).toEqual({
      login: { credentialId: id, runtime: 'claude', method: 'oauth_token' },
    });
    expect((await runtimeLogin(other)).data).toEqual({ login: null });

    const run = await claimedRun(asOwner, coder);
    const delivered = await runtimeLogin(coder, { runId: run.id });
    expect(delivered.data!.login).toEqual({
      credentialId: id,
      runtime: 'claude',
      method: 'oauth_token',
      value: TOKEN,
    });
    // Another agent's run is not this runner's to name.
    expect((await runtimeLogin(other, { runId: run.id })).status).toBe(404);

    const uses = await asOwner.teams({ teamId }).credentials({ credentialId: id }).uses.get({
      query: {},
    });
    // Newest first: the delivery, then the owner's grant and creation.
    expect(uses.data!.items).toEqual([
      expect.objectContaining({ action: 'delivered', purpose: 'runtime:claude', runId: run.id }),
      expect.objectContaining({ action: 'changed', purpose: 'grants' }),
      expect.objectContaining({ action: 'changed', purpose: 'created' }),
    ]);
  });

  it('reaches the agents of a project through a project grant, on their runtime only', async () => {
    const { asOwner, teamId, projectId } = await setup();
    const coder = await agentOn(asOwner, teamId, 'coder', 'claude');
    const writer = await agentOn(asOwner, teamId, 'writer', 'hermes');
    const id = (
      await credentials(asOwner, teamId).post({
        kind: 'runtime_login',
        label: 'Claude Code',
        runtime: 'claude',
        method: 'oauth_token',
        value: TOKEN,
      })
    ).data!.id;
    const put = await asOwner
      .teams({ teamId })
      .credentials({ credentialId: id })
      .grants.put({ grants: [{ projectId }] });
    expect(put.status).toBe(200);
    expect((await runtimeLogin(coder)).data).toEqual({
      login: { credentialId: id, runtime: 'claude', method: 'oauth_token' },
    });
    expect((await runtimeLogin(writer)).data).toEqual({ login: null });
  });

  it('gives a Hermes agent none, and none of another runtime', async () => {
    const { asOwner, teamId } = await setup();
    const codex = await agentOn(asOwner, teamId, 'coder', 'codex');
    const id = (
      await credentials(asOwner, teamId).post({
        kind: 'runtime_login',
        label: 'Claude Code',
        runtime: 'claude',
        method: 'api_key',
        value: 'sk-ant-api03-x',
      })
    ).data!.id;
    // Granted while the agent ran on Claude Code, then switched to Codex.
    const route = asOwner.teams({ teamId })['ai-agents']({ agentId: codex.id });
    const policy = (await route.get()).data!.runtimePolicy;
    await route.patch({ runtimePolicy: { ...policy, runtime: 'claude' } });
    await asOwner
      .teams({ teamId })
      .credentials({ credentialId: id })
      .grants.put({
        agentIds: [codex.id],
      });
    await route.patch({ runtimePolicy: { ...policy, runtime: 'codex' } });
    expect((await runtimeLogin(codex)).data).toEqual({ login: null });
  });
});

describe("a Claude Code or Codex agent's SOUL", () => {
  beforeEach(resetDb);

  it('speaks of its own runtime, not of Hermes', async () => {
    const { asOwner, teamId } = await setup();
    const coder = await agentOn(asOwner, teamId, 'coder', 'claude');
    // A website login granted to it reaches no vault of its runtime, so it is not offered.
    const login = (
      await credentials(asOwner, teamId).post({
        kind: 'web_login',
        label: 'GitHub',
        loginUrl: 'https://github.com/login',
        username: 'bot@example.com',
        password: 'pw-4711',
      })
    ).data!.id;
    await asOwner
      .teams({ teamId })
      .credentials({ credentialId: login })
      .grants.put({
        agentIds: [coder.id],
      });
    const policy = (await coder.asRunner['agent-runtime'].policy.get()).data!;
    const soul = policy.runtimePolicy.files.find((file) => file.path === 'SOUL.md')!.content;
    expect(soul).not.toContain('Hermes vault');
    expect(soul).not.toContain('browser_vault_fill');
    expect(policy.webLogins).toBe(true);
  });
});
