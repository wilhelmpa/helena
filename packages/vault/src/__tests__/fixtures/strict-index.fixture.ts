import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(tmpdir(), 'mail-strict-index-'));
process.env.PROJECT_VAULT_ROOT = root;
globalThis.fetch = (() => assert.fail('Network forbidden')) as unknown as typeof fetch;
const moduleMock = (file: string, exports: Record<string, unknown>) =>
  mock.module(new URL(`../../${file}.ts`, import.meta.url).pathname, () => exports);
let fail = true;
let saved = 0;
moduleMock('store', {
  allIndexedFiles: async () => [],
  entriesWithSha: async () => [],
  entryValues: (x: unknown) => x,
  findEntry: async () => null,
  indexedPathsBelow: async () => [],
  moveEntries: async () => {},
  removeEntries: async () => {},
  touchEntry: async () => {},
  saveEntry: async () => {
    if (fail) throw new Error('Synthetic index write failed');
    saved++;
  },
});
moduleMock('markdown', { extractLinks: () => [], noteTitle: () => '', splitNote: () => ({}) });
moduleMock('canvas', { canvasText: () => '' });
moduleMock('extract', { isExtractable: () => false });
mock.module('@repo/storage/mime', () => ({ mimeFromName: () => 'message/rfc822' }));
const { indexVaultPaths } = await import('../../indexer');
try {
  await writeFile(path.join(root, 'original.eml'), 'Subject: Receipt\r\n\r\nPaid 14 EUR');
  await assert.rejects(
    indexVaultPaths(['original.eml'], { author: 'test' }, { throwOnError: true }),
    /Synthetic index write failed/,
  );
  assert.equal(saved, 0);
  const errorLog = console.error;
  let logs = 0;
  try {
    console.error = () => {
      logs++;
    };
    await indexVaultPaths(['original.eml']);
  } finally {
    console.error = errorLog;
  }
  assert.equal(logs, 1, 'Default remains best effort');
  fail = false;
  await indexVaultPaths(['original.eml'], { author: 'test' }, { throwOnError: true });
  assert.equal(saved, 1);
  await assert.rejects(
    indexVaultPaths(['missing.eml'], { author: 'test' }, { throwOnError: true }),
  );
  await indexVaultPaths(['missing.eml']);
  console.log('strict-index:ok');
} finally {
  await rm(root, { recursive: true, force: true });
}
