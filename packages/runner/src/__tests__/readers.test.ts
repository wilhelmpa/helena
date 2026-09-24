import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerRuntimeRequest, isRuntimeRequest, readerCapabilities } from '../readers';
import { hermesTranscript, parseHermesVersion } from '../readers/hermes';
import { claudeProjectDir, claudeReaders, codexReaders } from '../readers/jsonl';
import type { SessionPage, Transcript } from '../readers/types';
import { Redactor } from '../redact';

// A real `hermes sessions export --format jsonl --redact` of a session run against a
// scripted model: a terminal call, its result, and the answer.
const exported = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures/hermes-session-export.json'), 'utf8'),
) as Record<string, unknown>;

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'helena-readers-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('Hermes transcript', () => {
  it('maps an export to GenAI messages with typed parts', () => {
    const transcript = hermesTranscript(exported, 0, 500);
    expect(transcript.totalMessages).toBe(4);
    expect(transcript.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    const call = transcript.messages[1]!;
    expect(call.parts).toEqual([
      { type: 'reasoning', content: 'Ich probiere einen Befehl aus.' },
      {
        type: 'tool_call',
        id: 'call_ba2782c1',
        name: 'terminal',
        arguments: { command: 'echo hallo-aus-dem-test' },
      },
    ]);
    expect(transcript.messages[2]!.parts[0]).toEqual({
      type: 'tool_call_response',
      id: 'call_ba2782c1',
      name: 'terminal',
      response: { output: 'hallo-aus-dem-test', exit_code: 0, error: null },
    });
    // Hermes redacted the token in its export; the text keeps its ends only.
    const answer = transcript.messages[3]!.parts.find((part) => part.type === 'text');
    expect(answer).toEqual({
      type: 'text',
      content: 'Fertig: der Befehl lief. Das Token sk-tes...cdef bleibt geheim.',
    });
    expect(transcript.messages[0]!.timestamp).toBe(1790238535952);
  });

  it('counts the cached tokens into the input, as the GenAI convention does', () => {
    const { session } = hermesTranscript(exported, 0, 1);
    expect(session.usage).toEqual({
      inputTokens: 2400,
      outputTokens: 80,
      cacheReadTokens: 1600,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    });
    expect(session.model).toBe('fake-model');
    expect(session.startedAt).toBe(1790238536024);
  });

  it('pages the messages', () => {
    const page = hermesTranscript(exported, 2, 1);
    expect(page.messages.map((m) => m.role)).toEqual(['tool']);
    expect(page.offset).toBe(2);
    expect(page.totalMessages).toBe(4);
  });

  it('cuts an outsized tool result and says so', () => {
    const big = {
      ...exported,
      messages: [
        {
          id: 1,
          role: 'tool',
          tool_call_id: 'x',
          tool_name: 'read_file',
          content: 'a'.repeat(40_000),
          active: 1,
        },
      ],
    };
    const transcript = hermesTranscript(big, 0, 10);
    expect(transcript.truncated).toBe(true);
    const part = transcript.messages[0]!.parts[0] as { response: string };
    expect(part.response.length).toBeLessThan(33_000);
  });

  it('reads the version line', () => {
    expect(
      parseHermesVersion(
        'Hermes Agent v0.21.4 (2026.9.21) · upstream 3c6c1323 · local 80cb510b (+1 carried commit)\nInstall directory: /x',
      ),
    ).toEqual({
      runtime: 'hermes',
      version: '0.21.4',
      detail:
        'Hermes Agent v0.21.4 (2026.9.21) · upstream 3c6c1323 · local 80cb510b (+1 carried commit)',
    });
  });
});

describe('Claude Code sessions', () => {
  async function claudeHome(cwd: string) {
    const home = await tempHome();
    const dir = join(home, '.claude', 'projects', claudeProjectDir(cwd));
    await mkdir(dir, { recursive: true });
    const lines = [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-09-24T08:00:00.000Z',
        message: { role: 'user', content: 'List the files' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-09-24T08:00:02.000Z',
        message: {
          model: 'claude-sonnet-4-6',
          content: [
            { type: 'thinking', thinking: 'Use ls.' },
            { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
          ],
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 5,
            output_tokens: 7,
          },
          stop_reason: 'tool_use',
        },
      },
      {
        type: 'user',
        uuid: 'u2',
        timestamp: '2026-09-24T08:00:03.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.txt' }],
        },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        timestamp: '2026-09-24T08:00:04.000Z',
        message: {
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'One file: a.txt' }],
          usage: { input_tokens: 20, output_tokens: 5 },
        },
      },
    ];
    await writeFile(
      join(dir, 'sess-1.jsonl'),
      `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
    );
    // Another project's session in the same home is not the agent's.
    const other = join(home, '.claude', 'projects', claudeProjectDir('/srv/other'));
    await mkdir(other, { recursive: true });
    await writeFile(join(other, 'sess-2.jsonl'), `${JSON.stringify(lines[0])}\n`);
    return home;
  }

  it('lists the sessions of the agent working directory only', async () => {
    const cwd = '/srv/workspaces/vol';
    const home = await claudeHome(cwd);
    const page = (await claudeReaders.handle(
      { op: 'sessions.list' },
      { runtime: 'claude', home, cwd, env: {} },
    )) as SessionPage;
    expect(page.total).toBe(1);
    expect(page.sessions[0]).toMatchObject({
      id: 'sess-1',
      title: 'List the files',
      model: 'claude-sonnet-4-6',
      toolCallCount: 1,
      usage: { inputTokens: 135, outputTokens: 12, cacheReadTokens: 100, cacheWriteTokens: 5 },
    });
  });

  it('reads a transcript with tool calls and results', async () => {
    const cwd = '/srv/workspaces/vol';
    const home = await claudeHome(cwd);
    const transcript = (await claudeReaders.handle(
      { op: 'sessions.transcript', sessionId: 'sess-1' },
      { runtime: 'claude', home, cwd, env: {} },
    )) as Transcript;
    expect(transcript.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(transcript.messages[1]!.parts).toEqual([
      { type: 'reasoning', content: 'Use ls.' },
      { type: 'tool_call', id: 'toolu_1', name: 'Bash', arguments: { command: 'ls' } },
    ]);
    expect(transcript.messages[2]!.parts[0]).toMatchObject({
      type: 'tool_call_response',
      id: 'toolu_1',
      response: 'a.txt',
    });
    await expect(
      claudeReaders.handle(
        { op: 'sessions.transcript', sessionId: 'sess-2' },
        { runtime: 'claude', home, cwd, env: {} },
      ),
    ).rejects.toThrow('Session not found');
  });
});

describe('Codex sessions', () => {
  it('reads a rollout of the agent working directory', async () => {
    const home = await tempHome();
    const dir = join(home, '.codex', 'sessions', '2026', '09', '24');
    await mkdir(dir, { recursive: true });
    const id = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    const lines = [
      {
        timestamp: '2026-09-24T08:00:00Z',
        type: 'session_meta',
        payload: { id, cwd: '/srv/w/vol' },
      },
      { timestamp: '2026-09-24T08:00:00Z', type: 'turn_context', payload: { model: 'gpt-6-luna' } },
      {
        timestamp: '2026-09-24T08:00:00Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }],
        },
      },
      {
        timestamp: '2026-09-24T08:00:01Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Run the tests' }],
        },
      },
      {
        timestamp: '2026-09-24T08:00:02Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell',
          arguments: '{"command":["bun","test"]}',
          call_id: 'c1',
        },
      },
      {
        timestamp: '2026-09-24T08:00:05Z',
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'c1', output: '3 pass' },
      },
      {
        timestamp: '2026-09-24T08:00:06Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 900,
              cached_input_tokens: 600,
              output_tokens: 50,
              reasoning_output_tokens: 20,
            },
          },
        },
      },
      {
        timestamp: '2026-09-24T08:00:06Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'All green.' }],
        },
      },
    ];
    await writeFile(
      join(dir, `rollout-2026-09-24T08-00-00-${id}.jsonl`),
      lines.map((l) => JSON.stringify(l)).join('\n'),
    );
    const context = { runtime: 'codex', home, cwd: '/srv/w/vol', env: {} };
    const page = (await codexReaders.handle({ op: 'sessions.list' }, context)) as SessionPage;
    expect(page.sessions[0]).toMatchObject({
      id,
      title: 'Run the tests',
      model: 'gpt-6-luna',
      usage: { inputTokens: 900, cacheReadTokens: 600, outputTokens: 50, reasoningTokens: 20 },
    });
    const transcript = (await codexReaders.handle(
      { op: 'sessions.transcript', sessionId: id },
      context,
    )) as Transcript;
    expect(transcript.messages.map((m) => m.parts[0]!.type)).toEqual([
      'text',
      'tool_call',
      'tool_call_response',
      'text',
    ]);
    const elsewhere = (await codexReaders.handle(
      { op: 'sessions.list' },
      { ...context, cwd: '/srv/w/other' },
    )) as SessionPage;
    expect(elsewhere.total).toBe(0);
  });
});

describe('runtime requests', () => {
  it('knows the requests and the capabilities of each runtime', () => {
    expect(isRuntimeRequest({ op: 'sessions.list' })).toBe(true);
    expect(isRuntimeRequest({ op: 'files.delete' })).toBe(false);
    expect(readerCapabilities('hermes')).toContain('transcripts');
    expect(readerCapabilities('claude')).not.toContain('logs');
    expect(readerCapabilities('opencode')).toEqual([]);
  });

  it('pins and unpins a skill through the Hermes CLI', async () => {
    const home = await tempHome();
    const bin = join(home, 'hermes');
    const calls = join(home, 'calls');
    await writeFile(
      bin,
      `#!/bin/sh\necho "$@" >> '${calls}'\nif [ "$2" = status ]; then echo 'curator: PAUSED'; fi\n`,
    );
    await chmod(bin, 0o755);
    const context = { runtime: 'hermes', home, cwd: home, env: { HERMES_BIN: bin } };
    const status = (await answerRuntimeRequest(
      { op: 'curator.set', action: 'pin', skill: 'release-notes' },
      context,
    )) as { paused: boolean | null };
    expect(status.paused).toBe(true);
    await answerRuntimeRequest(
      { op: 'curator.set', action: 'unpin', skill: 'release-notes' },
      context,
    );
    expect((await readFile(calls, 'utf8')).trim().split('\n')).toEqual([
      'curator pin release-notes',
      'curator status',
      'curator unpin release-notes',
      'curator status',
    ]);
    await expect(
      answerRuntimeRequest({ op: 'curator.set', action: 'pin', skill: '--all' }, context),
    ).rejects.toThrow('Not a skill name');
  });

  it('refuses what the runtime cannot answer', async () => {
    const home = await tempHome();
    await expect(
      answerRuntimeRequest({ op: 'logs.read' }, { runtime: 'claude', home, cwd: '/x', env: {} }),
    ).rejects.toThrow('cannot answer logs.read');
  });

  it('masks the secrets the runner holds in what it answers', async () => {
    const cwd = '/srv/workspaces/vol';
    const home = await tempHome();
    const dir = join(home, '.claude', 'projects', claudeProjectDir(cwd));
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 's.jsonl'),
      JSON.stringify({
        type: 'user',
        uuid: 'u',
        timestamp: '2026-09-24T08:00:00Z',
        message: { content: 'key agent-key-1234567890 here' },
      }),
    );
    const transcript = (await answerRuntimeRequest(
      { op: 'sessions.transcript', sessionId: 's' },
      { runtime: 'claude', home, cwd, env: {} },
      new Redactor(['agent-key-1234567890']),
    )) as Transcript;
    expect(transcript.messages[0]!.parts[0]).toEqual({
      type: 'text',
      content: 'key [redacted] here',
    });
  });
});
