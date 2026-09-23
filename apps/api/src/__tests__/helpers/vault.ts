import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Points PROJECT_VAULT_ROOT at an empty directory of its own. The attachments of every
// test's "MKT-1" land in the same task folder otherwise, and a file an earlier test
// left there changes the name the next one gets.
export function freshVault(): string {
  const vault = mkdtempSync(path.join(tmpdir(), 'itsaplan-test-vault-'));
  process.env.PROJECT_VAULT_ROOT = vault;
  return vault;
}
