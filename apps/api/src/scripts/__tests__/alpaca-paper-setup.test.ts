import { beforeEach, describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  aiAgent,
  agentTool,
  agentToolLink,
  db,
  integrationCredential,
  integrationCredentialGrant,
  projectMember,
  sealCredential,
} from '@repo/db';
import { buildMcpServer } from '#mcp/server';
import { replaceGrants } from '#modules/agents/credentials/grants';
import { and, eq, sql } from 'drizzle-orm';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { createCredential } from '#tests/helpers/integrations';
import { PAPER_SETUP_DEFAULTS, setupAlpacaPaper } from '../alpaca-paper-setup';

const moduleRoot = resolve(import.meta.dir, '../../../../..');
const syntheticKeys = { keyId: 'PKPAPERFIXTUREONLY', secretKey: 'synthetic-paper-secret' };
let reads = 0;
const readPaper = async () => {
  reads++;
  return { active: true, positions: 0, openOrders: 0, marketOpen: false };
};
const run = (mode: 'dry-run' | 'check' | 'apply' = 'apply') =>
  setupAlpacaPaper({ mode, moduleRoot, readPaper });

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const result = await api.projects.post({ key: 'TRADE', name: 'Synthetic paper setup' });
  expect(result.status).toBe(201);
  const project = result.data!;
  expect(project.teamId).toBe(1);
  // The operator intentionally accepts only the reviewed live manifest. Fixtures are
  // created through the API; only private test sequences reproduce its exact IDs.
  await db.execute(sql`select setval(pg_get_serial_sequence('ai_agent', 'id'), 65)`);
  const agent = await createAgent(api, 'TRADE', {
    name: 'Synthetic paper trader',
    username: 'paper-trader-trade',
    kind: 'external',
  });
  expect(agent.status).toBe(201);
  expect(agent.data!.agent.id).toBe(66);
  await db.execute(sql`select setval(pg_get_serial_sequence('integration_credential', 'id'), 42)`);
  for (const [index, value] of Object.values(syntheticKeys).entries()) {
    const source = await api.teams({ teamId: 1 }).credentials.post({
      kind: 'api_key',
      label: `Synthetic source ${index}`,
      value,
      projectId: project.id,
    });
    expect(source.status).toBe(201);
    expect(source.data!.id).toBe(43 + index);
  }
  return { api, project, agent: agent.data!.agent, apiKey: agent.data!.apiKey! };
}

async function counts() {
  const [row] = await db.execute(sql`select
    (select count(*)::int from integration_credential) as credentials,
    (select count(*)::int from integration_credential_grant) as grants,
    (select count(*)::int from agent_tool) as tools,
    (select count(*)::int from agent_tool_link) as links,
    (select count(*)::int from integration_credential_use) as audit,
    (select count(*)::int from helena_paper_order_intent) as intents,
    (select count(*)::int from agent_run) as runs,
    (select count(*)::int from notification_delivery) as deliveries`);
  return row;
}

async function withPaperMcp(
  work: (
    fixture: Awaited<ReturnType<typeof setup>> & {
      client: Client;
      seen: string[];
      credentialId: number;
    },
  ) => Promise<void>,
  agentProject?: string,
) {
  const fixture = await setup();
  const applied = await run();
  const server = await buildMcpServer(
    app,
    { kind: 'api-key', apiKey: fixture.apiKey },
    fixture.agent.userId,
    { agentProject },
  );
  const client = new Client({ name: 'paper-read-fixture', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const seen: string[] = [];
  const originalFetch = globalThis.fetch;
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
    expect(['https://paper-api.alpaca.markets', 'https://data.alpaca.markets']).toContain(
      url.origin,
    );
    seen.push(url.pathname);
    if (url.pathname === '/v2/account')
      return Response.json({
        status: 'ACTIVE',
        currency: 'USD',
        equity: '100000',
        last_equity: '100000',
        cash: '100000',
        buying_power: '100000',
        trading_blocked: false,
        account_blocked: false,
      });
    if (url.pathname === '/v2/positions' || url.pathname === '/v2/orders') return Response.json([]);
    if (url.pathname === '/v2/clock')
      return Response.json({
        is_open: false,
        next_open: '2026-09-28T13:30:00Z',
        next_close: '2026-09-28T20:00:00Z',
      });
    if (url.pathname === '/v2/stocks/trades/latest')
      return Response.json({ trades: { SPY: { p: 100, t: new Date().toISOString() } } });
    throw new Error('Unexpected fixture request');
  };
  globalThis.fetch = Object.assign(fakeFetch, {
    preconnect: () => {
      throw new Error('No network');
    },
  });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await work({ ...fixture, client, seen, credentialId: applied.credentialId! });
  } finally {
    await client.close();
    await server.close();
    globalThis.fetch = originalFetch;
  }
}

async function paperCall(client: Client, name: string, args: Record<string, unknown> = {}) {
  return CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
}

async function paperCredential(
  api: Awaited<ReturnType<typeof setup>>['api'],
  overrides: Record<string, unknown> = {},
) {
  return createCredential(api, 'TRADE', {
    integrationKey: 'alpaca_paper',
    credential: { ...PAPER_SETUP_DEFAULTS, ...syntheticKeys, ...overrides },
  });
}

describe('reviewed paper operator setup', () => {
  beforeEach(async () => {
    await resetDb();
    reads = 0;
  });

  it('defaults to a no-write dry-run and changes only the exact agent on apply; reruns are no-ops', async () => {
    const { api, project } = await setup();
    const foreign = await createAgent(api, 'TRADE', {
      name: 'Other agent',
      username: 'other-agent',
      kind: 'external',
    });
    expect(foreign.status).toBe(201);
    const before = await counts();
    const dry = await run('dry-run');
    expect(dry).toMatchObject({
      credentialId: null,
      agentId: 66,
      projectId: project.id,
      changed: false,
      ordersPlaced: 0,
    });
    expect(dry.limits.halted).toBe(true);
    expect(reads).toBe(0);
    expect(await counts()).toEqual(before);
    const result = await run();
    expect(result.changed).toBe(true);
    expect(result.limits.halted).toBe(true);
    const [detail] = await db
      .select({ projectId: integrationCredential.projectId })
      .from(integrationCredential)
      .where(eq(integrationCredential.id, result.credentialId!));
    expect(detail!.projectId).toBe(project.id);
    const grants = await db
      .select()
      .from(integrationCredentialGrant)
      .where(eq(integrationCredentialGrant.credentialId, result.credentialId!));
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ agentId: 66, projectId: null, access: 'write' });
    const tools = await api
      .teams({ teamId: 1 })
      ['ai-agents']({ agentId: 66 })
      ['tool-configs'].get();
    expect(tools.data!.map((tool) => tool.toolKey)).toContain('alpaca_paper_account');
    expect(tools.data!.every((tool) => tool.credentialId === result.credentialId)).toBe(true);
    expect(
      (
        await api
          .teams({ teamId: 1 })
          ['ai-agents']({ agentId: foreign.data!.agent.id })
          ['tool-configs'].get()
      ).data,
    ).toEqual([]);
    for (const credentialId of [43, 44]) {
      expect(
        await db
          .select()
          .from(integrationCredentialGrant)
          .where(eq(integrationCredentialGrant.credentialId, credentialId)),
      ).toEqual([]);
    }
    const applied = await counts();
    expect(applied).toMatchObject({ runs: before!.runs, deliveries: before!.deliveries });
    expect((await run()).changed).toBe(false);
    expect(await counts()).toEqual(applied);
    expect(reads).toBe(2);
  });

  it('the actual client performs only the four paper GET reads, with no network or orders', async () => {
    await setup();
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://paper-api.alpaca.markets');
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('error');
      seen.push(url.pathname);
      if (url.pathname === '/v2/account')
        return Response.json({ status: 'ACTIVE', account_blocked: false, trading_blocked: false });
      if (url.pathname === '/v2/clock') return Response.json({ is_open: false });
      if (url.pathname === '/v2/positions' || url.pathname === '/v2/orders')
        return Response.json([]);
      throw new Error('Unexpected fixture request');
    };
    globalThis.fetch = Object.assign(fakeFetch, {
      preconnect: () => {
        throw new Error('No network');
      },
    });
    try {
      const before = await counts();
      const result = await setupAlpacaPaper({ mode: 'check', moduleRoot });
      expect(result.ordersPlaced).toBe(0);
      expect(seen.sort()).toEqual(['/v2/account', '/v2/clock', '/v2/orders', '/v2/positions']);
      expect(await counts()).toEqual(before);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refuses foreign native tool bindings before reading the provider or rewriting grants', async () => {
    const { api } = await setup();
    const credentialId = await paperCredential(api);
    const other = await createAgent(api, 'TRADE', {
      name: 'Other agent',
      username: 'other-agent',
      kind: 'external',
    });
    const tool = await api
      .teams({ teamId: 1 })
      ['agent-tools'].post({ toolKey: 'alpaca_paper_account', credentialId });
    expect(tool.status).toBe(201);
    expect(
      (
        await api
          .teams({ teamId: 1 })
          ['ai-agents']({ agentId: other.data!.agent.id })
          ['tool-configs'].put({ agentToolIds: [tool.data!.id] })
      ).status,
    ).toBe(200);
    const before = await counts();
    await expect(run()).rejects.toThrow('foreign-native-tool-binding');
    expect(reads).toBe(0);
    expect(await counts()).toEqual(before);
  });

  it('refuses an existing grant for another agent without replacing it', async () => {
    const { api } = await setup();
    const credentialId = await paperCredential(api);
    const other = await createAgent(api, 'TRADE', {
      name: 'Other agent',
      username: 'other-agent',
      kind: 'external',
    });
    // Native connector credentials have no access-center grant endpoint; seed
    // this legacy grant through the same bounded service used by the operator.
    await replaceGrants(
      { id: credentialId, teamId: 1, projectId: null, projectKey: null, services: [] },
      [{ agentId: other.data!.agent.id, access: 'write' }],
    );
    const before = await counts();
    await expect(run()).rejects.toThrow('foreign-paper-grant');
    expect(reads).toBe(0);
    expect(await counts()).toEqual(before);
  });

  for (const halt of [false, undefined]) {
    it(`refuses ${halt === undefined ? 'missing' : 'false'} actual halt even when all numeric limits are valid`, async () => {
      const { api } = await setup();
      const credentialId = await paperCredential(api);
      // Reproduce an older stored credential with missing flag, without changing
      // the current API's defaulting behavior. These are exclusively dummy values.
      const values = { ...PAPER_SETUP_DEFAULTS, ...syntheticKeys, tradingHalted: halt };
      await db
        .update(integrationCredential)
        .set(sealCredential(credentialId, JSON.stringify(values)))
        .where(eq(integrationCredential.id, credentialId));
      const before = await counts();
      await expect(run()).rejects.toThrow('paper-entry-halt-required');
      expect(reads).toBe(0);
      expect(await counts()).toEqual(before);
    });
  }

  it('preserves existing owner limits and encrypted values through check and apply', async () => {
    const { api } = await setup();
    const credentialId = await paperCredential(api, {
      maxOrderValueUsd: 73,
      maxRiskPerTradeUsd: 11,
      allowedSymbols: 'SPY, QQQ',
      allowCrypto: true,
    });
    const [before] = await db
      .select({
        ciphertext: integrationCredential.ciphertext,
        iv: integrationCredential.iv,
        authTag: integrationCredential.authTag,
      })
      .from(integrationCredential)
      .where(eq(integrationCredential.id, credentialId));
    const beforeCounts = await counts();
    expect((await run('check')).changed).toBe(false);
    expect(await counts()).toEqual(beforeCounts);
    const result = await run();
    expect(result.limits).toMatchObject({
      maxOrderValueUsd: 73,
      maxRiskPerTradeUsd: 11,
      allowedSymbols: ['SPY', 'QQQ'],
      allowCrypto: true,
      halted: true,
    });
    const [after] = await db
      .select({
        ciphertext: integrationCredential.ciphertext,
        iv: integrationCredential.iv,
        authTag: integrationCredential.authTag,
      })
      .from(integrationCredential)
      .where(eq(integrationCredential.id, credentialId));
    expect(after).toEqual(before);
  });

  it('reads the configured paper account, positions, orders and market through actual agent MCP dispatch', async () => {
    await withPaperMcp(async ({ client, seen }) => {
      const before = await counts();
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toContain('alpaca_paper_account');
      const account = await paperCall(client, 'alpaca_paper_account');
      expect(account.isError).not.toBe(true);
      expect(account.structuredContent).toMatchObject({
        paper: true,
        account: { status: 'ACTIVE' },
        limits: { halted: true, allowCrypto: false },
        missingLimits: [],
      });
      for (const name of ['alpaca_paper_positions', 'alpaca_paper_orders'])
        expect((await paperCall(client, name)).isError).not.toBe(true);
      expect(
        (await paperCall(client, 'alpaca_paper_market', { symbols: ['SPY'] })).isError,
      ).not.toBe(true);
      expect([...new Set(seen)].sort()).toEqual([
        '/v2/account',
        '/v2/clock',
        '/v2/orders',
        '/v2/positions',
        '/v2/stocks/trades/latest',
      ]);
      const after = await counts();
      expect(after).toEqual({ ...before, audit: Number(before!.audit) + 4 });
      expect(after).toMatchObject({ intents: 0, runs: 0, deliveries: 0 });
    });
  });

  for (const mutation of [
    'unbind',
    'credential-project',
    'credential-team',
    'tool-team',
    'agent-project',
  ] as const) {
    it(`refuses a retained MCP tool after ${mutation} changes before another broker read`, async () => {
      await withPaperMcp(async ({ api, agent, client, seen, credentialId }) => {
        expect((await paperCall(client, 'alpaca_paper_account')).isError).not.toBe(true);
        const otherProject = await api.projects.post({ key: 'OTHER', name: 'Other project' });
        expect(otherProject.status).toBe(201);
        const otherTeam = await api.teams.post({ name: 'Other team' });
        expect(otherTeam.status).toBe(201);
        if (mutation === 'unbind')
          await db.delete(agentToolLink).where(eq(agentToolLink.agentId, agent.id));
        if (mutation === 'credential-project')
          await db
            .update(integrationCredential)
            .set({ projectId: otherProject.data!.id })
            .where(eq(integrationCredential.id, credentialId));
        if (mutation === 'credential-team')
          await db
            .update(integrationCredential)
            .set({ teamId: otherTeam.data!.id })
            .where(eq(integrationCredential.id, credentialId));
        if (mutation === 'tool-team')
          await db
            .update(agentTool)
            .set({ teamId: otherTeam.data!.id })
            .where(eq(agentTool.credentialId, credentialId));
        if (mutation === 'agent-project')
          await db
            .update(projectMember)
            .set({ projectId: otherProject.data!.id })
            .where(eq(projectMember.userId, agent.userId));
        const before = await counts();
        const calls = seen.length;
        const denied = await paperCall(client, 'alpaca_paper_account');
        expect(denied.isError).toBe(true);
        expect(denied.structuredContent).toMatchObject({ error: { status: 403 } });
        expect(seen).toHaveLength(calls);
        expect(await counts()).toEqual(before);
      });
    });
  }

  for (const socketProject of [undefined, 'home', 'trade', 'other']) {
    it(`retains explicit multi-project membership while respecting ${socketProject ?? 'unscoped chat'} context`, async () => {
      await withPaperMcp(async ({ api, agent, project, client, seen }) => {
        const other = await api.projects.post({ key: 'OTHER', name: 'Other project' });
        expect(other.status).toBe(201);
        await db.insert(projectMember).values({ projectId: other.data!.id, userId: agent.userId });
        if (socketProject === 'home')
          await db.update(aiAgent).set({ username: 'master' }).where(eq(aiAgent.id, agent.id));
        const before = seen.length;
        const result = await paperCall(client, 'alpaca_paper_account');
        if (socketProject === 'other') {
          expect(result.isError).toBe(true);
          expect(result.structuredContent).toMatchObject({ error: { status: 403 } });
          expect(seen).toHaveLength(before);
        } else {
          expect(result.isError).not.toBe(true);
          expect(result.structuredContent).toMatchObject({ paper: true, limits: { halted: true } });
        }
        await db
          .delete(projectMember)
          .where(
            and(eq(projectMember.projectId, project.id), eq(projectMember.userId, agent.userId)),
          );
        const calls = seen.length;
        expect((await paperCall(client, 'alpaca_paper_account')).isError).toBe(true);
        expect(seen).toHaveLength(calls);
      }, socketProject);
    });
  }
});
