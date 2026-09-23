import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { createPlanVolumeStore } from '../fresh-reset.mjs';

const execute = promisify(execFile);

async function command(file, args) {
  assert.equal(file, 'docker');
  const result = await execute(file, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  return { stdout: result.stdout, stderr: result.stderr };
}

const docker = (args) => command('docker', args);

test('real Docker volumes clear and roll back application-owned content', async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const dbBackupVolume = `fresh-reset-test-db-${suffix}`;
  const legacyMinioVolume = `fresh-reset-test-minio-${suffix}`;
  const stage = await mkdtemp(join(tmpdir(), 'fresh-reset-volumes-'));

  await docker(['volume', 'create', dbBackupVolume]);
  await docker(['volume', 'create', legacyMinioVolume]);
  try {
    await docker([
      'run',
      '--rm',
      '--network',
      'none',
      '-v',
      `${dbBackupVolume}:/vol/db`,
      '-v',
      `${legacyMinioVolume}:/vol/minio`,
      'alpine:3.22',
      'sh',
      '-ceu',
      [
        "mkdir -p /vol/db/history /vol/minio/.minio.sys/config",
        "printf 'database dump' >/vol/db/history/backup.dump",
        "printf 'legacy object' >/vol/minio/.minio.sys/config/object",
        'chown -R 1000:1000 /vol/db',
        'chmod 755 /vol/db',
      ].join('; '),
    ]);

    const store = createPlanVolumeStore(command, { dbBackupVolume, legacyMinioVolume });
    assert.deepEqual(await store.inventory(), {
      dbBackupEntries: 2,
      legacyMinioEntries: 3,
    });

    const session = await store.beginReset(stage);
    assert.deepEqual(await store.verifyFresh(), {
      dbBackupEntries: 0,
      legacyMinioEntries: 0,
    });

    await store.rollback(session);
    assert.deepEqual(await store.inventory(), {
      dbBackupEntries: 2,
      legacyMinioEntries: 3,
    });
    const restored = await docker([
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '-v',
      `${dbBackupVolume}:/vol/db:ro`,
      '-v',
      `${legacyMinioVolume}:/vol/minio:ro`,
      'alpine:3.22',
      'sh',
      '-ceu',
      "stat -c '%u:%g %a' /vol/db; cat /vol/db/history/backup.dump; cat /vol/minio/.minio.sys/config/object",
    ]);
    assert.equal(restored.stdout, '1000:1000 755\ndatabase dumplegacy object');

    await store.beginReset(stage);
    assert.deepEqual(await store.verifyFresh(), {
      dbBackupEntries: 0,
      legacyMinioEntries: 0,
    });
  } finally {
    await docker(['volume', 'rm', '-f', dbBackupVolume, legacyMinioVolume]).catch(() => {});
    await rm(stage, { recursive: true, force: true });
  }
});
