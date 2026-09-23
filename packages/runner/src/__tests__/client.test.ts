import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { Client } from '../client';
import type { RunnerConfig } from '../config';

let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe('runner gateway client', () => {
  it('publishes the catalog and reads the complete Hermes chat contract without exposing secrets', async () => {
    const requests: { path: string; apiKey: string | undefined; body: unknown }[] = [];
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString('utf8');
      requests.push({
        path: request.url ?? '',
        apiKey: request.headers['x-api-key'] as string | undefined,
        body: text ? JSON.parse(text) : undefined,
      });
      response.setHeader('content-type', 'application/json');
      if (request.url === '/agent-runtime/policy') {
        response.end(
          JSON.stringify({ revision: 'sha256:one', runtimePolicy: { files: [] }, skills: [] }),
        );
        return;
      }
      if (request.url === '/agent-chats/claim') {
        response.end(
          JSON.stringify({
            message: {
              id: 7,
              threadId: 'thread-1',
              prompt: 'Continue',
              systemPrompt: '',
              sessionId: 'session-1',
              model: 'anthropic/claude-opus-4.6',
              thinkingLevel: 'high',
            },
          }),
        );
        return;
      }
      response.end('{}');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const config = {
      url: `http://127.0.0.1:${address.port}`,
      apiKey: 'runner-secret',
      models: [
        {
          id: 'anthropic/claude-opus-4.6',
          name: 'Claude Opus 4.6',
          reasoning: true,
          thinkingLevels: ['medium', 'high'],
          thinkingDefault: 'medium',
        },
      ],
    } as RunnerConfig;
    const client = new Client(config);

    await client.publishChatCatalog(config.models);
    const policy = await client.runtimePolicy();
    await client.reportRuntimeStatus({
      adapter: 'hermes',
      status: 'online',
      appliedRevision: policy.revision,
      capabilities: ['managed-markdown'],
      detail: null,
    });
    const message = await client.claimChat();

    expect(message).toMatchObject({
      sessionId: 'session-1',
      model: 'anthropic/claude-opus-4.6',
      thinkingLevel: 'high',
    });
    expect(requests.map((entry) => entry.path)).toEqual([
      '/agent-chats/catalog',
      '/agent-runtime/policy',
      '/agent-runtime/status',
      '/agent-chats/claim',
    ]);
    expect(requests.every((entry) => entry.apiKey === 'runner-secret')).toBe(true);
    expect(JSON.stringify(requests[0]?.body)).not.toContain('runner-secret');
  });

  it('reads the secrets of the MCP servers with the agent key', async () => {
    let apiKey: string | undefined;
    server = createServer((request, response) => {
      apiKey = request.headers['x-api-key'] as string | undefined;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify(
          request.url === '/agent-runtime/mcp-secrets' ? { secrets: { '7': 'value' } } : {},
        ),
      );
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const client = new Client({
      url: `http://127.0.0.1:${address.port}`,
      apiKey: 'runner-secret',
    } as RunnerConfig);

    expect(await client.mcpSecrets()).toEqual({ '7': 'value' });
    expect(apiKey).toBe('runner-secret');
  });

  it('reads a canceled run off its heartbeat, and no body as not canceled', async () => {
    const paths: string[] = [];
    server = createServer((request, response) => {
      paths.push(request.url ?? '');
      if (request.url === '/agent-runs/1/heartbeat?attempt=1') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ canceled: true }));
        return;
      }
      response.statusCode = 204;
      response.end();
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const client = new Client({
      url: `http://127.0.0.1:${address.port}`,
      apiKey: 'runner-secret',
    } as RunnerConfig);

    expect(await client.heartbeat(1, 1)).toBe(true);
    expect(await client.heartbeat(2, 3)).toBe(false);
    expect(paths).toEqual([
      '/agent-runs/1/heartbeat?attempt=1',
      '/agent-runs/2/heartbeat?attempt=3',
    ]);
  });

  it('stops work the server no longer has, and names the attempt on result and release', async () => {
    const paths: string[] = [];
    server = createServer((request, response) => {
      paths.push(request.url ?? '');
      response.statusCode = request.url?.includes('/9/') ? 404 : 204;
      response.end();
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const client = new Client({
      url: `http://127.0.0.1:${address.port}`,
      apiKey: 'runner-secret',
    } as RunnerConfig);

    expect(await client.heartbeat(9, 2)).toBe(true);
    expect(await client.chatHeartbeat(9)).toBe(true);
    await client.report(4, 2, { status: 'success', output: 'done' });
    await client.release(4, 2);
    await expect(client.report(9, 2, { status: 'success' })).rejects.toMatchObject({ status: 404 });
    expect(paths).toContain('/agent-runs/4/result?attempt=2');
    expect(paths).toContain('/agent-runs/4/release?attempt=2');
  });
});
