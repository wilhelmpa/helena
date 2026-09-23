import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client, ReflectionReport, Run } from '../client';
import type { RunnerConfig } from '../config';
import { ReflectionReader, reflect } from '../reflect';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const run: Run = {
  id: 7,
  trigger: 'delegation',
  prompt: 'Scrape the price list.',
  systemPrompt: '',
  attempts: 1,
  issueId: 3,
  issueIdentifier: 'MKT-3',
  model: 'anthropic/claude-opus-5.5',
  thinkingLevel: null,
};

const request = { prompt: 'Look back at the task.', maxTurns: 8, runBudgetSeconds: 120 };

const line = (value: unknown) => JSON.stringify(value);

// What the fake Hermes prints: a memory write, a skill it created, a patch Hermes refused
// and a memory write Hermes kept as a proposal, then the counts of the turn.
const stream = [
  line({ type: 'system', subtype: 'init', session_id: 'sess-1' }),
  line({
    type: 'tool_use',
    name: 'memory',
    tool_call_id: 'c1',
    input: { action: 'add', target: 'user', content: 'Wants prices in EUR.' },
  }),
  line({ type: 'tool_result', name: 'memory', tool_call_id: 'c1', output: '{"success": true}' }),
  line({
    type: 'tool_use',
    name: 'skill_manage',
    tool_call_id: 'c2',
    input: { action: 'create', name: 'web-scrape', content: '---\nname: web-scrape\n---' },
  }),
  line({
    type: 'tool_result',
    name: 'skill_manage',
    tool_call_id: 'c2',
    output: '{"success":true}',
  }),
  line({
    type: 'tool_use',
    name: 'skill_manage',
    tool_call_id: 'c3',
    input: { action: 'patch', name: 'plan-7' },
  }),
  line({
    type: 'tool_result',
    name: 'skill_manage',
    tool_call_id: 'c3',
    output: '{"success": false, "error": "old_string not found"}',
  }),
  line({ type: 'tool_use', name: 'memory', tool_call_id: 'c4', input: { action: 'add' } }),
  line({
    type: 'tool_result',
    name: 'memory',
    tool_call_id: 'c4',
    output: '{"success": true, "staged": true}',
  }),
  line({
    type: 'result',
    session_id: 'sess-1',
    exit_code: 0,
    text: 'Saved the EUR preference and a web-scrape skill.',
    tokens: { input: 900, output: 120, cache_read: 30_000, cache_write: 0 },
  }),
].join('\n');

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'itsaplan-reflect-'));
  dirs.push(dir);
  await writeFile(join(dir, 'stream.jsonl'), `${stream}\n`);
  const fake = join(dir, 'hermes');
  await writeFile(
    fake,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > "${join(dir, 'argv')}"`,
      `cat > "${join(dir, 'stdin')}"`,
      `echo "$HERMES_MANAGED_DIR $ITSAPLAN_RUN_ID" > "${join(dir, 'env')}"`,
      `cat "${join(dir, 'stream.jsonl')}"`,
    ].join('\n'),
  );
  await chmod(fake, 0o755);
  const config: RunnerConfig = {
    name: '',
    url: 'http://plan.test',
    apiKey: 'test-key',
    agent: 'hermes',
    args: [],
    cwd: dir,
    env: { PATH: `${dir}:${process.env.PATH ?? ''}` },
    concurrency: 1,
    pollIntervalMs: 1000,
    timeoutMs: 60_000,
    outputFormat: 'hermes-stream-json',
    models: [],
  };
  const reports: ReflectionReport[] = [];
  const client = {
    reportReflection: async (_runId: number, report: ReflectionReport) => {
      reports.push(report);
    },
  } as unknown as Client;
  return { dir, config, client, reports };
}

const hermes = {
  toolsets: ['file', 'memory', 'skills', 'terminal', 'itsaplan'],
  env: { HERMES_MANAGED_DIR: '/hermes/run/itsaplan-managed' },
};

describe('reflection', () => {
  it("continues the run's session with only the memory and skill tools, and reports what it saved", async () => {
    const { dir, config, client, reports } = await setup();

    const report = await reflect(config, client, run, 'sess-1', request, hermes);

    const argv = (await readFile(join(dir, 'argv'), 'utf8')).trim().split('\n');
    const flag = (name: string) => argv[argv.indexOf(name) + 1];
    expect(flag('--resume')).toBe('sess-1');
    expect(flag('--toolsets')).toBe('memory,skills');
    expect(flag('--max-turns')).toBe('8');
    expect(flag('--run-budget')).toBe('120');
    expect(flag('--model')).toBe('anthropic/claude-opus-5.5');
    expect(await readFile(join(dir, 'stdin'), 'utf8')).toBe('Look back at the task.');
    expect((await readFile(join(dir, 'env'), 'utf8')).trim()).toBe(
      '/hermes/run/itsaplan-managed 7',
    );

    expect(report).toEqual({
      status: 'success',
      usage: { inputTokens: 30_900, outputTokens: 120 },
      saved: [
        { tool: 'memory', action: 'add', target: 'user' },
        { tool: 'skill', action: 'create', target: 'web-scrape' },
      ],
      summary: 'Saved the EUR preference and a web-scrape skill.',
    });
    expect(reports).toEqual([report]);
  });

  it('reports a failure without starting Hermes when the agent has neither tool', async () => {
    const { dir, config, client, reports } = await setup();

    const report = await reflect(config, client, run, 'sess-1', request, {
      toolsets: ['file', 'terminal'],
      env: {},
    });

    expect(report).toEqual({
      status: 'failed',
      saved: [],
      error: 'The agent has no memory or skill tools',
    });
    expect(reports).toEqual([report]);
    expect(existsSync(join(dir, 'argv'))).toBe(false);
  });

  it('reads the stream however it is split into chunks', () => {
    const reader = new ReflectionReader();
    for (let index = 0; index < stream.length; index += 7)
      reader.write(stream.slice(index, index + 7));
    reader.end();
    expect(reader.saved).toEqual([
      { tool: 'memory', action: 'add', target: 'user' },
      { tool: 'skill', action: 'create', target: 'web-scrape' },
    ]);
  });
});
