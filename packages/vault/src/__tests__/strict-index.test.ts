import { expect, it } from 'bun:test';

it('propagates strict index failures, remains retryable and preserves the default', () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      '--no-install',
      new URL('./fixtures/strict-index.fixture.ts', import.meta.url).pathname,
    ],
    { env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test' }, timeout: 5000 },
  );
  expect(result.stderr.toString()).toBe('');
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe('strict-index:ok');
});
