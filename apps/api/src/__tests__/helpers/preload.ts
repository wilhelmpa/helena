import { afterAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cloneTestDatabase } from './clone-db';

// Documents and project files are written below PROJECT_VAULT_ROOT, whose default is the
// live vault of the server. A test run gets a directory of its own, whatever the env file
// says; a test that needs a particular root sets it itself.
process.env.PROJECT_VAULT_ROOT = mkdtempSync(join(tmpdir(), 'helena-test-vault-'));

// Uploaded files are stored in a temporary directory of the run as well, so the suite
// needs no object store and never writes into a real one.
process.env.STORAGE_ROOT = mkdtempSync(join(tmpdir(), 'helena-test-storage-'));

// The run works on its own copy of the test database (see clone-db.ts). This runs before
// any test file imports @repo/db, whose client reads DATABASE_URL once.
const url = process.env.DATABASE_URL;
if (url && process.env.NODE_ENV === 'test' && process.env.HELENA_TEST_DB_CLONE !== '0') {
  const clone = await cloneTestDatabase(url);
  if (clone) {
    process.env.DATABASE_URL = clone.url;
    afterAll(async () => {
      // The engine keeps connections to the copy; it stops before the copy goes.
      const { stopEngine } = await import('#modules/engine/dbos');
      await stopEngine().catch(() => {});
      await clone.drop();
    });
  }
}
