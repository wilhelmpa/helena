import { describe, it, expect, beforeEach } from 'bun:test';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { addProjectMember } from '#tests/helpers/members';
import { createCredential } from '#tests/helpers/integrations';
import { bootstrapHomeAgent } from '../../../../../scripts/bootstrap-home-agent';
import { getRunnerAgent } from '#modules/agents/runner/service';
import { deliverSshKeys } from '../../delivery';
import { projectRoot } from '#modules/project-files/roots';
import { db, aiAgent } from '@repo/db';
import { eq } from 'drizzle-orm';
import { forgetTeamSecrets, maskForTeam } from '../../env';

// The Credentials page: a team's web logins, API keys, SSH keys and secrets, the agents
// they are granted to, and what an agent's runner receives for the run it holds.

process.env.AGENT_CHAT_CLAIM_WAIT_MS = '50';
process.env.AGENT_CHAT_CLAIM_POLL_MS = '10';

const PASSWORD = ' fake-password-4711 ';
const TOTP = 'JBSWY3DPEHPK3PXP';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const mkt = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  const ops = (await asOwner.projects.post({ key: 'OPS', name: 'Operations' })).data!;
  const view = await asOwner.projects({ projectKey: 'MKT' }).get();
  return {
    asOwner,
    teamId: mkt.teamId,
    mkt,
    ops,
    columnId: view.data!.columns[0].id,
  };
}

const credentials = (api: Api, teamId: number) => api.teams({ teamId }).credentials;
const credential = (api: Api, teamId: number, credentialId: number) =>
  api.teams({ teamId }).credentials({ credentialId });

function githubLogin(extra: Record<string, unknown> = {}) {
  return {
    kind: 'web_login' as const,
    label: 'GitHub',
    loginUrl: 'https://github.com/login',
    allowedDomains: ['gist.github.com'],
    username: 'bot@example.com',
    password: PASSWORD,
    totpSecret: TOTP,
    notes: 'Deploy account',
    ...extra,
  };
}

async function externalAgent(asOwner: Api, username: string, projectKey = 'MKT') {
  const created = await createAgent(asOwner, projectKey, {
    name: `Agent ${username}`,
    username,
    kind: 'external',
    triggerOnMention: true,
  });
  return { ...created.data!.agent, asRunner: apiKeyApi(created.data!.apiKey!) };
}

// Queues a run of the agent in the project by mentioning it on a new issue, and claims it
// the way its runner does.
async function claimedRun(
  asOwner: Api,
  projectKey: string,
  agent: { username: string; asRunner: Api },
) {
  const columnId = (await asOwner.projects({ projectKey }).get()).data!.columns[0].id;
  const issue = (await asOwner.projects({ projectKey }).issues.post({ columnId, title: 'Sign in' }))
    .data!;
  await asOwner.issues({ issueId: issue.id }).comments.post({ body: `log in @${agent.username}` });
  const run = (await agent.asRunner['agent-runs'].claim.post()).data!.run!;
  return { run, issue };
}

const webLogins = (agent: { asRunner: Api }, runId: number) =>
  agent.asRunner['agent-runs']({ runId })['web-logins'].get();

describe('credentials', () => {
  beforeEach(resetDb);

  it('stores a web login and never returns its secret fields', async () => {
    const { asOwner, teamId } = await setup();
    const res = await credentials(asOwner, teamId).post(githubLogin());
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      kind: 'web_login',
      label: 'GitHub',
      projectId: null,
      loginUrl: 'https://github.com/login',
      allowedDomains: ['https://gist.github.com'],
      username: 'bot@example.com',
      notes: 'Deploy account',
      publicKey: null,
      secrets: ['password', 'totpSecret'],
      agentIds: [],
    });

    const list = await credentials(asOwner, teamId).get({ query: {} });
    expect(list.data).toMatchObject({ total: 1, items: [{ label: 'GitHub' }] });
    for (const body of [res.data, list.data]) {
      expect(JSON.stringify(body)).not.toContain('fake-password');
      expect(JSON.stringify(body)).not.toContain(TOTP);
    }
  });

  it('checks the fields of each kind', async () => {
    const { asOwner, teamId } = await setup();
    const post = (body: Parameters<ReturnType<typeof credentials>['post']>[0]) =>
      credentials(asOwner, teamId).post(body);
    for (const body of [
      githubLogin({ password: undefined }),
      githubLogin({ password: '   ' }),
      githubLogin({ username: '' }),
      githubLogin({ loginUrl: 'ftp://github.com' }),
      githubLogin({ loginUrl: 'https://user:pw@github.com/login' }),
      githubLogin({ allowedDomains: ['*.github.com'] }),
      githubLogin({ allowedDomains: ['github.com/login'] }),
      githubLogin({ totpSecret: 'not base32!' }),
      githubLogin({ totpSecret: 'otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP' }),
      githubLogin({ value: 'x' }),
      githubLogin({ label: '' }),
      githubLogin({ label: '   ' }),
      { kind: 'api_key' as const, label: 'Shopify' },
      { kind: 'secret' as const, label: 'TOKEN', value: 'x', username: 'u' },
      { kind: 'ssh_key' as const, label: 'Deploy', value: 'x' },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    const otpauth = await post(
      githubLogin({ totpSecret: 'otpauth://totp/GitHub:bot?secret=JBSWY3DPEHPK3PXP&digits=8' }),
    );
    expect(otpauth.status).toBe(201);
    const apiKey = await post({ kind: 'api_key', label: 'Shopify', value: 'shpat_fake' });
    expect(apiKey.data).toMatchObject({ kind: 'api_key', secrets: ['value'] });
  });

  it('keeps a secret field an update leaves out, replaces one it sends and removes the key', async () => {
    const { asOwner, teamId } = await setup();
    const id = (await credentials(asOwner, teamId).post(githubLogin())).data!.id;
    const agent = await externalAgent(asOwner, 'shopper');
    await credential(asOwner, teamId, id).grants.put({ agentIds: [agent.id] });

    const renamed = await credential(asOwner, teamId, id).patch({ label: 'GitHub bot' });
    expect(renamed.data).toMatchObject({
      label: 'GitHub bot',
      secrets: ['password', 'totpSecret'],
    });
    let run = (await claimedRun(asOwner, 'MKT', agent)).run;
    let delivered = (await webLogins(agent, run.id)).data!.logins[0];
    expect(delivered).toMatchObject({ password: PASSWORD, totpSecret: TOTP });
    await agent.asRunner['agent-runs']({ runId: run.id }).result.post({ status: 'success' });

    const replaced = await credential(asOwner, teamId, id).patch({
      password: 'second-fake',
      totpSecret: null,
    });
    expect(replaced.data!.secrets).toEqual(['password']);
    expect(new Date(replaced.data!.updatedAt).getTime()).toBeGreaterThan(
      new Date(renamed.data!.updatedAt).getTime(),
    );
    run = (await claimedRun(asOwner, 'MKT', agent)).run;
    delivered = (await webLogins(agent, run.id)).data!.logins[0];
    expect(delivered).toMatchObject({ password: 'second-fake', totpSecret: null });

    expect((await credential(asOwner, teamId, id).patch({ password: '' })).status).toBe(400);
    expect((await credential(asOwner, teamId, id).patch({ value: 'x' })).status).toBe(400);
    expect((await credential(asOwner, teamId, id + 100).patch({ label: 'x' })).status).toBe(404);
  });

  it('generates an SSH key and returns only its public half', async () => {
    const { asOwner, teamId } = await setup();
    const created = await credentials(asOwner, teamId).post({
      kind: 'ssh_key',
      label: 'GitHub deploy',
    });
    expect(created.status).toBe(201);
    expect(created.data!.publicKey).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5\S+ GitHub-deploy$/);
    expect(created.data!.secrets).toEqual(['privateKey']);
    expect(JSON.stringify(created.data)).not.toContain('PRIVATE KEY');

    const renewed = await credential(asOwner, teamId, created.data!.id)['ssh-key'].post();
    expect(renewed.status).toBe(200);
    expect(renewed.data!.publicKey).not.toBe(created.data!.publicKey);

    const login = (await credentials(asOwner, teamId).post(githubLogin())).data!;
    expect((await credential(asOwner, teamId, login.id)['ssh-key'].post()).status).toBe(400);
  });

  it('lets only the team owners and managers change credentials', async () => {
    const { asOwner, teamId } = await setup();
    const id = (await credentials(asOwner, teamId).post(githubLogin())).data!.id;
    const member = await addProjectMember(asOwner, 'MKT');
    expect((await credentials(member, teamId).post(githubLogin())).status).toBe(403);
    expect((await credential(member, teamId, id).patch({ label: 'x' })).status).toBe(403);
    expect((await credential(member, teamId, id).delete()).status).toBe(403);
    expect((await credential(member, teamId, id).grants.put({ agentIds: [] })).status).toBe(403);

    // Someone outside the team gets the answer an unknown team gets.
    const stranger = authedApi((await signUpTestUser()).cookie);
    expect((await credentials(stranger, teamId).get({ query: {} })).status).toBe(404);

    expect((await credential(asOwner, teamId, id).delete()).status).toBe(204);
    expect((await credential(asOwner, teamId, id).delete()).status).toBe(404);
  });

  it('audits only a completed deletion and keeps its label', async () => {
    const { asOwner, teamId } = await setup();
    const hidden = await createCredential(asOwner, 'MKT', {
      integrationKey: 'jina',
      credential: { apiKey: 'jina-fixture-key' },
    });
    expect((await credential(asOwner, teamId, hidden).delete()).status).toBe(404);
    const id = (await credentials(asOwner, teamId).post(githubLogin())).data!.id;
    expect((await credential(asOwner, teamId, id).delete()).status).toBe(204);
    expect((await credential(asOwner, teamId, id).delete()).status).toBe(404);
    const audit = await asOwner.teams({ teamId }).access.audit.get({ query: {} });
    expect(audit.status).toBe(200);
    expect(audit.data!.items.filter((entry) => entry.purpose === 'deleted')).toMatchObject([
      { credentialId: null, credentialLabel: 'GitHub', action: 'changed', agentName: 'Owner' },
    ]);
  });

  it('delivers Home SSH keys across projects with each workspace attribution', async () => {
    const { asOwner, teamId, mkt, ops } = await setup();
    const home = await bootstrapHomeAgent();
    if (home.status !== 'ready') throw new Error('Missing Home fixture');
    const [row] = await db
      .select({ userId: aiAgent.userId })
      .from(aiAgent)
      .where(eq(aiAgent.id, home.agentId));
    const runner = (await getRunnerAgent(row!.userId))!;
    const ids = [];
    for (const project of [mkt, ops]) {
      const key = await credentials(asOwner, teamId).post({ kind: 'ssh_key', label: project.key });
      expect(key.status).toBe(201);
      ids.push(key.data!.id);
      expect(
        (await credential(asOwner, teamId, key.data!.id).patch({ projectId: project.id })).status,
      ).toBe(200);
      expect(
        (await credential(asOwner, teamId, key.data!.id).grants.put({ agentIds: [home.agentId] }))
          .status,
      ).toBe(200);
    }
    const keys = await deliverSshKeys(runner, {
      runId: null,
      chatMessageId: null,
      projectId: mkt.id,
    });
    expect(keys.map((key) => key.id)).toEqual(ids);
    expect(keys.map((key) => key.workspaces)).toEqual(
      [projectRoot('MKT', 'code'), projectRoot('OPS', 'code')].map((root) => [root.directory]),
    );
  });

  it('masks delivered SSH keys and TOTP seeds across key rotation and deletion', async () => {
    const { asOwner, teamId } = await setup();
    const agent = await externalAgent(asOwner, 'key-user');
    const login = (await credentials(asOwner, teamId).post(githubLogin())).data!.id;
    const ssh = (await credentials(asOwner, teamId).post({ kind: 'ssh_key', label: 'SSH' })).data!
      .id;
    for (const id of [login, ssh])
      await credential(asOwner, teamId, id).grants.put({ agentIds: [agent.id] });
    const { run } = await claimedRun(asOwner, 'MKT', agent);
    const delivered = await agent.asRunner['agent-runs']({ runId: run.id })['ssh-keys'].get();
    expect(delivered.status).toBe(200);
    const key = delivered.data!.keys[0].privateKey;
    expect(await maskForTeam(teamId, `${key} ${TOTP}`)).toBe('[redacted] [redacted]');
    await credential(asOwner, teamId, ssh)['ssh-key'].post();
    await credential(asOwner, teamId, login).delete();
    forgetTeamSecrets(teamId);
    expect(await maskForTeam(teamId, `${key} ${TOTP}`)).toBe('[redacted] [redacted]');
  });

  it('keeps the credentials apart from the integrations', async () => {
    const { asOwner, teamId, mkt } = await setup();
    const jina = await createCredential(asOwner, 'MKT', {
      integrationKey: 'jina',
      credential: { apiKey: 'jina-fake' },
    });
    const secret = (
      await credentials(asOwner, teamId).post({ kind: 'secret', label: 'TOKEN', value: 'x' })
    ).data!.id;
    const apiKey = (
      await credentials(asOwner, teamId).post({ kind: 'api_key', label: 'SHOP', value: 'y' })
    ).data!.id;
    await credentials(asOwner, teamId).post({
      kind: 'secret',
      label: 'PROJECT_ONLY',
      value: 'z',
      projectId: mkt.id,
    });
    const login = (await credentials(asOwner, teamId).post(githubLogin())).data!.id;

    const integrations = await asOwner.teams({ teamId }).integrations.get({ query: {} });
    expect(integrations.data!.items.map((item) => item.id)).toEqual([jina]);
    expect(
      (await asOwner.teams({ teamId }).integrations({ credentialId: login }).delete()).status,
    ).toBe(404);
    expect(
      (
        await asOwner
          .teams({ teamId })
          .integrations.post({ integrationKey: 'secret', label: 'X', credential: { value: 'x' } })
      ).status,
    ).toBe(400);

    const options = await asOwner
      .teams({ teamId })
      .integrations.options.get({ query: { kind: 'secret' } });
    expect(options.data!.map((option) => option.id).sort()).toEqual([secret, apiKey].sort());
    expect((await asOwner.teams({ teamId }).get()).data).toMatchObject({ integrationCount: 1 });
  });

  it('grants a credential to agents of the team that run in Hermes', async () => {
    const { asOwner, teamId, mkt } = await setup();
    const id = (await credentials(asOwner, teamId).post(githubLogin())).data!.id;
    const shopper = await externalAgent(asOwner, 'shopper');
    const planner = await externalAgent(asOwner, 'planner', 'OPS');
    const template = await asOwner.teams({ teamId })['ai-agents'].post({
      name: 'Designer',
      username: 'designer',
      kind: 'external',
      template: true,
    });
    const otherTeam = await asOwner.teams.post({ name: 'Design' });
    await asOwner.teams({ teamId: otherTeam.data!.id }).projects.post({ key: 'DSG', name: 'D' });
    const foreign = await externalAgent(asOwner, 'foreign', 'DSG');

    const granted = await credential(asOwner, teamId, id).grants.put({
      agentIds: [shopper.id, planner.id, shopper.id],
    });
    expect(granted.status).toBe(200);
    expect(granted.data!.grants.map((grant) => grant.agentId).sort((a, b) => a! - b!)).toEqual(
      [shopper.id, planner.id].sort((a, b) => a - b),
    );
    expect(granted.data!.grants.every((grant) => grant.access === 'write')).toBe(true);

    for (const agentId of [template.data!.agent.id, foreign.id, 999_999]) {
      const res = await credential(asOwner, teamId, id).grants.put({ agentIds: [agentId] });
      expect(res.status).toBe(400);
    }

    // Limited to a project, the credential keeps only the agents that work there, and
    // can be granted only to them.
    const moved = await credential(asOwner, teamId, id).patch({ projectId: mkt.id });
    expect(moved.data).toMatchObject({ projectId: mkt.id, projectKey: 'MKT' });
    expect(moved.data!.agentIds).toEqual([shopper.id]);
    const refused = await credential(asOwner, teamId, id).grants.put({ agentIds: [planner.id] });
    expect(refused.status).toBe(400);
    expect((await credential(asOwner, teamId, id).patch({ projectId: 999_999 })).status).toBe(400);

    const cleared = await credential(asOwner, teamId, id).grants.put({ agentIds: [] });
    expect(cleared.data!.grants).toEqual([]);
  });
});

describe('credential delivery to the runner', () => {
  beforeEach(resetDb);

  it('gives the runner the granted logins of the run it holds, and nothing else', async () => {
    const { asOwner, teamId, ops } = await setup();
    const shopper = await externalAgent(asOwner, 'shopper');
    const other = await externalAgent(asOwner, 'writer');
    const github = (await credentials(asOwner, teamId).post(githubLogin())).data!.id;
    const opsOnly = (
      await credentials(asOwner, teamId).post(
        githubLogin({ label: 'Ops console', loginUrl: 'https://ops.example.com/login' }),
      )
    ).data!.id;
    await credential(asOwner, teamId, github).grants.put({ agentIds: [shopper.id] });
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: shopper.id })
      .projects.put({
        projectIds: [
          (await asOwner.projects({ projectKey: 'MKT' }).get()).data!.project.id,
          ops.id,
        ],
      });
    await credential(asOwner, teamId, opsOnly).patch({ projectId: ops.id });
    await credential(asOwner, teamId, opsOnly).grants.put({ agentIds: [shopper.id] });

    const { run } = await claimedRun(asOwner, 'MKT', shopper);
    const res = await webLogins(shopper, run.id);
    expect(res.status).toBe(200);
    expect(res.data!.logins).toEqual([
      {
        id: github,
        label: 'GitHub',
        updatedAt: expect.any(Date),
        origins: ['https://github.com', 'https://gist.github.com'],
        username: 'bot@example.com',
        password: PASSWORD,
        totpSecret: TOTP,
      },
    ]);

    // Only the runner that holds the run, and only while it holds it.
    expect((await webLogins(other, run.id)).status).toBe(404);
    expect((await asOwner['agent-runs']({ runId: run.id })['web-logins'].get()).status).toBe(403);
    await shopper.asRunner['agent-runs']({ runId: run.id }).result.post({ status: 'success' });
    expect((await webLogins(shopper, run.id)).status).toBe(404);

    const opsRun = (await claimedRun(asOwner, 'OPS', shopper)).run;
    const inOps = await webLogins(shopper, opsRun.id);
    expect(inOps.data!.logins.map((login) => login.id)).toEqual([github, opsOnly]);
  });

  it('refuses a run that is queued but not claimed', async () => {
    const { asOwner, teamId, columnId } = await setup();
    const shopper = await externalAgent(asOwner, 'shopper');
    const id = (await credentials(asOwner, teamId).post(githubLogin())).data!.id;
    await credential(asOwner, teamId, id).grants.put({ agentIds: [shopper.id] });
    const issue = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Sign in' })
    ).data!;
    await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'go @shopper' });
    const runs = await asOwner.teams({ teamId })['ai-agents']({ agentId: shopper.id }).runs.get({
      query: {},
    });
    const queued = runs.data!.items[0];
    expect((await webLogins(shopper, queued.id)).status).toBe(404);
  });

  it('gives the logins of a claimed chat answer', async () => {
    const { asOwner, teamId } = await setup();
    const shopper = await externalAgent(asOwner, 'shopper');
    const id = (await credentials(asOwner, teamId).post(githubLogin())).data!.id;
    await credential(asOwner, teamId, id).grants.put({ agentIds: [shopper.id] });
    await asOwner
      .projects({ projectKey: 'MKT' })
      ['ai-agents']({ agentId: shopper.id })
      .chat.post({ prompt: 'Sign in to GitHub' });
    const message = (await shopper.asRunner['agent-chats'].claim.post()).data!.message!;
    const res = await shopper.asRunner['agent-chats']({ messageId: message.id })[
      'web-logins'
    ].get();
    expect(res.data!.logins.map((login) => login.id)).toEqual([id]);
    expect(
      (await shopper.asRunner['agent-chats']({ messageId: message.id + 1 })['web-logins'].get())
        .status,
    ).toBe(404);
  });

  it('records every delivery and use in the audit log', async () => {
    const { asOwner, teamId } = await setup();
    const shopper = await externalAgent(asOwner, 'shopper');
    const github = (await credentials(asOwner, teamId).post(githubLogin())).data!.id;
    const ungranted = (await credentials(asOwner, teamId).post(githubLogin({ label: 'Other' })))
      .data!.id;
    await credential(asOwner, teamId, github).grants.put({ agentIds: [shopper.id] });
    const { run, issue } = await claimedRun(asOwner, 'MKT', shopper);
    await webLogins(shopper, run.id);

    const used = await shopper.asRunner['agent-runtime']['credential-uses'].post({
      runId: run.id,
      uses: [
        { credentialId: github, tool: 'browser_vault_fill', origin: 'https://github.com' },
        { credentialId: ungranted, tool: 'browser_vault_fill', origin: 'https://github.com' },
      ],
    });
    expect(used.status).toBe(204);
    const neither = await shopper.asRunner['agent-runtime']['credential-uses'].post({ uses: [] });
    expect(neither.status).toBe(400);

    const log = await credential(asOwner, teamId, github).uses.get({ query: {} });
    expect(log.status).toBe(200);
    // The owner's creation and grant are logged too, as changes with no agent.
    expect(log.data!.total).toBe(4);
    expect(log.data!.items).toMatchObject([
      {
        action: 'used',
        purpose: 'browser_vault_fill https://github.com',
        agentId: shopper.id,
        agentName: 'Agent shopper',
        runId: run.id,
        issueIdentifier: `MKT-${issue.sequenceNumber}`,
      },
      { action: 'delivered', purpose: 'Hermes vault', runId: run.id },
      { action: 'changed', purpose: 'grants', agentId: null },
      { action: 'changed', purpose: 'created', agentId: null },
    ]);
    // Nothing of the agent's reaches the credential it was never granted.
    expect(
      (await credential(asOwner, teamId, ungranted).uses.get({ query: {} })).data!.items,
    ).toMatchObject([{ action: 'changed', purpose: 'created' }]);

    // The log outlives the credential's grant.
    await credential(asOwner, teamId, github).grants.put({ agentIds: [] });
    expect((await credential(asOwner, teamId, github).uses.get({ query: {} })).data!.total).toBe(5);
  });

  it("logs the owner's own changes, and keeps them after the credential is gone", async () => {
    const { asOwner, teamId } = await setup();
    const id = (await credentials(asOwner, teamId).post(githubLogin())).data!.id;
    await credential(asOwner, teamId, id).patch({ label: 'GitHub (Bot)' });
    expect((await credential(asOwner, teamId, id).delete()).status).toBe(204);

    const audit = await asOwner.teams({ teamId }).access.audit.get({ query: {} });
    expect(audit.data!.items).toMatchObject([
      {
        action: 'changed',
        purpose: 'deleted',
        credentialId: null,
        credentialLabel: 'GitHub (Bot)',
      },
      { action: 'changed', purpose: 'edited', credentialId: null },
      { action: 'changed', purpose: 'created', credentialId: null },
    ]);
    expect(JSON.stringify(audit.data)).not.toContain(githubLogin().password);
  });

  it('records the MCP secrets a runner reads for a run', async () => {
    const { asOwner, teamId, mkt } = await setup();
    const shopper = await externalAgent(asOwner, 'shopper');
    const apiKey = (
      await credentials(asOwner, teamId).post({
        kind: 'api_key',
        label: 'TYPESAFE_API_KEY',
        value: 'ts_fake',
      })
    ).data!.id;
    const projectSecret = (
      await credentials(asOwner, teamId).post({
        kind: 'secret',
        label: 'PROJECT_ONLY',
        value: 'p',
        projectId: mkt.id,
      })
    ).data!.id;
    const server = await asOwner.teams({ teamId })['mcp-servers'].post({
      name: 'typesafe',
      transport: 'stdio',
      command: 'npx',
      env: [{ name: 'TYPESAFE_API_KEY', credentialId: apiKey }],
    });
    expect(server.status).toBe(201);
    const refused = await asOwner.teams({ teamId })['mcp-servers'].post({
      name: 'project-only',
      transport: 'stdio',
      command: 'npx',
      env: [{ name: 'TOKEN', credentialId: projectSecret }],
    });
    expect(refused.status).toBe(400);
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: shopper.id })
      ['mcp-servers'].put({ mcpServerIds: [server.data!.id] });

    const { run } = await claimedRun(asOwner, 'MKT', shopper);
    const secrets = await shopper.asRunner['agent-runtime']['mcp-secrets'].get({
      query: { runId: run.id },
    });
    expect(secrets.data!.secrets).toEqual({ [String(apiKey)]: 'ts_fake' });
    const log = await credential(asOwner, teamId, apiKey).uses.get({ query: {} });
    expect(log.data!.items).toMatchObject([
      { action: 'delivered', purpose: 'MCP server typesafe', runId: run.id },
      { action: 'changed', purpose: 'created' },
    ]);
    const stale = await shopper.asRunner['agent-runtime']['mcp-secrets'].get({
      query: { runId: run.id + 1 },
    });
    expect(stale.status).toBe(404);
  });

  it('tells the runner and the agent that logins are granted', async () => {
    const { asOwner, teamId } = await setup();
    const shopper = await externalAgent(asOwner, 'shopper');
    const policy = async () => (await shopper.asRunner['agent-runtime'].policy.get()).data!;
    const before = await policy();
    expect(before.webLogins).toBe(false);
    expect(before.runtimePolicy.files[0].content).not.toContain('## Website logins');

    const id = (await credentials(asOwner, teamId).post(githubLogin())).data!.id;
    await credential(asOwner, teamId, id).grants.put({ agentIds: [shopper.id] });
    const after = await policy();
    expect(after.webLogins).toBe(true);
    expect(after.revision).not.toBe(before.revision);
    expect(after.runtimePolicy.files[0].content).toContain('## Website logins');
  });
});
