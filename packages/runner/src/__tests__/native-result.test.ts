import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute } from '../execute';

async function run(
  result: object | null,
  code: number,
  stderr = 'DeprecationWarning: AI SDK Warning',
) {
  const dir = await mkdtemp(join(tmpdir(), 'volition-native-result-'));
  const script = join(dir, 'runner.mjs');
  await writeFile(
    script,
    `
process.stdin.resume();
process.stdin.on('end', () => {
  process.stderr.write(${JSON.stringify(stderr)});
  process.stdout.write(JSON.stringify({type: 'text', delta: 'Answer available'}) + '\\n');
  ${result ? `process.stdout.write(${JSON.stringify(JSON.stringify(result))});` : ''}
  process.exitCode = ${code};
});
`,
  );
  const argv1 = process.argv[1];
  process.argv[1] = script;
  try {
    return await execute(
      {
        name: 'test',
        url: 'http://127.0.0.1:1',
        apiKey: 'synthetic',
        agent: 'helena',
        args: [],
        env: {},
        cwd: dir,
        concurrency: 1,
        pollIntervalMs: 1000,
        timeoutMs: 5000,
        outputFormat: 'helena-jsonl',
        models: [],
      },
      { prompt: 'Read only.', systemPrompt: '', env: {} },
    );
  } finally {
    process.argv[1] = argv1;
    await rm(dir, { recursive: true, force: true });
  }
}

test('a native success with stderr warnings returns only the final answer', async () => {
  expect(await run({ type: 'result', text: 'Done.', exitCode: 0 }, 0)).toEqual({
    status: 'success',
    output: 'Done.',
  });
});

test('a native result error takes precedence over stderr warnings', async () => {
  expect(
    await run(
      { type: 'result', text: 'Partial', exitCode: 1, reason: 'error', error: 'Connection reset' },
      1,
    ),
  ).toMatchObject({ status: 'failed', output: 'Partial', error: 'Connection reset' });
});

test('a failed native result stays failed even when the process exits zero', async () => {
  expect(
    await run({ type: 'result', text: '', exitCode: 1, reason: 'step-timeout' }, 0),
  ).toMatchObject({ status: 'failed', output: '', error: 'step-timeout' });
});

test('a missing native result cannot turn partial text into success', async () => {
  expect(await run(null, 0)).toMatchObject({
    status: 'failed',
    error: 'Native stream ended without a final result',
  });
});

test('a process error after a successful native result stays failed', async () => {
  expect(
    await run({ type: 'result', text: 'Done.', exitCode: 0 }, 1, 'Cleanup failed'),
  ).toMatchObject({ status: 'failed', output: 'Done.', error: 'Cleanup failed' });
});

test('a structured provider refusal reaches failure classification', async () => {
  const outcome = await run(
    {
      type: 'result',
      text: '',
      exitCode: 1,
      reason: 'model-unavailable',
      error: 'model_not_found: model flash not found',
    },
    1,
  );
  expect(outcome).toMatchObject({
    status: 'failed',
    output: '',
    error: 'model_not_found: model flash not found',
    failure: { code: 'model-unavailable', retryable: false },
  });
});
