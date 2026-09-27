import { expect, it } from 'bun:test';

it('preserves original bytes without DB indexing inside receipt intake and indexes ordinary writes', () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      '--no-install',
      new URL('./fixtures/deferred-write.ts', import.meta.url).pathname,
    ],
    { env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test' }, timeout: 5000 },
  );
  expect(result.stderr.toString()).toBe('');
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe('deferred-write:ok');
});
