import { expect, it } from 'bun:test';

// Module mocks run in a child process so they cannot replace another suite's DB or matcher.
for (const mode of ['default', 'false', 'skip', 'existing', 'backfill', 'history']) {
  it(`preserves per-call matching behavior: ${mode}`, () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        new URL('./fixtures/mail-receipt-matching.fixture.ts', import.meta.url).pathname,
        mode,
      ],
      { env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test' } },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe('');
    expect(result.stdout.toString().trim()).toBe(`matching:${mode}:ok`);
  });
}
