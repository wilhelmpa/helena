import { test, expect } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODING_TASKS } from './tasks';
import { evaluateCodingTask, helenaMetrics, hermesMetrics } from './run';

test('the coding suite contains twelve distinct TypeScript and Python tasks', () => {
  expect(CODING_TASKS).toHaveLength(12);
  expect(new Set(CODING_TASKS.map((task) => task.id)).size).toBe(12);
  expect(CODING_TASKS.filter((task) => task.language === 'typescript')).toHaveLength(6);
  expect(CODING_TASKS.filter((task) => task.language === 'python')).toHaveLength(6);
  expect(CODING_TASKS.filter((task) => task.addedTest)).toHaveLength(2);
});

test('Hermes harness grades a change in a disposable repository', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'helena-fake-hermes-'));
  const binary = join(directory, 'hermes');
  await writeFile(
    binary,
    `#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
writeFileSync('solution.ts', 'export function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(value, high)); }');
console.log(JSON.stringify({ type: 'tool_use', name: 'terminal', input: { command: 'edit solution.ts' } }));
console.log(JSON.stringify({ type: 'result', exit_code: 0, tokens: { input: 10, output: 5 } }));
`,
    { mode: 0o755 },
  );
  try {
    const result = await evaluateCodingTask(CODING_TASKS[0]!, 'fake', null, binary);
    expect(result.testsPassed).toBe(true);
    expect(result.validToolCalls).toBe(1);
    expect(result.aborted).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Hermes metrics count tool calls, repeated actions, abort and tokens', () => {
  const output = [
    { type: 'tool_use', name: 'terminal', input: { command: 'bun test' } },
    { type: 'tool_use', name: 'terminal', input: { command: 'bun test' } },
    { type: 'tool_result', is_error: true },
    { type: 'result', exit_code: 1, tokens: { input: 100, cache_read: 20, output: 30 } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');
  expect(hermesMetrics(output)).toEqual({
    toolCalls: 2,
    validToolCalls: 1,
    loops: 1,
    aborted: true,
    inputTokens: 120,
    outputTokens: 30,
  });
});

test("Helena's own loop grades the same way through its helena-jsonl stream", async () => {
  const directory = await mkdtemp(join(tmpdir(), 'helena-fake-agent-'));
  const entry = join(directory, 'agent.ts');
  await writeFile(
    entry,
    `import { writeFileSync } from 'node:fs';
writeFileSync('solution.ts', 'export function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(value, high)); }');
console.log(JSON.stringify({ type: 'tool-call', id: '1', name: 'write_file', input: '{}' }));
console.log(JSON.stringify({ type: 'tool-result', id: '1', output: 'ok' }));
console.log(JSON.stringify({ type: 'spend', inputTokens: 40, outputTokens: 7 }));
console.log(JSON.stringify({ type: 'result', text: 'done', exitCode: 0 }));
`,
  );
  try {
    const result = await evaluateCodingTask(CODING_TASKS[0]!, 'fake', 'local', {
      kind: 'helena',
      entry,
      baseUrl: 'http://127.0.0.1:1/v1',
    });
    expect(result.testsPassed).toBe(true);
    expect(result.validToolCalls).toBe(1);
    expect(result.inputTokens).toBe(40);
    expect(result.aborted).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Helena metrics count errors, repeats, abort and tokens', () => {
  const output = [
    { type: 'tool-call', id: 'a', name: 'shell', input: '{"command":"bun test"}' },
    { type: 'tool-result', id: 'a', output: 'Exit code 1', isError: true },
    { type: 'tool-call', id: 'b', name: 'shell', input: '{"command":"bun test"}' },
    { type: 'spend', inputTokens: 120, outputTokens: 30 },
    { type: 'result', text: '', exitCode: 1 },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');
  expect(helenaMetrics(output)).toEqual({
    toolCalls: 2,
    validToolCalls: 1,
    loops: 1,
    aborted: true,
    inputTokens: 120,
    outputTokens: 30,
  });
});
