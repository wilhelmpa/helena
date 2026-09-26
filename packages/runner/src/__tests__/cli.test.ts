import { afterEach, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// The runner process against a stand-in for Plan: what it does when its service manager
// stops it mid-run, and when the lease of a run it executes ran out and the run comes
// back to it.

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function queuedRun(claim: number) {
  return {
    id: 5,
    trigger: 'manual',
    prompt: 'Do the stage.',
    systemPrompt: '',
    attempts: claim,
    claim,
    issueId: null,
    issueIdentifier: null,
    model: null,
    thinkingLevel: null,
  };
}

// `claims` answers the claims in order, then an empty queue.
async function plan(claims: unknown[]) {
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    const path = request.url ?? '';
    requests.push(path);
    response.setHeader('content-type', 'application/json');
    if (path === '/agent-runs/claim') {
      response.end(JSON.stringify({ run: claims.shift() ?? null }));
      return;
    }
    if (path === '/agent-chats/claim') {
      response.statusCode = 404;
      response.end('{}');
      return;
    }
    if (path.includes('/heartbeat')) {
      response.end(JSON.stringify({ canceled: false }));
      return;
    }
    response.statusCode = 204;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  return { url: `http://127.0.0.1:${address.port}`, requests };
}

async function startRunner(url: string, command: string, env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'itsaplan-cli-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = join(dir, 'runner.json');
  await writeFile(
    config,
    JSON.stringify({
      url,
      apiKey: 'runner-secret',
      command,
      cwd: dir,
      env: { DIR: dir },
      concurrency: 2,
      pollIntervalMs: 1000,
    }),
  );
  const child: ChildProcess = spawn(
    process.execPath,
    [join(import.meta.dir, '../cli.ts'), config],
    {
      stdio: 'ignore',
      env: { ...process.env, ...env },
    },
  );
  cleanup.push(async () => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  return { dir, child, exited };
}

async function until(check: () => boolean, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached');
    await sleep(50);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('runner process', () => {
  it('hands a run back and kills its command when it is stopped', async () => {
    const { url, requests } = await plan([queuedRun(1)]);
    const { dir, child, exited } = await startRunner(url, 'echo $$ > "$DIR/pid"; exec sleep 30');
    await until(() => existsSync(join(dir, 'pid')));
    const pid = Number(readFileSync(join(dir, 'pid'), 'utf8'));

    child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(requests).toContain('/agent-runs/5/release?claim=1');
    expect(requests.some((path) => path.includes('/result'))).toBe(false);
    await until(() => !alive(pid));
  }, 15_000);

  it('drains a claimed run on descriptor change before restarting for a new agent', async () => {
    const claims = [queuedRun(1)];
    const { url, requests } = await plan(claims);
    const dir = await mkdtemp(join(tmpdir(), 'itsaplan-reload-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const marker = join(dir, 'restart-request.json');
    const { dir: runnerDir, exited } = await startRunner(
      url,
      'echo started > "$DIR/started"; sleep 3; echo done',
      {
        HERMES_RUNNER_RESTART_REQUEST_PATH: marker,
        HERMES_RUNNER_RESTART_BASELINE: '',
      },
    );
    // The first claim starts before provisioning requests a reload.
    await until(() => existsSync(join(runnerDir, 'started')));
    await writeFile(marker, '{"id":"new-generation"}');
    await sleep(1_300);
    claims.push({ ...queuedRun(1), id: 6 });
    expect(await Promise.race([exited, sleep(8_000).then(() => 'timeout')])).toBe(0);
    expect(requests).toContain('/agent-runs/5/result?claim=1');
    expect(requests).not.toContain('/agent-runs/5/release?claim=1');
    expect(claims).toHaveLength(1);
    expect(requests).not.toContain('/agent-runs/6/result?claim=1');
  }, 12_000);

  it('bounds a wedged descriptor drain and hands its claim back', async () => {
    const { url, requests } = await plan([queuedRun(1)]);
    const dir = await mkdtemp(join(tmpdir(), 'itsaplan-reload-deadline-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const marker = join(dir, 'restart-request.json');
    const { dir: runnerDir, exited } = await startRunner(
      url,
      'echo started > "$DIR/started"; exec sleep 30',
      {
        HERMES_RUNNER_RESTART_REQUEST_PATH: marker,
        HERMES_RUNNER_RESTART_BASELINE: '',
        HERMES_RUNNER_RESTART_MAX_DRAIN_MS: '1000',
      },
    );
    await until(() => existsSync(join(runnerDir, 'started')));
    await writeFile(marker, '{"id":"new-generation"}');
    expect(await Promise.race([exited, sleep(6_000).then(() => 'timeout')])).toBe(0);
    expect(requests).toContain('/agent-runs/5/release?claim=1');
    expect(requests.some((path) => path.includes('/result'))).toBe(false);
  }, 10_000);

  it('keeps one command for a run that comes back to it, and reports under the new claim', async () => {
    const { url, requests } = await plan([queuedRun(1), queuedRun(2)]);
    const { dir, child } = await startRunner(url, 'echo x >> "$DIR/starts"; sleep 2; echo done');
    await until(() => requests.includes('/agent-runs/5/result?claim=2'));
    expect(readFileSync(join(dir, 'starts'), 'utf8')).toBe('x\n');
    child.kill('SIGTERM');
  }, 15_000);
});
