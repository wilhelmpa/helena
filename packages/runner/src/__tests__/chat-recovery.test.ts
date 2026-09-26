import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answer } from '../chat';
import { Client } from '../client';
import type { RunnerConfig } from '../config';
import { AnswerStream, type AgUiEvent } from '../agui';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

describe('chat report recovery', () => {
  it('keeps acknowledged batches out of a later flush after a following batch failed', async () => {
    const stored: AgUiEvent[] = [];
    let calls = 0;
    const stream = new AnswerStream(
      'hermes-stream-json',
      'thread',
      '7',
      async (events) => {
        expect(events.length).toBeLessThanOrEqual(200);
        if (++calls === 2) throw new Error('Synthetic permanent second-batch failure');
        stored.push(...events);
      },
      undefined,
      200,
    );
    for (let id = 0; id < 100; id++) {
      stream.write(
        JSON.stringify({ type: 'tool_use', tool_call_id: `t${id}`, name: 'fixture', input: {} }) +
          '\n',
      );
      stream.write(
        JSON.stringify({ type: 'tool_result', tool_call_id: `t${id}`, output: `result-${id}` }) +
          '\n',
      );
    }
    await expect(stream.flush()).rejects.toThrow('Synthetic permanent second-batch failure');
    expect(stored).toHaveLength(200);
    await stream.finish('Done once');
    const results = stored.filter((event) => event.type === 'TOOL_CALL_RESULT');
    expect(results).toHaveLength(100);
    expect(new Set(results.map((event) => event.toolCallId)).size).toBe(100);
    expect(stored.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')).toEqual([
      expect.objectContaining({ delta: 'Done once' }),
    ]);
    expect(stored.filter((event) => event.type === 'RUN_FINISHED')).toHaveLength(1);
  });

  it('retains a completed command and its tool result through unavailable API and lost acknowledgements', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helena-chat-recovery-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const events: AgUiEvent[] = [];
    const deliveries: { claim: number; offset: number; sessionId?: string }[] = [];
    let eventRequests = 0;
    let resultRequests = 0;
    let completions = 0;
    const server: Server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.setHeader('content-type', 'application/json');
      if (request.url === '/agent-chats/7/events') {
        eventRequests++;
        deliveries.push({ ...body.delivery, sessionId: body.sessionId });
        if (eventRequests === 1) {
          response.writeHead(503).end('{}');
          return;
        }
        if (body.delivery?.offset === events.length) events.push(...body.events);
        if (eventRequests === 2) {
          response.destroy();
          return;
        }
        response.end('{"canceled":false}');
        return;
      }
      if (request.url === '/agent-chats/7/result?claim=1') {
        resultRequests++;
        if (resultRequests === 1) {
          response.writeHead(503).end('{}');
          return;
        }
        if (completions === 0 && body.status === 'success') completions++;
        if (resultRequests === 2) {
          response.destroy();
          return;
        }
        response.writeHead(204).end();
        return;
      }
      response.writeHead(404).end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const config: RunnerConfig = {
      name: 'synthetic',
      url: `http://127.0.0.1:${address.port}`,
      apiKey: 'synthetic-fixture-key',
      command: `printf 'once\\n' >> "$EXECUTION_LOG"; printf '%s\\n' '{"type":"system","session_id":"synthetic-session"}' '{"type":"tool_use","tool_call_id":"tool-1","name":"fixture_write","input":{}}' '{"type":"tool_result","tool_call_id":"tool-1","output":"synthetic-file-hash"}' '{"type":"result","text":"Completed once","session_id":"synthetic-session"}'`,
      args: [],
      cwd: dir,
      env: { EXECUTION_LOG: join(dir, 'executions') },
      concurrency: 1,
      pollIntervalMs: 1000,
      timeoutMs: 5000,
      outputFormat: 'hermes-stream-json',
      models: [],
    };
    const stop = new AbortController();
    cleanup.push(async () => stop.abort());
    await answer(
      config,
      new Client(config),
      {
        id: 7,
        attempts: 1,
        threadId: 'synthetic-thread',
        prompt: 'Do it once',
        systemPrompt: '',
        sessionId: null,
        model: null,
        thinkingLevel: null,
      },
      stop,
      null,
    );
    expect(await readFile(join(dir, 'executions'), 'utf8')).toBe('once\n');
    expect(eventRequests).toBe(3);
    expect(deliveries).toEqual(
      Array.from({ length: 3 }, () => ({
        claim: 1,
        offset: 0,
        sessionId: 'synthetic-session',
      })),
    );
    expect(events.filter((event) => event.type === 'TOOL_CALL_RESULT')).toEqual([
      expect.objectContaining({ content: 'synthetic-file-hash', toolCallId: 'tool-1' }),
    ]);
    expect(events.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')).toEqual([
      expect.objectContaining({ delta: 'Completed once' }),
    ]);
    expect(events.filter((event) => event.type === 'RUN_FINISHED')).toHaveLength(1);
    expect(resultRequests).toBe(3);
    expect(completions).toBe(1);
    expect(stop.signal.aborted).toBe(false);
  }, 15_000);
});
