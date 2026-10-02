import { afterAll, beforeAll, expect, test } from 'bun:test';
import { toJsonSchema, toMcpTool } from '@helena/sdk';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import catalog from '../../../../../../scripts/tool-regression/catalog.json';
import { sample, invalidInput } from '../../../../../../scripts/tool-regression/sample';
import { authedApi } from '#tests/helpers/app';
import { registries } from '#shared/helena';
import { routeTools } from '../../generate';
import { app } from '#tests/helpers/app';
import { auth } from '@repo/auth';
import { callConfiguredTool, configuredToolsOf } from '#modules/agents/tools/run';
import { seedToolStack } from '../fixtures/stack';
import {
  installExternalFixtures,
  PAPER_ACCOUNT,
  seedCancelablePaperOrder,
} from '../fixtures/external';
import { createStrategyApproval } from '#modules/trading/strategies';
import { bootstrapHomeAgent } from '../../../scripts/bootstrap-home-agent';
import { db, project } from '@repo/db';
import { eq } from 'drizzle-orm';

const routeNames = new Set(routeTools(app).map((tool) => tool.name));
const tools = registries.tools.list().filter((tool) => !routeNames.has(tool.name));
let stack: Awaited<ReturnType<typeof seedToolStack>>;
let bindings: Awaited<ReturnType<typeof configuredToolsOf>>;
let homeBindings: Awaited<ReturnType<typeof configuredToolsOf>>;
let homeCaller: {
  userId: string;
  auth: { kind: 'api-key'; apiKey: string };
  runId: null;
  agentProject: string;
};
const homeTools = new Set(['threads_delete', 'instagram_delete_media', 'instagram_delete_comment']);
let restoreExternalFixtures: (() => void) | undefined;
const validator = new AjvJsonSchemaValidator();
const results: Record<string, unknown>[] = [];

beforeAll(async () => {
  restoreExternalFixtures = installExternalFixtures();
  stack = await seedToolStack();
  expect((await bootstrapHomeAgent()).status).toBe('ready');
  const api = authedApi(stack.owner.cookie);
  const team = api.teams({ teamId: stack.project.teamId });
  const home = (await team['ai-agents'].get()).data!.find((agent) => agent.agentRole === 'home')!;
  expect(home).toBeDefined();
  const homeKey = (
    await auth.api.createApiKey({ body: { userId: home.userId, name: 'ABSCHLUSSTEST Home' } })
  ).key;
  homeCaller = {
    userId: home.userId,
    auth: { kind: 'api-key', apiKey: homeKey },
    runId: null,
    agentProject: 'home',
  };
  await db.update(project).set({ autopilotLevel: 3 }).where(eq(project.id, stack.project.id));
  const connectorCatalog = (await team.integrations.catalog.get()).data!;
  const bindingIds: number[] = [];
  for (const connectorId of new Set(tools.map((tool) => tool.connector!))) {
    const entry = connectorCatalog.find((item) => item.key === connectorId)!;
    const credential: Record<string, unknown> = Object.fromEntries(
      entry.credentialSchema.map((field) => [
        field.key,
        field.type === 'number'
          ? 10000
          : field.type === 'boolean'
            ? true
            : field.type === 'url'
              ? 'https://gitea.example.test'
              : 'ABSCHLUSSTEST',
      ]),
    );
    if (connectorId === 'alpaca_paper')
      Object.assign(credential, {
        keyId: 'PKABSCHLUSSTEST214',
        secretKey: 'synthetic-fixture',
        maxOrderValueUsd: 1000,
        maxPositionValueUsd: 2000,
        maxRiskPerTradeUsd: 50,
        dailyLossLimitUsd: 150,
        allowedSymbols: 'AAPL',
        tradingHalted: false,
      });
    if (connectorId === 'instagram') Object.assign(credential, { userId: '214', igUserId: '214' });
    const created = await team.integrations.post({
      integrationKey: connectorId,
      label: 'ABSCHLUSSTEST',
      credential,
    });
    expect(created.status).toBe(201);
    const credentialId = created.data!.id;
    for (const tool of tools.filter((tool) => tool.connector === connectorId)) {
      const bound = await team['agent-tools'].post({ toolKey: tool.name, credentialId });
      expect(bound.status).toBe(201);
      bindingIds.push(bound.data!.id);
    }
  }
  expect(
    (
      await team['ai-agents']({ agentId: stack.agent.id })['tool-configs'].put({
        agentToolIds: bindingIds,
      })
    ).status,
  ).toBe(200);
  bindings = await configuredToolsOf(stack.agent.userId);
  expect(
    (
      await team['ai-agents']({ agentId: home.id })['tool-configs'].put({
        agentToolIds: bindingIds,
      })
    ).status,
  ).toBe(200);
  homeBindings = await configuredToolsOf(home.userId);
  const note = await api.knowledge.notes.put({
    path: `Projects/${stack.project.key}/Docs/Strategien/abschlusstest/abschlusstest v1.0.md`,
    content:
      '---\ntyp: strategie\nstrategie: abschlusstest\nversion: "1.0"\nstatus: paper\ninstrumente: [AAPL]\nbacktest: "[[ABSCHLUSSTEST]]"\n---\n# ABSCHLUSSTEST\nSynthetic entry and exit rules.\n',
  });
  expect(note.status).toBe(200);
  const { approval } = await createStrategyApproval(
    {
      project: stack.project,
      agent: stack.agent,
      strategyId: 'abschlusstest',
      strategyVersion: '1.0',
    },
    PAPER_ACCOUNT,
  );
  expect(
    (await api.approvals({ approvalId: approval.id }).decision.post({ approved: true })).status,
  ).toBe(200);
}, 30_000);
afterAll(async () => {
  restoreExternalFixtures?.();
  if (process.env.VOLITION_CONNECTOR_RESULTS)
    await Bun.write(process.env.VOLITION_CONNECTOR_RESULTS, JSON.stringify(results, null, 2));
});

test('every registered connector has an executable credential fixture', () => {
  expect(tools.map((tool) => tool.name).sort()).toEqual(catalog.connector);
  expect([...bindings.keys()].sort()).toEqual(catalog.connector);
});

for (const tool of tools) {
  if (
    process.env.VOLITION_TOOL_FILTER &&
    !new RegExp(process.env.VOLITION_TOOL_FILTER).test(tool.name)
  )
    continue;
  test(`${tool.name}: valid input, invalid input and foreign project through configured execution`, async () => {
    const schema = toJsonSchema(tool.inputSchema) as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    const args = sample(schema, {
      symbol: 'AAPL',
      symbols: ['AAPL'],
      orderId: '00000000-0000-4000-8000-000000000214',
      requestId: crypto.randomUUID(),
      pageId: '00000000-0000-4000-8000-000000000214',
      parentPageId: '00000000-0000-4000-8000-000000000214',
      discussionId: '00000000-0000-4000-8000-000000000214',
      text: 'ABSCHLUSSTEST',
      imageUrl: 'https://example.test/ABSCHLUSSTEST.png',
      videoUrl: 'https://example.test/ABSCHLUSSTEST.mp4',
      title: 'ABSCHLUSSTEST',
      query: 'ABSCHLUSSTEST',
      q: 'ABSCHLUSSTEST',
      side: 'buy',
      qty: 1,
      type: 'limit',
      limitPrice: 100,
      stopPrice: 95,
      targetPrice: 110,
      stopLossPrice: 95,
      takeProfitPrice: 110,
      strategyId: 'abschlusstest',
      strategyVersion: '1.0',
      action: 'approve',
      model: 'jina-reranker-v2-base-multilingual',
      mode: 'append',
    }) as Record<string, unknown>;
    // Semantic alternatives are not expressible as a required JSON Schema field.
    if (['threads_publish', 'threads_reply'].includes(tool.name)) args.text = 'ABSCHLUSSTEST';
    if (tool.name === 'notion_add_comment')
      Object.assign(args, {
        pageId: '00000000-0000-4000-8000-000000000214',
        text: 'ABSCHLUSSTEST',
      });
    if (tool.name === 'threads_location_search') args.query = 'ABSCHLUSSTEST';
    if (tool.name === 'notion_update_page') args.markdown = '# ABSCHLUSSTEST';
    if (tool.name === 'gitea_update_issue') args.title = 'ABSCHLUSSTEST';
    if (['alpaca_paper_check_order', 'alpaca_paper_submit_order'].includes(tool.name))
      Object.assign(args, {
        type: 'limit',
        qty: 1,
        limitPrice: 100,
        stopLossPrice: 95,
        takeProfitPrice: 110,
      });
    if (tool.name === 'alpaca_paper_cancel_order') seedCancelablePaperOrder();
    const configured = (homeTools.has(tool.name) ? homeBindings : bindings).get(tool.name)!;
    const row: Record<string, unknown> = { name: tool.name };
    results.push(row);
    const caller = homeTools.has(tool.name)
      ? homeCaller
      : {
          userId: stack.agent.userId,
          auth: { kind: 'api-key' as const, apiKey: stack.agentKey },
          runId: null,
          agentProject: stack.project.key.toLowerCase(),
        };
    const result = await callConfiguredTool(configured, args, caller);
    row.valid = result.structuredContent;
    if (result.isError)
      throw new Error(`${tool.name}: ${JSON.stringify(result.structuredContent)}`);
    expect(result.isError).not.toBe(true);
    expect(CallToolResultSchema.safeParse(result).success).toBe(true);
    const output = toMcpTool(tool).outputSchema;
    if (output) expect(validator.getValidator(output)(result.structuredContent).valid).toBe(true);
    const invalid = invalidInput(schema, args);
    if (invalid) {
      const bad = await callConfiguredTool(configured, invalid, caller);
      row.invalid = bad.structuredContent;
      expect(bad).toMatchObject({
        isError: true,
        structuredContent: { error: { status: 400, message: expect.any(String) } },
      });
    }
    const foreign = await callConfiguredTool(configured, args, {
      ...caller,
      agentProject: stack.foreign.key.toLowerCase(),
    });
    row.foreign = foreign.structuredContent;
    expect(foreign).toMatchObject({ isError: true, structuredContent: { error: { status: 403 } } });
  }, 15_000);
}
