import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../agent';
import type { AgentRuntimeConfig } from '../config';
import { MemorySink } from '../events';
import type { HelenaApi } from '../helena-client';
import { MemorySessionStore } from '../session';
import type { AgentTool } from '../tools/types';
import { factoryOf, scriptedModel, type Turn } from './fake-model';

async function workdir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'helena-agent-test-'));
}

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

  test('the shell tool runs commands and reports red tests', async () => {
    const { sink } = await run([
      { calls: [{ name: 'shell', input: { command: 'echo hallo && exit 3' } }] },
      { text: 'ok' },
    ]);
    const output = sink.of('tool-result')[0]!;
    expect(output.isError).toBe(true);
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
});
