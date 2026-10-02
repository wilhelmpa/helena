import { expect, test } from 'bun:test';
import { dispatchTool } from '../../dispatch';
import { mcpTool, routeTools } from '../../generate';
import type { McpApp } from '../../types';

function fixture() {
  const calls: Request[] = [];
  const app: McpApp = {
    routes: [
      {
        method: 'GET',
        path: '/ABSCHLUSSTEST',
        hooks: {
          detail: mcpTool('volition_fixture'),
          query: {
            type: 'object',
            properties: { ids: { type: 'array', items: { type: 'integer' } } },
            required: ['ids'],
          },
        },
      },
    ],
    handle: async (request) => {
      calls.push(request);
      return Response.json({ ids: JSON.parse(new URL(request.url).searchParams.get('ids')!) });
    },
  };
  return { app, tool: routeTools(app)[0]!, calls };
}

test('MCP query arrays survive conversion to the HTTP route', async () => {
  const { app, tool, calls } = fixture();
  const result = await dispatchTool(
    app,
    tool,
    { ids: [214, 831] },
    { kind: 'api-key', apiKey: 'ABSCHLUSSTEST' },
    { viaMcpEndpoint: true },
  );
  expect(result.structuredContent).toMatchObject({
    ok: true,
    status: 200,
    data: { ids: [214, 831] },
  });
  expect(calls).toHaveLength(1);
});

test('invalid MCP query types are rejected before routing or side effects', async () => {
  const { app, tool, calls } = fixture();
  const result = await dispatchTool(
    app,
    tool,
    { ids: 'ABSCHLUSSTEST' },
    { kind: 'api-key', apiKey: 'ABSCHLUSSTEST' },
    { viaMcpEndpoint: true },
  );
  expect(result.structuredContent).toMatchObject({
    ok: false,
    status: 400,
    error: { message: expect.stringContaining('ids') },
  });
  expect(calls).toHaveLength(0);
});

test('MCP mutations send declared query fields in the URL and body fields in JSON', async () => {
  const app: McpApp = {
    routes: [
      {
        method: 'POST',
        path: '/ABSCHLUSSTEST',
        hooks: {
          detail: mcpTool('volition_fixture'),
          query: {
            type: 'object',
            properties: { root: { type: 'string', enum: ['home', 'templates'] } },
            required: ['root'],
          },
          body: {
            type: 'object',
            properties: { content: { type: 'string' } },
            required: ['content'],
            additionalProperties: false,
          },
        },
      },
    ],
    handle: async (request) =>
      Response.json({
        root: new URL(request.url).searchParams.get('root'),
        body: await request.json(),
      }),
  };
  const result = await dispatchTool(
    app,
    routeTools(app)[0]!,
    { root: 'home', content: 'ABSCHLUSSTEST' },
    { kind: 'api-key', apiKey: 'ABSCHLUSSTEST' },
    { viaMcpEndpoint: true },
  );
  expect(result.structuredContent).toMatchObject({
    ok: true,
    data: { root: 'home', body: { content: 'ABSCHLUSSTEST' } },
  });
  if (result.structuredContent.ok)
    expect((result.structuredContent.data as { body: object }).body).not.toHaveProperty('root');
});
