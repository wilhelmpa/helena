import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Client, Run } from '../client';
import type { RunnerConfig } from '../config';
import { perform } from '../run';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const run: Run = {
  id: 7,
  trigger: 'manual',
  prompt: 'Do the stage.',
  systemPrompt: '',
  issueId: null,
  issueIdentifier: null,
  model: null,
  thinkingLevel: null,
};

async function setup(command: string) {
  const dir = await mkdtemp(join(tmpdir(), 'itsaplan-run-'));
  dirs.push(dir);
  const config: RunnerConfig = {
    name: '',
    url: 'http://plan.test',
    apiKey: 'test-key',
    command,
    args: [],
    cwd: dir,
    env: { PID_FILE: join(dir, 'pid') },
    concurrency: 1,
    pollIntervalMs: 1000,
    timeoutMs: 60_000,
    outputFormat: 'text',
    models: [],
  };
  const reports: unknown[] = [];
  const client = {
    report: async (_runId: number, result: unknown) => {
      reports.push(result);
      return null;
    },
  } as unknown as Client;
  return { config, client, reports, pidFile: join(dir, 'pid') };
}

describe('queued run', () => {
  it('reports the outcome of the command', async () => {
    const { config, client, reports } = await setup('echo done');
    const performed = await perform(config, client, run, new AbortController());
    expect(performed).toEqual({
      outcome: expect.objectContaining({ status: 'success', output: 'done' }),
      reflection: null,
    });
    expect(reports).toEqual([expect.objectContaining({ status: 'success', output: 'done' })]);
  });

  it('reports the session and the tool calls of a Hermes run and returns the reflection Plan asks for', async () => {
    const { config, reports } = await setup(
      `printf '%s\\n' '{"type":"tool_use","name":"terminal"}' '{"type":"result","text":"Done","session_id":"sess-9"}'`,
    );
    const reflection = { prompt: 'Look back.', maxTurns: 8, runBudgetSeconds: 120 };
    const client = {
      report: async (_runId: number, result: unknown) => {
        reports.push(result);
        return reflection;
      },
    } as unknown as Client;

    const performed = await perform(
      { ...config, outputFormat: 'hermes-stream-json' },
      client,
      run,
      new AbortController(),
    );

    expect(performed).toEqual({
      outcome: { status: 'success', output: 'Done', sessionId: 'sess-9', toolCalls: 1 },
      reflection,
    });
    expect(reports).toEqual([
      expect.objectContaining({ status: 'success', sessionId: 'sess-9', toolCalls: 1 }),
    ]);
  });

  it("hands the command the environment of the agent's Hermes settings", async () => {
    const { config, client } = await setup('echo "$HERMES_MANAGED_DIR $ITSAPLAN_MCP_SECRET_7"');
    const performed = await perform(config, client, run, new AbortController(), {
      toolsets: null,
      env: { HERMES_MANAGED_DIR: '/hermes/run/itsaplan-managed', ITSAPLAN_MCP_SECRET_7: 'value' },
    });
    expect(performed?.outcome).toMatchObject({ output: '/hermes/run/itsaplan-managed value' });
  });

  it('runs the command in the folder of the issue area', async () => {
    const { config, client } = await setup('pwd');
    await mkdir(join(config.cwd!, 'backend'));
    const performed = await perform(
      config,
      client,
      { ...run, workdir: 'backend' },
      new AbortController(),
    );
    expect(performed?.outcome).toMatchObject({
      status: 'success',
      output: join(await realpath(config.cwd!), 'backend'),
    });
  });

  it('kills the command of a canceled run and reports nothing for it', async () => {
    const { config, client, reports, pidFile } = await setup(
      'echo $$ > "$PID_FILE"; exec sleep 30',
    );
    const stop = new AbortController();
    const performing = perform(config, client, run, stop);
    while (!existsSync(pidFile)) await sleep(20);

    stop.abort();
    expect(await performing).toBeNull();
    expect(reports).toEqual([]);
  });
});
