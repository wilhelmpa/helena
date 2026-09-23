import { describe, it, expect, beforeEach } from 'bun:test';
import { auth } from '@repo/auth';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { bootstrapHomeAgent } from '../../../scripts/bootstrap-home-agent';
import { AGENT_PROJECT_HEADER } from '../../agent-socket';

// An isolated agent reaches the API only through the agent socket, which names the
// project of the Unix user that connected. The header narrows what a credential may do:
// only the key of an agent of that project gets through, and never to the control plane.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const home = await bootstrapHomeAgent();
  if (home.status !== 'ready') throw new Error('Home agent was not provisioned');
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
  const agent = await createAgent(asOwner, 'MKT', {
    name: 'Writer',
    username: 'writer',
    kind: 'external',
  });
  const personal = await auth.api.createApiKey({ body: { userId: owner.userId, name: 'cli' } });
  return {
    owner,
    homeKey: home.apiKey,
    agentKey: agent.data!.apiKey!,
    personalKey: personal.key,
  };
}

function get(path: string, headers: Record<string, string>) {
  return app.handle(new Request(`http://localhost${path}`, { headers }));
}

function mcpInitialize(headers: Record<string, string>) {
  return app.handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      }),
    }),
  );
}

describe('agent socket', () => {
  beforeEach(resetDb);

  it('lets an agent key through for its own project', async () => {
    const { agentKey } = await setup();
    const res = await get('/projects', { 'x-api-key': agentKey, [AGENT_PROJECT_HEADER]: 'mkt' });
    expect(res.status).toBe(200);
  });

  it("refuses an agent key for another project's socket", async () => {
    const { agentKey } = await setup();
    const res = await get('/projects', { 'x-api-key': agentKey, [AGENT_PROJECT_HEADER]: 'ops' });
    expect(res.status).toBe(403);
  });

  it("refuses a person's API key on the agent socket", async () => {
    const { personalKey } = await setup();
    const res = await get('/projects', { 'x-api-key': personalKey, [AGENT_PROJECT_HEADER]: 'mkt' });
    expect(res.status).toBe(403);
    // Without the header the same key works as before.
    expect((await get('/projects', { 'x-api-key': personalKey })).status).toBe(200);
  });

  it('refuses a session cookie on the agent socket', async () => {
    const { owner } = await setup();
    const res = await get('/projects', { cookie: owner.cookie, [AGENT_PROJECT_HEADER]: 'mkt' });
    expect(res.status).toBe(403);
  });

  it('keeps the Home agent to Home and project agents out of it', async () => {
    const { homeKey, agentKey } = await setup();
    const asHome = { 'x-api-key': homeKey };
    expect((await get('/projects', { ...asHome, [AGENT_PROJECT_HEADER]: 'home' })).status).toBe(
      200,
    );
    expect((await get('/projects', { ...asHome, [AGENT_PROJECT_HEADER]: 'mkt' })).status).toBe(403);
    const res = await get('/projects', { 'x-api-key': agentKey, [AGENT_PROJECT_HEADER]: 'home' });
    expect(res.status).toBe(403);
  });

  it('refuses a malformed project name', async () => {
    const { agentKey } = await setup();
    const res = await get('/projects', { 'x-api-key': agentKey, [AGENT_PROJECT_HEADER]: '../x' });
    expect(res.status).toBe(403);
  });

  it('keeps the control plane and the sign-in flows out of reach', async () => {
    const { agentKey } = await setup();
    const headers = { 'x-api-key': agentKey, [AGENT_PROJECT_HEADER]: 'mkt' };
    for (const path of ['/internal/agent-egress/policy', '/api/auth/get-session', '/auth/verify']) {
      expect((await get(path, headers)).status).toBe(403);
    }
  });

  it('checks the project on the MCP endpoint too', async () => {
    const { agentKey } = await setup();
    const bearer = { authorization: `Bearer ${agentKey}` };
    expect((await mcpInitialize({ ...bearer, [AGENT_PROJECT_HEADER]: 'mkt' })).status).toBe(200);
    expect((await mcpInitialize({ ...bearer, [AGENT_PROJECT_HEADER]: 'ops' })).status).toBe(403);
    expect((await mcpInitialize({ [AGENT_PROJECT_HEADER]: 'mkt' })).status).toBe(403);
  });
});
