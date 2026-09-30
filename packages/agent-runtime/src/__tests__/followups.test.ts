import { expect, test } from 'bun:test';
import { runLoop, type LoopInput } from '../loop';
import { MemorySessionStore } from '../session';
import { MemorySink } from '../events';
import { FollowupInbox } from '../followups';
import { scriptedModel, type Turn } from './fake-model';

function fixture(turns: Turn[]) {
  const sessions = new MemorySessionStore();
  const model = scriptedModel(turns);
  const sink = new MemorySink();
  let pending: 'inject' | 'replace' | null = null;
  const inbox = new FollowupInbox(async (boundary) => {
    if (!boundary) return { pending: pending !== null, replace: pending === 'replace', items: [] };
    const mode = pending;
    pending = null;
    const items = mode
      ? [
          {
            seq: boundary.afterSeq + 1,
            step: boundary.step,
            message: { role: 'user' as const, content: 'Use the new instruction.' },
          },
        ]
      : [];
    await sessions.append(boundary.sessionId, items);
    return { pending: items.length > 0, replace: mode === 'replace', items };
  });
  const input: LoopInput = {
    config: { model: 'test/model', servers: [], workdir: '/tmp', policy: 'allow' },
    prompt: 'Original task',
    system: '',
    sessionId: null,
    models: [
      {
        id: 'test/model',
        modelId: 'model',
        provider: 'test',
        model,
        local: false,
        contextLength: 100000,
        providerOptions: {},
      },
    ],
    tools: [],
    direct: new Set(['work']),
    sessions,
    sink,
    policy: async () => ({ allowed: true, message: '' }),
    env: { ITSAPLAN_MESSAGE_ID: '42' },
    signal: new AbortController().signal,
    followups: inbox,
  };
  return {
    input,
    sessions,
    sink,
    model,
    inbox,
    push: (mode: 'inject' | 'replace') => {
      pending = mode;
    },
  };
}

test('inject during a tool preserves its result and defers remaining calls before the next model step', async () => {
  const f = fixture([
    {
      calls: [
        { name: 'work', input: {}, id: 'a' },
        { name: 'work', input: {}, id: 'b' },
      ],
    },
    { text: 'Done with the new instruction.' },
  ]);
  let executed = 0;
  f.input.tools = [
    {
      name: 'work',
      description: 'work',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      async execute(_, ctx) {
        executed++;
        f.push('inject');
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(ctx.signal.aborted).toBe(false);
        return { text: 'Saved tool result' };
      },
    },
  ];
  const result = await runLoop(f.input);
  expect(result.status).toBe('success');
  expect(executed).toBe(1);
  const stored = await f.sessions.load(result.sessionId);
  expect(stored!.items.map((i) => i.message.role)).toEqual([
    'user',
    'assistant',
    'tool',
    'user',
    'assistant',
  ]);
  expect(JSON.stringify(stored!.items[2])).toContain('Saved tool result');
  expect(JSON.stringify(f.model.doStreamCalls[1]!.prompt)).toContain('Use the new instruction.');
});

test('replace aborts the tool and waits for cleanup before the replacement model step', async () => {
  const f = fixture([{ calls: [{ name: 'work', input: {} }] }, { text: 'Replacement complete.' }]);
  let cleaned = false;
  f.input.tools = [
    {
      name: 'work',
      description: 'work',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      async execute(_, ctx) {
        f.push('replace');
        void f.inbox.pending();
        await new Promise<void>((resolve) =>
          ctx.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        cleaned = true;
        return { text: 'Cleanup complete' };
      },
    },
  ];
  const consume = f.inbox.consume.bind(f.inbox);
  f.inbox.consume = async (boundary) => {
    if (f.inbox.signal.aborted) expect(cleaned).toBe(true);
    return consume(boundary);
  };
  const result = await runLoop(f.input);
  expect(result.status).toBe('success');
  expect(cleaned).toBe(true);
  const stored = await f.sessions.load(result.sessionId);
  expect(JSON.stringify(stored!.items)).toContain('The tool was stopped.');
  expect(f.model.doStreamCalls).toHaveLength(2);
});

test('injection at response end takes another step and restart does not append the original task again', async () => {
  const f = fixture([{ text: 'First answer.' }, { text: 'Updated answer.' }]);
  const emit = f.sink.emit.bind(f.sink);
  let once = false;
  f.sink.emit = (event) => {
    emit(event);
    if (event.type === 'text' && !once) {
      once = true;
      f.push('inject');
    }
  };
  const result = await runLoop(f.input);
  expect(result.text).toBe('Updated answer.');
  const resumed = await runLoop({ ...f.input, sessionId: result.sessionId });
  const stored = await f.sessions.load(resumed.sessionId);
  expect(
    stored!.items.filter((i) => i.message.role === 'user' && i.message.content === 'Original task'),
  ).toHaveLength(1);
  expect(
    stored!.items.filter(
      (i) => i.message.role === 'user' && i.message.content === 'Use the new instruction.',
    ),
  ).toHaveLength(1);
});

test('replace during a model request aborts it before starting the replacement step', async () => {
  const f = fixture([{ hang: true }, { text: 'Replacement answer.' }]);
  const timer = setTimeout(() => {
    f.push('replace');
    void f.inbox.pending();
  }, 20);
  try {
    const result = await runLoop(f.input);
    expect(result.status).toBe('success');
    expect(result.text).toBe('Replacement answer.');
    expect(f.model.doStreamCalls).toHaveLength(2);
    expect(f.model.doStreamCalls[0]!.abortSignal!.aborted).toBe(true);
  } finally {
    clearTimeout(timer);
  }
});

test('a failed control channel cannot discard completed tool results', async () => {
  const f = fixture([
    {
      calls: [
        { name: 'work', input: {}, id: 'first' },
        { name: 'work', input: {}, id: 'second' },
      ],
    },
  ]);
  let calls = 0;
  let polls = 0;
  f.input.tools = [
    {
      name: 'work',
      description: 'work',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      async execute() {
        calls++;
        return { text: 'Committed result' };
      },
    },
  ];
  f.inbox.pending = async () => {
    if (++polls > 1) throw new Error('API unavailable');
    return false;
  };
  const consume = f.inbox.consume.bind(f.inbox);
  f.inbox.consume = (boundary) => {
    if (boundary.afterSeq > 1) return Promise.reject(new Error('API unavailable'));
    return consume(boundary);
  };
  await expect(runLoop(f.input)).rejects.toThrow('API unavailable');
  const session = await f.sessions.load(f.sink.of('session')[0]!.id);
  expect(calls).toBe(1);
  expect(session!.items.map((item) => item.message.role)).toEqual(['user', 'assistant', 'tool']);
  expect(JSON.stringify(session!.items)).toContain('Committed result');
});

test('a new instruction after a length continuation discards the previous partial answer', async () => {
  const f = fixture([
    { text: 'Old partial. ', finishReason: 'length' },
    { text: 'Old continuation. ', finishReason: 'length' },
    { text: 'Updated answer.' },
  ]);
  const emit = f.sink.emit.bind(f.sink);
  f.sink.emit = (event) => {
    emit(event);
    if (event.type === 'text' && event.delta === 'Old continuation. ') f.push('inject');
  };
  const result = await runLoop(f.input);
  expect(result).toMatchObject({ status: 'success', text: 'Updated answer.', steps: 3 });
  const stored = await f.sessions.load(result.sessionId);
  expect(JSON.stringify(stored!.items)).toContain('Old partial. ');
  expect(JSON.stringify(stored!.items)).toContain('Use the new instruction.');
});
