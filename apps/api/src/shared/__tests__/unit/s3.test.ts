import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { putObject, warnIfStorageNotConfigured } from '../../s3';

const original = { root: process.env.STORAGE_ROOT, endpoint: process.env.S3_ENDPOINT };

function restore(name: 'STORAGE_ROOT' | 'S3_ENDPOINT', value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore('STORAGE_ROOT', original.root);
  restore('S3_ENDPOINT', original.endpoint);
});

describe('storage selection', () => {
  it('stores on the local disk when STORAGE_ROOT is set, even beside S3 settings', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'itsaplan-storage-unit-'));
    process.env.STORAGE_ROOT = root;
    process.env.S3_ENDPOINT = 'http://127.0.0.1:1';

    await putObject('avatars/abc', Buffer.from('x'), 'image/png');

    expect(await readFile(path.join(root, 'objects/avatars/abc'), 'utf8')).toBe('x');
  });

  it('names both options when neither is configured', async () => {
    delete process.env.STORAGE_ROOT;
    delete process.env.S3_ENDPOINT;

    await expect(putObject('avatars/abc', Buffer.from('x'), 'image/png')).rejects.toThrow(
      /File storage is not configured: set STORAGE_ROOT .* or S3_ENDPOINT/,
    );
  });

  it('warns at startup when the storage cannot be used', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      process.env.STORAGE_ROOT = '/srv/storage';
      warnIfStorageNotConfigured();
      expect(warn).not.toHaveBeenCalled();

      process.env.STORAGE_ROOT = 'storage';
      warnIfStorageNotConfigured();
      expect(warn).toHaveBeenLastCalledWith('[planner] STORAGE_ROOT must be an absolute path');

      delete process.env.STORAGE_ROOT;
      delete process.env.S3_ENDPOINT;
      warnIfStorageNotConfigured();
      expect(warn.mock.lastCall?.[0]).toStartWith('[planner] File storage is not configured');
    } finally {
      warn.mockRestore();
    }
  });
});
