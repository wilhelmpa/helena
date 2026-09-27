import { expect, it } from 'bun:test';

for (const mode of ['complete', 'unproven', 'late-conflict'])
  it(`checks complete native text before the stored excerpt: ${mode}`, () => {
    const child = Bun.spawnSync(
      [
        process.execPath,
        '--no-install',
        new URL('./fixtures/original-pair-extract.fixture.ts', import.meta.url).pathname,
        mode,
      ],
      { env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test' }, timeout: 5000 },
    );
    expect(child.stderr.toString()).toBe('');
    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString().trim()).toBe(`${mode}:ok`);
  });
