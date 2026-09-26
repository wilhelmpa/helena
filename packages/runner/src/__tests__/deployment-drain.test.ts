import { afterEach, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function until(check: () => boolean) {
  const deadline = Date.now() + 8_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Drain fixture did not reach expected state');
    await sleep(20);
  }
}

async function fixture(options: { heldClaim?: boolean; capability?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'helena-deploy-drain-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const requests: string[] = [];
  let runClaims = 0;
  let chatClaims = 0;
  let held: ServerResponse | undefined;
  const server = createServer((request, response) => {
    request.resume();
    const path = request.url ?? '';
    requests.push(path);
    response.setHeader('content-type', 'application/json');
    if (path === '/agent-runs/claim') {
      runClaims++;
      response.end(
        JSON.stringify({
          run:
            runClaims === 1
              ? {
                  id: 5,
                  trigger: 'manual',
                  prompt: 'Synthetic run',
                  systemPrompt: '',
                  attempts: 1,
                  claim: 1,
                  issueId: null,
                  issueIdentifier: null,
                  model: null,
                  thinkingLevel: null,
                }
              : null,
        }),
      );
      return;
    }
    if (path === '/agent-chats/claim') {
      chatClaims++;
      if (options.heldClaim) {
        held = response;
        return;
      }
      response.end(
        JSON.stringify({
          message:
            chatClaims === 1
              ? {
                  id: 7,
                  attempts: 1,
                  threadId: 'synthetic',
                  prompt: 'Synthetic chat',
                  systemPrompt: '',
                  sessionId: null,
                  model: null,
                  thinkingLevel: null,
                }
              : null,
        }),
      );
      return;
    }
    if (path.endsWith('/claim')) {
      response.writeHead(404).end('{}');
      return;
    }
    if (path.includes('/events') || path.includes('/heartbeat')) {
      response.end('{"canceled":false}');
      return;
    }
    response.writeHead(204).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  const config = join(dir, 'runner.json');
  await writeFile(
    config,
    JSON.stringify({
      url: `http://127.0.0.1:${address.port}`,
      apiKey: 'synthetic-key',
      concurrency: 2,
      command:
        'printf "once\\n" >> "$DIR/started-$ITSAPLAN_TRIGGER"; while [ ! -f "$DIR/finish" ]; do sleep 0.05; done; printf "done\\n"; touch "$DIR/done-$ITSAPLAN_TRIGGER"',
      cwd: dir,
      env: { DIR: dir },
      pollIntervalMs: 1000,
    }),
  );
  const child = spawn(process.execPath, [join(import.meta.dir, '../cli.ts'), config], {
    stdio: 'ignore',
    env: {
      ...process.env,
      ...(options.capability ? { HELENA_RUNNER_DRAIN_STATUS: join(dir, 'status.json') } : {}),
    },
  });
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  cleanup.push(async () => {
    held?.destroy();
    await writeFile(join(dir, 'finish'), 'finish');
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const stopped = await Promise.race([exited.then(() => true), sleep(2_000).then(() => false)]);
    if (!stopped) {
      child.kill('SIGKILL');
      await exited;
    }
    for (const kind of ['manual', 'chat']) {
      if (existsSync(join(dir, `started-${kind}`)))
        await until(() => existsSync(join(dir, `done-${kind}`)));
    }
  });
  await until(() => existsSync(join(dir, 'started-manual')));
  return {
    dir,
    child,
    exited,
    requests,
    counts: () => [runClaims, chatClaims],
    held: () => held,
    finish: () => writeFile(join(dir, 'finish'), 'finish'),
  };
}

it('finishes a held run and chat after repeated SIGINT without new claims or release', async () => {
  const f = await fixture();
  await until(() => existsSync(join(f.dir, 'started-chat')));
  f.child.kill('SIGINT');
  await sleep(100);
  const counts = f.counts();
  f.child.kill('SIGINT');
  await sleep(250);
  expect(f.child.exitCode).toBeNull();
  expect(f.child.signalCode).toBeNull();
  expect(f.counts()).toEqual(counts);
  expect(f.requests.some((path) => path.includes('/release'))).toBe(false);
  await f.finish();
  expect(await f.exited).toBe(0);
  expect(f.requests.filter((path) => path === '/agent-runs/5/result?claim=1')).toHaveLength(1);
  expect(f.requests.filter((path) => path === '/agent-chats/7/result?claim=1')).toHaveLength(1);
  expect(await readFile(join(f.dir, 'started-manual'), 'utf8')).toBe('once\n');
  expect(await readFile(join(f.dir, 'started-chat'), 'utf8')).toBe('once\n');
}, 12_000);

it('joins a held run when another feed rejects an already pending claim during drain', async () => {
  const f = await fixture({ heldClaim: true });
  await until(() => f.held() !== undefined);
  f.child.kill('SIGINT');
  await sleep(50);
  f.held()!.writeHead(401).end('{}');
  await sleep(250);
  expect(f.child.exitCode).toBeNull();
  expect(f.child.signalCode).toBeNull();
  expect(f.requests.some((path) => path.includes('/release'))).toBe(false);
  await f.finish();
  expect(await f.exited).toBe(0);
  expect(f.requests.filter((path) => path === '/agent-runs/5/result?claim=1')).toHaveLength(1);
}, 12_000);

it.skipIf(process.platform !== 'linux')(
  'publishes actual process identity before claims and the graceful drain phase',
  async () => {
    const f = await fixture({ capability: true });
    const running = JSON.parse(await readFile(join(f.dir, 'status.json'), 'utf8'));
    const proc = await readFile(`/proc/${f.child.pid}/stat`, 'utf8');
    const startTicks = proc.slice(proc.lastIndexOf(') ') + 2).split(' ')[19];
    expect(running).toEqual({ version: 1, pid: f.child.pid, startTicks, phase: 'running' });
    f.child.kill('SIGINT');
    await sleep(100);
    expect(JSON.parse(await readFile(join(f.dir, 'status.json'), 'utf8'))).toEqual({
      ...running,
      phase: 'draining',
    });
    await f.finish();
    expect(await f.exited).toBe(0);
  },
  12_000,
);
