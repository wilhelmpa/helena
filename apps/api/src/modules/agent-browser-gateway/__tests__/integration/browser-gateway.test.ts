import { describe, it, expect, beforeEach, beforeAll } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { ensureBuiltinMcpServers } from '../../../agents/mcp-servers/service';
import { bootstrapHomeAgent } from '../../../../scripts/bootstrap-home-agent';

// The browser gateway's Plan-side surface (design: docs/volition-design-browser-gateway.md):
// the "Projekt-Browser" builtin MCP server entry, its per-project settings, and the internal
// routes the gateway process itself calls with a service token plus the agent's own key.

const GATEWAY_TOKEN = 'test-browser-gateway-token-0123456789abcdef0123';
const TOTP = 'JBSWY3DPEHPK3PXP'; // same well-known test seed the credentials tests use

beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), 'browser-gateway-'));
  const file = join(directory, 'token');
  writeFileSync(file, GATEWAY_TOKEN, { mode: 0o600 });
  process.env.BROWSER_GATEWAY_TOKEN_FILE = file;
});

function internal(path: string, body: unknown, token: string | undefined = GATEWAY_TOKEN) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const mkt = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  return { asOwner, mkt };
}

const servers = (api: Api, teamId: number) => api.teams({ teamId })['mcp-servers'];
const agentServers = (api: Api, teamId: number, agentId: number) =>
  api.teams({ teamId })['ai-agents']({ agentId })['mcp-servers'];
const credentials = (api: Api, teamId: number) => api.teams({ teamId }).credentials;
const credential = (api: Api, teamId: number, credentialId: number) =>
  api.teams({ teamId }).credentials({ credentialId });

async function agentWithGateway(
  asOwner: Api,
  teamId: number,
  projectKey: string,
  username: string,
) {
  const created = await createAgent(asOwner, projectKey, {
    name: `Agent ${username}`,
    username,
    kind: 'external',
  });
  const agent = created.data!.agent;
  // The library lists the built-in "Projekt-Browser" entry for every team.
  const server = (await servers(asOwner, teamId).get()).data!.find(
    (row) => row.name === 'projekt-browser',
  )!;
  await agentServers(asOwner, teamId, agent.id).put({ mcpServerIds: [server.id] });
  return { agent, apiKey: created.data!.apiKey! as string, server };
}

describe('browser gateway', () => {
  beforeEach(resetDb);

  it('refuses a request without the gateway service token', async () => {
    // '' (not undefined) so the helper's default parameter does not silently supply the real
    // token: an empty/absent Authorization header is what "no token" means here.
    const res = await internal(
      '/internal/browser-gateway/resolve',
      { agentKey: 'x', projectSlug: 'mkt', via: 'mkt' },
      '',
    );
    expect(res.status).toBe(401);
  });

  it('refuses a request with the wrong service token', async () => {
    const res = await internal(
      '/internal/browser-gateway/resolve',
      { agentKey: 'x', projectSlug: 'mkt', via: 'mkt' },
      'wrong-token-0123456789abcdef0123456789',
    );
    expect(res.status).toBe(401);
  });

  it('resolves an agent, its project and whether Projekt-Browser is enabled', async () => {
    const { asOwner, mkt } = await setup();
    const { agent, apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const res = await internal('/internal/browser-gateway/resolve', {
      agentKey: apiKey,
      projectSlug: 'mkt',
      via: 'mkt',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agentId: number;
      browserGatewayEnabled: boolean;
      settings: { humanInput: boolean; lockTimeoutSec: number };
    };
    expect(body.agentId).toBe(agent.id);
    expect(body.browserGatewayEnabled).toBe(true);
    expect(body.settings).toMatchObject({ humanInput: true, lockTimeoutSec: 120 });
  });

  it('reports Projekt-Browser as disabled for an agent that never had it enabled', async () => {
    const { asOwner } = await setup();
    const created = await createAgent(asOwner, 'MKT', {
      name: 'Plain',
      username: 'plain',
      kind: 'external',
    });
    const res = await internal('/internal/browser-gateway/resolve', {
      agentKey: created.data!.apiKey!,
      projectSlug: 'mkt',
      via: 'mkt',
    });
    const body = (await res.json()) as { browserGatewayEnabled: boolean };
    expect(body.browserGatewayEnabled).toBe(false);
  });

  it('refuses an agent key for a project the agent does not work in', async () => {
    const { asOwner, mkt } = await setup();
    await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const { apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const res = await internal('/internal/browser-gateway/resolve', {
      agentKey: apiKey,
      projectSlug: 'ops',
      via: 'ops',
    });
    expect(res.status).toBe(403);
  });

  it('fills a login by frame origin and never returns the TOTP secret', async () => {
    const { asOwner, mkt } = await setup();
    const { agent, apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const cred = (
      await credentials(asOwner, mkt.teamId).post({
        kind: 'web_login',
        label: 'GitHub',
        loginUrl: 'https://github.com/login',
        allowedDomains: [],
        username: 'bot@example.com',
        password: 'fake-password-4711',
        totpSecret: TOTP,
      })
    ).data!;
    await credential(asOwner, mkt.teamId, cred.id).grants.put({ agentIds: [agent.id] });

    const res = await internal('/internal/browser-gateway/login', {
      agentKey: apiKey,
      projectSlug: 'mkt',
      via: 'mkt',
      frameOrigin: 'https://github.com',
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TOTP);
    const body = JSON.parse(text) as {
      status: string;
      login: { username: string; password: string; has2fa: boolean };
    };
    expect(body.status).toBe('filled');
    expect(body.login.username).toBe('bot@example.com');
    expect(body.login.password).toBe('fake-password-4711');
    expect(body.login.has2fa).toBe(true);
    expect(body).not.toHaveProperty('login.totpSecret');
  });

  it('offers a choice, without any password, when several logins match the origin', async () => {
    const { asOwner, mkt } = await setup();
    const { agent, apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    for (const label of ['Primary', 'Backup']) {
      const cred = (
        await credentials(asOwner, mkt.teamId).post({
          kind: 'web_login',
          label,
          loginUrl: 'https://example.com/login',
          allowedDomains: [],
          username: `${label.toLowerCase()}@example.com`,
          password: 'fake-password',
        })
      ).data!;
      await credential(asOwner, mkt.teamId, cred.id).grants.put({ agentIds: [agent.id] });
    }
    const res = await internal('/internal/browser-gateway/login', {
      agentKey: apiKey,
      projectSlug: 'mkt',
      via: 'mkt',
      frameOrigin: 'https://example.com',
    });
    const body = (await res.json()) as { status: string; candidates: { label: string }[] };
    expect(body.status).toBe('choose');
    expect(body.candidates.map((c) => c.label).sort()).toEqual(['Backup', 'Primary']);
    expect(JSON.stringify(body)).not.toContain('password');
  });

  it('never fills a login on an origin it was not saved for', async () => {
    const { asOwner, mkt } = await setup();
    const { agent, apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const cred = (
      await credentials(asOwner, mkt.teamId).post({
        kind: 'web_login',
        label: 'GitHub',
        loginUrl: 'https://github.com/login',
        allowedDomains: [],
        username: 'bot@example.com',
        password: 'fake-password',
      })
    ).data!;
    await credential(asOwner, mkt.teamId, cred.id).grants.put({ agentIds: [agent.id] });
    const res = await internal('/internal/browser-gateway/login', {
      agentKey: apiKey,
      projectSlug: 'mkt',
      via: 'mkt',
      frameOrigin: 'https://not-github.example',
    });
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('none');
  });

  it('computes the current TOTP code and never returns the secret', async () => {
    const { asOwner, mkt } = await setup();
    const { agent, apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const cred = (
      await credentials(asOwner, mkt.teamId).post({
        kind: 'web_login',
        label: 'GitHub',
        loginUrl: 'https://github.com/login',
        allowedDomains: [],
        username: 'bot@example.com',
        password: 'fake-password',
        totpSecret: TOTP,
      })
    ).data!;
    await credential(asOwner, mkt.teamId, cred.id).grants.put({ agentIds: [agent.id] });
    const res = await internal('/internal/browser-gateway/login-code', {
      agentKey: apiKey,
      credentialId: cred.id,
      frameOrigin: 'https://github.com',
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TOTP);
    const body = JSON.parse(text) as { code: string; secondsRemaining: number };
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.secondsRemaining).toBeGreaterThan(0);
    expect(body.secondsRemaining).toBeLessThanOrEqual(30);
  });

  it('refuses a login code for a credential not granted to the agent', async () => {
    const { asOwner, mkt } = await setup();
    const { apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const cred = (
      await credentials(asOwner, mkt.teamId).post({
        kind: 'web_login',
        label: 'GitHub',
        loginUrl: 'https://github.com/login',
        allowedDomains: [],
        username: 'bot@example.com',
        password: 'fake-password',
        totpSecret: TOTP,
      })
    ).data!;
    const res = await internal('/internal/browser-gateway/login-code', {
      agentKey: apiKey,
      credentialId: cred.id,
      frameOrigin: 'https://github.com',
    });
    expect(res.status).toBe(404);
  });

  it('records a non-credential tool call in the audit trail, without any value', async () => {
    const { asOwner, mkt } = await setup();
    const { agent, apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const audit = await internal('/internal/browser-gateway/audit', {
      agentKey: apiKey,
      projectSlug: 'mkt',
      via: 'mkt',
      actor: 'agent',
      tool: 'browser_navigate',
      category: 'write',
      target: 'https://example.com/secret-path',
    });
    expect(audit.status).toBe(200);
    const events = await asOwner.projects({ projectKey: 'MKT' })['browser-gateway'].events.get();
    expect(events.data!.items).toHaveLength(1);
    expect(events.data!.items[0]).toMatchObject({
      agentId: agent.id,
      actor: 'agent',
      tool: 'browser_navigate',
      category: 'write',
    });
  });

  it("decides a browser action by its category, for the agent's own project only", async () => {
    const { asOwner, mkt } = await setup();
    await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const { apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const call = (body: Record<string, unknown>) =>
      internal('/internal/browser-gateway/decide', {
        agentKey: apiKey,
        projectSlug: 'mkt',
        via: 'mkt',
        tool: 'browser_click',
        category: 'send',
        context: { origin: 'https://shop.example', target: 'f1e5', formAction: null },
        ...body,
      });
    // Helena's Autopilot decides: at the project's default level 1 a click that writes goes
    // ahead, one that sends needs the owner, who gets a card in Freigaben.
    const write = await call({ category: 'write' });
    expect(write.status).toBe(200);
    expect(await write.json()).toEqual({
      effect: 'allow',
      reason: 'Autopilot level 1 (With approval) allows write',
    });
    const send = await call({});
    const asked = (await send.json()) as { effect: string; reason: string; approvalId: number };
    expect(asked).toMatchObject({
      effect: 'needs-approval',
      reason: 'Autopilot level 1 (With approval) asks a person before send',
    });
    const card = (await asOwner.approvals.get({ query: {} })).data!.items.find(
      (item) => item.id === asked.approvalId,
    )!;
    expect(card).toMatchObject({ kind: 'send', category: 'send', autopilotLevel: 1 });
    // At level 3 it sends on its own; paying stays a person's decision.
    await asOwner.projects({ projectKey: 'MKT' }).autopilot.put({ level: 3 });
    expect(await (await call({})).json()).toMatchObject({ effect: 'allow' });
    expect(await (await call({ category: 'pay' })).json()).toMatchObject({
      effect: 'needs-approval',
      reason: 'A person always approves pay, even at level 3',
    });
    expect((await call({ category: 'launch-missiles' })).status).toBe(400);
    expect((await call({ projectSlug: 'ops', via: 'ops' })).status).toBe(403);
    expect((await call({ agentKey: 'not-a-key' })).status).toBe(403);
  });

  it('lists the projects a user works in for the Home "Browser" overview', async () => {
    const { asOwner, mkt } = await setup();
    const overview = await asOwner['browser-gateway'].overview.get();
    expect(overview.status).toBe(200);
    expect(overview.data!.projects).toContainEqual({
      projectId: mkt.id,
      projectKey: 'MKT',
      projectName: 'Marketing',
      slug: 'mkt',
    });
  });

  it('refuses the "Browser" overview to a request with no session', async () => {
    const res = await app.handle(new Request('http://localhost/browser-gateway/overview'));
    expect(res.status).toBe(401);
  });

  it("lets the project owner read and change the project's browser gateway settings", async () => {
    const { asOwner } = await setup();
    const before = await asOwner.projects({ projectKey: 'MKT' }).settings['browser-gateway'].get();
    expect(before.data).toEqual({
      domainBlocklist: [],
      domainAllowlist: [],
      humanInput: true,
      lockTimeoutSec: 120,
      agentViewport: { width: 1440, height: 900 },
      // Local and private addresses stay closed to agents until the owner opens them.
      allowLocalAddresses: false,
    });
    const updated = await asOwner.projects({ projectKey: 'MKT' }).settings['browser-gateway'].put({
      domainBlocklist: ['bank.example'],
      humanInput: false,
      lockTimeoutSec: 60,
      agentViewport: { width: 1280, height: 800 },
      allowLocalAddresses: true,
    });
    expect(updated.status).toBe(200);
    expect(updated.data).toMatchObject({
      domainBlocklist: ['bank.example'],
      domainAllowlist: [],
      humanInput: false,
      lockTimeoutSec: 60,
      agentViewport: { width: 1280, height: 800 },
      allowLocalAddresses: true,
    });
    const tooSmall = await asOwner.projects({ projectKey: 'MKT' }).settings['browser-gateway'].put({
      agentViewport: { width: 320, height: 200 },
    });
    expect(tooSmall.status).toBe(400);
  });

  it("a project's settings feed the gateway's own policy fetch", async () => {
    const { asOwner } = await setup();
    await asOwner.projects({ projectKey: 'MKT' }).settings['browser-gateway'].put({
      domainBlocklist: ['bank.example'],
    });
    const res = await app.handle(
      new Request('http://localhost/internal/browser-gateway/policy', {
        headers: { authorization: `Bearer ${GATEWAY_TOKEN}` },
      }),
    );
    const body = (await res.json()) as { projects: Record<string, { domainBlocklist: string[] }> };
    expect(body.projects.mkt.domainBlocklist).toEqual(['bank.example']);
  });

  it('seeds the builtin servers as builtin, and a team cannot edit or delete them', async () => {
    const { asOwner, mkt } = await setup();
    const list = (await servers(asOwner, mkt.teamId).get()).data!;
    const gateway = list.find((row) => row.name === 'projekt-browser')!;
    const legacy = list.find((row) => row.name === 'hermes-browser-legacy')!;
    expect(gateway.builtin).toBe(true);
    expect(legacy.builtin).toBe(true);

    const patched = await servers(
      asOwner,
      mkt.teamId,
    )({ mcpServerId: gateway.id }).patch({
      description: 'changed',
    });
    expect(patched.status).toBe(403);
    const deleted = await servers(asOwner, mkt.teamId)({ mcpServerId: gateway.id }).delete();
    expect(deleted.status).toBe(403);

    // Re-running the seed is idempotent: still exactly one row per name, still builtin.
    await ensureBuiltinMcpServers(mkt.teamId);
    const again = (await servers(asOwner, mkt.teamId).get()).data!;
    expect(again.filter((row) => row.name === 'projekt-browser')).toHaveLength(1);
  });

  it('refuses a TOTP code for a page of another site', async () => {
    const { asOwner, mkt } = await setup();
    const { agent, apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const cred = (
      await credentials(asOwner, mkt.teamId).post({
        kind: 'web_login',
        label: 'GitHub',
        loginUrl: 'https://github.com/login',
        allowedDomains: [],
        username: 'bot@example.com',
        password: 'fake-password',
        totpSecret: TOTP,
      })
    ).data!;
    await credential(asOwner, mkt.teamId, cred.id).grants.put({ agentIds: [agent.id] });
    const res = await internal('/internal/browser-gateway/login-code', {
      agentKey: apiKey,
      credentialId: cred.id,
      frameOrigin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toMatch(/\d{6}/);
  });

  it('refuses a call that names another project through a project socket', async () => {
    const { asOwner, mkt } = await setup();
    await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const { apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const res = await internal('/internal/browser-gateway/resolve', {
      agentKey: apiKey,
      projectSlug: 'mkt',
      via: 'ops',
    });
    expect(res.status).toBe(403);
  });

  it("keeps Home's socket for the Home-Master, which may act on Home and on its projects", async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const asOwner = authedApi(owner.cookie);
    // The Home-Master joins every project created after it.
    const home = await bootstrapHomeAgent();
    if (home.status !== 'ready') throw new Error('no Home agent');
    const mkt = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
    const { apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const server = (await servers(asOwner, mkt.teamId).get()).data!.find(
      (row) => row.name === 'projekt-browser',
    )!;
    await agentServers(asOwner, mkt.teamId, home.agentId).put({ mcpServerIds: [server.id] });

    // A project agent may not use Home's socket.
    const intruder = await internal('/internal/browser-gateway/resolve', {
      agentKey: apiKey,
      projectSlug: 'home',
      via: 'home',
    });
    expect(intruder.status).toBe(403);
    // The Home-Master may not use a project's socket.
    const wrongSocket = await internal('/internal/browser-gateway/resolve', {
      agentKey: home.apiKey,
      projectSlug: 'mkt',
      via: 'mkt',
    });
    expect(wrongSocket.status).toBe(403);
    // Home's own browser: no project, default settings.
    const own = await internal('/internal/browser-gateway/resolve', {
      agentKey: home.apiKey,
      projectSlug: 'home',
      via: 'home',
    });
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({
      projectId: null,
      projectKey: null,
      browserGatewayEnabled: true,
      settings: { lockTimeoutSec: 120 },
    });
    // A project it works in, through Home's socket.
    const project = await internal('/internal/browser-gateway/resolve', {
      agentKey: home.apiKey,
      projectSlug: 'mkt',
      via: 'home',
    });
    expect(project.status).toBe(200);
    expect(await project.json()).toMatchObject({ projectId: mkt.id, projectKey: 'MKT' });
    // Its actions on Home's own browser are recorded without a project.
    const audit = await internal('/internal/browser-gateway/audit', {
      agentKey: home.apiKey,
      projectSlug: 'home',
      via: 'home',
      actor: 'agent',
      tool: 'browser_navigate',
      target: 'https://example.com/',
    });
    expect(audit.status).toBe(200);
  });

  it('files a handover card in Freigaben and closes it once the owner gave control back', async () => {
    const { asOwner, mkt } = await setup();
    const { apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const filed = await internal('/internal/browser-gateway/handover', {
      agentKey: apiKey,
      projectSlug: 'mkt',
      via: 'mkt',
      reason: 'Bitte das CAPTCHA lösen',
    });
    expect(filed.status).toBe(200);
    const { approvalId } = (await filed.json()) as { approvalId: number };
    const pending = await asOwner.approvals.get({ query: { status: 'pending' } });
    const card = pending.data!.items.find((item) => item.id === approvalId)!;
    expect(card.action).toBe('Bitte übernehmen: Bitte das CAPTCHA lösen');
    expect(card.details).toContain('/project/MKT?tool=browser');

    const done = await internal('/internal/browser-gateway/handover-done', {
      approvalId,
      finished: true,
    });
    expect(done.status).toBe(200);
    const after = await asOwner.approvals.get({ query: { status: 'decided' } });
    const closed = after.data!.items.find((item) => item.id === approvalId)!;
    expect(closed.followUpRunId).toBeNull();
  });

  it('never closes an ordinary approval through the handover route', async () => {
    const { asOwner, mkt } = await setup();
    const { agent } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const { createApprovalRequest } = await import('#modules/approvals/service');
    const { approval } = await createApprovalRequest({
      projectId: mkt.id,
      agent: { id: agent.id, userId: agent.userId },
      kind: 'other',
      action: 'Send the newsletter',
    });
    await internal('/internal/browser-gateway/handover-done', {
      approvalId: approval.id,
      finished: true,
    });
    const pending = await asOwner.approvals.get({ query: { status: 'pending' } });
    expect(pending.data!.items.some((item) => item.id === approval.id)).toBe(true);
  });

  it("files a download into the project's Inbox and records it", async () => {
    const vault = mkdtempSync(join(tmpdir(), 'browser-gateway-vault-'));
    const previous = process.env.PROJECT_VAULT_ROOT;
    process.env.PROJECT_VAULT_ROOT = vault;
    try {
      const { asOwner, mkt } = await setup();
      const { apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
      const first = await internal('/internal/browser-gateway/download', {
        projectSlug: 'mkt',
        agentKey: apiKey,
        fileName: '../../etc/invoice.pdf',
        data: Buffer.from('%PDF').toString('base64'),
      });
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ path: 'Projects/MKT/Inbox/invoice.pdf' });
      expect(readFileSync(join(vault, 'Projects/MKT/Inbox/invoice.pdf'), 'utf8')).toBe('%PDF');
      const second = await internal('/internal/browser-gateway/download', {
        projectSlug: 'mkt',
        agentKey: null,
        fileName: 'invoice.pdf',
        data: Buffer.from('%PDF-2').toString('base64'),
      });
      expect(((await second.json()) as { path: string }).path).not.toBe(
        'Projects/MKT/Inbox/invoice.pdf',
      );
      const events = await asOwner.projects({ projectKey: 'MKT' })['browser-gateway'].events.get();
      expect(events.data!.items.map((item) => [item.tool, item.actor, item.category])).toEqual([
        ['browser_download', 'owner', 'execute'],
        ['browser_download', 'agent', 'execute'],
      ]);
    } finally {
      process.env.PROJECT_VAULT_ROOT = previous;
    }
  });

  it('turns the gateway on for the Home-Master and the coordinators, and only once', async () => {
    const { asOwner, mkt } = await setup();
    const home = await bootstrapHomeAgent();
    if (home.status !== 'ready') throw new Error('no Home agent');
    await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const { setupBrowserGateway } = await import('../../../../scripts/setup-browser-gateway');
    const dry = await setupBrowserGateway(true);
    const first = await setupBrowserGateway(false);
    expect(first.enabled.map((entry) => entry.why).sort()).toEqual(
      dry.enabled.map((entry) => entry.why).sort(),
    );
    expect(first.enabled.some((entry) => entry.why === 'home')).toBe(true);
    expect(first.enabled.some((entry) => entry.username === 'hermes-ops-coordinator')).toBe(true);
    const again = await setupBrowserGateway(false);
    expect(again.enabled).toEqual([]);
    const resolved = await internal('/internal/browser-gateway/resolve', {
      agentKey: home.apiKey,
      projectSlug: 'home',
      via: 'home',
    });
    expect(
      ((await resolved.json()) as { browserGatewayEnabled: boolean }).browserGatewayEnabled,
    ).toBe(true);
    expect(mkt.teamId).toBeGreaterThan(0);
  });
});
