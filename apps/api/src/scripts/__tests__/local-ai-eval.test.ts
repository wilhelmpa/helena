import { expect, it } from 'bun:test';
import { createServer, type RequestListener } from 'node:http';
import { resolve } from 'node:path';

async function runEval(
  handler: RequestListener,
  args: string[],
  environment: Record<string, string> = {},
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected local TCP address');
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(import.meta.dir, '../local-ai-eval.ts'),
        '--base',
        `http://127.0.0.1:${address.port}/v1`,
        '--model',
        'gemma4-it:e2b',
        '--json',
        '-',
        ...args,
      ],
      {
        env: { PATH: process.env.PATH ?? '', ...environment },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const deadline = setTimeout(() => child.kill('SIGKILL'), 8_000);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]).finally(() => clearTimeout(deadline));
    expect(exitCode).toBe(0);
    return { report: JSON.parse(stdout), stderr };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

it.skipIf(!process.env.DATABASE_URL)(
  'exits after writing its report with database persistence configured',
  async () => {
    const { report, stderr } = await runEval(
      (_request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ choices: [{ message: { content: 'hand_to_agent' } }] }));
      },
      ['--classes', 'voice-reply'],
      { DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: 'test' },
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].result).not.toBeNull();
    expect(stderr).toContain('server not registered uniquely');
  },
  12_000,
);

it('marks an actual socket disconnect and successful retry in CLI text and JSON', async () => {
  let requests = 0;
  const { report, stderr } = await runEval(
    (request, response) => {
      requests++;
      if (requests === 1) {
        request.socket.destroy();
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: 'hand_to_agent' } }] }));
    },
    ['--classes', 'voice-reply'],
  );
  expect(requests).toBe(16);
  expect(report.rows[0].error).toBeNull();
  expect(report.rows[0].result).not.toBeNull();
  expect(report.rows[0].retries).toHaveLength(1);
  expect(report.rows[0].retries[0].delayMs).toBe(1_000);
  expect(stderr).toContain('socket closed; retrying once after 1000 ms');
  expect(stderr).toContain('socket retry: completed (1)');
}, 10_000);

it('exposes NPU timeouts separately in the CLI report without retrying them', async () => {
  const { report, stderr } = await runEval(
    (_request, response) => {
      const timer = setTimeout(() => response.end('{}'), 30);
      response.on('close', () => clearTimeout(timer));
    },
    ['--classes', 'decisions', '--npu', '--npu-timeout-ms', '1'],
  );
  const row = report.rows[0];
  expect(row.result).toBeNull();
  expect(row.npuReadout.timeoutMs).toBe(1);
  expect(row.npuReadout.timeouts.length).toBeGreaterThan(0);
  expect(row.npuReadout.failures).toEqual([]);
  expect(row.npuReadout.errors).toEqual([]);
  expect(row.retries).toEqual([]);
  expect(row.npuReadout.threshold).toBe(0.85);
  expect(row.npuReadout.passed).toBe(false);
  expect(stderr).toContain('decision failures; 0 backend errors');
}, 10_000);
