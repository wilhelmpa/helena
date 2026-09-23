import { afterEach, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// Chaos tests for run resume: the owner's requirement is that an agent never just stops
// -- a run whose runner died mid flight picks its session back up instead of starting
// over or failing silently. These drive the real runner CLI as a child process against a
// stand-in for Plan, the same way cli.test.ts does, so a real SIGKILL and a real SIGTERM
// are what each scenario actually exercises.

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

interface FakeRun {
  id: number;
  trigger: string;
  prompt: string;
  systemPrompt: string;
  attempts: number;
  claim: number;
  issueId: null;
  issueIdentifier: null;
  model: null;
  thinkingLevel: null;
  sessionId?: string;
}

function queuedRun(claim: number, extra: Partial<FakeRun> = {}): FakeRun {
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
    ...extra,
  };
}

// A stand-in for Plan that hands out the queued runs it is given, in order, and
// remembers the session ids and results it is told about, the way the real server
// would. `claims` answers `/agent-runs/claim` in order, then an empty queue.
function plan(claims: FakeRun[]) {
  const requests: string[] = [];
  const sessions: Record<number, string> = {};
  const results: unknown[] = [];
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
    if (path.includes('/session')) {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          sessionId: string;
        };
        const runId = Number(path.split('/')[2]);
        sessions[runId] = body.sessionId;
        response.statusCode = 204;
        response.end();
      });
      return;
    }
    if (path.includes('/result')) {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        results.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        response.end(JSON.stringify({ reflection: null }));
      });
      return;
    }
    response.statusCode = 204;
    response.end();
  });
  return new Promise<{
    url: string;
    requests: string[];
    sessions: Record<number, string>;
    results: unknown[];
  }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      cleanup.push(() => new Promise((res) => server.close(() => res())));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test server did not bind');
      resolve({ url: `http://127.0.0.1:${address.port}`, requests, sessions, results });
    });
  });
}

async function startRunner(url: string, command: string, options: { outputFormat?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'itsaplan-chaos-'));
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
      pollIntervalMs: 300,
      ...options,
    }),
  );
  const child: ChildProcess = spawn(
    process.execPath,
    [join(import.meta.dir, '../cli.ts'), config],
    { stdio: 'ignore' },
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

// Prints a Hermes-style session line, then a child pid file, then sleeps well past the
// window each test needs to kill something.
const HERMES_START = (dir: string, sessionId: string) =>
  `echo '{"type":"system","session_id":"${sessionId}"}'; echo $$ > "${dir}/pid"; sleep 30`;

describe('chaos: run resume', () => {
  it('kill -9 of the runner mid run: the next runner resumes the same session, and the run ends exactly once', async () => {
    const { url, requests, sessions } = await plan([queuedRun(1)]);
    const { dir, child, exited } = await startRunner(url, HERMES_START('$DIR', 'sess-crash-1'), {
      outputFormat: 'hermes-stream-json',
    });
    await until(() => existsSync(join(dir, 'pid')));
    const pid = Number(readFileSync(join(dir, 'pid'), 'utf8'));
    // The command runs in its own process group precisely so a killed runner does not
    // reach it -- it is left running, orphaned, for its lease to reclaim. Clean it up
    // regardless of how the test ends.
    cleanup.push(async () => {
      if (alive(pid)) process.kill(pid, 'SIGKILL');
    });
    // The session reaches Plan well before the run would have finished.
    await until(() => sessions[5] === 'sess-crash-1');

    child.kill('SIGKILL');
    await exited;
    expect(alive(pid)).toBe(true);
    // Killed outright: no result was ever sent for this attempt.
    expect(requests.some((p) => p.includes('/result'))).toBe(false);

    // A second runner starts, the way a service manager restarts it. Plan claims it out
    // again with the saved session and a resume prompt.
    const resumeQueue = [
      queuedRun(2, {
        prompt: 'RESUME_PROMPT_MARKER',
        sessionId: 'sess-crash-1',
      }),
    ];
    const second = await plan(resumeQueue);
    const runner2 = await startRunner(
      second.url,
      '[ "$ITSAPLAN_SESSION_ID" = "sess-crash-1" ] && echo x >> "$DIR/resumed"; echo done',
    );
    await until(() => existsSync(join(runner2.dir, 'resumed')));
    expect(readFileSync(join(runner2.dir, 'resumed'), 'utf8')).toBe('x\n');
    await until(() => second.requests.some((p) => p.includes('/result')));
    expect(second.results).toHaveLength(1);
    runner2.child.kill('SIGTERM');
  }, 20_000);

  it('kill -9 of the command (Hermes) itself: the runner reports a failure once, not a hang, and a fresh claim can still resume its session', async () => {
    const { url, sessions, requests, results } = await plan([queuedRun(1)]);
    const { dir } = await startRunner(url, HERMES_START('$DIR', 'sess-crash-2'), {
      outputFormat: 'hermes-stream-json',
    });
    await until(() => existsSync(join(dir, 'pid')));
    const commandPid = Number(readFileSync(join(dir, 'pid'), 'utf8'));
    await until(() => sessions[5] === 'sess-crash-2');

    // The command dies; the runner process itself keeps running and notices.
    process.kill(commandPid, 'SIGKILL');
    await until(() => requests.some((p) => p.includes('/result')));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'failed' });
    // Exactly one result for this attempt, not a retry loop from the same process.
    expect(requests.filter((p) => p.includes('/result'))).toHaveLength(1);
  }, 15_000);

  it('a deploy restart (SIGTERM) hands the run back without spending an attempt, keeping the session for next time', async () => {
    const { url, requests, sessions } = await plan([queuedRun(1)]);
    const { dir, child, exited } = await startRunner(url, HERMES_START('$DIR', 'sess-deploy-1'), {
      outputFormat: 'hermes-stream-json',
    });
    await until(() => existsSync(join(dir, 'pid')));
    const pid = Number(readFileSync(join(dir, 'pid'), 'utf8'));
    await until(() => sessions[5] === 'sess-deploy-1');

    // SIGTERM: the runner interrupts the command (which gets the chance a real Hermes
    // gets to save its session -- already saved above), then hands the run back.
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(requests).toContain('/agent-runs/5/release?claim=1');
    // No failure was reported for the interruption: a release does not spend the
    // attempt, and no /result call happened for it either.
    expect(requests.some((p) => p.includes('/result'))).toBe(false);
    await until(() => !alive(pid));
    // The session survived the graceful stop.
    expect(sessions[5]).toBe('sess-deploy-1');
  }, 15_000);

  it('two runners started at once on the same resumable run: only one executes it, and it ends exactly once', async () => {
    const server = await plan([queuedRun(1, { sessionId: 'sess-fence-1' })]);
    const a = await startRunner(server.url, 'echo a >> "$DIR/started"; sleep 1; echo done');
    const b = await startRunner(server.url, 'echo b >> "$DIR/started"; sleep 1; echo done');

    await until(() => server.requests.some((p) => p.includes('/result')), 10_000);
    // Only one of the two ever saw the run: the other's claim found the queue empty.
    const aRan = existsSync(join(a.dir, 'started'));
    const bRan = existsSync(join(b.dir, 'started'));
    expect(aRan !== bRan).toBe(true);
    expect(server.results).toHaveLength(1);
    expect(server.requests.filter((p) => p.includes('/result'))).toHaveLength(1);

    a.child.kill('SIGTERM');
    b.child.kill('SIGTERM');
  }, 15_000);
});
