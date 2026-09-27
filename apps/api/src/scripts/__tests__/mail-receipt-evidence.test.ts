import { expect, it } from 'bun:test';
import { receiptEvidenceCases } from './fixtures/mail-receipt-evidence-cases';

// Production facts, history and intake run with isolated in-memory infrastructure boundaries.
for (const mode of ['native', 'history']) {
  for (const sample of receiptEvidenceCases) {
    it(`uses the same receipt evidence through ${mode}: ${sample.id}`, () => {
      const result = Bun.spawnSync(
        [
          process.execPath,
          '--no-install',
          new URL('./fixtures/mail-receipt-evidence.fixture.ts', import.meta.url).pathname,
          mode,
          sample.id,
        ],
        { env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test' } },
      );
      expect(result.stderr.toString()).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toBe(`evidence:${mode}:${sample.id}:ok`);
    });
  }
}
