import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { RequestError, type Client, type Run } from '../client';
import type { RunnerConfig } from '../config';
import { perform, reportUntilTaken } from '../run';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const run: Run = {
  id: 7,
  trigger: 'manual',
  prompt: 'Do the stage.',
  systemPrompt: '',
  attempts: 1,
  claim: 1,
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
    report: async (_runId: number, _claim: number, result: unknown) => {
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

describe('result report', () => {
  const noWait = () => Promise.resolve();

  it('sends a result again until the server takes it, under the claim it holds', async () => {
    const { config } = await setup('echo done');
    const sent: { claim: number; result: unknown }[] = [];
    let unreachable = 2;
    const client = {
      report: async (_runId: number, claim: number, result: unknown) => {
        if (unreachable-- > 0) throw new TypeError('fetch failed');
        sent.push({ claim, result });
      },
    } as unknown as Client;
    const outcome = await perform(
      config,
      client,
      { ...run, attempts: 2, claim: 2 },
      new AbortController(),
      null,
      {
        wait: noWait,
      },
    );
    expect(outcome).toMatchObject({ status: 'success' });
    expect(sent).toEqual([{ claim: 2, result: expect.objectContaining({ output: 'done' }) }]);
  });

  it('gives up on an answer that is final, and when the run is taken away', async () => {
    let calls = 0;
    const gone = reportUntilTaken(
      async () => {
        calls++;
        throw new RequestError(404, 'POST /agent-runs/7/result failed with 404');
      },
      new AbortController().signal,
      noWait,
    );
    await expect(gone).rejects.toMatchObject({ status: 404 });
    expect(calls).toBe(1);

    const stop = new AbortController();
    const stopped = reportUntilTaken(
      async () => {
        stop.abort();
        throw new RequestError(502, 'POST /agent-runs/7/result failed with 502');
      },
      stop.signal,
      noWait,
    );
    await expect(stopped).rejects.toMatchObject({ status: 502 });
  });

  it('takes a server error that repeats as the answer, and waits for a server that is down', async () => {
    let errors = 0;
    const failing = reportUntilTaken(
      async () => {
        errors++;
        throw new RequestError(500, 'POST /agent-runs/7/result failed with 500');
      },
      new AbortController().signal,
      noWait,
    );
    await expect(failing).rejects.toMatchObject({ status: 500 });
    expect(errors).toBe(21);

    let refused = 0;
    await reportUntilTaken(
      async () => {
        if (refused++ < 20) throw new TypeError('fetch failed');
      },
      new AbortController().signal,
      noWait,
    );
    expect(refused).toBe(21);
  });

  it('kills a command whose stop came before it started', async () => {
    const { config, client, reports, pidFile } = await setup(
      'echo $$ > "$PID_FILE"; exec sleep 30',
    );
    const stop = new AbortController();
    stop.abort();
    expect(await perform(config, client, run, stop)).toBeNull();
    expect(reports).toEqual([]);
    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, 'utf8'));
      await sleep(200);
      expect(() => process.kill(pid, 0)).toThrow();
    }
  });
});

describe('result under a new claim', () => {
  it('is sent again when the runner claimed its run again while it reported', async () => {
    const { config } = await setup('echo done');
    const held: Run = { ...run, claim: 1 };
    const sent: number[] = [];
    const client = {
      report: async (_runId: number, claim: number) => {
        sent.push(claim);
        if (claim === 1) {
          held.claim = 2;
          throw new RequestError(404, 'POST /agent-runs/7/result failed with 404');
        }
      },
    } as unknown as Client;
    await perform(config, client, held, new AbortController(), null, { wait: async () => {} });
    expect(sent).toEqual([1, 2]);
  });
});
