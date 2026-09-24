import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunnerConfig } from '../config';
import { execute, modelProvider } from '../execute';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('Hermes subprocess adapter', () => {
  async function streamOutcome(stream: string) {
    const dir = await mkdtemp(join(tmpdir(), 'itsaplan-hermes-result-'));
    dirs.push(dir);
    const outputFile = join(dir, 'output');
    await writeFile(outputFile, stream);
    return execute(
      {
        name: '',
        url: 'http://plan.test',
        apiKey: 'test-key',
        command: 'cat "$FAKE_OUTPUT"',
        args: [],
        cwd: dir,
        env: { FAKE_OUTPUT: outputFile },
        concurrency: 1,
        pollIntervalMs: 1000,
        timeoutMs: 5000,
        outputFormat: 'hermes-stream-json',
        models: [],
      },
      { prompt: '', systemPrompt: '', env: {} },
    );
  }

  it('returns only the complete final answer after a large tool transcript', async () => {
    const answer = JSON.stringify({ summary: 'x'.repeat(10_000), delegations: [] });
    const outcome = await streamOutcome(
      [
        JSON.stringify({ type: 'tool_result', output: 'noise'.repeat(20_000) }),
        JSON.stringify({ type: 'text', text: 'Intermediate commentary' }),
        JSON.stringify({ type: 'result', text: answer, exit_code: 0 }),
      ].join('\n'),
    );
    expect(outcome).toEqual({ status: 'success', output: answer });
  });

  it('names the session of the run and counts its tool calls', async () => {
    const outcome = await streamOutcome(
      [
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' }),
        JSON.stringify({ type: 'tool_use', name: 'terminal', input: { command: 'ls' } }),
        JSON.stringify({ type: 'tool_result', name: 'terminal', output: 'a' }),
        JSON.stringify({ type: 'tool_use', name: 'read_file', input: { path: 'a' } }),
        // A compression moved the session to a new id before the run ended.
        JSON.stringify({ type: 'result', text: 'Done', exit_code: 0, session_id: 'sess-2' }),
      ].join('\n'),
    );
    expect(outcome).toEqual({
      status: 'success',
      output: 'Done',
      sessionId: 'sess-2',
      toolCalls: 2,
    });
  });

  it('rejects a successful process that never emits a final result', async () => {
    const outcome = await streamOutcome('{"type":"text","text":"Incomplete"}\n');
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBe('Hermes stream ended without a final result');
  });

  it('rejects an oversized final answer instead of truncating structured data', async () => {
    const outcome = await streamOutcome(
      JSON.stringify({ type: 'result', text: 'x'.repeat(131_073) }),
    );
    expect(outcome).toEqual({
      status: 'failed',
      output: '',
      error: 'Hermes final result exceeds 128 KiB',
    });
  });

  it('measures the final answer limit in UTF-8 bytes', async () => {
    const outcome = await streamOutcome(
      JSON.stringify({ type: 'result', text: '😀'.repeat(32_769) }),
    );
    expect(outcome).toEqual({
      status: 'failed',
      output: '',
      error: 'Hermes final result exceeds 128 KiB',
    });
  });

  it("reports the run's token totals from the Hermes result, cache included", async () => {
    const outcome = await streamOutcome(
      [
        JSON.stringify({ type: 'text', text: 'Done.' }),
        JSON.stringify({
          type: 'result',
          text: 'Done.',
          exit_code: 0,
          tokens: { input: 1_200, output: 340, total: 9_540, cache_read: 8_000, cache_write: 0 },
        }),
      ].join('\n'),
    );
    expect(outcome).toEqual({
      status: 'success',
      output: 'Done.',
      usage: { inputTokens: 9_200, outputTokens: 340 },
    });

    const failed = await streamOutcome(
      JSON.stringify({ type: 'result', text: 'Stopped', exit_code: 1, tokens: { input: 50 } }),
    );
    expect(failed).toMatchObject({ status: 'failed', usage: { inputTokens: 50, outputTokens: 0 } });
    expect(await streamOutcome('{"type":"result","text":"No counts"}')).not.toHaveProperty('usage');
  });

  it('honors failure reported by the Hermes result', async () => {
    const outcome = await streamOutcome('{"type":"result","text":"Cannot finish","exit_code":2}\n');
    expect(outcome).toEqual({
      status: 'failed',
      output: 'Cannot finish',
      error: 'Hermes reported exit code 2',
    });
  });

  // Codex with a ChatGPT account refused the model (live, 2026-09-24): Hermes ends the turn
  // with its own copy, the provider's words in `error`, and only its session on stderr.
  async function refusedRun(result: Record<string, unknown>, agent: 'hermes' | undefined) {
    const dir = await mkdtemp(join(tmpdir(), 'itsaplan-hermes-refusal-'));
    dirs.push(dir);
    const binary = join(dir, 'hermes');
    await writeFile(
      binary,
      `#!/bin/sh\ncat > /dev/null\nprintf '%s\\n' '${JSON.stringify(result).replace(/'/g, `'\\''`)}'\nprintf 'session_id: 20260924_191027_ae3ffa\\n' >&2\nexit 1\n`,
    );
    await chmod(binary, 0o755);
    return execute(
      {
        name: '',
        url: 'http://plan.test',
        apiKey: 'secret',
        ...(agent ? { agent } : { command: `"${binary}"` }),
        args: [],
        cwd: dir,
        env: { PATH: `${dir}:${process.env.PATH ?? ''}` },
        concurrency: 1,
        pollIntervalMs: 1000,
        timeoutMs: 5000,
        outputFormat: 'hermes-stream-json',
        models: [],
      },
      { prompt: 'Work', systemPrompt: '', env: {}, model: 'gpt-6-terra' },
    );
  }

  const REFUSAL = {
    type: 'result',
    session_id: '20260924_191027_ae3ffa',
    exit_code: 1,
    text:
      "ChatGPT or Codex Subscription rejected the request and retrying won't help. Pick another " +
      'model with /model.\n\nProvider said: HTTP 400: {"detail":"The \'gpt-6-terra\' model is not ' +
      'supported when using Codex with a ChatGPT account."}',
    error:
      'HTTP 400: {"detail":"The \'gpt-6-terra\' model is not supported when using Codex with a ChatGPT account."}',
  };

  it("reads a model the provider refuses this account as final, in the provider's words", async () => {
    const outcome = await refusedRun(REFUSAL, 'hermes');
    expect(outcome.status).toBe('failed');
    // The provider's words, not the session line Hermes ends its stderr with.
    expect(outcome.error).toBe(REFUSAL.error);
    expect(outcome.failure).toEqual({
      code: 'model-unavailable',
      retryable: false,
      model: 'gpt-6-terra',
      detail: "The 'gpt-6-terra' model is not supported when using Codex with a ChatGPT account.",
    });
  });

  it("takes Hermes' own verdict where its result line carries one", async () => {
    const outcome = await refusedRun(
      {
        type: 'result',
        exit_code: 1,
        text: 'The request was malformed.',
        error: 'HTTP 400: bad request',
        failure_reason: 'format_error',
        failure_retryable: false,
      },
      'hermes',
    );
    expect(outcome.failure).toMatchObject({ code: 'provider-rejected', retryable: false });
    const login = await refusedRun(
      {
        type: 'result',
        exit_code: 1,
        text: 'Signed out.',
        failure_reason: 'auth_permanent',
        failure_retryable: false,
      },
      'hermes',
    );
    expect(login.failure).toBeUndefined();
  });

  it('words a failure from the result text when Hermes gives no summary', async () => {
    const { error, ...withoutSummary } = REFUSAL;
    expect(error).toBeTruthy();
    const outcome = await refusedRun(withoutSummary, 'hermes');
    expect(outcome.error).toBe(
      'HTTP 400: {"detail":"The \'gpt-6-terra\' model is not supported when using Codex with a ChatGPT account."}',
    );
    expect(outcome.error).not.toContain('session_id');
    const plain = await refusedRun(
      { type: 'result', exit_code: 1, text: 'The tool loop gave up.\nDetails follow.' },
      'hermes',
    );
    expect(plain.error).toBe('The tool loop gave up.');
  });

  it("leaves an operator's own command unread", async () => {
    const outcome = await refusedRun(REFUSAL, undefined);
    expect(outcome.status).toBe('failed');
    expect(outcome.failure).toBeUndefined();
  });

  it('passes the prompt on stdin and the session, model, reasoning, limits, toolsets and profile as argv', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'itsaplan-hermes-'));
    dirs.push(dir);
    const argvFile = join(dir, 'argv');
    const stdinFile = join(dir, 'stdin');
    const binary = join(dir, 'hermes');
    await writeFile(
      binary,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "$FAKE_ARGV"\ncat > "$FAKE_STDIN"\nprintf '%s\\n' '{"type":"system","subtype":"init","session_id":"session-1"}' '{"type":"text","text":"Done."}' '{"type":"result","session_id":"session-1","text":"Done.","tokens":{"input":12,"output":3,"total":15}}'\n`,
    );
    await chmod(binary, 0o755);

    const config: RunnerConfig = {
      name: '',
      url: 'http://plan.test',
      apiKey: 'secret',
      agent: 'hermes',
      provider: 'copilot',
      args: ['--profile', 'default'],
      cwd: dir,
      env: {
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        FAKE_ARGV: argvFile,
        FAKE_STDIN: stdinFile,
      },
      concurrency: 1,
      pollIntervalMs: 1000,
      timeoutMs: 5000,
      outputFormat: 'hermes-stream-json',
      models: [],
    };
    const outcome = await execute(config, {
      prompt: 'Do the work',
      systemPrompt: 'Project context',
      sessionId: 'session-0',
      model: 'anthropic/claude-opus-4.6',
      thinkingLevel: 'high',
      maxTurns: 25,
      runBudgetSeconds: 600,
      toolsets: ['file', 'web', 'itsaplan'],
      env: {},
    });

    expect(outcome.status).toBe('success');
    expect(outcome.output).toBe('Done.');
    expect(await readFile(stdinFile, 'utf8')).toBe('Project context\n\nDo the work');
    const argv = (await readFile(argvFile, 'utf8')).trim().split('\n');
    expect(argv).toContain('--profile');
    expect(argv[argv.indexOf('--profile') + 1]).toBe('default');
    expect(argv).not.toContain('--ignore-rules');
    expect(argv[argv.indexOf('--resume') + 1]).toBe('session-0');
    expect(argv[argv.lastIndexOf('--provider') + 1]).toBe('copilot');
    expect(argv[argv.lastIndexOf('--model') + 1]).toBe('anthropic/claude-opus-4.6');
    expect(argv[argv.lastIndexOf('--reasoning') + 1]).toBe('high');
    expect(argv[argv.indexOf('--max-turns') + 1]).toBe('25');
    expect(argv[argv.indexOf('--run-budget') + 1]).toBe('600');
    expect(argv[argv.indexOf('--toolsets') + 1]).toBe('file,web,itsaplan');
  });
});

describe('modelProvider', () => {
  const config = {
    provider: 'openai-codex',
    models: [
      {
        id: 'gpt-5.5',
        name: 'GPT 5.5',
        reasoning: true,
        thinkingLevels: [],
        thinkingDefault: null,
      },
      {
        id: 'claude-sonnet-5',
        name: 'Claude Sonnet 5',
        reasoning: true,
        thinkingLevels: [],
        thinkingDefault: null,
        provider: 'anthropic',
      },
    ],
  } as unknown as RunnerConfig;

  it('runs a model the catalog lists under another provider on that provider', () => {
    expect(modelProvider(config, 'claude-sonnet-5')).toBe('anthropic');
  });

  it("runs the default model and unknown models on the runner's provider", () => {
    expect(modelProvider(config, null)).toBe('openai-codex');
    expect(modelProvider(config, 'gpt-5.5')).toBe('openai-codex');
    expect(modelProvider(config, 'unknown')).toBe('openai-codex');
  });
});
