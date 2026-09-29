import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let inTransaction = false;
const indexed: string[] = [];
const forbidden = () => assert.fail('Unexpected database or network call');
globalThis.fetch = forbidden as unknown as typeof fetch;
mock.module('@repo/db', () => ({ db: new Proxy({}, { get: forbidden }), vaultEntry: {} }));
mock.module('@repo/vault', () => ({
  isSyncConflict: () => false,
  moveEntries: forbidden,
  resolveVaultPath: forbidden,
  splitNote: forbidden,
  vaultOrigin: () => 'manual',
}));
mock.module('@helena/knowledge', () => ({
  recordActorWrite: async (paths: string[]) => {
    assert.equal(inTransaction, false, 'Writer indexed inside the intake transaction');
    indexed.push(...paths);
  },
  reindexVaultPaths: async () => {
    assert.equal(inTransaction, false);
  },
}));
const { writeUniqueFile, describeVaultFile } = await import('../../service');
const { projectRoot } = await import('../../roots');
const root = await mkdtemp(path.join(tmpdir(), 'helena-deferred-write-'));
process.env.PROJECT_VAULT_ROOT = root;
try {
  const folder = projectRoot('SYNTH');
  const bytes = Buffer.from('Synthetic original RFC822 bytes\r\n');
  inTransaction = true;
  const original = await writeUniqueFile(folder, 'Files/Belege', 'receipt.eml', bytes, undefined, {
    deferIndex: true,
  });
  assert.deepEqual(indexed, []);
  assert.deepEqual(await readFile(path.join(folder.directory, original)), bytes);
  assert.equal((await describeVaultFile(folder, original)).sizeBytes, bytes.length);
  inTransaction = false;
  const next = await writeUniqueFile(folder, 'Files/Belege', 'receipt.eml', bytes, {
    ref: 'user:synthetic',
  });
  assert.notEqual(next, original);
  assert.deepEqual(indexed, [`Projects/SYNTH/${next}`]);
  assert.deepEqual(await readFile(path.join(folder.directory, original)), bytes);
  console.log('deferred-write:ok');
} finally {
  await rm(root, { recursive: true, force: true });
}
