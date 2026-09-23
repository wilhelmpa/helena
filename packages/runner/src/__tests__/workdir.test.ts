import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCwd } from '../workdir';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function workspace() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'itsaplan-workdir-')));
  dirs.push(dir);
  await mkdir(join(dir, 'backend'));
  return dir;
}

describe('runCwd', () => {
  it('starts a run in the folder of its area below the working directory', async () => {
    const cwd = await workspace();
    expect(runCwd(cwd, 'backend')).toBe(join(cwd, 'backend'));
  });

  it('keeps the working directory for a run without an area', async () => {
    const cwd = await workspace();
    expect(runCwd(cwd, null)).toBe(cwd);
    expect(runCwd(cwd, undefined)).toBe(cwd);
    expect(runCwd(undefined, null)).toBeUndefined();
  });

  it('keeps the working directory while the area folder does not exist', async () => {
    const cwd = await workspace();
    await writeFile(join(cwd, 'notes'), 'a file, not a folder');
    expect(runCwd(cwd, 'design')).toBe(cwd);
    expect(runCwd(cwd, 'notes')).toBe(cwd);
  });

  it('refuses a folder outside the working directory', async () => {
    const cwd = await workspace();
    for (const workdir of ['..', '../other', '/etc', 'backend/../..', '.']) {
      expect(() => runCwd(cwd, workdir)).toThrow('is outside');
    }
  });

  it('refuses a symbolic link that leaves the working directory', async () => {
    const cwd = await workspace();
    const elsewhere = await workspace();
    await symlink(elsewhere, join(cwd, 'linked'));
    expect(() => runCwd(cwd, 'linked')).toThrow('is outside');
  });
});
