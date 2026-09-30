import { expect, spyOn, test } from 'bun:test';
import { APICallError, generateText } from 'ai';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPriorityProxy } from '../../../../deployment/volition-stack/native/halogen/priority-proxy';
import { DEFAULT_PRIORITY_CONFIG } from '@helena/sdk';
import { runAgent } from '../agent';
import { parseConfig, type AgentRuntimeConfig } from '../config';
import { MemorySink } from '../events';
import { LocalModelBusy, LocalQueueRetry } from '../local-queue';
import { resolveModel } from '../models';
import { MemorySessionStore } from '../session';

const busy = (retryAfter = '1') =>
  new APICallError({
    message: 'Halogen queue is full or timed out',
    url: 'http://fixture/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 503,
    responseHeaders: { 'retry-after': retryAfter },
    responseBody: JSON.stringify({ error: { code: 'engine_busy' } }),
  });

test('local queue retries with exponential backoff and respects Retry-After', async () => {
  const sink = new MemorySink();
  const retry = new LocalQueueRetry(5000, sink);
  let attempts = 0;
  const result = await retry.run('local/flash', new AbortController().signal, async () => {
    if (++attempts <= 2) throw busy(attempts === 1 ? '1.1' : '0');
    return 'done';
  });
  expect(result).toBe('done');
  expect(attempts).toBe(3);
  expect(sink.of('status').map((event) => event.retryAfterMs)).toEqual([1100, 2000]);
  expect(sink.of('status')[1]!.remainingMs).toBeLessThan(4000);
});

test('successful admissions consume the shared wait budget across turns', async () => {
  const sink = new MemorySink();
  const retry = new LocalQueueRetry(80, sink);
  await retry.run('local/flash', new AbortController().signal, async (queue) => {
    queue.admitted(50);
    return 'first turn';
  });
  await expect(
    retry.run('local/flash', new AbortController().signal, async () => {
      throw busy('300');
    }),
  ).rejects.toBeInstanceOf(LocalModelBusy);
  expect(sink.of('status')[0]!.retryAfterMs).toBeLessThanOrEqual(30);
});

test('backend backoff uses the wait budget left by previous admissions', async () => {
  const sink = new MemorySink();
  const retry = new LocalQueueRetry(80, sink);
  await retry.run('local/flash', new AbortController().signal, async (queue) => {
    queue.admitted(50);
  });
  const unavailable = new APICallError({
    message: 'Halogen backend is unavailable',
    url: 'http://fixture/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 502,
    responseBody: JSON.stringify({ error: { code: 'backend_unavailable' } }),
  });
  let attempts = 0;
  await expect(
    retry.run('local/flash', new AbortController().signal, async () => {
      attempts++;
      throw unavailable;
    }),
  ).rejects.toBe(unavailable);
  expect(attempts).toBe(1);
  expect(sink.of('status')[0]!.retryAfterMs).toBeLessThanOrEqual(30);
});

test('backend errors after admission are not replayed', async () => {
  const sink = new MemorySink();
  const retry = new LocalQueueRetry(5000, sink);
  const unavailable = new APICallError({
    message: 'Halogen backend is unavailable',
    url: 'http://fixture/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 502,
    responseBody: JSON.stringify({ error: { code: 'backend_unavailable' } }),
  });
  let attempts = 0;
  await expect(
    retry.run('local/flash', new AbortController().signal, async (queue) => {
      attempts++;
      queue.admitted(10);
      throw unavailable;
    }),
  ).rejects.toBe(unavailable);
  expect(attempts).toBe(1);
  expect(sink.of('status')).toHaveLength(0);
});

function completion(text = 'Done') {
  return new Response(
    [
      {
        id: 'fixture',
        model: 'flash',
        created: 1,
        choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
      },
      {
        id: 'fixture',
        model: 'flash',
        created: 1,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

const config: AgentRuntimeConfig = {
  model: 'helena-halogen/flash',
  workdir: '/tmp',
  kind: 'chat',
  servers: [
    {
      provider: 'helena-halogen',
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:8741/v1',
      local: true,
      thinkingSwitch: true,
    },
    { provider: 'cloud', kind: 'openai-compatible', baseUrl: 'https://fixture.invalid/v1' },
  ],
  policy: 'allow',
  memory: { enabled: false },
};

async function withFetch<T>(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  run: () => Promise<T>,
) {
  const mock = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (url: Parameters<typeof fetch>[0], init?: RequestInit) => handler(String(url), init),
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    return await run();
  } finally {
    mock.mockRestore();
  }
}

function run(
  extra: Partial<AgentRuntimeConfig> = {},
  sink = new MemorySink(),
  signal = new AbortController().signal,
) {
  return runAgent({
    config: { ...config, ...extra },
    prompt: 'Test',
    sink,
    env: { VOLITION_HALOGEN_PRIORITY: 'interactive' },
    signal,
    sessions: new MemorySessionStore(),
  });
}

test('a busy local model retries before a configured cloud fallback', async () => {
  let local = 0;
  let cloud = 0;
  const sink = new MemorySink();
  const result = await withFetch(
    async (url) => {
      if (url.includes('fixture.invalid')) {
        cloud++;
        return completion('Cloud');
      }
      if (++local === 1)
        return Response.json(
          { error: { code: 'engine_busy' } },
          { status: 503, headers: { 'retry-after': '1' } },
        );
      return completion();
    },
    () => run({ fallbackModels: ['cloud/big'], limits: { localModelQueueSeconds: 3 } }, sink),
  );
  expect(result.status).toBe('success');
  expect(result.text).toBe('Done');
  expect(local).toBe(2);
  expect(cloud).toBe(0);
  expect(sink.of('status')[0]).toMatchObject({
    status: 'model-queued',
    message: 'Wartet auf freien Modellplatz',
  });
  expect(result.steps).toBe(1);
});

test('queue admission can exceed first-chunk and step timeouts without failing', async () => {
  const result = await withFetch(
    async () => {
      await Bun.sleep(60);
      return completion();
    },
    () =>
      run({ limits: { firstChunkSeconds: 0.01, stepSeconds: 0.02, localModelQueueSeconds: 0.3 } }),
  );
  expect(result.status).toBe('success');
});

test('admission deadline aborts a pending proxy request', async () => {
  let canceled = false;
  const result = await withFetch(
    async (_url, init) => {
      await new Promise<void>((_resolve, reject) => {
        const abort = () => {
          canceled = true;
          reject(new Error('aborted'));
        };
        init?.signal?.addEventListener('abort', abort, { once: true });
        if (init?.signal?.aborted) abort();
      });
      return completion();
    },
    () => run({ limits: { localModelQueueSeconds: 0.04 } }),
  );
  expect(result.reason).toBe('local-model-busy');
  expect(canceled).toBe(true);
});

for (const target of [undefined, 'runtime:codex/gpt-6.1-sol']) {
  test(`busy deadline reports overload or configured escalation (${target ?? 'none'})`, async () => {
    const sink = new MemorySink();
    let attempts = 0;
    const started = Date.now();
    const result = await withFetch(
      async () => {
        attempts++;
        return Response.json({ error: { code: 'engine_busy' } }, { status: 503 });
      },
      () =>
        run(
          { limits: { localModelQueueSeconds: 0.06 }, ...(target && { runtimeFallback: target }) },
          sink,
        ),
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(attempts).toBe(1);
    expect(result.reason).toBe(target ? 'escalated' : 'local-model-busy');
    if (!target) expect(result.error).toBe('Das lokale Modell ist ausgelastet.');
    else expect(sink.of('escalate')[0]!.detail).toBe('local-model-busy');
  });
}

test('stop during backoff exits with 130 and does not escalate or retry', async () => {
  const controller = new AbortController();
  const sink = new MemorySink();
  const emit = sink.emit.bind(sink);
  sink.emit = (event) => {
    emit(event);
    if (event.type === 'status') controller.abort();
  };
  let attempts = 0;
  const result = await withFetch(
    async () => {
      attempts++;
      return Response.json({ error: { code: 'engine_busy' } }, { status: 503 });
    },
    () => run({ runtimeFallback: 'runtime:codex' }, sink, controller.signal),
  );
  expect(result.reason).toBe('aborted');
  expect(result.exitCode).toBe(130);
  expect(attempts).toBe(1);
  expect(sink.of('escalate')).toHaveLength(0);
});

test('run budget also cancels queue backoff', async () => {
  const result = await withFetch(
    async () => Response.json({ error: { code: 'engine_busy' } }, { status: 503 }),
    () => run({ limits: { runBudgetSeconds: 0.06 } }),
  );
  expect(result.reason).toBe('budget');
});

for (const local of [true, false]) {
  test(`generic 503 responses do not enter local retry (local: ${local})`, async () => {
    let attempts = 0;
    const sink = new MemorySink();
    const result = await withFetch(
      async () => {
        attempts++;
        return Response.json({ error: { code: 'unrelated_failure' } }, { status: 503 });
      },
      () => run({ servers: [{ ...config.servers[0]!, local }] }, sink),
    );
    expect(result.reason).toBe('model-unavailable');
    expect(attempts).toBe(1);
    expect(sink.of('status')).toHaveLength(0);
  });
}

for (const status of [502, 503]) {
  test(`short local backend outage (${status}) retries before cloud fallback`, async () => {
    let attempts = 0;
    let cloud = 0;
    const sink = new MemorySink();
    const result = await withFetch(
      async (url) => {
        if (url.includes('fixture.invalid')) {
          cloud++;
          return completion('Cloud');
        }
        if (++attempts <= 2)
          return Response.json({ error: { code: 'backend_unavailable' } }, { status });
        return completion('Local');
      },
      () => run({ fallbackModels: ['cloud/model'] }, sink),
    );
    expect(result.exitCode).toBe(0);
    expect(result.text).toBe('Local');
    expect(attempts).toBe(3);
    expect(cloud).toBe(0);
    expect(sink.of('status').map((event) => event.retryAfterMs)).toEqual([1000, 2000]);
  });
}

test('persistent local backend outage is limited to three attempts and preserves cloud fallback', async () => {
  let attempts = 0;
  let cloud = 0;
  const result = await withFetch(
    async (url) => {
      if (url.includes('fixture.invalid')) {
        cloud++;
        return completion('Cloud');
      }
      attempts++;
      return Response.json({ error: { code: 'backend_unavailable' } }, { status: 502 });
    },
    () => run({ fallbackModels: ['cloud/model'] }),
  );
  expect(result.text).toBe('Cloud');
  expect(attempts).toBe(3);
  expect(cloud).toBe(1);
});

for (const target of [undefined, 'runtime:codex']) {
  test(`backend retry respects the shared wait budget and preserves failure (${target ?? 'none'})`, async () => {
    const sink = new MemorySink();
    let attempts = 0;
    const result = await withFetch(
      async () => {
        attempts++;
        return Response.json({ error: { code: 'backend_unavailable' } }, { status: 502 });
      },
      () =>
        run(
          { limits: { localModelQueueSeconds: 0.06 }, ...(target && { runtimeFallback: target }) },
          sink,
        ),
    );
    expect(attempts).toBe(1);
    expect(result.reason).toBe(target ? 'escalated' : 'model-unavailable');
    expect(sink.of('status')[0]!.retryAfterMs).toBeLessThanOrEqual(60);
    if (target) expect(sink.of('escalate')[0]!.detail).toBe('model-unavailable');
  });
}

test('cloud backend outage is not retried by the local policy', async () => {
  let attempts = 0;
  const sink = new MemorySink();
  const result = await withFetch(
    async () => {
      attempts++;
      return Response.json({ error: { code: 'backend_unavailable' } }, { status: 502 });
    },
    () => run({ servers: [{ ...config.servers[0]!, local: false }] }, sink),
  );
  expect(result.reason).toBe('model-unavailable');
  expect(attempts).toBe(1);
  expect(sink.of('status')).toHaveLength(0);
});

test('stop during backend backoff cancels without escalation or another attempt', async () => {
  const controller = new AbortController();
  const sink = new MemorySink();
  const emit = sink.emit.bind(sink);
  sink.emit = (event) => {
    emit(event);
    if (event.type === 'status') controller.abort();
  };
  let attempts = 0;
  const result = await withFetch(
    async () => {
      attempts++;
      return Response.json({ error: { code: 'backend_unavailable' } }, { status: 502 });
    },
    () => run({ runtimeFallback: 'runtime:codex' }, sink, controller.signal),
  );
  expect(result.reason).toBe('aborted');
  expect(result.exitCode).toBe(130);
  expect(attempts).toBe(1);
  expect(sink.of('escalate')).toHaveLength(0);
});

test('cloud busy responses are not retried by the local queue policy', async () => {
  let attempts = 0;
  const result = await withFetch(
    async () => {
      attempts++;
      return Response.json({ error: { code: 'engine_busy' } }, { status: 503 });
    },
    () => run({ servers: [{ ...config.servers[0]!, local: false }] }),
  );
  expect(result.reason).toBe('model-unavailable');
  expect(attempts).toBe(1);
});

test('camelCase provider options carry reasoning effort and the thinking switch without warnings', async () => {
  for (const [provider, reasoning, effort, thinking] of [
    ['helena-halogen', 'high', 'high', true],
    ['helena-halogen--nothink', 'off', 'none', false],
  ] as const) {
    let body: Record<string, unknown> = {};
    await withFetch(
      async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({
          id: 'fixture',
          model: 'flash',
          created: 1,
          choices: [
            { index: 0, message: { role: 'assistant', content: 'Done' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
      async () => {
        const resolved = resolveModel(
          `${provider}/flash`,
          [{ ...config.servers[0]!, provider }],
          reasoning,
          {},
        );
        const result = await generateText({
          model: resolved.model,
          prompt: 'Test',
          providerOptions: resolved.providerOptions as never,
          maxRetries: 0,
        });
        expect(result.warnings).toEqual([]);
        expect(Object.keys(resolved.providerOptions)).not.toContain(provider);
      },
    );
    expect(body.reasoning_effort).toBe(effort);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: thinking });
  }
});

test('runtime validates the configurable queue limit', () => {
  expect(
    parseConfig({ ...config, limits: { localModelQueueSeconds: 0 } }).limits
      ?.localModelQueueSeconds,
  ).toBe(0);
  for (const value of [-1, Infinity, '600', 86_401]) {
    expect(() => parseConfig({ ...config, limits: { localModelQueueSeconds: value } })).toThrow(
      'localModelQueueSeconds',
    );
  }
});

test('eight native chats finish against a single-slot proxy despite admission timeouts', async () => {
  const backend = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch() {
      await Bun.sleep(80);
      return completion();
    },
  });
  const socketDir = await mkdtemp(join(tmpdir(), 'volition-native-queue-'));
  const proxy = await startPriorityProxy({
    hostPorts: [0, 0],
    backendPorts: [backend.port!, backend.port!],
    socketDir,
    readConfig: async () => ({
      ...DEFAULT_PRIORITY_CONFIG,
      maxInteractive: 1,
      interactiveQueueMs: 300,
    }),
  });
  const realFetch = globalThis.fetch;
  const sinks = Array.from({ length: 8 }, () => new MemorySink());
  try {
    const results = await withFetch(
      (url, init) => realFetch(url.replace(':8741/', `:${proxy.ports[0]}/`), init),
      () => Promise.all(sinks.map((sink) => run({ limits: { localModelQueueSeconds: 10 } }, sink))),
    );
    expect(results.map((result) => result.exitCode)).toEqual(Array(8).fill(0));
    expect(sinks.some((sink) => sink.of('status').length > 0)).toBe(true);
    expect(proxy.scheduler.status().queued.interactive).toBe(0);
    expect(proxy.scheduler.status().active.interactive).toBe(0);
  } finally {
    await proxy.close();
    await backend.stop(true);
    await rm(socketDir, { recursive: true, force: true });
  }
});

for (const [kind, expected] of [
  ['run', 600_000],
  ['chat', 180_000],
] as const) {
  test(`default queue budget for ${kind} is ${expected} ms`, async () => {
    const controller = new AbortController();
    const sink = new MemorySink();
    const emit = sink.emit.bind(sink);
    sink.emit = (event) => {
      emit(event);
      if (event.type === 'status') controller.abort();
    };
    await withFetch(
      async () => Response.json({ error: { code: 'engine_busy' } }, { status: 503 }),
      () => run({ kind }, sink, controller.signal),
    );
    expect(sink.of('status')[0]!.remainingMs).toBeGreaterThan(expected - 1000);
    expect(sink.of('status')[0]!.remainingMs).toBeLessThanOrEqual(expected);
  });
}

test('stop cancels an in-flight admission request before escalation', async () => {
  const controller = new AbortController();
  let canceled = false;
  const sink = new MemorySink();
  const result = await withFetch(
    async (_url, init) => {
      const pending = new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            canceled = true;
            reject(new Error('aborted'));
          },
          { once: true },
        );
      });
      controller.abort();
      await pending;
      return completion();
    },
    () => run({ runtimeFallback: 'runtime:codex' }, sink, controller.signal),
  );
  expect(result.exitCode).toBe(130);
  expect(canceled).toBe(true);
  expect(sink.of('escalate')).toHaveLength(0);
});

test('generation watchdogs resume after successful admission', async () => {
  const started = Date.now();
  const result = await withFetch(
    async () => {
      await Bun.sleep(40);
      return new Response(new ReadableStream(), {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
    () => run({ limits: { firstChunkSeconds: 0.04, localModelQueueSeconds: 1 } }),
  );
  expect(result.reason).toBe('model-unavailable');
  expect(Date.now() - started).toBeLessThan(500);
});

test('central timeout escalation applies after the queue deadline', async () => {
  const { normalizeEscalation } = await import('@helena/sdk');
  const central = normalizeEscalation({ enabled: true, failure: { on: ['timeout'] } });
  const result = await withFetch(
    async () => Response.json({ error: { code: 'engine_busy' } }, { status: 503 }),
    () => run({ limits: { localModelQueueSeconds: 0.04 }, escalation: { central } }),
  );
  expect(result.status).toBe('escalated');
});

test('exhausted admission budget cannot open another queued model request', async () => {
  const retry = new LocalQueueRetry(50, new MemorySink());
  await retry.run('local/flash', new AbortController().signal, async (queue) => {
    queue.admitted(50);
    return 'Done';
  });
  let called = false;
  await expect(
    retry.run('local/flash', new AbortController().signal, async () => {
      called = true;
      return 'Unexpected request';
    }),
  ).rejects.toBeInstanceOf(LocalModelBusy);
  expect(called).toBe(false);
});

test('a configured local fallback is still attempted after exhausting the queue budget', async () => {
  let fallbackCalls = 0;
  const result = await withFetch(
    async (url) => {
      if (url.includes(':8743/')) {
        fallbackCalls++;
        return completion('Fallback');
      }
      return Response.json({ error: { code: 'engine_busy' } }, { status: 503 });
    },
    () =>
      run({
        fallbackModels: ['local-fallback/flash'],
        servers: [
          ...config.servers,
          {
            ...config.servers[0]!,
            provider: 'local-fallback',
            baseUrl: 'http://127.0.0.1:8743/v1',
          },
        ],
        limits: { localModelQueueSeconds: 0.04 },
      }),
  );
  expect(result.status).toBe('success');
  expect(result.text).toBe('Fallback');
  expect(fallbackCalls).toBe(1);
});
