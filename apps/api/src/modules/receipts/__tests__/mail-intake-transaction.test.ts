import { expect, it } from 'bun:test';

for (const mode of [
  'intake-parallel',
  'intake-sql-rollback',
  'intake-index-retry',
  'intake-index-and-match-error',
  'intake-fs-error',
]) {
  it(`uses one intake transaction and preserves recoverable originals: ${mode}`, () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        '--no-install',
        new URL(
          '../../../scripts/__tests__/fixtures/mail-receipt-evidence.fixture.ts',
          import.meta.url,
        ).pathname,
        mode,
        'french-only',
      ],
      { env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test' }, timeout: 5000 },
    );
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(`evidence:${mode}:french-only:ok`);
  });
}
