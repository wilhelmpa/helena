import { describe, it, expect, beforeEach, beforeAll } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { ensureBuiltinMcpServers } from '../../../agents/mcp-servers/service';

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
  const server = (
    await servers(asOwner, teamId).post({
      name: 'projekt-browser',
      transport: 'stdio',
      command: '/usr/local/libexec/volition-browser-gateway-mcp',
    })
  ).data!;
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
      { agentKey: 'x', projectSlug: 'mkt' },
      '',
    );
    expect(res.status).toBe(401);
  });

  it('refuses a request with the wrong service token', async () => {
    const res = await internal(
      '/internal/browser-gateway/resolve',
      { agentKey: 'x', projectSlug: 'mkt' },
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
    });
    expect(res.status).toBe(404);
  });

  it('records a non-credential tool call in the audit trail, without any value', async () => {
    const { asOwner, mkt } = await setup();
    const { agent, apiKey } = await agentWithGateway(asOwner, mkt.teamId, 'MKT', 'writer');
    const audit = await internal('/internal/browser-gateway/audit', {
      agentKey: apiKey,
      projectSlug: 'mkt',
      actor: 'agent',
      tool: 'browser_navigate',
      target: 'https://example.com/secret-path?token=abc',
    });
    expect(audit.status).toBe(200);
    const events = await asOwner.projects({ projectKey: 'MKT' })['browser-gateway'].events.get();
    expect(events.data!.items).toHaveLength(1);
    expect(events.data!.items[0]).toMatchObject({
      agentId: agent.id,
      actor: 'agent',
      tool: 'browser_navigate',
    });
  });

  it('lists the projects a user works in for the Home "Browser" overview', async () => {
    const { asOwner, mkt } = await setup();
    const overview = await asOwner['browser-gateway'].overview.get();
    expect(overview.status).toBe(200);
    expect(overview.data!.projects).toContainEqual({
      projectId: mkt.id,
      projectKey: 'MKT',
      projectName: 'Marketing',
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
    });
    const updated = await asOwner.projects({ projectKey: 'MKT' }).settings['browser-gateway'].put({
      domainBlocklist: ['bank.example'],
      humanInput: false,
      lockTimeoutSec: 60,
    });
    expect(updated.status).toBe(200);
    expect(updated.data).toMatchObject({
      domainBlocklist: ['bank.example'],
      domainAllowlist: [],
      humanInput: false,
      lockTimeoutSec: 60,
    });
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
    await ensureBuiltinMcpServers(mkt.teamId);
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
});
