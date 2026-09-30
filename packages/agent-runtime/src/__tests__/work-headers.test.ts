import { expect, test } from 'bun:test';
import { HelenaClient } from '../helena-client';
import { connectMcp } from '../tools/mcp';

for (const ids of [
  { runId: null, messageId: 42 },
  { runId: 13, messageId: null },
]) {
  test(`native API calls carry their work identity: ${JSON.stringify(ids)}`, async () => {
    let headers = new Headers();
    const fetchImpl = (async (_url, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ names: [] });
    }) as typeof fetch;
    const client = new HelenaClient('http://localhost:3000', 'fixture', ids, fetchImpl);
    await client.selectTools({ prompt: 'Check identity', tools: [] });
    expect(headers.get('x-volition-message')).toBe(
      ids.messageId === null ? null : String(ids.messageId),
    );
    expect(headers.get('x-helena-run')).toBe(ids.runId === null ? null : String(ids.runId));
  });
  test(`native MCP calls carry their work identity despite stale profile headers: ${JSON.stringify(ids)}`, async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (request.method !== 'POST') return new Response(null, { status: 405 });
        const message = await request.json();
        if (message.id === undefined) return new Response(null, { status: 202 });
        const result =
          message.method === 'initialize'
            ? {
                protocolVersion: message.params.protocolVersion,
                capabilities: { tools: {} },
                serverInfo: { name: 'fixture', version: '1' },
              }
            : {
                content: [],
                structuredContent: {
                  runId: request.headers.get('x-helena-run'),
                  messageId: request.headers.get('x-volition-message'),
                },
              };
        return Response.json({ jsonrpc: '2.0', id: message.id, result });
      },
    });
    let connection;
    try {
      connection = await connectMcp(
        {
          name: 'itsaplan',
          transport: 'http',
          url: String(server.url),
          headers: [
            { name: 'x-helena-run', value: { literal: '99' } },
            { name: 'x-volition-message', value: { literal: '98' } },
          ],
        },
        {
          ITSAPLAN_RUN_ID: ids.runId === null ? '' : String(ids.runId),
          ITSAPLAN_MESSAGE_ID: ids.messageId === null ? '' : String(ids.messageId),
        },
      );
      const result = await connection.client.callTool({ name: 'run_as_root', arguments: {} });
      expect(result.structuredContent).toEqual({
        runId: ids.runId === null ? null : String(ids.runId),
        messageId: ids.messageId === null ? null : String(ids.messageId),
      });
    } finally {
      await connection?.close();
      await server.stop(true);
    }
  });
}
