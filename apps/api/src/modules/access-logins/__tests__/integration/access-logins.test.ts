import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, integrationCredentialUse } from '@repo/db';
import { eq } from 'drizzle-orm';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { resetDb } from '#tests/helpers/db';
import { listAccessLogins } from '../../service';

// "Anmeldungen" in Zugänge: every Claude Code and Codex agent with the login its runtime
// works with (its own device login, or a stored runtime login granted to it), and for the
// owner the model logins every Hermes agent shares. Never a token.

process.env.AGENT_RUNTIME_REQUEST_CLAIM_WAIT_MS = '50';
process.env.AGENT_RUNTIME_REQUEST_CLAIM_POLL_MS = '10';
process.env.AGENT_RUNTIME_REQUEST_ANSWER_POLL_MS = '10';

const ORIGIN = { origin: 'http://localhost:3001' };
const TOKEN = 'sk-ant-oat01-the-owners-setup-token-4711';
const COMMAND =
  'sudo -u volition-hermes /usr/bin/python3 -I /usr/local/lib/volition-isolation/launch_client.py ' +
  'run --slug vol --profile vol_33 --runtime codex --kind helper --cwd /srv/w -- login --device-auth';

// Keys and values that would be a login; none may appear in any response here.
const SECRET_KEY = /token|secret|password|apikey|api_key|^value$|ciphertext|^iv$|authTag/i;
const SECRET_VALUE = /eyJ[A-Za-z0-9_-]{10,}|\brt_[A-Za-z0-9_]{6,}|sk-ant-oat01|sk-proj-/;

function assertNoTokens(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoTokens(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      expect(key).not.toMatch(SECRET_KEY);
      assertNoTokens(item, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string') expect(value).not.toMatch(SECRET_VALUE);
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie, ORIGIN);
  const project = (await asOwner.projects.post({ key: 'VOL', name: 'Volition' })).data!;
  return { owner, asOwner, teamId: project.teamId };
}

async function agentOn(
  asOwner: Api,
  teamId: number,
  username: string,
  runtime: 'hermes' | 'claude' | 'codex',
) {
  const created = await createAgent(asOwner, 'VOL', {
    name: `Agent ${username}`,
    username,
    kind: 'external',
  });
  const agent = created.data!.agent;
  const route = asOwner.teams({ teamId })['ai-agents']({ agentId: agent.id });
  const policy = (await route.get()).data!.runtimePolicy;
  await route.patch({ runtimePolicy: { ...policy, runtime } });
  return { ...agent, asRunner: apiKeyApi(created.data!.apiKey!) };
}

// What a Codex agent's runner reports: its own ChatGPT login, as Codex told it, with a few
// fields a broken runner might add.
async function reportAccount(asRunner: Api, account: Record<string, unknown> | null) {
  const res = await asRunner['agent-runtime'].status.post({
    adapter: 'codex',
    status: 'online',
    appliedRevision: null,
    capabilities: ['model', 'login', 'logout'],
    detail: null,
    issues: account?.signedIn === false ? [{ code: 'not-signed-in', detail: 'missing' }] : [],
    account: account as never,
  });
  expect(res.status).toBe(200);
}

const SIGNED_IN = {
  signedIn: true,
  method: 'chatgpt',
  email: 'owner@example.com',
  plan: 'pro',
  organization: null,
  refreshedAt: '2026-09-25T08:00:00.000Z',
  checkedAt: new Date().toISOString(),
  command: COMMAND,
};

const logins = (api: Api, teamId: number) => api.teams({ teamId }).access.logins;

// The runner's side of one runtime request: claims it and answers.
async function answerRequest(
  asRunner: Api,
  op: 'login.read' | 'login.logout',
  answer: () => Promise<Record<string, unknown>>,
) {
  for (let i = 0; i < 200; i++) {
    const claimed = (await asRunner['agent-runtime'].requests.claim.post()).data!.request;
    if (claimed) {
      expect(claimed.request.op).toBe(op);
      await asRunner['agent-runtime']
        .requests({ requestId: claimed.id })
        .answer.post({ ok: true, result: await answer() });
      return;
    }
  }
  throw new Error('no request arrived');
}

describe('logins in Zugänge', () => {
  beforeEach(resetDb);

  it("lists a Codex agent's own device login with its account, and never a token", async () => {
    const { asOwner, teamId } = await setup();
    const codex = await agentOn(asOwner, teamId, 'codex-test', 'codex');
    await agentOn(asOwner, teamId, 'writer', 'hermes');
    await reportAccount(codex.asRunner, {
      ...SIGNED_IN,
      // A runner that sent more than the account: dropped when stored.
      refresh_token: 'rt_should_never_be_stored',
      tokens: { id_token: 'eyJhbGciOiJSUzI1NiJ9.payload.sig' },
    });

    const { data, status } = await logins(asOwner, teamId).get();
    expect(status).toBe(200);
    // Only the Claude Code and Codex agents.
    expect(data!.agents).toHaveLength(1);
    expect(data!.agents[0]).toMatchObject({
      agentId: codex.id,
      runtime: 'codex',
      online: true,
      source: 'own',
      state: 'signedIn',
      account: { method: 'chatgpt', email: 'owner@example.com', plan: 'pro' },
      credential: null,
      command: COMMAND,
      canCheck: true,
      canSignOut: true,
    });
    // The client reads a time as a Date.
    expect(new Date(data!.agents[0]!.refreshedAt!).toISOString()).toBe('2026-09-25T08:00:00.000Z');
    expect(data!.shared).toEqual([]);
    assertNoTokens(data);

    // The agent page reads the same account through its sync state.
    const sync = await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: codex.id })
      ['runtime-sync'].get();
    expect(sync.data!.account).toMatchObject({ email: 'owner@example.com', plan: 'pro' });
    assertNoTokens(sync.data!.account);
  });

  it('names the stored runtime login granted to a Claude Code agent, not its value', async () => {
    const { asOwner, teamId } = await setup();
    const claude = await agentOn(asOwner, teamId, 'claude-test', 'claude');
    const credential = (
      await asOwner.teams({ teamId }).credentials.post({
        kind: 'runtime_login',
        label: 'Claude',
        runtime: 'claude',
        method: 'oauth_token',
        value: TOKEN,
      })
    ).data!;
    await asOwner
      .teams({ teamId })
      .credentials({ credentialId: credential.id })
      .grants.put({ agentIds: [claude.id] });

    const { data } = await logins(asOwner, teamId).get();
    expect(data!.agents[0]).toMatchObject({
      agentId: claude.id,
      runtime: 'claude',
      source: 'stored',
      state: 'signedIn',
      credential: { id: credential.id, label: 'Claude' },
      account: null,
      canSignOut: false,
    });
    expect(JSON.stringify(data)).not.toContain(TOKEN);
    assertNoTokens(data);
  });

  it('says when an agent is not signed in, or its login was refused', async () => {
    const { asOwner, teamId } = await setup();
    const codex = await agentOn(asOwner, teamId, 'codex-test', 'codex');
    await reportAccount(codex.asRunner, { ...SIGNED_IN, signedIn: false });
    let row = (await logins(asOwner, teamId).get()).data!.agents[0]!;
    expect(row).toMatchObject({ source: 'none', state: 'signedOut', account: null });
    expect(row.command).toBe(COMMAND);

    await codex.asRunner['agent-runtime'].status.post({
      adapter: 'codex',
      status: 'degraded',
      appliedRevision: null,
      capabilities: ['login', 'logout'],
      detail: 'codex is not signed in',
      issues: [{ code: 'not-signed-in', detail: 'rejected', command: COMMAND }],
      account: SIGNED_IN,
    });
    row = (await logins(asOwner, teamId).get()).data!.agents[0]!;
    expect(row).toMatchObject({ source: 'own', state: 'expired' });
  });

  it('shows the shared Hermes logins to the owner only, with their plan', async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'logins-'));
    const saved = process.env.HELENA_LOGIN_STATUS_DIR;
    process.env.HELENA_LOGIN_STATUS_DIR = dir;
    try {
      await writeFile(
        join(dir, 'hermes.json'),
        JSON.stringify({
          version: 1,
          reporter: 'helena-token-keeper',
          checkedAt: new Date().toISOString(),
          intervalSeconds: 600,
          logins: [
            {
              store: 'hermes',
              provider: 'anthropic',
              id: 'abc123',
              label: 'owner@example.com',
              managed: true,
              state: 'ok',
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
              refreshedAt: new Date().toISOString(),
              error: null,
              command: null,
              access_token: 'sk-ant-oat01-must-not-pass',
            },
          ],
          errors: [],
        }),
      );
      const { asOwner, teamId } = await setup();
      const codex = await agentOn(asOwner, teamId, 'codex-test', 'codex');
      await codex.asRunner['agent-runtime'].limits.post({
        snapshots: [
          {
            provider: 'anthropic',
            account: 'acct-claude',
            source: 'hermes',
            login: 'hermes',
            plan: 'max',
            windows: [],
            extra: null,
            resetCredits: null,
            allowed: true,
            via: 'probe',
            observedAt: new Date(Date.now() - 60_000).toISOString(),
            unavailable: null,
          },
        ],
      });

      const { data } = await logins(asOwner, teamId).get();
      expect(data!.shared).toHaveLength(1);
      expect(data!.shared![0]).toMatchObject({
        store: 'hermes',
        provider: 'anthropic',
        label: 'owner@example.com',
        managed: true,
        condition: 'active',
        plan: 'max',
        stale: false,
      });
      assertNoTokens(data);

      // Anyone but the owner sees the team's agents only.
      const other = await listAccessLogins(teamId, { owner: false, visibleTo: undefined });
      expect(other.shared).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.HELENA_LOGIN_STATUS_DIR;
      else process.env.HELENA_LOGIN_STATUS_DIR = saved;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("signs an agent's own login out through its runner, and logs who did", async () => {
    const { owner, asOwner, teamId } = await setup();
    const codex = await agentOn(asOwner, teamId, 'codex-test', 'codex');
    await reportAccount(codex.asRunner, SIGNED_IN);
    const signOut = logins(asOwner, teamId).agents({ agentId: codex.id })['sign-out'];

    // Not from outside the signed-in interface.
    const plain = authedApi(owner.cookie);
    const refused = await plain
      .teams({ teamId })
      .access.logins.agents({ agentId: codex.id })
      ['sign-out'].post();
    expect(refused.status).toBe(403);

    const [res] = await Promise.all([
      signOut.post(),
      answerRequest(codex.asRunner, 'login.logout', async () => {
        // The runner ran `codex logout`, looked again and reported it before answering.
        await reportAccount(codex.asRunner, { ...SIGNED_IN, signedIn: false });
        return { account: { ...SIGNED_IN, signedIn: false, email: null, plan: null } };
      }),
    ]);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ agentId: codex.id, state: 'signedOut', canSignOut: false });

    const [entry] = await db
      .select()
      .from(integrationCredentialUse)
      .where(eq(integrationCredentialUse.teamId, teamId));
    expect(entry).toMatchObject({
      credentialId: null,
      credentialLabel: 'Codex · Agent codex-test',
      agentId: null,
      agentName: 'Owner',
      action: 'changed',
      purpose: 'signed-out',
    });
  });

  it("checks an agent's login now, and refuses a runner that cannot", async () => {
    const { asOwner, teamId } = await setup();
    const codex = await agentOn(asOwner, teamId, 'codex-test', 'codex');
    const check = logins(asOwner, teamId).agents({ agentId: codex.id }).check;
    await codex.asRunner['agent-runtime'].status.post({
      adapter: 'codex',
      status: 'online',
      appliedRevision: null,
      capabilities: ['model'],
      detail: null,
    });
    expect((await check.post()).status).toBe(409);

    await reportAccount(codex.asRunner, { ...SIGNED_IN, signedIn: false });
    const [res] = await Promise.all([
      check.post(),
      answerRequest(codex.asRunner, 'login.read', async () => {
        await reportAccount(codex.asRunner, SIGNED_IN);
        return { account: SIGNED_IN };
      }),
    ]);
    expect(res.data).toMatchObject({ state: 'signedIn', account: { email: 'owner@example.com' } });

    // A Hermes agent keeps no login of its own.
    const hermes = await agentOn(asOwner, teamId, 'writer', 'hermes');
    const none = await logins(asOwner, teamId).agents({ agentId: hermes.id }).check.post();
    expect(none.status).toBe(404);
  });
});
