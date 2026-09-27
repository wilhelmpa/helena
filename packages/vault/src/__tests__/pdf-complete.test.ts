import { expect, it } from 'bun:test';

for (const mode of ['complete', 'byte-cap', 'character-cap', 'timeout', 'ocr'])
  it(`marks only complete native PDF output as whole-document evidence: ${mode}`, () => {
    const child = Bun.spawnSync(
      [
        process.execPath,
        '--no-install',
        new URL('./fixtures/pdf-complete.fixture.ts', import.meta.url).pathname,
        mode,
      ],
      { env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test' }, timeout: 5000 },
    );
    expect(child.stderr.toString()).toBe('');
    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString().trim()).toBe(`${mode}:ok`);
  });
