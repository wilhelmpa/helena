import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { app, apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { bootstrapHomeAgent } from '../../../../scripts/bootstrap-home-agent';
import { buildMcpServer } from '#mcp/server';
import { HostdError, useHostdTransport } from '#modules/server/hostd';

let calls: Array<{ method: string; input: Record<string, unknown> }>;
const clients: Client[] = [];
beforeEach(async () => {
  await resetDb();
  calls = [];
  useHostdTransport(async (method, input) => {
    calls.push({ method, input });
    if (method === 'DevelopmentEnqueue') return { number: 165, file: '165-api-fix.md' };
    if (method === 'DevelopmentStatus')
      return { queue: ['165-api-fix.md'], log: 'starte 164', running: [{ pid: 123, number: 164 }] };
    if (method === 'DevelopmentReport') {
      if (input.number === 999) throw new HostdError('NotFound', 'Report not found');
      return { number: input.number, content: 'Tested; no deploy' };
    }
    if (method === 'DevelopmentRelease')
      return {
        liveSha: 'a'.repeat(40),
        gates: [
          {
            file: 'api-full.log',
            summary: ['42 pass', '0 fail'],
            available: true,
            modifiedAt: '2026-09-30T10:00:00Z',
          },
        ],
      };
    return { enabled: true, directOnly: false, unrestricted: true, epoch: 1 };
  });
});
afterEach(async () => {
  useHostdTransport(null);
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function setup() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'DEV', name: 'Development' });
  const home = await bootstrapHomeAgent();
  if (home.status !== 'ready') throw new Error('Home missing');
  const other = await createAgent(asOwner, 'DEV', {
    name: 'Other',
    username: 'other',
    kind: 'external',
  });
  return { owner, asOwner, home, other: other.data!, asHome: apiKeyApi(home.apiKey) };
}
async function request(key: string | undefined, path: string, body?: unknown, cookie?: string) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { 'x-api-key': key } : {}),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
const task = {
  name: 'api-fix',
  body: '# Auftrag\nBasis hub/rel-12',
  model: 'gpt-6.1-sol',
  effort: 'high',
};

async function mcp(key: string, userId: string) {
  const server = await buildMcpServer(app, { kind: 'api-key', apiKey: key }, userId);
  const client = new Client({ name: 'development-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

describe('Home development tools', () => {
  it('enqueues and reads all bounded host operations', async () => {
    const { home } = await setup();
    const queued = await request(home.apiKey, '/agent-development/tasks', task);
    expect(queued.status).toBe(200);
    expect(await queued.json()).toEqual({ number: 165, file: '165-api-fix.md' });
    expect(calls[0]).toEqual({
      method: 'DevelopmentEnqueue',
      input: { ...task, body: { text: task.body }, actor: `agent:${home.agentId}` },
    });
    for (const path of ['status', 'reports/164', 'release'])
      expect((await request(home.apiKey, `/agent-development/${path}`)).status).toBe(200);
    expect((await request(home.apiKey, '/agent-development/reports/999')).status).toBe(404);
  });
  it('refuses owner sessions and other agent roles before touching the host', async () => {
    const { home, other, owner } = await setup();
    for (const path of ['status', 'reports/164', 'release', 'tasks']) {
      for (const key of [other.apiKey!, undefined]) {
        const response = await request(
          key,
          `/agent-development/${path}`,
          path === 'tasks' ? task : undefined,
          key ? undefined : owner.cookie,
        );
        expect(response.status).toBe(403);
      }
    }
    expect(calls).toEqual([]);
    for (const name of ['../x', '/tmp/x', 'a.md', 'a\nb', 'a;echo'])
      expect(
        (await request(home.apiKey, '/agent-development/tasks', { ...task, name })).status,
      ).toBe(400);
    for (const number of ['0', '-1', '1.5', '1000000000'])
      expect((await request(home.apiKey, `/agent-development/reports/${number}`)).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it('documents all development operations and the unrestricted switch in OpenAPI', async () => {
    const response = await app.handle(new Request('http://localhost/docs/json'));
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      paths: Record<
        string,
        Record<
          string,
          {
            responses: Record<string, unknown>;
            requestBody?: {
              content: Record<string, { schema: { properties: Record<string, { type: string }> } }>;
            };
          }
        >
      >;
    };
    for (const [path, method] of [
      ['/agent-development/tasks', 'post'],
      ['/agent-development/status', 'get'],
      ['/agent-development/reports/{number}', 'get'],
      ['/agent-development/release', 'get'],
    ]) {
      const operation = document.paths[path!]?.[method!];
      expect(operation).toBeDefined();
      for (const status of ['200', '400', '403', '404', '503'])
        expect(operation.responses[status]).toBeDefined();
    }
    const settings =
      document.paths['/god/root-access']!.put!.requestBody!.content['application/json']!.schema;
    expect(settings.properties.unrestricted?.type).toBe('boolean');
  });
  it('lists and executes MCP tools only for Home, including guessed calls', async () => {
    const { home, other, asOwner } = await setup();
    const teamId = other.agent.teamId;
    const homeAgent = (
      await asOwner.teams({ teamId })['ai-agents']({ agentId: home.agentId }).get()
    ).data!;
    const homeClient = await mcp(home.apiKey, homeAgent.userId);
    const otherClient = await mcp(other.apiKey!, other.agent.userId);
    const names = [
      'enqueue_codex_task',
      'get_codex_queue',
      'read_codex_report',
      'get_development_release',
    ];
    const listed = (await homeClient.listTools()).tools.map((tool) => tool.name);
    expect(listed).toEqual(expect.arrayContaining(names));
    expect(listed).toContain('run_as_root');
    expect(
      (await otherClient.listTools()).tools
        .map((tool) => tool.name)
        .filter((name) => names.includes(name)),
    ).toEqual([]);
    expect(
      (await homeClient.callTool({ name: 'enqueue_codex_task', arguments: task })).isError,
    ).not.toBe(true);
    for (const [name, args] of [
      ['get_codex_queue', {}],
      ['read_codex_report', { number: 164 }],
      ['get_development_release', {}],
    ] as const)
      expect((await homeClient.callTool({ name, arguments: args })).isError).not.toBe(true);
    const count = calls.length;
    expect(
      (await otherClient.callTool({ name: 'enqueue_codex_task', arguments: task })).isError,
    ).toBe(true);
    expect(calls).toHaveLength(count);
  });
});
