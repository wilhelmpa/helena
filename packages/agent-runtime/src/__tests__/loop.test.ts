import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../agent';
import type { AgentRuntimeConfig } from '../config';
import { MemorySink } from '../events';
import type { HelenaApi } from '../helena-client';
import { FileSessionStore, MemorySessionStore } from '../session';
import { structuredSummary } from '../loop';
import type { AgentTool } from '../tools/types';
import { factoryOf, scriptedModel, type Turn } from './fake-model';

async function workdir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'helena-agent-test-'));
}

function selectionClient(selectTools: NonNullable<HelenaApi['selectTools']>): HelenaApi {
  return {
    selectTools,
    decide: async () => ({ allowed: true, message: 'Synthetic allow' }),
    createSession: async () => 'unused',
    loadSession: async () => null,
    appendItems: async () => {},
    compact: async () => {},
    memory: async () => ({ files: [], notes: [], approval: false }),
    note: async () => {},
    proposeMemory: async () => ({ status: 'applied' }),
    searchSessions: async () => [],
  };
}

test('tool preselection keeps the profile core and find_tools', async () => {
  const { primary, result } = await run([{ text: 'Done.' }], {
    prompt: 'Read the file.',
    helena: selectionClient(async () => ({ names: ['read_file'] })),
  });
  expect(result.status).toBe('success');
  expect(primary.doStreamCalls[0]!.tools?.map((tool) => tool.name).sort()).toEqual([
    'clarify',
    'edit_file',
    'find_tools',
    'list_files',
    'memory',
    'read_file',
    'search_files',
    'search_sessions',
    'shell',
    'write_file',
  ]);
});

test('a failed tool preselection preserves the original catalog', async () => {
  const { primary, result } = await run([{ text: 'Done.' }], {
    prompt: 'Read the file.',
    helena: selectionClient(async () => {
      throw new Error('timeout');
    }),
  });
  expect(result.status).toBe('success');
  expect(primary.doStreamCalls[0]!.tools?.some((tool) => tool.name === 'write_file')).toBe(true);
});

function config(dir: string, extra: Partial<AgentRuntimeConfig> = {}): AgentRuntimeConfig {
  return {
    model: 'local/flash',
    servers: [
      {
        provider: 'local',
        kind: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:1/v1',
        local: true,
        contextLength: 262_144,
      },
      { provider: 'cloud', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:2/v1' },
    ],
    workdir: dir,
    tools: { profile: 'coder-lite', allowUnsandboxedShell: true },
    policy: 'allow',
    ...extra,
  };
}

async function run(
  script: Turn[],
  options: {
    dir?: string;
    config?: Partial<AgentRuntimeConfig>;
    models?: Record<string, ReturnType<typeof scriptedModel>>;
    sessions?: MemorySessionStore;
    sessionId?: string | null;
    helena?: HelenaApi | null;
    prompt?: string;
    signal?: AbortSignal;
    extraTools?: AgentTool[];
    labels?: string[];
  } = {},
) {
  const dir = options.dir ?? (await workdir());
  const sink = new MemorySink();
  const sessions = options.sessions ?? new MemorySessionStore();
  const primary = scriptedModel(script);
  const result = await runAgent({
    config: config(dir, options.config),
    prompt: options.prompt ?? 'Mach die Aufgabe.',
    sessionId: options.sessionId ?? null,
    labels: options.labels,
    sink,
    env: {},
    signal: options.signal ?? new AbortController().signal,
    modelFactory: factoryOf({ 'local/flash': primary, ...options.models }),
    helena: options.helena ?? null,
    sessions,
    extraTools: options.extraTools,
  });
  return { result, sink, dir, sessions, primary };
}

describe('agent loop', () => {
  test('asks once for an answer after an empty turn following a tool result', async () => {
    const { result, sink } = await run([
      { calls: [{ name: 'write_file', input: { path: 'a.txt', content: 'Test' } }] },
      { text: '' },
      { text: 'Die Datei wurde gelesen.' },
    ]);
    expect(result.status).toBe('success');
    expect(result.text).toBe('Die Datei wurde gelesen.');
    expect(sink.of('tool-call').map((event) => event.name)).toEqual(['write_file']);
  });

  test('answers without tools and reports session, model, spend and result', async () => {
    const { result, sink } = await run([{ text: 'Hallo!', reasoning: 'kurz nachdenken' }]);
    expect(result.status).toBe('success');
    expect(result.exitCode).toBe(0);
    expect(sink.text()).toBe('Hallo!');
    const types = sink.events.map((event) => event.type);
    expect(types[0]).toBe('session');
    expect(types[1]).toBe('model');
    expect(types).toContain('thinking');
    expect(types.slice(-2)).toEqual(['spend', 'result']);
    const spend = sink.of('spend')[0]!;
    expect(spend.steps).toBe(1);
    expect(spend.inputTokens).toBe(100);
    expect(spend.model).toBe('local/flash');
  });

  test('runs tool calls, writes the file and saves every step', async () => {
    const { result, sink, dir, sessions } = await run([
      { calls: [{ name: 'write_file', input: { path: 'a.txt', content: 'eins' } }] },
      { calls: [{ name: 'read_file', input: { path: 'a.txt' } }] },
      { text: 'Fertig.' },
    ]);
    expect(result.status).toBe('success');
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('eins');
    expect(sink.of('tool-call').map((event) => event.name)).toEqual(['write_file', 'read_file']);
    expect(sink.of('tool-result')[1]!.output).toContain('1\teins');
    const stored = await sessions.load(result.sessionId);
    // user, (assistant, tool) × 2, assistant
    expect(stored!.items.map((item) => item.message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ]);
  });

  test('resumes a saved session with its whole history', async () => {
    const sessions = new MemorySessionStore();
    const first = await run([{ text: 'Erste Antwort.' }], { sessions, prompt: 'Merk dir 42.' });
    const second = await run([{ text: 'Es war 42.' }], {
      sessions,
      sessionId: first.result.sessionId,
      prompt: 'Welche Zahl?',
    });
    expect(second.result.sessionId).toBe(first.result.sessionId);
    const prompt = JSON.stringify(second.primary.doStreamCalls[0]!.prompt);
    expect(prompt).toContain('Merk dir 42.');
    expect(prompt).toContain('Erste Antwort.');
    expect(prompt).toContain('Welche Zahl?');
  });

  test('a lost session fails with the words the runner reads as session lost', async () => {
    const { result, sink } = await run([{ text: 'x' }], { sessionId: 'gone' });
    expect(result.exitCode).toBe(1);
    expect(sink.of('result')[0]!.error).toBe('Session not found');
  });

  test("a call Helena's policy refuses does not run", async () => {
    const helena: HelenaApi = {
      decide: async () => ({ allowed: false, message: 'BLOCKED: needs approval #7' }),
      createSession: async () => 'unused',
      loadSession: async () => null,
      appendItems: async () => {},
      compact: async () => {},
      memory: async () => ({ files: [], notes: [], approval: false }),
      note: async () => {},
      proposeMemory: async () => ({ status: 'applied' }),
      searchSessions: async () => [],
    };
    const { result, sink, dir } = await run(
      [
        { calls: [{ name: 'write_file', input: { path: 'b.txt', content: 'x' } }] },
        { text: 'Blockiert.' },
      ],
      { helena, config: { policy: 'helena' } },
    );
    expect(result.status).toBe('success');
    expect(sink.of('tool-result')[0]).toMatchObject({
      isError: true,
      output: 'BLOCKED: needs approval #7',
    });
    await expect(readFile(join(dir, 'b.txt'), 'utf8')).rejects.toThrow();
  });

  test('stops a loop of calls that change nothing, after one warning', async () => {
    const same = { calls: [{ name: 'list_files', input: { path: '.' } }] };
    const { result, sink } = await run(Array(12).fill(same));
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('loop');
    expect(sink.of('tool-call').length).toBeLessThan(10);
  });

  test('falls back to the next model when the first one is down', async () => {
    const cloud = scriptedModel([{ text: 'Von der Cloud.' }]);
    const { result, sink } = await run([{ error: 'connect ECONNREFUSED 127.0.0.1:8731' }], {
      config: { fallbackModels: ['cloud/big'] },
      models: { 'cloud/big': cloud },
    });
    expect(result.status).toBe('success');
    expect(sink.text()).toBe('Von der Cloud.');
    expect(sink.of('model').map((event) => event.id)).toEqual(['local/flash', 'cloud/big']);
    expect(sink.of('spend')[0]!.model).toBe('cloud/big');
  });

  test('a model that never starts answering hits the first-chunk deadline', async () => {
    const { result } = await run([{ hang: true }], {
      config: { limits: { firstChunkSeconds: 0.2 } },
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('model-unavailable');
  });

  test('hands a task of an escalating kind to Claude Code before the first step', async () => {
    const { result, sink, primary } = await run([{ text: 'nie' }], {
      prompt: 'Prüfe den Vertrag mit dem Lieferanten.',
      config: { escalation: { target: 'runtime:claude/opus', taskKinds: ['recht'] } },
    });
    expect(result.status).toBe('escalated');
    expect(result.exitCode).toBe(3);
    const escalate = sink.of('escalate')[0]!;
    expect(escalate).toMatchObject({
      target: 'runtime:claude/opus',
      reason: 'task-kind',
      detail: 'recht',
    });
    expect(escalate.handover).toContain('Prüfe den Vertrag');
    expect(primary.doStreamCalls.length).toBe(0);
  });

  test('switches to a bigger API model after a loop and finishes there', async () => {
    const same = { calls: [{ name: 'list_files', input: {} }] };
    const big = scriptedModel([{ text: 'Vom großen Modell erledigt.' }]);
    const { result, sink } = await run(Array(12).fill(same), {
      config: { escalation: { target: 'cloud/big', onFailure: true } },
      models: { 'cloud/big': big },
    });
    expect(result.status).toBe('success');
    expect(sink.text()).toContain('Vom großen Modell erledigt.');
    expect(sink.of('model').at(-1)!.id).toBe('cloud/big');
    expect(JSON.stringify(big.doStreamCalls[0]!.prompt)).toContain('stärkeres Modell');
  });

  test('clarify ends the turn with the question', async () => {
    const { result, sink } = await run([
      {
        calls: [
          { name: 'clarify', input: { question: 'Welches Projekt?', choices: ['VOL', 'VERVE'] } },
        ],
      },
      { text: 'nie erreicht' },
    ]);
    expect(result.status).toBe('waiting');
    expect(result.exitCode).toBe(0);
    expect(result.text).toBe('Welches Projekt?');
    expect(sink.of('tool-call')[0]!.input).toContain('VERVE');
  });

  test('find_tools makes a deferred tool callable in the next step', async () => {
    const hidden: AgentTool = {
      name: 'create_calendar_event',
      description: 'Create an event in the calendar',
      readOnly: true,
      inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
      execute: async () => ({ text: 'event created' }),
    };
    const { result, sink } = await run(
      [
        { calls: [{ name: 'create_calendar_event', input: { title: 'x' } }] },
        { calls: [{ name: 'find_tools', input: { query: 'calendar event' } }] },
        { calls: [{ name: 'create_calendar_event', input: { title: 'x' } }] },
        { text: 'Termin steht.' },
      ],
      { extraTools: [hidden], config: { tools: { profile: 'assistent' } } },
    );
    expect(result.status).toBe('success');
    const outputs = sink.of('tool-result').map((event) => event.output);
    expect(outputs[0]).toContain('not loaded');
    expect(outputs[1]).toContain('create_calendar_event');
    expect(outputs[2]).toBe('event created');
  });

  test('offers a task-matched tool directly and defers unrelated knowledge search', async () => {
    const extraTools: AgentTool[] = ['create_issue', 'search_knowledge'].map((name) => ({
      name,
      description: name === 'create_issue' ? 'Create a project issue' : 'Search project knowledge',
      readOnly: true,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ text: 'done' }),
    }));
    const { primary, result } = await run(
      [{ calls: [{ name: 'create_issue', input: {} }] }, { text: 'Erledigt.' }],
      {
        prompt: 'Erstelle eine Aufgabe im Projekt.',
        extraTools,
        config: { tools: { profile: 'assistent' } },
      },
    );
    const offered = primary.doStreamCalls[0]!.tools!.map((entry) => entry.name);
    expect(offered).toContain('create_issue');
    expect(offered).not.toContain('search_knowledge');
    expect(result.status).toBe('success');
  });

  test('file tools stay inside the working folder', async () => {
    const dir = await workdir();
    const outside = await workdir();
    await writeFile(join(outside, 'secret.txt'), 'geheim');
    const { sink } = await run(
      [
        { calls: [{ name: 'read_file', input: { path: join(outside, 'secret.txt') } }] },
        { calls: [{ name: 'read_file', input: { path: '../x' } }] },
        { text: 'ok' },
      ],
      { dir },
    );
    for (const event of sink.of('tool-result')) {
      expect(event.isError).toBe(true);
      expect(event.output).not.toContain('geheim');
    }
  });

  test('the shell tool preserves output for nonzero command exits', async () => {
    const { sink } = await run([
      { calls: [{ name: 'shell', input: { command: 'echo hallo && exit 3' } }] },
      { text: 'ok' },
    ]);
    const output = sink.of('tool-result')[0]!;
    expect(output.isError).not.toBe(true);
    expect(output.outcome).toBe('nonzero_with_output');
    expect(output.exitCode).toBe(3);
    expect(output.output).toContain('Exit code 3');
    expect(output.output).toContain('hallo');
  });

  test('a stop ends the command with exit 130', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const { result } = await run([{ hang: true }], { signal: controller.signal });
    expect(result.exitCode).toBe(130);
  });

  test('compresses the history once the context grows past the threshold', async () => {
    const sessions = new MemorySessionStore();
    const script: Turn[] = [];
    for (let index = 0; index < 8; index++) {
      script.push({
        calls: [{ name: 'write_file', input: { path: `f${index}.txt`, content: String(index) } }],
        inputTokens: 5000,
      });
    }
    script.push({ text: 'fertig', inputTokens: 100 });
    const { result } = await run(script, {
      sessions,
      config: { limits: { compressAtTokens: 4000 } },
    });
    expect(result.status).toBe('success');
    const stored = await sessions.load(result.sessionId);
    expect(stored!.summary).toBe('Zusammenfassung.');
    expect(stored!.compactedThrough).toBeGreaterThan(0);
  });

  test('keeps the original session when the memory flush fails', async () => {
    const sessions = new MemorySessionStore();
    let flushes = 0;
    const helena = selectionClient(async () => ({ names: [] }));
    helena.note = async () => {
      flushes++;
      throw new Error('simulated crash before compaction');
    };
    const script: Turn[] = Array.from({ length: 8 }, (_, index) => ({
      calls: [{ name: 'write_file', input: { path: `file${index}.txt`, content: `${index}` } }],
      inputTokens: 5000,
    }));
    script.push({ text: 'Done.', inputTokens: 100 });
    const { result } = await run(script, {
      sessions,
      helena,
      config: { memory: { enabled: false }, limits: { compressAtTokens: 4000 } },
    });
    const stored = await sessions.load(result.sessionId);
    expect(flushes).toBeGreaterThan(0);
    expect(stored!.summary).toBeNull();
    expect(stored!.compactedThrough).toBe(0);
    expect(stored!.items.length).toBeGreaterThan(8);
  });

  test('keeps recent turns verbatim after a session exceeds its model context', async () => {
    const sessions = new MemorySessionStore();
    const script: Turn[] = Array.from({ length: 24 }, (_, index) => ({
      calls: [{ name: 'write_file', input: { path: `long-${index}.txt`, content: `${index}` } }],
      inputTokens: 5000,
    }));
    script.push({ text: 'Done.', inputTokens: 100 });
    const { result, primary } = await run(script, {
      sessions,
      config: {
        limits: { compressAtTokens: 4000, maxTurns: 30 },
        servers: [
          {
            provider: 'local',
            kind: 'openai-compatible',
            baseUrl: 'http://127.0.0.1:1/v1',
            contextLength: 2048,
          },
        ],
      },
    });
    const stored = await sessions.load(result.sessionId);
    expect(result.status).toBe('success');
    expect(stored!.summary).toBe('Zusammenfassung.');
    expect(stored!.items.length).toBeGreaterThan(24);
    const lastPrompt = JSON.stringify(primary.doStreamCalls.at(-1)!.prompt);
    expect(lastPrompt).toContain('long-23.txt');
  });
});

test('compression never turns a clarifying question into a summary', () => {
  expect(structuredSummary('Can you clarify what to keep?')).toBeNull();
  expect(structuredSummary('Ziel: Aufgabe fertig.')).toContain('## Stand');
  expect(structuredSummary('Reference: https://example.test/?id=7')).toContain('?id=7');
});

test('file compaction accepts an identical retry and keeps the prior checkpoint on conflict', async () => {
  const store = new FileSessionStore(await workdir());
  const id = await store.create();
  await store.compact(id, '## Ziel\nFinish the task', 7);
  await store.compact(id, '## Ziel\nFinish the task', 7);
  await expect(store.compact(id, 'Different summary', 7)).rejects.toThrow('reload');
  expect(await store.load(id)).toMatchObject({
    compactedThrough: 7,
    summary: '## Ziel\nFinish the task',
  });
});

describe('announcements', () => {
  test('a turn that only announces the work is told to go on, once', async () => {
    const { result, sink } = await run([
      { text: 'Ich schaue mir die Dateien an.' },
      { calls: [{ name: 'list_files', input: {} }] },
      { text: 'Es gibt keine Dateien.' },
    ]);
    expect(result.status).toBe('success');
    expect(result.text).toBe('Es gibt keine Dateien.');
    expect(sink.of('tool-call').length).toBe(1);
  });
});

describe('the decision service', () => {
  const decide = (answer: object): AgentTool => ({
    name: 'decide',
    description: 'Decide a question among fixed options',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ text: JSON.stringify(answer) }),
  });

  test('hands a task the decision service calls large to the bigger model', async () => {
    const { result, sink } = await run([{ text: 'nie' }], {
      extraTools: [decide({ status: 'decided', choice: 'large', confidence: 0.93 })],
      config: { escalation: { target: 'runtime:codex', confidenceBelow: 0.8 } },
    });
    expect(result.status).toBe('escalated');
    expect(sink.of('escalate')[0]).toMatchObject({ reason: 'uncertain', target: 'runtime:codex' });
  });

  test('keeps a task the decision service calls small, and one it cannot decide', async () => {
    for (const answer of [
      { status: 'decided', choice: 'small', confidence: 0.95 },
      { status: 'unsure', choice: null, confidence: 0.4 },
    ]) {
      const { result } = await run([{ text: 'Erledigt.' }], {
        extraTools: [decide(answer)],
        config: { escalation: { target: 'runtime:codex', confidenceBelow: 0.8 } },
      });
      expect(result.status).toBe('success');
    }
  });
});

describe('reflection', () => {
  function helenaStub() {
    const notes: string[] = [];
    const helena: HelenaApi = {
      decide: async () => ({ allowed: true, message: '' }),
      createSession: async () => 'unused',
      loadSession: async () => null,
      appendItems: async () => {},
      compact: async () => {},
      memory: async () => ({ files: [], notes: [], approval: false }),
      note: async (text) => {
        notes.push(text);
      },
      proposeMemory: async () => ({ status: 'applied' }),
      searchSessions: async () => [],
    };
    return { helena, notes };
  }

  test('after a successful run with real work, the loop keeps what it learned', async () => {
    const { helena, notes } = helenaStub();
    const { result, sink } = await run(
      [
        { calls: [{ name: 'list_files', input: {} }] },
        { calls: [{ name: 'write_file', input: { path: 'x.txt', content: '1' } }] },
        { calls: [{ name: 'read_file', input: { path: 'x.txt' } }] },
        { text: 'Datei angelegt.' },
        // The reflection:
        {
          calls: [
            { name: 'memory', input: { action: 'note', content: 'x.txt liegt im Arbeitsordner' } },
          ],
        },
        { text: 'nichts weiter' },
      ],
      { helena, config: { policy: 'allow' }, prompt: 'Every week create and verify this file.' },
    );
    expect(result.status).toBe('success');
    expect(notes).toEqual(['x.txt liegt im Arbeitsordner']);
    const closing = sink.events.slice(-2);
    expect(closing[0]).toMatchObject({ type: 'spend', steps: 6, toolCalls: 4 });
    expect(closing[1]).toMatchObject({ type: 'result', text: 'Datei angelegt.', exitCode: 0 });
    // The reflection's own words never reach the answer.
    expect(sink.text()).not.toContain('nichts weiter');
  });

  test('a run whose tests stayed red learns nothing', async () => {
    const { helena, notes } = helenaStub();
    const { result, primary } = await run(
      [
        { calls: [{ name: 'shell', input: { command: 'bun test nowhere.test.ts; exit 1' } }] },
        { calls: [{ name: 'list_files', input: {} }] },
        { calls: [{ name: 'read_file', input: { path: 'missing' } }] },
        { text: 'Tests rot, bitte prüfen.' },
        { calls: [{ name: 'memory', input: { action: 'note', content: 'nie' } }] },
      ],
      { helena },
    );
    expect(result.status).toBe('success');
    expect(notes).toEqual([]);
    expect(primary.doStreamCalls.length).toBe(4);
  });
});

test('a chat emits the runtime handover for its follow-up agent', async () => {
  const { result, sink } = await run([{ text: 'Ich prüfe den Vertrag: sieht gut aus.' }], {
    prompt: 'Prüfe den Vertrag.',
    config: { kind: 'chat', escalation: { target: 'runtime:claude', taskKinds: ['recht'] } },
  });
  expect(result.status).toBe('escalated');
  expect(sink.of('escalate')[0]!.target).toBe('runtime:claude');
});

test('tells an announcement from an answer', async () => {
  const { isAnnouncement } = await import('../loop');
  expect(isAnnouncement('Ich schaue mir die Seite an.')).toBe(true);
  expect(isAnnouncement('Let me check the file.')).toBe(true);
  expect(isAnnouncement('Ich prüfe den Vertrag: sieht gut aus.')).toBe(false);
  expect(isAnnouncement('Ich habe die Datei angelegt.')).toBe(false);
  expect(isAnnouncement('Ich schaue nach. Der Preis ist 49 €.')).toBe(false);
  expect(isAnnouncement('Soll ich die Seite prüfen?')).toBe(false);
});

for (const escalation of [
  { target: 'runtime:codex', mode: 'never' as const },
  { target: 'runtime:codex', onFailure: false },
]) {
  test(`failure escalation respects ${JSON.stringify(escalation)}`, async () => {
    const { result, sink } = await run([{ error: 'connection refused' }], {
      config: { escalation },
    });
    expect(result.status).toBe('failed');
    expect(sink.of('escalate')).toHaveLength(0);
  });
}

test('an unreachable policy API denies a real write', async () => {
  const { HelenaClient } = await import('../helena-client');
  const { sink, dir } = await run(
    [
      { calls: [{ name: 'write_file', input: { path: 'forbidden.txt', content: 'bad' } }] },
      { text: 'Blocked.' },
    ],
    {
      config: { policy: 'helena', memory: { enabled: false } },
      helena: new HelenaClient('http://127.0.0.1:1', 'fixture'),
    },
  );
  expect(sink.of('tool-result')[0]!.output).toContain('BLOCKED');
  await expect(readFile(join(dir, 'forbidden.txt'))).rejects.toThrow();
});

test('central rules select kind-specific targets and task pins override agent pins', async () => {
  const { normalizeEscalation } = await import('@helena/sdk');
  const central = normalizeEscalation({ enabled: true });
  const { result, sink } = await run([{ text: 'unused' }], {
    prompt: 'Review security',
    config: { escalation: { central, agentId: 7 } },
  });
  expect(result.status).toBe('escalated');
  expect(sink.of('escalate')[0]!.target).toBe('runtime:claude/claude-opus-5-5');
  const { centralEscalation } = await import('../escalation');
  central.pins = [
    { scope: 'agent', id: 7, mode: 'strong', model: null },
    { scope: 'task', id: 42, mode: 'local', model: null },
  ];
  expect(
    centralEscalation({ central, agentId: 7 }, 'Review security', { ITSAPLAN_ISSUE_ID: '42' }),
  ).toBeNull();
  central.enabled = false;
  expect(
    centralEscalation({ central, agentId: 7, mode: 'always' }, 'Review security', {}),
  ).toBeNull();
});

test('hands over at eighty percent of the wall-clock budget', async () => {
  const { runLoop } = await import('../loop');
  const { resolveModel } = await import('../models');
  const dir = await workdir();
  const cfg = config(dir, {
    limits: { runBudgetSeconds: 10 },
    escalation: { target: 'runtime:codex' },
  });
  const sink = new MemorySink();
  let reads = 0;
  const model = resolveModel(
    'local/flash',
    cfg.servers,
    null,
    {},
    factoryOf({ 'local/flash': scriptedModel([{ text: 'unused' }]) }),
  );
  const result = await runLoop({
    config: cfg,
    prompt: 'Task',
    system: '',
    sessionId: null,
    models: [model],
    tools: [],
    direct: new Set(),
    sessions: new MemorySessionStore(),
    sink,
    policy: async () => ({ allowed: true, message: '' }),
    env: {},
    signal: new AbortController().signal,
    now: () => (reads++ === 0 ? 0 : 8000),
  });
  expect(result.status).toBe('escalated');
  expect(sink.of('escalate')[0]!.detail).toBe('budget-80');
});

test('a slow policy cannot start a write after the run budget expired', async () => {
  const { HelenaClient } = await import('../helena-client');
  const helena = new HelenaClient('http://127.0.0.1:1', 'fixture');
  helena.decide = async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { allowed: true, message: '' };
  };
  const began = Date.now();
  const { result, dir } = await run(
    [{ calls: [{ name: 'write_file', input: { path: 'too-late.txt', content: 'late' } }] }],
    {
      helena,
      config: { policy: 'helena', memory: { enabled: false }, limits: { runBudgetSeconds: 0.05 } },
    },
  );
  expect(result.status).toBe('failed');
  expect(Date.now() - began).toBeLessThan(140);
  await new Promise((resolve) => setTimeout(resolve, 170));
  await expect(readFile(join(dir, 'too-late.txt'))).rejects.toThrow();
});

test('central timeout rules receive a first-token timeout', async () => {
  const { normalizeEscalation } = await import('@helena/sdk');
  const central = normalizeEscalation({ enabled: true, failure: { on: ['timeout'] } });
  const { result, sink } = await run([{ hang: true }], {
    config: { limits: { firstChunkSeconds: 0.05 }, escalation: { central } },
  });
  expect(result.status).toBe('escalated');
  expect(sink.of('escalate')[0]!.target).toBe('runtime:codex/gpt-6-sol');
});

test('a model step has a total deadline independent of the first-token limit', async () => {
  const began = Date.now();
  const { result } = await run([{ hang: true }], {
    config: { limits: { firstChunkSeconds: 10, stepSeconds: 0.05 } },
  });
  expect(result.status).toBe('failed');
  expect(Date.now() - began).toBeLessThan(500);
});

test('a failed test raises automatic reasoning for the next step', async () => {
  const { primary } = await run([
    { calls: [{ name: 'shell', input: { command: 'bun test missing.test.ts' } }] },
    { text: 'The test failed.' },
  ]);
  expect(primary.doStreamCalls[0]!.providerOptions?.local).toMatchObject({
    reasoningEffort: 'low',
  });
  expect(primary.doStreamCalls[1]!.providerOptions?.local).toMatchObject({
    reasoningEffort: 'medium',
  });
});

test('discovery keeps at most eight deferred schemas and preserves the stored history', async () => {
  const extraTools: AgentTool[] = Array.from({ length: 18 }, (_, index) => ({
    name: `group${Math.floor(index / 6)}_tool${index}`,
    description: 'A deferred tool',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ text: 'ok' }),
  }));
  const { primary, sessions, result, sink } = await run(
    [
      { calls: [{ name: 'find_tools', input: { query: 'group0' } }] },
      { calls: [{ name: 'find_tools', input: { query: 'group1' } }] },
      {
        calls: [
          { name: 'find_tools', input: { query: 'group2' } },
          { name: 'group0_tool2', input: {} },
        ],
      },
      { text: 'Done.' },
    ],
    { extraTools, config: { tools: { profile: 'assistent' } } },
  );
  const names = primary.doStreamCalls.at(-1)!.tools!.map((entry) => entry.name);
  expect(names).toContain('group2_tool15');
  expect(names).not.toContain('group0_tool0');
  expect(names.filter((name) => name.startsWith('group'))).toHaveLength(8);
  expect(sink.of('tool-result').at(-1)!.output).toBe('ok');
  expect((await sessions.load(result.sessionId))!.items).toHaveLength(8);
});

test('two searches keep the first discovered tool available', async () => {
  const extraTools: AgentTool[] = Array.from({ length: 8 }, (_, index) => ({
    name: `group${Math.floor(index / 4)}_tool${index}`,
    description: 'A deferred tool',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ text: 'found tool worked' }),
  }));
  const { sink } = await run(
    [
      { calls: [{ name: 'find_tools', input: { query: 'group0' } }] },
      { calls: [{ name: 'find_tools', input: { query: 'group1' } }] },
      { calls: [{ name: 'group0_tool0', input: {} }] },
      { text: 'Done.' },
    ],
    { extraTools, config: { tools: { profile: 'assistent' } } },
  );
  expect(sink.of('tool-result')[2]!.output).toBe('found tool worked');
});
