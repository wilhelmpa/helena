import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '@repo/mail';
import { receiptMime } from './html-receipt';

globalThis.fetch = (() => assert.fail('Network forbidden')) as unknown as typeof fetch;
mock.module('@repo/vault', () => ({
  extractText: () => assert.fail('EML must not use external extraction'),
  hasProgram: () => assert.fail('EML must not launch programs'),
  runProgram: () => assert.fail('EML must not launch programs'),
}));
const { extractReceiptFile } = await import('../../extract');
const directory = await mkdtemp(join(tmpdir(), 'helena-html-receipt-'));
try {
  const raw = receiptMime();
  const file = join(directory, 'fictional.eml');
  await writeFile(file, raw, { mode: 0o600 });
  const facts = await extractReceiptFile(file, 'fictional.eml', []);
  assert.equal(facts.grossCents, 2380);
  assert.equal(facts.vatCents, 380);
  assert.equal(facts.invoiceNumber, 'FICTION-92001');
  assert.equal(facts.invoiceDate, '2026-09-04');
  assert.deepEqual(facts.details.mailBody, { part: 'text/html-fallback', fallback: 'accepted' });
  assert.equal(sha256(await readFile(file)), sha256(raw));
  console.log('html-eml:ok');
} finally {
  await rm(directory, { recursive: true, force: true });
}
