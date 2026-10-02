import { afterAll, beforeAll, expect, test } from 'bun:test';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import catalog from '../../../../../../scripts/tool-regression/catalog.json';
import { sample, invalidInput } from '../../../../../../scripts/tool-regression/sample';
import { app } from '#tests/helpers/app';
import { routeTools } from '../../generate';
import { dispatchTool } from '../../dispatch';
import { routeAccessForAgent } from '../../access';
import { seedToolStack } from '../fixtures/stack';
import { installExternalFixtures, selectExternalFixture } from '../fixtures/external';
import { operatorTools, ToolFixtureResolver } from '../fixtures/resolve';
import { provisionBlueprint } from '../fixtures/provision';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../../server';

const tools = routeTools(app);
const validator = new AjvJsonSchemaValidator();
let stack: Awaited<ReturnType<typeof seedToolStack>>;
const results: Record<string, unknown>[] = [];
let restoreExternalFixtures: (() => void) | undefined;
let resolver: ToolFixtureResolver;

beforeAll(async () => {
  restoreExternalFixtures = installExternalFixtures();
  stack = await seedToolStack();
  resolver = new ToolFixtureResolver(stack, tools);
}, 30_000);
afterAll(async () => {
  restoreExternalFixtures?.();
  if (process.env.VOLITION_TOOL_RESULTS)
    await Bun.write(process.env.VOLITION_TOOL_RESULTS, JSON.stringify(results, null, 2));
});

test('every API registration has a named regression fixture', () => {
  expect(tools.map((tool) => tool.name).sort()).toEqual(catalog.api);
});

test('person-only tools are invisible to agents', async () => {
  const mayOffer = await routeAccessForAgent(stack.agent.userId, stack.project.teamId);
  const personal = tools.filter((tool) => tool.access === 'person-only');
  expect(personal).toHaveLength(6);
  for (const tool of personal) expect(mayOffer(tool)).toBe(false);
  const server = await buildMcpServer(
    app,
    { kind: 'api-key', apiKey: stack.agentKey },
    stack.agent.userId,
  );
  const client = new Client({ name: 'volition-tool-regression', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = new Set((await client.listTools()).tools.map((tool) => tool.name));
    for (const tool of personal) expect(listed.has(tool.name)).toBe(false);
  } finally {
    await client.close();
    await server.close();
  }
});

for (const tool of [...tools].sort(
  (a, b) => Number(a.method !== 'GET') - Number(b.method !== 'GET'),
)) {
  if (
    process.env.VOLITION_TOOL_FILTER &&
    !new RegExp(process.env.VOLITION_TOOL_FILTER).test(tool.name)
  )
    continue;
  test(`${tool.name}: runtime input, validation and foreign access`, async () => {
    if (tool.method !== 'GET' && !operatorTools.has(tool.name) && tool.access !== 'person-only') {
      stack = await seedToolStack();
      resolver = new ToolFixtureResolver(stack, tools);
    }
    selectExternalFixture(tool);
    const valid = operatorTools.has(tool.name)
      ? (sample(tool.inputSchema, stack.fields) as Record<string, unknown>)
      : await resolver.argumentsFor(tool);
    const invalid = invalidInput(tool.inputSchema, valid);
    expect(
      validator.getValidator(tool.inputSchema as Parameters<typeof validator.getValidator>[0])(
        valid,
      ).valid,
    ).toBe(true);
    const row: Record<string, unknown> = { name: tool.name };
    results.push(row);
    const validateOutput = validator.getValidator(tool.outputSchema);
    if (!invalid) {
      // An argumentless tool has no invalid domain argument. The MCP protocol validates
      // the surrounding request; there is no invented required field in its fixture.
      row.invalid = 'not-applicable: argumentless schema';
    } else {
      const response = await dispatchTool(
        app,
        tool,
        invalid,
        { kind: 'session', cookie: stack.owner.cookie },
        { viaMcpEndpoint: true },
      );
      row.invalid = response.structuredContent;
      expect(response.structuredContent.ok).toBe(false);
      expect(response.structuredContent.status).toBeGreaterThanOrEqual(400);
      expect(response.structuredContent.status).toBeLessThan(500);
      if (!response.structuredContent.ok)
        expect(response.structuredContent.error.message.length).toBeGreaterThan(3);
      expect(validateOutput(response.structuredContent).valid).toBe(true);
    }
    if (tool.access === 'person-only') {
      row.valid = 'person-only: hidden from agents';
      return;
    }
    if (operatorTools.has(tool.name)) {
      row.valid = 'pending: injected operator adapter needed';
      return;
    }
    if (
      tool.pathParams.some((param) =>
        ['projectKey', 'teamId', 'issueId', 'threadId', 'messageId', 'receiptId'].includes(param),
      )
    ) {
      const foreign = await dispatchTool(
        app,
        tool,
        valid,
        { kind: 'session', cookie: stack.outsider.cookie },
        { viaMcpEndpoint: true },
      );
      row.foreign = foreign.structuredContent;
      expect([403, 404]).toContain(foreign.structuredContent.status);
      expect(validateOutput(foreign.structuredContent).valid).toBe(true);
    } else row.foreign = 'not-applicable: no project/team/entity selector';
    if (
      tool.pathParams.some((param) => ['projectKey', 'projectId', 'issueId'].includes(param)) ||
      (tool.path.startsWith('/knowledge') && ('path' in valid || 'root' in valid))
    ) {
      const scoped = sample(tool.inputSchema, {
        ...resolver.fields,
        ...stack.restrictedFields,
      }) as Record<string, unknown>;
      const foreignArgs = { ...valid };
      for (const key of Object.keys(stack.restrictedFields))
        if (key in foreignArgs) foreignArgs[key] = scoped[key];
      const foreign = await dispatchTool(
        app,
        tool,
        foreignArgs,
        { kind: 'api-key', apiKey: stack.agentKey },
        { viaMcpEndpoint: true, agentProject: stack.project.key.toLowerCase() },
      );
      row.foreignSameTeam = foreign.structuredContent;
      if (tool.name === 'resolve_knowledge_path') {
        // This resolver deliberately returns null for both missing and unreadable
        // references. It must never reveal the foreign path or its existence.
        expect(foreign.structuredContent).toMatchObject({
          ok: true,
          status: 200,
          data: { path: null },
        });
      } else expect([403, 404]).toContain(foreign.structuredContent.status);
    }
    const call = dispatchTool(
      app,
      tool,
      valid,
      { kind: 'session', cookie: stack.owner.cookie },
      { viaMcpEndpoint: true },
    );
    const response =
      tool.name === 'apply_project_blueprint' ? await provisionBlueprint(call) : await call;
    row.valid = response.structuredContent;
    // The transport contract includes domain refusals (no configured provider,
    // no queued run). Preserve their 4xx envelope; never accept a server failure.
    expect(response.structuredContent.status).toBeLessThan(500);
    expect(validateOutput(response.structuredContent).valid).toBe(true);
  }, 30_000);
}
