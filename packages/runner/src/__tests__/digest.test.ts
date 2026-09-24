import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunnerConfig } from '../config';
import { DIGEST_TOOLSETS, digestRuntimeError, digestSettings, isDigestRun } from '../digest';
import { execute } from '../execute';

// A digest run (the update center's summary of release notes) is text only: Hermes without
// its rules, memory or skills, limited to a toolset that reaches nothing outside the turn,
// without the agent's MCP secrets.

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('digest runs', () => {
  it('are known by their trigger', () => {
    expect(isDigestRun({ trigger: 'digest' })).toBe(true);
    expect(isDigestRun({ trigger: 'manual' })).toBe(false);
  });

  it('keep only what the command needs to reach its model', () => {
    const settings = digestSettings({
      toolsets: ['terminal', 'browser', 'itsaplan'],
      env: {
        HERMES_HOME: '/h',
        ITSAPLAN_MCP_SECRET_ITSAPLAN: 'secret',
        BROWSER_GATEWAY_SOCKET: '/s',
      },
      args: ['--skills', 'helena'],
      instructions: 'You are the Home master.',
      logins: new Map([['vault-1', 3]]),
    });
    expect(settings.toolsets).toEqual(DIGEST_TOOLSETS);
    expect(settings.args).toEqual(['--ignore-rules']);
    expect(settings.env).toEqual({ HERMES_HOME: '/h', BROWSER_GATEWAY_SOCKET: '/s' });
    expect(settings.instructions).toBeUndefined();
    expect(settings.logins).toBeUndefined();
    expect(digestSettings(null)).toEqual({
      toolsets: DIGEST_TOOLSETS,
      env: {},
      args: ['--ignore-rules'],
    });
  });

  it('need Hermes', () => {
    expect(digestRuntimeError({ agent: 'hermes' })).toBeNull();
    expect(digestRuntimeError({ agent: 'claude' })).toContain('Hermes');
    expect(digestRuntimeError({ command: 'my-agent' })).toContain('Hermes');
  });

  it('start Hermes without rules, with the todo toolset, on the run model and reasoning', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helena-digest-'));
    dirs.push(dir);
    const argvFile = join(dir, 'argv');
    const binary = join(dir, 'hermes');
    await writeFile(
      binary,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "$FAKE_ARGV"\ncat > /dev/null\nprintf '%s\\n' '{"type":"result","session_id":"s-1","text":"{\\"zusammenfassung\\":\\"ok\\"}","tokens":{"input":5,"output":2}}'\n`,
    );
    await chmod(binary, 0o755);
    const config: RunnerConfig = {
      name: '',
      url: 'http://plan.test',
      apiKey: 'secret',
      agent: 'hermes',
      args: [],
      cwd: dir,
      env: { PATH: `${dir}:${process.env.PATH ?? ''}`, FAKE_ARGV: argvFile },
      concurrency: 1,
      pollIntervalMs: 1000,
      timeoutMs: 5000,
      outputFormat: 'hermes-stream-json',
      models: [],
    };
    const settings = digestSettings({ toolsets: ['terminal'], env: {} });
    const outcome = await execute(
      { ...config, args: [...config.args, ...(settings.args ?? [])] },
      {
        prompt: 'Komponente: Codex',
        systemPrompt: 'Du fasst Versionshinweise zusammen.',
        model: 'gpt-5.6-luna',
        thinkingLevel: 'low',
        maxTurns: 3,
        toolsets: settings.toolsets,
        env: settings.env,
      },
    );
    expect(outcome.status).toBe('success');
    const argv = (await readFile(argvFile, 'utf8')).trim().split('\n');
    expect(argv).toContain('--ignore-rules');
    expect(argv[argv.indexOf('--toolsets') + 1]).toBe('todo');
    expect(argv[argv.lastIndexOf('--model') + 1]).toBe('gpt-5.6-luna');
    expect(argv[argv.lastIndexOf('--reasoning') + 1]).toBe('low');
    expect(argv[argv.indexOf('--max-turns') + 1]).toBe('3');
  });
});
