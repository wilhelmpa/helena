import { describe, it, expect, beforeEach } from 'bun:test';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createCredential } from '#tests/helpers/integrations';
import { untaggedRoutes } from '#tests/helpers/mcp';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import { createAgent } from '#tests/helpers/agents';

// The team's MCP server library and the servers enabled on an agent. A value may name one
// of the team's secrets; its value reaches only the runner of an agent the server is
// enabled on, through a route of its own.

const SECRET_VALUE = 'ts_live_value_1234';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const project = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  return { asOwner, teamId: project.data!.teamId };
}

const servers = (api: Api, teamId: number) => api.teams({ teamId })['mcp-servers'];
const agentServers = (api: Api, teamId: number, agentId: number) =>
  api.teams({ teamId })['ai-agents']({ agentId })['mcp-servers'];

function typesafeSecret(asOwner: Api, projectKey = 'MKT'): Promise<number> {
  return createCredential(asOwner, projectKey, {
    integrationKey: 'secret',
    label: 'TYPESAFE_API_KEY',
    credential: { value: SECRET_VALUE },
  });
}

function jevBrowser(credentialId: number) {
  return {
    name: 'jev-browser',
    description: 'Browser agent',
    transport: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@jkudish/jev-browser'],
    env: [
      { name: 'TYPESAFE_API_KEY', credentialId },
      { name: 'JEV_BROWSER_MODEL', value: 'jev-latest' },
    ],
  };
}

async function externalAgent(asOwner: Api, username: string) {
  const created = await createAgent(asOwner, 'MKT', { name: username, username, kind: 'external' });
  return { id: created.data!.agent.id, asRunner: apiKeyApi(created.data!.apiKey!) };
}

describe('agent MCP servers', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('adds a stdio server that names a secret and never returns its value', async () => {
    const { asOwner, teamId } = await setup();
    const credentialId = await typesafeSecret(asOwner);

    const res = await servers(asOwner, teamId).post(jevBrowser(credentialId));
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      teamId,
      name: 'jev-browser',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@jkudish/jev-browser'],
      url: null,
      env: [
        {
          name: 'TYPESAFE_API_KEY',
          value: null,
          credentialId,
          credentialLabel: 'TYPESAFE_API_KEY',
        },
        { name: 'JEV_BROWSER_MODEL', value: 'jev-latest', credentialId: null },
      ],
      headers: [],
    });

    const list = await servers(asOwner, teamId).get();
    expect(list.data).toHaveLength(1);
    expect(JSON.stringify(list.data)).not.toContain(SECRET_VALUE);
  });

  it('adds an http server and clears the fields a stdio server would use', async () => {
    const { asOwner, teamId } = await setup();
    const res = await servers(asOwner, teamId).post({
      name: 'docs',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      command: 'npx',
      env: [{ name: 'IGNORED', value: 'x' }],
      headers: [{ name: 'X-Team', value: 'marketing' }],
    });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      url: 'https://mcp.example.com/mcp',
      command: null,
      args: [],
      env: [],
      headers: [{ name: 'X-Team', value: 'marketing' }],
    });
  });

  it('refuses a server its transport cannot start', async () => {
    const { asOwner, teamId } = await setup();
    const post = (body: Parameters<ReturnType<typeof servers>['post']>[0]) =>
      servers(asOwner, teamId).post(body);
    expect((await post({ name: 'shopify-dev', transport: 'stdio' })).status).toBe(400);
    expect((await post({ name: 'shopify-dev', transport: 'stdio', command: '  ' })).status).toBe(
      400,
    );
    expect((await post({ name: 'docs', transport: 'sse' })).status).toBe(400);
    expect((await post({ name: 'docs', transport: 'http', url: 'ftp://host/mcp' })).status).toBe(
      400,
    );
    expect((await post({ name: 'Docs Server', transport: 'stdio', command: 'x' })).status).toBe(
      400,
    );
    expect((await post({ name: 'shopify-dev', transport: 'stdio', command: 'npx' })).status).toBe(
      201,
    );
  });

  it('refuses a value Hermes would expand, and one that is both or neither', async () => {
    const { asOwner, teamId } = await setup();
    const credentialId = await typesafeSecret(asOwner);
    const stdio = { name: 'tool', transport: 'stdio' as const, command: 'npx' };
    for (const body of [
      { ...stdio, env: [{ name: 'KEY', value: '${ANTHROPIC_API_KEY}' }] },
      { ...stdio, args: ['--token=${GH_TOKEN}'] },
      { ...stdio, env: [{ name: 'KEY', value: 'x', credentialId }] },
      { ...stdio, env: [{ name: 'KEY' }] },
      {
        ...stdio,
        env: [
          { name: 'KEY', value: 'a' },
          { name: 'KEY', value: 'b' },
        ],
      },
      { ...stdio, env: [{ name: '1KEY', value: 'x' }] },
    ]) {
      expect((await servers(asOwner, teamId).post(body)).status).toBe(400);
    }
  });

  it('refuses a credential that is not a secret of the team', async () => {
    const { asOwner, teamId } = await setup();
    const jina = await createCredential(asOwner, 'MKT', {
      integrationKey: 'jina',
      credential: { apiKey: 'jina-key' },
    });
    const otherTeam = await asOwner.teams.post({ name: 'Design' });
    await asOwner.teams({ teamId: otherTeam.data!.id }).projects.post({ key: 'DSG', name: 'D' });
    const theirs = await typesafeSecret(asOwner, 'DSG');

    for (const credentialId of [jina, theirs, 999_999]) {
      const res = await servers(asOwner, teamId).post(jevBrowser(credentialId));
      expect(res.status).toBe(400);
    }
  });

  it('refuses a secret without a name', async () => {
    const { asOwner, teamId } = await setup();
    const res = await asOwner
      .teams({ teamId })
      .integrations.post({ integrationKey: 'secret', credential: { value: SECRET_VALUE } });
    expect(res.status).toBe(400);
    const credentialId = await typesafeSecret(asOwner);
    const rename = await asOwner
      .teams({ teamId })
      .integrations({ credentialId })
      .patch({ label: ' ' });
    expect(rename.status).toBe(400);
  });

  it('refuses a second server with the same name', async () => {
    const { asOwner, teamId } = await setup();
    const body = { name: 'shopify-dev', transport: 'stdio' as const, command: 'npx' };
    expect((await servers(asOwner, teamId).post(body)).status).toBe(201);
    const dup = await servers(asOwner, teamId).post(body);
    expect(dup.status).toBe(409);
  });

  it('updates a server and clears what its new transport does not use', async () => {
    const { asOwner, teamId } = await setup();
    const created = await servers(asOwner, teamId).post(jevBrowser(await typesafeSecret(asOwner)));
    const id = created.data!.id;

    const renamed = await servers(
      asOwner,
      teamId,
    )({ mcpServerId: id }).patch({
      description: 'Renamed',
    });
    expect(renamed.data).toMatchObject({ description: 'Renamed', command: 'npx' });

    const moved = await servers(
      asOwner,
      teamId,
    )({ mcpServerId: id }).patch({
      transport: 'sse',
      url: 'http://127.0.0.1:9000/sse',
    });
    expect(moved.status).toBe(200);
    expect(moved.data).toMatchObject({
      transport: 'sse',
      url: 'http://127.0.0.1:9000/sse',
      command: null,
      args: [],
      env: [],
    });

    const missing = await servers(
      asOwner,
      teamId,
    )({ mcpServerId: id + 100 }).patch({
      description: 'x',
    });
    expect(missing.status).toBe(404);
  });

  it('enables servers on an agent, ignoring a server of another team', async () => {
    const { asOwner, teamId } = await setup();
    const mine = await servers(asOwner, teamId).post({
      name: 'shopify-dev',
      transport: 'stdio',
      command: 'npx',
    });
    const otherTeam = await asOwner.teams.post({ name: 'Design' });
    const theirs = await servers(asOwner, otherTeam.data!.id).post({
      name: 'other',
      transport: 'stdio',
      command: 'npx',
    });
    const agent = await externalAgent(asOwner, 'shopper');

    const set = await agentServers(asOwner, teamId, agent.id).put({
      mcpServerIds: [mine.data!.id, theirs.data!.id],
    });
    expect(set.status).toBe(200);
    expect(set.data?.map((server) => server.id)).toEqual([mine.data!.id]);
    const read = await agentServers(asOwner, teamId, agent.id).get();
    expect(read.data?.map((server) => server.name)).toEqual(['shopify-dev']);

    const cleared = await agentServers(asOwner, teamId, agent.id).put({ mcpServerIds: [] });
    expect(cleared.data).toHaveLength(0);

    const foreign = await agentServers(asOwner, otherTeam.data!.id, agent.id).get();
    expect(foreign.status).toBe(404);
  });

  it('removes a deleted server from its agents', async () => {
    const { asOwner, teamId } = await setup();
    const created = await servers(asOwner, teamId).post({
      name: 'shopify-dev',
      transport: 'stdio',
      command: 'npx',
    });
    const agent = await externalAgent(asOwner, 'shopper');
    await agentServers(asOwner, teamId, agent.id).put({ mcpServerIds: [created.data!.id] });

    const del = await servers(asOwner, teamId)({ mcpServerId: created.data!.id }).delete();
    expect(del.status).toBe(204);
    expect((await agentServers(asOwner, teamId, agent.id).get()).data).toHaveLength(0);
    expect(
      (await servers(asOwner, teamId)({ mcpServerId: created.data!.id }).delete()).status,
    ).toBe(404);
  });

  it("gives the agent's runner its servers, and their secrets on a route of their own", async () => {
    const { asOwner, teamId } = await setup();
    const credentialId = await typesafeSecret(asOwner);
    await createCredential(asOwner, 'MKT', {
      integrationKey: 'secret',
      label: 'UNUSED',
      credential: { value: 'unused-value' },
    });
    const server = await servers(asOwner, teamId).post(jevBrowser(credentialId));
    const agent = await externalAgent(asOwner, 'shopper');
    const other = await externalAgent(asOwner, 'writer');
    await agentServers(asOwner, teamId, agent.id).put({ mcpServerIds: [server.data!.id] });

    const policy = await agent.asRunner['agent-runtime'].policy.get();
    expect(policy.status).toBe(200);
    expect(policy.data!.mcpServers).toEqual([
      {
        name: 'jev-browser',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@jkudish/jev-browser'],
        url: null,
        env: [
          { name: 'TYPESAFE_API_KEY', secret: credentialId },
          { name: 'JEV_BROWSER_MODEL', value: 'jev-latest' },
        ],
        headers: [],
      },
    ]);
    expect(JSON.stringify(policy.data)).not.toContain(SECRET_VALUE);

    const secrets = await agent.asRunner['agent-runtime']['mcp-secrets'].get();
    expect(secrets.status).toBe(200);
    expect(secrets.data!.secrets).toEqual({ [String(credentialId)]: SECRET_VALUE });

    const otherSecrets = await other.asRunner['agent-runtime']['mcp-secrets'].get();
    expect(otherSecrets.data!.secrets).toEqual({});
    expect((await other.asRunner['agent-runtime'].policy.get()).data!.mcpServers).toEqual([]);

    // A person's session is not a runner.
    expect((await asOwner['agent-runtime']['mcp-secrets'].get()).status).toBe(403);
  });

  it('changes the policy revision when a server of the agent changes', async () => {
    const { asOwner, teamId } = await setup();
    const server = await servers(asOwner, teamId).post({
      name: 'shopify-dev',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@shopify/dev-mcp@latest'],
    });
    const agent = await externalAgent(asOwner, 'shopper');
    const before = (await agent.asRunner['agent-runtime'].policy.get()).data!.revision;
    await agentServers(asOwner, teamId, agent.id).put({ mcpServerIds: [server.data!.id] });
    const linked = (await agent.asRunner['agent-runtime'].policy.get()).data!.revision;
    expect(linked).not.toBe(before);
    await servers(asOwner, teamId)({ mcpServerId: server.data!.id }).patch({ args: ['-y'] });
    expect((await agent.asRunner['agent-runtime'].policy.get()).data!.revision).not.toBe(linked);
  });

  it('carries the servers of a template into its copy', async () => {
    const { asOwner, teamId } = await setup();
    const project = (await asOwner.projects.get()).data!.find((p) => p.key === 'MKT')!;
    const server = await servers(asOwner, teamId).post({
      name: 'shopify-dev',
      transport: 'stdio',
      command: 'npx',
    });
    const template = await asOwner
      .teams({ teamId })
      ['ai-agents'].post({ name: 'Shop', username: 'shop', kind: 'external', template: true });
    const templateId = template.data!.agent.id;
    await agentServers(asOwner, teamId, templateId).put({ mcpServerIds: [server.data!.id] });

    const copied = await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: templateId })
      .copy.post({ projectId: project.id });
    const read = await agentServers(asOwner, teamId, copied.data!.agent.id).get();
    expect(read.data?.map((s) => s.name)).toEqual(['shopify-dev']);
  });

  it('counts the servers with the tools of the team', async () => {
    const { asOwner, teamId } = await setup();
    await servers(asOwner, teamId).post({ name: 'shopify-dev', transport: 'stdio', command: 'x' });
    const team = (await asOwner.teams.get()).data!.find((t) => t.id === teamId)!;
    expect(team.toolCount).toBe(1);
  });

  it('lets a member read the library when their role grants it, and nothing more', async () => {
    const { asOwner, teamId } = await setup();
    await servers(asOwner, teamId).post({ name: 'shopify-dev', transport: 'stdio', command: 'x' });
    const role = await createRole(asOwner, 'MKT', {
      name: 'Tool reader',
      permissions: { agent_tools: { read: true } },
    });
    const asMember = await addProjectMember(asOwner, 'MKT', role.data!.id);

    expect((await servers(asMember, teamId).get()).data).toHaveLength(1);
    const post = await servers(asMember, teamId).post({
      name: 'other',
      transport: 'stdio',
      command: 'x',
    });
    expect(post.status).toBe(403);

    const plain = await addProjectMember(asOwner, 'MKT');
    expect((await servers(plain, teamId).get()).status).toBe(403);
  });

  it('hides the library from someone outside the team', async () => {
    const { teamId } = await setup();
    const outsider = authedApi((await signUpTestUser({ name: 'Outsider' })).cookie);
    expect((await servers(outsider, teamId).get()).status).toBe(404);
  });

  // A server starts a command on the agents' machine, so it is configured in the UI only.
  it('exposes none of its routes as MCP tools', () => {
    expect(untaggedRoutes((route) => route.includes('mcp-servers'))).toEqual([
      'GET /teams/:teamId/mcp-servers',
      'POST /teams/:teamId/mcp-servers',
      'PATCH /teams/:teamId/mcp-servers/:mcpServerId',
      'DELETE /teams/:teamId/mcp-servers/:mcpServerId',
      'GET /teams/:teamId/ai-agents/:agentId/mcp-servers',
      'PUT /teams/:teamId/ai-agents/:agentId/mcp-servers',
    ]);
  });
});
