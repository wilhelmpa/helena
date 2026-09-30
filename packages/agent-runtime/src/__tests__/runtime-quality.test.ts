import { expect, test } from 'bun:test';
import { directTools, runAgent } from '../agent';
import type { AgentRuntimeConfig } from '../config';
import { MemorySink } from '../events';
import type { HelenaApi } from '../helena-client';
import { MemorySessionStore } from '../session';
import { memoryTool, skillTool } from '../tools/builtin';
import type { AgentTool, ToolContext } from '../tools/types';
import { factoryOf, scriptedModel, type Turn } from './fake-model';

const config: AgentRuntimeConfig = {
  model: 'test/model',
  servers: [{ provider: 'test', kind: 'openai-compatible', local: true }],
  kind: 'chat',
  workdir: '/tmp',
  policy: 'allow',
  memory: { enabled: false },
};
const context: ToolContext = {
  workdir: '/tmp',
  env: {},
  signal: new AbortController().signal,
};

async function run(
  script: Turn[],
  options: {
    config?: Partial<AgentRuntimeConfig>;
    sessions?: MemorySessionStore;
    sessionId?: string;
    model?: ReturnType<typeof scriptedModel>;
    extraTools?: AgentTool[];
  } = {},
) {
  const model = options.model ?? scriptedModel(script);
  const sessions = options.sessions ?? new MemorySessionStore();
  const sink = new MemorySink();
  const result = await runAgent({
    config: { ...config, ...options.config },
    prompt: 'Continue.',
    sessions,
    sessionId: options.sessionId,
    sink,
    modelFactory: factoryOf({ 'test/model': model }),
    extraTools: options.extraTools,
    helena: null,
    env: {},
    signal: context.signal,
  });
  return { model, sessions, sink, result };
}

test('length continues the answer without losing its first part', async () => {
  const { result, sink, model } = await run([
    { text: '1, 2, ', finishReason: 'length' },
    { text: '3, 4.' },
  ]);
  expect(result).toMatchObject({ status: 'success', text: '1, 2, 3, 4.', steps: 2 });
  expect(
    sink
      .of('text')
      .map((event) => event.delta)
      .join(''),
  ).toBe(result.text);
  expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain('1, 2, ');
});

test('repeated length is failed and never reports a complete answer', async () => {
  const { result } = await run([{ text: 'partial', finishReason: 'length' }]);
  expect(result).toMatchObject({ status: 'failed', reason: 'output-length', exitCode: 1 });
  expect(result.steps).toBeLessThanOrEqual(4);
  expect(result.text).toContain('partial');
});

test('length with no remaining turn fails with the partial answer', async () => {
  const { result } = await run([{ text: 'partial', finishReason: 'length' }], {
    config: { limits: { maxTurns: 1 } },
  });
  expect(result).toMatchObject({ status: 'failed', reason: 'output-length', text: 'partial' });
});

test('an empty continuation cannot mark the truncated answer complete', async () => {
  const { result } = await run([{ text: 'partial', finishReason: 'length' }, { text: '' }]);
  expect(result).toMatchObject({ status: 'failed', reason: 'output-length', text: 'partial' });
});

async function history(summary: string | null = null) {
  const sessions = new MemorySessionStore();
  const id = await sessions.create();
  for (let step = 1; step <= 12; step++) {
    await sessions.append(id, [
      {
        seq: step * 2 - 1,
        step,
        message: {
          role: 'user',
          content: `Project VOL-58 deadline 2026-10-05. ${'detail '.repeat(1000)}`,
        },
      },
      { seq: step * 2, step, message: { role: 'assistant', content: 'Acknowledged.' } },
    ]);
  }
  if (summary) await sessions.compact(id, summary, 2);
  return { sessions, sessionId: id };
}

test('a resumed pure chat compresses before its first model call', async () => {
  const state = await history('## Goal\nPrevious summary.');
  const { model, result } = await run([{ text: 'Done.' }], state);
  expect(result.status).toBe('success');
  expect(
    model.doStreamCalls.filter(
      (call) =>
        call.prompt[0]?.role === 'system' &&
        call.prompt[0].content.startsWith('Erstelle eine einzige flache Zusammenfassung'),
    ),
  ).toHaveLength(1);
  expect(model.doStreamCalls[0]!.maxOutputTokens).toBeGreaterThan(1500);
  expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain('Previous summary.');
  expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain('Zusammenfassung.');
  const stored = await state.sessions.load(state.sessionId);
  expect(stored!.summary).toBe('Zusammenfassung.');
  expect(stored!.compactedThrough).toBeGreaterThan(2);
});

test('compression includes facts at the end of a long chat message', async () => {
  const state = await history();
  state.sessions.sessions.get(state.sessionId)!.items[0]!.message.content +=
    '\nContact at the end: Dora, code VOL-END-800.';
  const { model } = await run([{ text: 'Done.' }], state);
  expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain('VOL-END-800');
});

test('a bounded compression keeps complete oldest steps and leaves the rest visible', async () => {
  const state = await history();
  const stored = state.sessions.sessions.get(state.sessionId)!;
  for (const item of stored.items) {
    if (item.message.role === 'user')
      item.message.content = `STEP-${item.step} ${'x'.repeat(29000)}`;
  }
  const { model } = await run([{ text: 'Done.' }], state);
  const summaryPrompt = JSON.stringify(model.doStreamCalls[0]!.prompt);
  expect(summaryPrompt).toContain('STEP-1');
  expect(summaryPrompt).not.toContain('STEP-5');
  const mainPrompt = JSON.stringify(model.doStreamCalls[1]!.prompt);
  expect(mainPrompt).toContain('STEP-5');
  expect(mainPrompt).toContain('STEP-6');
});

test('a truncated compression preserves the old summary and all its history', async () => {
  const state = await history('Previous summary.');
  const model = scriptedModel([{ text: 'Done.' }], {
    summary: 'Broken summary',
    summaryFinishReason: 'length',
  });
  await run([], { ...state, model });
  const stored = await state.sessions.load(state.sessionId);
  expect(stored!.summary).toBe('Previous summary.');
  expect(stored!.compactedThrough).toBe(2);
  expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain('VOL-58');
});

test('a clarifying question cannot replace the previous summary or discard its history', async () => {
  const state = await history('Previous summary.');
  const model = scriptedModel([{ text: 'Done.' }], { summary: 'Can you clarify what to keep?' });
  await run([], { ...state, model });
  const stored = await state.sessions.load(state.sessionId);
  expect(stored!.summary).toBe('Previous summary.');
  expect(stored!.compactedThrough).toBe(2);
  expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain('VOL-58');
});

test('compression streams its output through the OpenAI API', async () => {
  const state = await history();
  const requests: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as Record<string, unknown>;
      requests.push(body);
      if (!body.stream) return Response.json({ error: 'stream required' }, { status: 502 });
      const content = requests.length === 1 ? '## Ziel\nVOL-58, deadline 2026-10-05.' : 'Done.';
      const chunks = [
        { choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] },
        {
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        },
      ];
      return new Response(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  try {
    await runAgent({
      config: {
        ...config,
        servers: [
          {
            provider: 'test',
            kind: 'openai-compatible',
            baseUrl: `http://127.0.0.1:${server.port}/v1`,
            local: true,
          },
        ],
      },
      ...state,
      prompt: 'Continue.',
      helena: null,
      sink: new MemorySink(),
      env: {},
      signal: context.signal,
    });
    expect((await state.sessions.load(state.sessionId))!.summary).toContain('VOL-58');
    expect(requests.every((request) => request.stream === true)).toBe(true);
    expect(requests[0]!.max_tokens).toBe(4096);
    expect(requests[0]!.reasoning_effort).toBe('none');
  } finally {
    await server.stop(true);
  }
});

test('skill pages honor line offset and limit for instructions and reference files', async () => {
  const tool = skillTool([
    {
      name: 'sample',
      description: 'sample',
      markdown: 'one\ntwo\nthree\nfour',
      files: [{ path: 'ref.md', content: 'a\nb\nc' }],
    },
  ]);
  const first = await tool.execute({ name: 'sample', offset: 0, limit: 2 }, context);
  const second = await tool.execute({ name: 'sample', offset: 2, limit: 2 }, context);
  expect(first.text).toContain('one\ntwo');
  expect(first.text).not.toContain('three');
  expect(second.text).toContain('three\nfour');
  expect(second.text).not.toContain('one');
  expect(
    (await tool.execute({ name: 'sample', file: 'ref.md', offset: 1, limit: 1 }, context)).text,
  ).toContain('b');
  expect((await tool.execute({ name: 'sample', offset: -1 }, context)).isError).toBe(true);
});

test('doubly encoded skill arguments are repaired and non-object input is rejected', async () => {
  let calls = 0;
  const tool: AgentTool = {
    name: 'skill_manage',
    description: 'Manage skills',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['list'] } },
      required: ['action'],
    },
    execute: async (input) => {
      expect(input.action).toBe('list');
      calls++;
      return { text: '[]' };
    },
  };
  const { sink } = await run(
    [
      { calls: [{ name: tool.name, input: JSON.stringify(JSON.stringify({ action: 'list' })) }] },
      { calls: [{ name: tool.name, input: JSON.stringify(JSON.stringify(['list'])) }] },
      { text: 'Done.' },
    ],
    { extraTools: [tool], config: { tools: { core: ['skill_manage'] } } },
  );
  expect(calls).toBe(1);
  expect(sink.of('tool-result')[0]!.isError).not.toBe(true);
  expect(sink.of('tool-result')[1]!.isError).toBe(true);
});

test('actual input usage compresses a pure chat before completing it', async () => {
  const state = await history();
  const stored = state.sessions.sessions.get(state.sessionId)!;
  for (const item of stored.items) item.message.content = 'Small chat entry.';
  const { model } = await run([{ text: 'Done.', inputTokens: 15000 }], state);
  expect(
    model.doStreamCalls.filter(
      (call) =>
        call.prompt[0]?.role === 'system' &&
        call.prompt[0].content.startsWith('Erstelle eine einzige flache Zusammenfassung'),
    ),
  ).toHaveLength(1);
  expect((await state.sessions.load(state.sessionId))!.compactedThrough).toBeGreaterThan(0);
});

test('memory reads reuse the run snapshot and refresh it after a write', async () => {
  let reads = 0;
  let noted = false;
  const writes: string[] = [];
  let sessionId = 'session-a';
  const initial = {
    files: [{ file: 'MEMORY.md', content: 'Project VOL-58 deadline.', sha256: '' }],
    notes: [],
    approval: false,
  };
  const api = {
    memory: async () => {
      reads++;
      return {
        ...initial,
        notes: noted ? [{ day: '2026-09-30', content: '- 22:00 New useful fact.\n' }] : [],
      };
    },
    note: async (_content: string, session: string) => {
      writes.push(session);
      noted = true;
    },
    proposeMemory: async (_file: string, _content: string, _reason: string, session: string) => {
      writes.push(session);
      return { status: 'pending' };
    },
  } as unknown as HelenaApi;
  const tool = memoryTool(api, () => sessionId, initial);
  for (let round = 0; round < 3; round++) {
    expect((await tool.execute({ action: 'read', query: 'deadline' }, context)).text).toContain(
      'VOL-58',
    );
  }
  expect(reads).toBe(0);
  expect((await tool.execute({ action: 'note', content: 'New useful fact.' }, context)).text).toBe(
    "Saved today's note.",
  );
  await tool.execute({ action: 'read', query: 'deadline' }, context);
  expect(reads).toBe(1);
  sessionId = 'session-b';
  await tool.execute(
    { action: 'propose', file: 'MEMORY.md', content: 'New durable facts.' },
    context,
  );
  await tool.execute({ action: 'read', query: 'deadline' }, context);
  expect(reads).toBe(2);
  expect(writes).toEqual(['session-a', 'session-b']);
});

test('memory notes distinguish an approval proposal from a confirmed saved note', async () => {
  const api = {
    note: async () => {},
    memory: async () => ({ files: [], notes: [], approval: true }),
  } as unknown as HelenaApi;
  const tool = memoryTool(api);
  expect((await tool.execute({ action: 'note', content: 'Useful procedure.' }, context)).text).toBe(
    "Submitted today's note for owner approval.",
  );
});

test('each profile directly offers its core tools and only research/full offer the browser', () => {
  const all = [
    'get_issue',
    'update_issue',
    'read_document',
    'search_knowledge_vault',
    'search_mail',
    'draft_reply',
    'capture_web_page',
    'browser_click',
    'read_file',
    'shell',
    'find_tools',
    'unrelated',
  ].map((name): AgentTool => ({
    name,
    kind: name === 'browser_click' ? 'browser' : 'normal',
    description: name,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ text: 'ok' }),
  }));
  for (const profile of ['voll', 'coder-lite', 'recherche', 'assistent'] as const) {
    const direct = directTools(profile, all);
    expect(direct.has('get_issue')).toBe(true);
    expect(direct.has('read_document')).toBe(true);
    expect(direct.has('browser_click')).toBe(profile === 'voll' || profile === 'recherche');
    expect(direct.has('search_mail')).toBe(profile === 'voll' || profile === 'assistent');
    expect(direct.has('read_file')).toBe(profile === 'voll' || profile === 'coder-lite');
    expect(direct.has('unrelated')).toBe(false);
  }
});
