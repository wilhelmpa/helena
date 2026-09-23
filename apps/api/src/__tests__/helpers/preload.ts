import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Documents and project files are written below PROJECT_VAULT_ROOT, whose default is the
// live vault of the server. A test run gets a directory of its own, whatever the env file
// says; a test that needs a particular root sets it itself.
process.env.PROJECT_VAULT_ROOT = mkdtempSync(join(tmpdir(), 'itsaplan-test-vault-'));
