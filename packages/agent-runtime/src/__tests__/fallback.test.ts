import { expect, test } from 'bun:test';
import { runAgent } from '../agent';
import { MemorySink } from '../events';
import { MemorySessionStore } from '../session';

function completion(text: string) {
  const chunks = [
    {
      id: 'fixture',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'cloud',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    },
    {
      id: 'fixture',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'cloud',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 },
    },
  ];
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

for (const isolated of [false, true])
  test(`cloud fallback after shutting down the local server (sandbox environment: ${isolated})`, async () => {
    let localCalls = 0;
    let cloudCalls = 0;
    const local = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => {
        localCalls++;
        return completion('Local');
      },
    });
    const localUrl = `http://127.0.0.1:${local.port}/v1`;
    const cloud = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        cloudCalls++;
        expect(request.headers.get('authorization')).toBe('Bearer synthetic-cloud-key');
        const body = (await request.json()) as { messages: { content: string }[] };
        expect(JSON.stringify(body.messages)).toContain('Preserve this task context');
        return completion('Cloud answered');
      },
    });
    try {
      expect((await fetch(`${localUrl}/chat/completions`)).ok).toBe(true);
      await local.stop(true);
      const sink = new MemorySink();
      const result = await runAgent({
        config: {
          model: 'local/flash',
          fallbackModels: ['openai/cloud'],
          workdir: '/tmp',
          servers: [
            { provider: 'local', kind: 'openai-compatible', baseUrl: localUrl, local: true },
            {
              provider: 'openai',
              kind: 'openai-compatible',
              baseUrl: `http://127.0.0.1:${cloud.port}/v1`,
              keyEnv: 'OPENAI_API_KEY',
            },
          ],
          tools: { profile: 'assistent' },
          policy: 'allow',
          memory: { enabled: false },
          limits: { firstChunkSeconds: 2, runBudgetSeconds: 10 },
        },
        prompt: 'Preserve this task context',
        sink,
        sessions: new MemorySessionStore(),
        env: { OPENAI_API_KEY: 'synthetic-cloud-key', ...(isolated && { HELENA_ISOLATED: '1' }) },
        signal: new AbortController().signal,
      });
      expect(result.status).toBe('success');
      expect(sink.text()).toBe('Cloud answered');
      expect(localCalls).toBe(1);
      expect(cloudCalls).toBe(1);
    } finally {
      await local.stop(true);
      await cloud.stop(true);
    }
  });

test('an unavailable local server hands subscription fallback its context and honors cancellation', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => completion('Local') });
  const url = `http://127.0.0.1:${server.port}/v1`;
  await server.stop(true);
  const config = {
    model: 'local/flash',
    runtimeFallback: 'runtime:codex/gpt-6-astra',
    workdir: '/tmp',
    servers: [{ provider: 'local', kind: 'openai-compatible' as const, baseUrl: url, local: true }],
    policy: 'allow' as const,
    memory: { enabled: false },
    limits: { firstChunkSeconds: 1, runBudgetSeconds: 5 },
  };
  const sink = new MemorySink();
  const result = await runAgent({
    config,
    prompt: 'Continue this context',
    sink,
    env: {},
    signal: new AbortController().signal,
  });
  expect(result.status).toBe('escalated');
  expect(sink.events.find((event) => event.type === 'escalate')).toMatchObject({
    target: 'runtime:codex/gpt-6-astra',
    handover: expect.stringContaining('Continue this context'),
  });
  const canceled = new AbortController();
  canceled.abort();
  const canceledSink = new MemorySink();
  expect(
    (
      await runAgent({
        config,
        prompt: 'Canceled',
        sink: canceledSink,
        env: {},
        signal: canceled.signal,
      })
    ).status,
  ).toBe('failed');
  expect(canceledSink.events.some((event) => event.type === 'escalate')).toBe(false);
});
