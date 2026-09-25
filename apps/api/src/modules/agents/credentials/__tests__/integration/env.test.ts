import { describe, it, expect, beforeEach } from 'bun:test';
import { db, agentChatEvent, agentChatMessage, agentRun } from '@repo/db';
import { eq } from 'drizzle-orm';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { envNameProblem, resolveEnvCandidates } from '../../env';

// Credentials as environment variables (docs/helena-decisions/agent-env.md): an API key or
// secret with a variable name, and a plain variable, reach the commands of the agents they
// are granted to for one run or chat answer, and never come back in what Helena stores.

process.env.AGENT_CHAT_CLAIM_WAIT_MS = '50';
process.env.AGENT_CHAT_CLAIM_POLL_MS = '10';
process.env.AGENT_RUNTIME_REQUEST_ANSWER_POLL_MS = '10';

const VERVE_TOKEN = 'verve-cloudflare-token-0123456789abcdef';
const VOL_TOKEN = 'vol-cloudflare-token-abcdef0123456789';
const TEAM_TOKEN = 'team-cloudflare-token-9876543210fedcba';
const ACCOUNT = '42a48d019d819276f79d3cf42750689b';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const verve = (await asOwner.projects.post({ key: 'VERVE', name: 'Verve' })).data!;
  const vol = (await asOwner.projects.post({ key: 'VOL', name: 'Volition' })).data!;
  return { asOwner, teamId: verve.teamId, verve, vol };
}

const credentials = (api: Api, teamId: number) => api.teams({ teamId }).credentials;
const credential = (api: Api, teamId: number, credentialId: number) =>
  api.teams({ teamId }).credentials({ credentialId });

async function externalAgent(asOwner: Api, username: string, projectKey: string) {
  const created = await createAgent(asOwner, projectKey, {
    name: `Agent ${username}`,
    username,
    kind: 'external',
    triggerOnMention: true,
  });
  return { ...created.data!.agent, asRunner: apiKeyApi(created.data!.apiKey!) };
}

async function claimedRun(
  asOwner: Api,
  projectKey: string,
  agent: { username: string; asRunner: Api },
) {
  const columnId = (await asOwner.projects({ projectKey }).get()).data!.columns[0].id;
  const issue = (
    await asOwner.projects({ projectKey }).issues.post({ columnId, title: 'Deploy the worker' })
  ).data!;
  await asOwner.issues({ issueId: issue.id }).comments.post({ body: `deploy @${agent.username}` });
  return (await agent.asRunner['agent-runs'].claim.post()).data!.run!;
}

const runEnv = (agent: { asRunner: Api }, runId: number) =>
  agent.asRunner['agent-runs']({ runId }).env.get();

// VERVE's token and the account id as a plain variable, both for VERVE's agents.
async function cloudflareForVerve(asOwner: Api, teamId: number, verveId: number) {
  const token = await credentials(asOwner, teamId).post({
    kind: 'api_key',
    label: 'Cloudflare VERVE',
    projectId: verveId,
    value: VERVE_TOKEN,
    envName: 'CLOUDFLARE_API_TOKEN',
  });
  const account = await credentials(asOwner, teamId).post({
    kind: 'variable',
    label: 'Cloudflare account',
    value: ACCOUNT,
    envName: 'CLOUDFLARE_ACCOUNT_ID',
  });
  for (const id of [token.data!.id, account.data!.id]) {
    await credential(asOwner, teamId, id).grants.put({ grants: [{ projectId: verveId }] });
  }
  return { token: token.data!, account: account.data! };
}

describe('variable names', () => {
  it('takes capital names and refuses what the system, Helena or the runtimes set', () => {
    for (const name of [
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
      '_X',
      'WRANGLER_SEND_METRICS',
    ]) {
      expect(envNameProblem(name)).toBeNull();
    }
    for (const name of [
      'cloudflare_token',
      '1TOKEN',
      'A-B',
      'X'.repeat(65),
      'PATH',
      'HOME',
      'BASH_ENV',
      'LD_PRELOAD',
      'NODE_OPTIONS',
      'PYTHONPATH',
      'GIT_SSH_COMMAND',
      'ITSAPLAN_API_KEY',
      'HERMES_HOME',
      'HTTPS_PROXY',
      'NPM_CONFIG_REGISTRY',
      'ANTHROPIC_API_KEY',
      'TERMINAL_TEMP_DIR',
    ]) {
      expect(envNameProblem(name)).not.toBeNull();
    }
  });

  it("picks one credential per name: the work's project, then the agent's own, then the team's", () => {
    const candidates = [
      { id: 1, name: 'CLOUDFLARE_API_TOKEN', projectId: null, byAgent: false },
      { id: 2, name: 'CLOUDFLARE_API_TOKEN', projectId: 6, byAgent: false },
      { id: 3, name: 'CLOUDFLARE_API_TOKEN', projectId: 5, byAgent: false },
      { id: 4, name: 'OTHER_KEY', projectId: null, byAgent: true },
    ];
    expect(resolveEnvCandidates(candidates, 6).chosen.map((c) => c.id)).toEqual([2, 4]);
    expect(resolveEnvCandidates(candidates, 7).chosen.map((c) => c.id)).toEqual([1, 4]);
    // A chat outside any project with two projects' tokens: neither is taken.
    const noTeam = candidates.filter((c) => c.id !== 1);
    const outside = resolveEnvCandidates(noTeam, null);
    expect(outside.chosen.map((c) => c.id)).toEqual([4]);
    expect(outside.ambiguous.map((c) => c.id).sort()).toEqual([2, 3]);
  });
});

describe('credentials as environment variables', () => {
  beforeEach(resetDb);

  it('stores a variable name with a key, and a plain variable with its value', async () => {
    const { asOwner, teamId, verve } = await setup();
    const { token, account } = await cloudflareForVerve(asOwner, teamId, verve.id);
    expect(token).toMatchObject({
      kind: 'api_key',
      envName: 'CLOUDFLARE_API_TOKEN',
      value: null,
      secrets: ['value'],
    });
    expect(account).toMatchObject({
      kind: 'variable',
      envName: 'CLOUDFLARE_ACCOUNT_ID',
      value: ACCOUNT,
      secrets: [],
    });
    const list = await credentials(asOwner, teamId).get({ query: {} });
    expect(JSON.stringify(list.data)).not.toContain(VERVE_TOKEN);

    // A name is used once per scope; another project may use it for its own.
    const again = await credentials(asOwner, teamId).post({
      kind: 'secret',
      label: 'Second',
      projectId: verve.id,
      value: 'another-value-123456',
      envName: 'CLOUDFLARE_API_TOKEN',
    });
    expect(again.status).toBe(409);
    const vol = (await asOwner.projects({ projectKey: 'VOL' }).get()).data!.project.id;
    const forVol = await credentials(asOwner, teamId).post({
      kind: 'api_key',
      label: 'Cloudflare VOL',
      projectId: vol,
      value: VOL_TOKEN,
      envName: 'CLOUDFLARE_API_TOKEN',
    });
    expect(forVol.status).toBe(201);
    // Moving it into VERVE would collide there.
    expect(
      (await credential(asOwner, teamId, forVol.data!.id).patch({ projectId: verve.id })).status,
    ).toBe(409);

    // Refused names and kinds without one.
    for (const body of [
      { kind: 'api_key' as const, label: 'x', value: 'value-12345678', envName: 'PATH' },
      { kind: 'api_key' as const, label: 'x', value: 'value-12345678', envName: 'lower' },
      { kind: 'variable' as const, label: 'x', value: 'plain' },
      { kind: 'variable' as const, label: 'x', value: '  ', envName: 'SOME_VALUE' },
      {
        kind: 'web_login' as const,
        label: 'x',
        loginUrl: 'https://a.b',
        username: 'u',
        password: 'p',
        envName: 'X',
      },
    ]) {
      expect((await credentials(asOwner, teamId).post(body)).status).toBe(400);
    }

    // The name can be taken away again; the value stays.
    const cleared = await credential(asOwner, teamId, token.id).patch({ envName: null });
    expect(cleared.data).toMatchObject({ envName: null, secrets: ['value'] });
  });

  it("gives a run's runner the variables of its project, and the audit log says so", async () => {
    const { asOwner, teamId, verve } = await setup();
    const { token, account } = await cloudflareForVerve(asOwner, teamId, verve.id);
    const coder = await externalAgent(asOwner, 'coder-verve', 'VERVE');
    const other = await externalAgent(asOwner, 'coder-vol', 'VOL');

    const run = await claimedRun(asOwner, 'VERVE', coder);
    const res = await runEnv(coder, run.id);
    expect(res.status).toBe(200);
    expect(res.data!.variables).toEqual([
      {
        id: account.id,
        label: 'Cloudflare account',
        name: 'CLOUDFLARE_ACCOUNT_ID',
        value: ACCOUNT,
        secret: false,
        updatedAt: expect.any(Date),
      },
      {
        id: token.id,
        label: 'Cloudflare VERVE',
        name: 'CLOUDFLARE_API_TOKEN',
        value: VERVE_TOKEN,
        secret: true,
        updatedAt: expect.any(Date),
      },
    ]);

    // Only the runner that holds the run, only while it does, never a person.
    expect((await runEnv(other, run.id)).status).toBe(404);
    expect((await asOwner['agent-runs']({ runId: run.id }).env.get()).status).toBe(403);
    const volRun = await claimedRun(asOwner, 'VOL', other);
    expect((await runEnv(other, volRun.id)).data!.variables).toEqual([]);

    const log = await credential(asOwner, teamId, token.id).uses.get({ query: {} });
    expect(log.data!.items[0]).toMatchObject({
      action: 'delivered',
      purpose: 'env CLOUDFLARE_API_TOKEN',
      agentId: coder.id,
      runId: run.id,
    });

    await coder.asRunner['agent-runs']({ runId: run.id }).result.post(
      { status: 'success', output: 'done' },
      { query: { claim: run.claim } },
    );
    expect((await runEnv(coder, run.id)).status).toBe(404);
  });

  it("takes the project's own token over the team's, and none where two would fit", async () => {
    const { asOwner, teamId, verve, vol } = await setup();
    await cloudflareForVerve(asOwner, teamId, verve.id);
    const teamWide = await credentials(asOwner, teamId).post({
      kind: 'secret',
      label: 'Cloudflare (team)',
      value: TEAM_TOKEN,
      envName: 'CLOUDFLARE_API_TOKEN',
    });
    const volToken = await credentials(asOwner, teamId).post({
      kind: 'api_key',
      label: 'Cloudflare VOL',
      projectId: vol.id,
      value: VOL_TOKEN,
      envName: 'CLOUDFLARE_API_TOKEN',
    });
    await credential(asOwner, teamId, volToken.data!.id).grants.put({
      grants: [{ projectId: vol.id }],
    });
    const coder = await externalAgent(asOwner, 'coder-verve', 'VERVE');
    await credential(asOwner, teamId, teamWide.data!.id).grants.put({ agentIds: [coder.id] });

    const run = await claimedRun(asOwner, 'VERVE', coder);
    const token = (await runEnv(coder, run.id)).data!.variables.find(
      (variable) => variable.name === 'CLOUDFLARE_API_TOKEN',
    );
    expect(token?.value).toBe(VERVE_TOKEN);

    // An agent in both projects, asked in a chat outside either: the two project tokens fit
    // equally well, so neither is set, and the log says why.
    const both = await externalAgent(asOwner, 'helper', 'VERVE');
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: both.id })
      .projects.put({ projectIds: [verve.id, vol.id] });
    await asOwner.teams({ teamId })['ai-agents']({ agentId: both.id }).chat.post({ prompt: 'hi' });
    const outside = (await both.asRunner['agent-chats'].claim.post()).data!.message!;
    const inChat = await both.asRunner['agent-chats']({ messageId: outside.id }).env.get();
    expect(inChat.data!.variables.map((variable) => variable.name)).toEqual([
      'CLOUDFLARE_ACCOUNT_ID',
    ]);
    const log = await credential(asOwner, teamId, volToken.data!.id).uses.get({ query: {} });
    expect(log.data!.items[0]).toMatchObject({ action: 'denied', agentId: both.id });

    // In a chat inside VOL, VOL's own token.
    await asOwner
      .projects({ projectKey: 'VOL' })
      ['ai-agents']({ agentId: both.id })
      .chat.post({ prompt: 'deploy' });
    await both.asRunner['agent-chats']({ messageId: outside.id }).result.post({
      status: 'success',
    });
    const inVol = (await both.asRunner['agent-chats'].claim.post()).data!.message!;
    const volEnv = await both.asRunner['agent-chats']({ messageId: inVol.id }).env.get();
    expect(volEnv.data!.variables.find((v) => v.name === 'CLOUDFLARE_API_TOKEN')?.value).toBe(
      VOL_TOKEN,
    );
  });

  it('lists the names an agent or a project receives, never a value', async () => {
    const { asOwner, teamId, verve } = await setup();
    await cloudflareForVerve(asOwner, teamId, verve.id);
    const coder = await externalAgent(asOwner, 'coder-verve', 'VERVE');
    const environment = (query: { agentId?: number; projectId?: number }) =>
      asOwner.teams({ teamId })['agent-environment'].get({ query });
    const ofAgent = await environment({ agentId: coder.id });
    expect(ofAgent.status).toBe(200);
    expect(ofAgent.data!.variables.map((variable) => [variable.name, variable.secret])).toEqual([
      ['CLOUDFLARE_ACCOUNT_ID', false],
      ['CLOUDFLARE_API_TOKEN', true],
    ]);
    expect(ofAgent.data!.variables[1]).toMatchObject({
      label: 'Cloudflare VERVE',
      projectKey: 'VERVE',
      grants: [{ agentId: null, projectKey: 'VERVE' }],
    });
    const ofProject = await environment({ projectId: verve.id });
    expect(ofProject.data!.variables).toHaveLength(2);
    for (const body of [ofAgent.data, ofProject.data]) {
      expect(JSON.stringify(body)).not.toContain(VERVE_TOKEN);
      expect(JSON.stringify(body)).not.toContain(ACCOUNT);
    }
    expect((await environment({})).status).toBe(400);
    expect((await environment({ projectId: 999_999 })).status).toBe(404);

    // The agent sees the names too, through its connections tool.
    const connections = await coder.asRunner.projects({ projectKey: 'VERVE' }).connections.get();
    expect(connections.data!.environment).toEqual([
      { name: 'CLOUDFLARE_ACCOUNT_ID', label: 'Cloudflare account', secret: false },
      { name: 'CLOUDFLARE_API_TOKEN', label: 'Cloudflare VERVE', secret: true },
    ]);
  });
});

describe('what the agents report is masked', () => {
  beforeEach(resetDb);

  it('keeps a delivered secret out of run results, timelines, chat answers and transcripts', async () => {
    const { asOwner, teamId, verve } = await setup();
    await cloudflareForVerve(asOwner, teamId, verve.id);
    const coder = await externalAgent(asOwner, 'coder-verve', 'VERVE');

    const run = await claimedRun(asOwner, 'VERVE', coder);
    await coder.asRunner['agent-runs']({ runId: run.id }).events.post(
      {
        events: [
          {
            type: 'TOOL_CALL_RESULT',
            messageId: 'm',
            toolCallId: 't',
            content: `CLOUDFLARE_API_TOKEN=${VERVE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=${ACCOUNT}`,
          },
        ],
      },
      { query: { claim: run.claim } },
    );
    await coder.asRunner['agent-runs']({ runId: run.id }).result.post(
      { status: 'failed', output: `printed ${VERVE_TOKEN}`, error: `auth ${VERVE_TOKEN} refused` },
      { query: { claim: run.claim } },
    );
    const [stored] = await db
      .select({ output: agentRun.output, error: agentRun.lastError })
      .from(agentRun)
      .where(eq(agentRun.id, run.id));
    expect(stored!.output).toBe('printed [redacted]');
    expect(stored!.error).not.toContain(VERVE_TOKEN);
    const timeline = await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: coder.id })
      .runs({ runId: run.id })
      .events.get({ query: {} });
    const shown = JSON.stringify(timeline.data);
    expect(shown).not.toContain(VERVE_TOKEN);
    expect(shown).toContain('CLOUDFLARE_API_TOKEN=[redacted]');
    // The account id is not a secret: it stays readable.
    expect(shown).toContain(ACCOUNT);

    // A chat answer.
    await asOwner
      .projects({ projectKey: 'VERVE' })
      ['ai-agents']({ agentId: coder.id })
      .chat.post({ prompt: 'what is the token?' });
    const message = (await coder.asRunner['agent-chats'].claim.post()).data!.message!;
    await coder.asRunner['agent-chats']({ messageId: message.id }).events.post({
      events: [
        { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: `It is ${VERVE_TOKEN}.` },
      ],
    });
    await coder.asRunner['agent-chats']({ messageId: message.id }).result.post({
      status: 'failed',
      error: `leaked ${VERVE_TOKEN}`,
    });
    const [answer] = await db
      .select({ content: agentChatMessage.content, error: agentChatMessage.lastError })
      .from(agentChatMessage)
      .where(eq(agentChatMessage.id, message.id));
    expect(answer!.content).toBe('It is [redacted].');
    expect(answer!.error).toBe('leaked [redacted]');
    const events = await db
      .select({ payload: agentChatEvent.payload })
      .from(agentChatEvent)
      .where(eq(agentChatEvent.messageId, message.id));
    expect(JSON.stringify(events)).not.toContain(VERVE_TOKEN);

    // A transcript read long after the run.
    const asking = asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: coder.id })
      .runtime.sessions.get({ query: { limit: 10 } });
    let claimed = null;
    for (let i = 0; i < 50 && !claimed; i++) {
      claimed = (await coder.asRunner['agent-runtime'].requests.claim.post()).data!.request;
    }
    expect(claimed).not.toBeNull();
    await coder.asRunner['agent-runtime'].requests({ requestId: claimed!.id }).answer.post({
      ok: true,
      result: {
        sessions: [
          {
            id: '20260925_210000_e310ba',
            title: `ran wrangler with ${VERVE_TOKEN}`,
            preview: `CLOUDFLARE_API_TOKEN=${VERVE_TOKEN}`,
            source: 'tool',
            model: 'fake-model',
            startedAt: 1790238536024,
            endedAt: 1790238536493,
            lastActiveAt: 1790238536468,
            endReason: 'cli_close',
            messageCount: 4,
            toolCallCount: 1,
            usage: {
              inputTokens: 2400,
              outputTokens: 80,
              cacheReadTokens: 1600,
              cacheWriteTokens: 0,
              reasoningTokens: 0,
            },
            estimatedCostUsd: 0,
            parentSessionId: null,
          },
        ],
        total: 1,
      },
    });
    const sessions = await asking;
    expect(sessions.status).toBe(200);
    expect(JSON.stringify(sessions.data)).not.toContain(VERVE_TOKEN);
    expect(JSON.stringify(sessions.data)).toContain('[redacted]');
  });

  it('masks a changed value at once', async () => {
    const { asOwner, teamId, verve } = await setup();
    const { token } = await cloudflareForVerve(asOwner, teamId, verve.id);
    const coder = await externalAgent(asOwner, 'coder-verve', 'VERVE');
    const run = await claimedRun(asOwner, 'VERVE', coder);
    // The mask was read once already; the new value must be in it right away.
    await coder.asRunner['agent-runs']({ runId: run.id }).events.post(
      { events: [{ type: 'RUN_STARTED', threadId: 'x', runId: 'x' }] },
      { query: { claim: run.claim } },
    );
    const rotated = 'rotated-cloudflare-token-00000000';
    await credential(asOwner, teamId, token.id).patch({ value: rotated });
    await coder.asRunner['agent-runs']({ runId: run.id }).result.post(
      { status: 'success', output: `now ${rotated}` },
      { query: { claim: run.claim } },
    );
    const [stored] = await db
      .select({ output: agentRun.output })
      .from(agentRun)
      .where(eq(agentRun.id, run.id));
    expect(stored!.output).toBe('now [redacted]');
  });
});
