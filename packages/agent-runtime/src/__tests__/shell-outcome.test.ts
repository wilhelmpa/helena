import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShell, shellTool } from '../tools/shell';
import { workspaceState } from '../workspace';
import { FailureWatch } from '../escalation';

test('105b: optional AGENTS read keeps preceding Git output and produces no tool error', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'volition-shell-'));
  const signal = new AbortController().signal;
  const ctx = { workdir: cwd, signal, env: { PATH: process.env.PATH } };
  try {
    await runShell(
      'git init -q -b fix-navigation-bugs',
      cwd,
      { PATH: process.env.PATH! },
      3000,
      signal,
    );
    await writeFile(join(cwd, 'existing.txt'), 'Owner work');
    const tool = shellTool({ timeoutMs: 2000 });
    const result = await tool.execute(
      { command: 'ls && git status -sb | head -5 && head -50 AGENTS.md 2>/dev/null' },
      ctx,
    );
    expect(result).toMatchObject({ isError: false, outcome: 'nonzero_with_output', exitCode: 1 });
    expect(result.text).toContain('existing.txt');
    expect(result.text).toContain('AGENTS.md read may have failed');
    const optional = await tool.execute(
      { command: 'if test -f AGENTS.md; then head -50 AGENTS.md; fi' },
      ctx,
    );
    expect(optional).toMatchObject({ outcome: 'ok', exitCode: 0 });
    const git = await workspaceState(cwd, ctx.env);
    expect(git).toContain('fix-navigation-bugs');
    expect(git).toContain('?? existing.txt');
    expect(git).toContain('Preserve existing');
    const absent = await tool.execute({ command: 'head missing.txt' }, ctx);
    expect(absent.outcome).toBe('nonzero_with_output');
    const timeout = await shellTool({ timeoutMs: 20 }).execute({ command: 'sleep 2' }, ctx);
    expect(timeout).toMatchObject({ outcome: 'error', isError: true, exitCode: null });
    const missingCommand = await tool.execute({ command: 'volition_command_does_not_exist' }, ctx);
    expect(missingCommand).toMatchObject({ outcome: 'error', isError: true, exitCode: 127 });
    expect(
      (await tool.execute({ command: 'pwd' }, { ...ctx, workdir: `${cwd}/absent` })).outcome,
    ).toBe('error');
    const aborted = await runShell('touch must-not-exist', cwd, {}, 1000, AbortSignal.abort());
    expect(aborted.aborted).toBe(true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('nonzero tests still trigger the red-test failure watcher', () => {
  const watch = new FailureWatch();
  watch.call('shell', { command: 'bun test' }, { test: true, exitCode: 1 });
  expect(watch.lastTests()).toBe(false);
  watch.call('shell', { command: 'bun test' }, { test: true, exitCode: 1 });
  watch.call('shell', { command: 'bun test' }, { test: true, exitCode: 1 });
  expect(watch.testsFailing()).toBe(true);
});
