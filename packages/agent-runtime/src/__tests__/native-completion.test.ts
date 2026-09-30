import { expect, jest, test } from 'bun:test';
import { setImmediate } from 'node:timers/promises';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { MemorySink } from '../events';
import { runLoop } from '../loop';
import { MemorySessionStore, messageText } from '../session';

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

async function settleStream() {
  for (let index = 0; index < 5; index++) await setImmediate();
}

function fixture(limits = {}) {
  let controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(value) {
          controller = value;
          value.enqueue({ type: 'stream-start', warnings: [] });
          value.enqueue({ type: 'text-start', id: 'answer' });
        },
      }),
    }),
  });
  const sessions = new MemorySessionStore();
  const sink = new MemorySink();
  const result = runLoop({
    config: { model: 'local/flash', servers: [], workdir: '/tmp', kind: 'chat', limits },
    prompt: 'Read the account.',
    system: '',
    sessionId: null,
    models: [
      {
        id: 'local/flash',
        provider: 'local',
        modelId: 'flash',
        model,
        local: true,
        contextLength: 262144,
        providerOptions: {},
      },
    ],
    tools: [],
    direct: new Set(),
    sessions,
    sink,
    policy: async () => ({ allowed: true, message: 'Allowed' }),
    env: {},
    signal: new AbortController().signal,
  });
  return { result, sessions, sink, stream: () => controller! };
}

test('an answer whose model call lasts over 60 seconds succeeds and is saved', async () => {
  jest.useFakeTimers();
  try {
    const f = fixture();
    await settleStream();
    for (const delta of ['Account: ', '100000 USD. ', 'No open orders. Read only.']) {
      f.stream().enqueue({ type: 'text-delta', id: 'answer', delta });
      await settleStream();
      jest.advanceTimersByTime(20000);
      await settleStream();
    }
    jest.advanceTimersByTime(1000);
    await settleStream();
    f.stream().enqueue({ type: 'text-end', id: 'answer' });
    f.stream().enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage });
    f.stream().close();
    await settleStream();
    const result = await f.result;
    expect(result).toMatchObject({ status: 'success', exitCode: 0, text: f.sink.text() });
    expect(f.sink.text()).toBe('Account: 100000 USD. No open orders. Read only.');
    const stored = await f.sessions.load(result.sessionId);
    expect(stored!.items.at(-1)!.message.role).toBe('assistant');
    expect(messageText(stored!.items.at(-1)!.message)).toBe(result.text);
    expect(f.sink.of('result')).toEqual([{ type: 'result', text: result.text, exitCode: 0 }]);
  } finally {
    jest.useRealTimers();
  }
});

test('an output pause still fails at the chunk deadline', async () => {
  jest.useFakeTimers();
  try {
    const f = fixture();
    await settleStream();
    f.stream().enqueue({ type: 'text-delta', id: 'answer', delta: 'Partial answer' });
    await settleStream();
    jest.advanceTimersByTime(30000);
    await settleStream();
    expect(await f.result).toMatchObject({ status: 'failed', exitCode: 1, error: 'chunk' });
    f.stream().close();
    await settleStream();
  } finally {
    jest.useRealTimers();
  }
});

test('an active answer still stops at the run budget', async () => {
  jest.useFakeTimers();
  try {
    const f = fixture({ runBudgetSeconds: 45 });
    await settleStream();
    for (let index = 0; index < 3; index++) {
      f.stream().enqueue({ type: 'text-delta', id: 'answer', delta: 'Partial answer' });
      await settleStream();
      jest.advanceTimersByTime(15000);
      await settleStream();
    }
    expect(await f.result).toMatchObject({ status: 'failed', exitCode: 1, error: 'budget' });
    f.stream().close();
    await settleStream();
  } finally {
    jest.useRealTimers();
  }
});

test('a provider error after text stays failed and preserves its message', async () => {
  const f = fixture();
  await settleStream();
  f.stream().enqueue({ type: 'text-delta', id: 'answer', delta: 'Partial answer' });
  f.stream().enqueue({ type: 'error', error: new Error('Connection reset during answer') });
  f.stream().close();
  const result = await f.result;
  expect(result).toMatchObject({
    status: 'failed',
    exitCode: 1,
    error: 'Connection reset during answer',
  });
  expect(f.sink.of('result')[0]!.error).toBe('Connection reset during answer');
});
