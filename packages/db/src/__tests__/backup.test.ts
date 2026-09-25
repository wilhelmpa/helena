import { describe, expect, it } from 'bun:test';
import { mkdtempSync, statSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The pre-migration dump holds every row, sessions included: the folder is 0700 and the file
// 0600 whatever the umask, and a folder left wider by an older release is narrowed.
const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'helena-backup-'));
const dir = join(root, 'backups');
mkdirSync(dir, { mode: 0o755 });
chmodSync(dir, 0o755);
process.env.BACKUP_DIR = dir;

describe('writeBackup', () => {
  it.skipIf(!process.env.DATABASE_URL)('writes a dump only its owner can read', async () => {
    const { writeBackup } = await import('../backup');
    const previous = process.umask(0o022);
    try {
      const result = await writeBackup([]);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(result.path).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(previous);
    }
  });
});
