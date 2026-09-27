import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mode = process.argv[2]!;
const text =
  mode === 'character-cap'
    ? 'x'.repeat(1_000_001)
    : 'Invoice\nInvoice number: INV-42\nTotal: 23.80 EUR';
mock.module('../../process', () => ({
  hasProgram: () => true,
  runProgram: async (argv: string[]) => {
    assert.equal(argv[0], mode === 'ocr' ? 'tesseract' : 'pdftotext');
    return {
      code: 0,
      stdout: text,
      stderr: '',
      timedOut: mode === 'timeout',
      truncated: mode === 'byte-cap',
    };
  },
}));
globalThis.fetch = (() => assert.fail('Network forbidden')) as unknown as typeof fetch;
const { extractText } = await import('../../extract');
const directory = await mkdtemp(join(tmpdir(), 'receipt-pdf-proof-'));
try {
  const file = join(directory, mode === 'ocr' ? 'source.png' : 'source.pdf');
  await writeFile(file, 'synthetic file read only by a mocked extractor');
  const result = await extractText(file);
  assert.equal(result.status, 'done');
  assert.equal(result.status === 'done' && result.nativePdfComplete === true, mode === 'complete');
  console.log(`${mode}:ok`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
