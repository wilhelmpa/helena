import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema, type CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { auth } from '@repo/auth';
import { and, eq } from 'drizzle-orm';
import { db, teamMember } from '@repo/db';
import { app, apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { buildMcpServer } from '../../server';

const clients: Client[] = [];
let externalAgentSequence = 0;

async function callTool(client: Client, params: CallToolRequest['params']) {
  return CallToolResultSchema.parse(await client.callTool(params));
}

async function connect(userId: string) {
  const { key } = await auth.api.createApiKey({ body: { userId, name: 'structured-results' } });
  return connectKey(userId, key);
}

async function connectKey(userId: string, key: string) {
  const server = await buildMcpServer(app, { kind: 'api-key', apiKey: key }, userId);
  const client = new Client({ name: 'structured-results-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

async function externalAgentClient(grants: string[]): Promise<{
  owner: Awaited<ReturnType<typeof signUpTestUser>>;
  ownerApi: ReturnType<typeof authedApi>;
  agent: { teamId: number; userId: string; apiKey: string };
  client: Client;
}> {
  const owner = await signUpTestUser();
  const ownerApi = authedApi(owner.cookie);
  const seedKey = `SEED${++externalAgentSequence}`;
  await ownerApi.projects.post({ key: seedKey, name: 'Seed' });
  const created = await createAgent(ownerApi, seedKey, {
    name: 'External creator',
    username: 'external-creator',
    kind: 'external',
    runtimePolicy: {
      reasoningEffort: null,
      toolAllow: [],
      toolDeny: [],
      mcpGrants: grants,
      files: [],
    },
  });
  const result = created.data!;
  const apiKey = result.apiKey!;
  return {
    owner,
    ownerApi,
    agent: { teamId: result.agent.teamId, userId: result.agent.userId, apiKey },
    client: await connectKey(result.agent.userId, apiKey),
  };
}

describe('MCP structured results through the SDK client', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it('compiles every advertised output schema and validates object, array, and empty results', async () => {
    const user = await signUpTestUser();
    const client = await connect(user.userId);
    const listed = await client.listTools();
    expect(listed.tools.length).toBeGreaterThan(0);
    expect(listed.tools.every((tool) => tool.outputSchema?.type === 'object')).toBe(true);
    expect(listed.tools.every((tool) => typeof tool.title === 'string' && tool.title)).toBe(true);
    expect(client.getServerVersion()).toMatchObject({ name: 'helena', title: 'Helena' });

    const created = await callTool(client, {
      name: 'create_project',
      arguments: { key: 'RESULT', name: 'Structured results' },
    });
    expect(created.isError).toBe(false);
    expect(created.structuredContent).toMatchObject({
      ok: true,
      status: 201,
      data: { key: 'RESULT', name: 'Structured results' },
    });
    const text = created.content[0];
    expect(text.type).toBe('text');
    if (text.type === 'text')
      expect(JSON.parse(text.text)).toEqual(created.structuredContent?.data);

    const projects = await callTool(client, { name: 'list_projects' });
    expect(projects.structuredContent).toMatchObject({
      ok: true,
      status: 200,
      data: [{ key: 'RESULT' }],
    });

    const deleted = await callTool(client, {
      name: 'delete_project',
      arguments: { projectKey: 'RESULT' },
    });
    expect(deleted.isError).toBe(false);
    expect(deleted.content).toEqual([{ type: 'text', text: '' }]);
    expect(deleted.structuredContent).toEqual({ ok: true, status: 204, data: null });
  });

  it('validates structured validation, conflict, and permission errors without changing their text', async () => {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    await api.projects.post({ key: 'PRIVATE', name: 'Private project' });
    const client = await connect(owner.userId);
    await client.listTools();
    for (const [args, status] of [
      [{ key: 'MISSING' }, 400],
      [{ key: 'PRIVATE', name: 'Duplicate' }, 409],
    ] as const) {
      const result = await callTool(client, { name: 'create_project', arguments: args });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        status,
        error: { code: `HTTP_${status}`, retryable: false, retryAfterSeconds: null },
      });
      const content = result.content[0];
      if (content.type === 'text') {
        expect(JSON.parse(content.text).error).toBe(
          (result.structuredContent?.error as { message: string }).message,
        );
      }
    }

    const outsider = await signUpTestUser();
    const otherClient = await connect(outsider.userId);
    await otherClient.listTools();
    const forbidden = await callTool(otherClient, {
      name: 'get_project',
      arguments: { projectKey: 'PRIVATE' },
    });
    expect(forbidden.isError).toBe(true);
    expect(forbidden.structuredContent).toMatchObject({
      ok: false,
      status: 403,
      error: { code: 'HTTP_403', retryable: false },
    });
  });

  it('returns the same error envelope for missing team arguments and unknown tools', async () => {
    const user = await signUpTestUser();
    await authedApi(user.cookie).teams.post({ name: 'Another team' });
    const client = await connect(user.userId);
    await client.listTools();
    const missing = await callTool(client, { name: 'list_ai_agents' });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({
      ok: false,
      status: 400,
      error: { code: 'HTTP_400', retryable: false },
    });
    expect(missing.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('teamId'),
    });

    const unknown = await callTool(client, { name: 'unknown_tool' });
    expect(unknown.isError).toBe(true);
    expect(unknown.content).toEqual([{ type: 'text', text: 'Unknown tool: unknown_tool' }]);
    expect(unknown.structuredContent).toMatchObject({
      ok: false,
      status: 404,
      error: { code: 'HTTP_404', retryable: false },
    });
  });

  it('lets an explicitly granted external MCP agent create for its team owner', async () => {
    const { owner, ownerApi, agent, client } = await externalAgentClient(['itsaplan']);
    const created = await callTool(client, {
      name: 'create_project',
      arguments: { key: 'MCP', name: 'Created by MCP' },
    });

    expect(created.isError).toBe(false);
    expect(created.structuredContent).toMatchObject({
      ok: true,
      status: 201,
      data: { key: 'MCP', teamId: agent.teamId },
    });
    // The owner owns it. The agent keeps to its own project: a new project takes in no
    // external agent but its coordinator and the Home agent.
    const members = await ownerApi.projects({ projectKey: 'MCP' }).members.get();
    expect(members.data?.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: owner.userId, role: 'owner' })]),
    );
    expect(members.data?.items.some((member) => member.userId === agent.userId)).toBe(false);
  });

  it('accepts the exact create_project grant and rejects an external agent with no grant', async () => {
    const exact = await externalAgentClient(['create_project']);
    const allowed = await callTool(exact.client, {
      name: 'create_project',
      arguments: { key: 'EXACT', name: 'Exact grant' },
    });
    expect(allowed.structuredContent).toMatchObject({ ok: true, status: 201 });

    const denied = await externalAgentClient([]);
    const rejected = await callTool(denied.client, {
      name: 'create_project',
      arguments: { key: 'DENIED', name: 'No grant' },
    });
    expect(rejected).toMatchObject({
      isError: true,
      structuredContent: { ok: false, status: 403 },
    });
    expect((await denied.ownerApi.projects.get()).data).toHaveLength(1);
  });

  it('rejects an external MCP agent whose recorded owner no longer owns its team', async () => {
    const { owner, agent, client } = await externalAgentClient(['itsaplan']);
    await db
      .update(teamMember)
      .set({ role: 'member' })
      .where(and(eq(teamMember.teamId, agent.teamId), eq(teamMember.userId, owner.userId)));

    const rejected = await callTool(client, {
      name: 'create_project',
      arguments: { key: 'STALE', name: 'Stale owner' },
    });
    expect(rejected).toMatchObject({
      isError: true,
      structuredContent: { ok: false, status: 403 },
    });
  });

  it('rejects external MCP project creation when the team closes its MCP surface', async () => {
    const { ownerApi, agent, client } = await externalAgentClient(['itsaplan']);
    await ownerApi.teams({ teamId: agent.teamId }).mcp.patch({ enabled: false });

    const rejected = await callTool(client, {
      name: 'create_project',
      arguments: { key: 'CLOSED', name: 'Closed team' },
    });
    expect(rejected).toMatchObject({
      isError: true,
      structuredContent: { ok: false, status: 403 },
    });
  });

  it('does not extend the external agent exception to normal HTTP', async () => {
    const { agent, ownerApi } = await externalAgentClient(['itsaplan']);
    const response = await apiKeyApi(agent.apiKey).projects.post({
      key: 'HTTP',
      name: 'Normal HTTP remains unchanged',
    });
    expect(response.status).toBe(400);
    expect((await ownerApi.projects.get()).data).toHaveLength(1);
  });
});
