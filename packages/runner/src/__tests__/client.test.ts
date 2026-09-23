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

  it('names the run or chat answer it reads logins and secrets for', async () => {
    const requests: { method?: string; url?: string; body: string }[] = [];
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        requests.push({ method: request.method, url: request.url, body });
        if (request.method === 'POST') {
          response.statusCode = 204;
          response.end();
          return;
        }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ logins: [{ id: 3 }], secrets: {} }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const client = new Client({
      url: `http://127.0.0.1:${address.port}`,
      apiKey: 'runner-secret',
    } as RunnerConfig);

    expect(await client.webLogins({ runId: 4 })).toEqual([{ id: 3 }] as never);
    await client.webLogins({ messageId: 5 });
    await client.mcpSecrets({ runId: 4 });
    await client.reportLoginUses({ messageId: 5 }, [
      { credentialId: 3, tool: 'browser_vault_fill', origin: 'https://github.com' },
    ]);
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /agent-runs/4/web-logins',
      'GET /agent-chats/5/web-logins',
      'GET /agent-runtime/mcp-secrets?runId=4',
      'POST /agent-runtime/credential-uses',
    ]);
    expect(JSON.parse(requests[3].body)).toEqual({
      messageId: 5,
      uses: [{ credentialId: 3, tool: 'browser_vault_fill', origin: 'https://github.com' }],
    });
  });

  it('reads the reflection Plan asks for off a run result, and none from an older server', async () => {
    const bodies: unknown[] = [];
    let resultCalls = 0;
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        bodies.push({ url: request.url, body: body ? JSON.parse(body) : undefined });
        if (request.url?.endsWith('/reflection')) {
          response.statusCode = 204;
          response.end();
          return;
        }
        resultCalls++;
        if (resultCalls === 1) {
          response.setHeader('content-type', 'application/json');
          response.end(
            JSON.stringify({
              reflection: { prompt: 'Look back.', maxTurns: 8, runBudgetSeconds: 120 },
            }),
          );
          return;
        }
        // An older server answers 204, with no reflection field to read.
        response.statusCode = 204;
        response.end();
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const client = new Client({
      url: `http://127.0.0.1:${address.port}`,
      apiKey: 'runner-secret',
    } as RunnerConfig);

    expect(await client.report(9, { status: 'success' })).toEqual({
      prompt: 'Look back.',
      maxTurns: 8,
      runBudgetSeconds: 120,
    });
    expect(await client.report(9, { status: 'success' })).toBeNull();

    await client.reportReflection(9, {
      status: 'success',
      saved: [{ tool: 'memory', action: 'add', target: 'user' }],
    });
    expect(bodies[2]).toEqual({
      url: '/agent-runs/9/reflection',
      body: { status: 'success', saved: [{ tool: 'memory', action: 'add', target: 'user' }] },
    });
  });

  it('reads a canceled run off its heartbeat, and no body as not canceled', async () => {
    const paths: string[] = [];
    server = createServer((request, response) => {
      paths.push(request.url ?? '');
      if (request.url === '/agent-runs/1/heartbeat?claim=1') {
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
    expect(paths).toEqual(['/agent-runs/1/heartbeat?claim=1', '/agent-runs/2/heartbeat?claim=3']);
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
    expect(paths).toContain('/agent-runs/4/result?claim=2');
    expect(paths).toContain('/agent-runs/4/release?claim=2');
  });
});
