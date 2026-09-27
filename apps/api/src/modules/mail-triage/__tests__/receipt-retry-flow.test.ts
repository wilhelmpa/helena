import { expect, it } from 'bun:test';
for (const mode of ['empty-success', 'fairness', 'owner-correction', 'scope']) {
  it(`runs bounded receipt retry without provider or task actions: ${mode}`, () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        '--no-install',
        new URL('./fixtures/receipt-retry.fixture.ts', import.meta.url).pathname,
        mode,
      ],
      { env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test' } },
    );
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(`retry:${mode}:ok`);
  });
}
