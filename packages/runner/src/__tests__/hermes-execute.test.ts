import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunnerConfig } from '../config';
import { execute } from '../execute';

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

  it('passes the prompt on stdin and the session, model, reasoning, limits and profile as argv', async () => {
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
  });
});
