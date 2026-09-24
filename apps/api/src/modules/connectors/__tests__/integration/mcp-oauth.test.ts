import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { readAccountSecrets, updateAccount } from '../../store';

// An MCP server that signs in with OAuth (the MCP authorization spec), against a fake
// server and authorization server: discovery, dynamic registration, PKCE, the pasted
// address, the bearer token the runner gets for the server's Authorization header, and
// its refresh. The tokens never leave the API otherwise.

let server: ReturnType<typeof Bun.serve>;
let base = '';
const seen: { path: string; body: string }[] = [];
let issued = 0;
const previousSsrf = process.env.SSRF_ALLOW_PRIVATE;

beforeAll(() => {
  // The fake servers listen on loopback, which the URL guard refuses otherwise.
  process.env.SSRF_ALLOW_PRIVATE = '1';
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === 'POST' ? await request.text() : '';
      seen.push({ path: url.pathname, body });
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
        return Response.json({ resource: `${base}/mcp`, authorization_servers: [base] });
      }
      if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
        return Response.json({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        });
      }
      if (url.pathname === '/register') {
        const metadata = JSON.parse(body) as Record<string, unknown>;
        return Response.json({ ...metadata, client_id: 'helena-client' }, { status: 201 });
      }
      if (url.pathname === '/token') {
        const params = new URLSearchParams(body);
        issued++;
        return Response.json({
          access_token: `access-${issued}`,
          refresh_token: 'refresh-secret',
          expires_in: 3600,
          token_type: 'Bearer',
          ...(params.get('grant_type') === 'refresh_token' ? {} : {}),
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  if (previousSsrf === undefined) delete process.env.SSRF_ALLOW_PRIVATE;
  else process.env.SSRF_ALLOW_PRIVATE = previousSsrf;
});

beforeEach(async () => {
  await resetDb();
  seen.length = 0;
  issued = 0;
});

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const project = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  return { asOwner, teamId: project.teamId };
}

async function agent(asOwner: Api) {
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Coder',
    username: 'coder',
    kind: 'external',
  });
  return { ...created.data!.agent, asRunner: apiKeyApi(created.data!.apiKey!) };
}

describe('MCP servers with OAuth', () => {
  it('signs in, hands the runner a bearer token for the server, and refreshes it', async () => {
    const { asOwner, teamId } = await setup();
    const mcp = asOwner.teams({ teamId }).connectors['mcp-oauth'];
    const started = await mcp.post({ label: 'Linear', serverUrl: `${base}/mcp` });
    expect(started.status).toBe(200);
    expect(started.data!.mode).toBe('paste');
    const authorize = new URL(started.data!.url!);
    expect(authorize.origin + authorize.pathname).toBe(`${base}/authorize`);
    expect(authorize.searchParams.get('client_id')).toBe('helena-client');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('resource')).toBe(`${base}/mcp`);
    const state = authorize.searchParams.get('state')!;

    const id = started.data!.id;
    const connection = mcp({ connectionId: id });
    const wrong = await connection.finish.post({
      redirectUrl: `http://127.0.0.1:53682/?state=nope&code=abc`,
    });
    expect(wrong.status).toBe(400);
    const finished = await connection.finish.post({
      redirectUrl: `http://127.0.0.1:53682/?state=${state}&code=abc`,
    });
    expect(finished.data).toMatchObject({ id, status: 'ok', serverUrl: `${base}/mcp` });
    const exchange = new URLSearchParams(seen.find((entry) => entry.path === '/token')!.body);
    expect(exchange.get('grant_type')).toBe('authorization_code');
    expect(exchange.get('code_verifier')).toBeTruthy();

    // Listed with the credentials, never with its tokens.
    const listed = await asOwner
      .teams({ teamId })
      .credentials.get({ query: { kind: 'mcp_oauth' } });
    expect(listed.data!.items).toMatchObject([
      { id, kind: 'mcp_oauth', label: 'Linear', status: 'ok', serverUrl: `${base}/mcp` },
    ]);
    expect(JSON.stringify(listed.data)).not.toContain('access-1');
    expect(JSON.stringify(listed.data)).not.toContain('refresh-secret');

    // A server of the library sends it as its Authorization header.
    const coder = await agent(asOwner);
    const created = await asOwner.teams({ teamId })['mcp-servers'].post({
      name: 'linear',
      transport: 'http',
      url: `${base}/mcp`,
      headers: [{ name: 'Authorization', credentialId: id }],
    });
    expect(created.status).toBe(201);
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: coder.id })
      ['mcp-servers'].put({ mcpServerIds: [created.data!.id] });
    const secrets = await coder.asRunner['agent-runtime']['mcp-secrets'].get({ query: {} });
    expect(secrets.data!.secrets).toEqual({ [String(id)]: 'Bearer access-1' });

    // Expired: the next read refreshes it.
    const stored = await readAccountSecrets(id);
    const tokens = JSON.parse(stored.tokens!) as Record<string, unknown>;
    await updateAccount(id, {
      secrets: { ...stored, tokens: JSON.stringify({ ...tokens, expires_at: Date.now() - 1000 }) },
    });
    const refreshed = await coder.asRunner['agent-runtime']['mcp-secrets'].get({ query: {} });
    expect(refreshed.data!.secrets).toEqual({ [String(id)]: 'Bearer access-2' });
    const refresh = new URLSearchParams(
      seen.filter((entry) => entry.path === '/token').at(-1)!.body,
    );
    expect(refresh.get('grant_type')).toBe('refresh_token');
  });
});
