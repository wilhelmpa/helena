import { expect, it } from 'bun:test';

it('re-extracts the same HTML facts from the complete immutable EML without external tools', () => {
  const child = Bun.spawnSync(
    [
      process.execPath,
      '--no-install',
      new URL('./fixtures/html-eml.fixture.ts', import.meta.url).pathname,
    ],
    { env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test' }, timeout: 5000 },
  );
  expect(child.stderr.toString()).toBe('');
  expect(child.exitCode).toBe(0);
  expect(child.stdout.toString().trim()).toBe('html-eml:ok');
});
