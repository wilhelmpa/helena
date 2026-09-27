import { mock } from 'bun:test';
import assert from 'node:assert/strict';

const mode = process.argv[2]!;
const text = `Receipt\nInvoice number: INV-42\nTotal: 23.80 EUR\nAmount paid: 23.80 EUR\n${'Harmless detail\n'.repeat(200)}${mode === 'late-conflict' ? 'Invoice number: INV-43' : ''}`;
mock.module('@repo/vault', () => ({
  extractText: async () => ({ status: 'done', text, nativePdfComplete: mode !== 'unproven' }),
  hasProgram: () => false,
  runProgram: () => assert.fail('No external program in this fixture'),
}));
globalThis.fetch = (() => assert.fail('Network forbidden')) as unknown as typeof fetch;
const { extractReceiptFile } = await import('../../extract');
const facts = await extractReceiptFile('/synthetic/source.pdf', 'source.pdf', []);
assert.equal(facts.textExcerpt!.length, 2000);
assert.equal(facts.originalEvidence !== null, mode === 'complete');
assert.equal(facts.grossCents, 2380);
assert.equal(facts.currency, 'EUR');
console.log(`${mode}:ok`);
