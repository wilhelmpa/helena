import { describe, expect, it } from 'bun:test';
import { PRESETS, presetArgv } from '../presets';
import { policyHookCommand } from '../execute';
import { hookQuestion, runPolicyHook } from '../policy-hook';

// Helena's Autopilot in the runner: Claude Code asks Helena's policy engine through a
// PreToolUse hook, and at level 0 it only plans; Codex, which has no hook, gets a read-only
// sandbox at level 0.

describe('Autopilot flags', () => {
  it('lets Claude Code only plan at level 0 and hands it the policy hook', () => {
    const argv = presetArgv(PRESETS.claude, null, '', [], 'do it', {
      autopilotLevel: 0,
      policyHook: "'/usr/bin/node' '/opt/runner/cli.js' policy-hook || exit 2",
    });
    expect(argv.lastIndexOf('--permission-mode')).toBeGreaterThan(
      argv.indexOf('--permission-mode'),
    );
    expect(argv[argv.lastIndexOf('--permission-mode') + 1]).toBe('plan');
    const settings = JSON.parse(argv[argv.indexOf('--settings') + 1]!);
    expect(settings).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: "'/usr/bin/node' '/opt/runner/cli.js' policy-hook || exit 2",
              },
            ],
          },
        ],
      },
    });
  });

  it("keeps Claude Code's own permission mode above level 0", () => {
    const argv = presetArgv(PRESETS.claude, null, '', [], 'do it', { autopilotLevel: 2 });
    expect(argv.filter((arg) => arg === '--permission-mode')).toHaveLength(1);
    expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('auto');
    expect(argv).not.toContain('--settings');
  });

  it('makes the Codex sandbox read-only at level 0 only', () => {
    const readOnly = presetArgv(PRESETS.codex, null, '', [], 'do it', { autopilotLevel: 0 });
    expect(readOnly.slice(-3)).toEqual(['-c', 'sandbox_mode="read-only"', '-']);
    const writable = presetArgv(PRESETS.codex, null, '', [], 'do it', { autopilotLevel: 1 });
    expect(writable).not.toContain('sandbox_mode="read-only"');
    expect(writable.at(-1)).toBe('-');
  });

  it('quotes the hook command for the shell and blocks when it cannot start', () => {
    expect(policyHookCommand('/usr/bin/node', "/opt/it's/cli.js")).toBe(
      `'/usr/bin/node' '/opt/it'\\''s/cli.js' policy-hook || exit 2`,
    );
    expect(policyHookCommand('/usr/bin/node', null)).toBeNull();
  });
});

describe('policy hook', () => {
  const env = {
    ITSAPLAN_URL: 'http://helena.test/',
    ITSAPLAN_API_KEY: 'agent-key',
    ITSAPLAN_RUN_ID: '42',
  };

  it('reports reads and leaves Helena’s own MCP tools to the server', () => {
    expect(hookQuestion({ tool_name: 'Read', tool_input: { file_path: 'a' } }, env)).toMatchObject({
      tool: 'Read',
      path: 'a',
      runId: 42,
    });
    expect(hookQuestion({ tool_name: 'mcp__itsaplan__create_issue' }, env)).toBeNull();
  });

  it('turns a tool call into the question for the engine', () => {
    expect(
      hookQuestion(
        { tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: '/srv/work/vol' },
        env,
      ),
    ).toEqual({
      runtime: 'claude',
      tool: 'Bash',
      workspace: '/srv/work/vol',
      command: 'git push',
      runId: 42,
    });
    expect(
      hookQuestion(
        { tool_name: 'mcp__shop__refund_order', tool_input: { id: 1 } },
        { ...env, ITSAPLAN_RUN_ID: '', ITSAPLAN_MESSAGE_ID: '7' },
      ),
    ).toEqual({
      runtime: 'claude',
      tool: 'refund_order',
      mcp: { server: 'shop', annotations: null },
      messageId: 7,
    });
  });

  function fakeFetch(answer: unknown, status = 200) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(answer), { status });
    }) as unknown as typeof fetch;
    return { calls, impl };
  }

  it('lets an allowed call go on to Claude Code and denies the rest with Helena’s message', async () => {
    const allowed = fakeFetch({ outcome: 'allow', message: '' });
    const stdin = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'a.md' } });
    expect(await runPolicyHook(stdin, env, allowed.impl)).toBe('');
    expect(allowed.calls[0]!.url).toBe('http://helena.test/agent-policy/decide');
    expect((allowed.calls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe(
      'agent-key',
    );

    const blocked = fakeFetch({ outcome: 'needs-approval', message: 'BLOCKED: ask first' });
    expect(JSON.parse(await runPolicyHook(stdin, env, blocked.impl))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'BLOCKED: ask first',
      },
    });
  });

  it('denies when Helena cannot be asked', async () => {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf x' } });
    const down = fakeFetch({ error: 'x' }, 503);
    const answer = JSON.parse(await runPolicyHook(stdin, env, down.impl));
    expect(answer.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(answer.hookSpecificOutput.permissionDecisionReason).toContain('Helena answered 503');
    const noKey = JSON.parse(await runPolicyHook(stdin, { ITSAPLAN_URL: 'http://x' }, down.impl));
    expect(noKey.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(
      JSON.parse(await runPolicyHook('not json', env, down.impl)).hookSpecificOutput,
    ).toMatchObject({ permissionDecision: 'deny' });
  });
});
