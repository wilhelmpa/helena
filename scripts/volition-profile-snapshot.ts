import { lstat, mkdir, open } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve, relative } from 'node:path';
import { readProfile, safeFile, type Mapping } from './volition-profile-import';

export async function assertRealPath(path: string, allowMissing = false): Promise<void> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error('Symlink in profile or output path');
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

export async function privateDirectory(path: string): Promise<void> {
  await assertRealPath(path, true);
  await mkdir(path, { recursive: true, mode: 0o700 });
  await assertRealPath(path);
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.mode & 0o077 || stat.uid !== process.getuid?.())
    throw new Error('Output directory must be private (0700) and owned by the caller');
}

export async function privateFile(path: string, contents: string): Promise<void> {
  await privateDirectory(dirname(path));
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(contents);
  } finally {
    await file.close();
  }
}

const backupCode = `
import pathlib, sqlite3, sys
from contextlib import closing
source = pathlib.Path(sys.argv[1]).resolve().as_uri() + '?mode=ro'
with closing(sqlite3.connect(source, uri=True)) as src, closing(sqlite3.connect(sys.argv[2])) as dst:
    src.backup(dst, pages=256)
    dst.execute('PRAGMA journal_mode=DELETE')
`;

export async function snapshotProfiles(
  mappings: Mapping[],
  target: string,
  progress: (message: string) => void,
  onClose: (close: () => Promise<void>) => void,
): Promise<void> {
  const root = resolve(target);
  for (const mapping of mappings) {
    const source = resolve(mapping.profile);
    const fromSource = relative(source, root);
    const fromTarget = relative(root, source);
    if (!fromSource || !fromSource.startsWith('..') || !fromTarget.startsWith('..'))
      throw new Error('Snapshot target must be outside all source profiles');
  }
  await privateDirectory(dirname(root));
  await mkdir(root, { mode: 0o700 });
  const snapshots: Mapping[] = [];
  const names = new Set<string>();
  for (const mapping of mappings) {
    const name = basename(resolve(mapping.profile));
    if (names.has(name)) throw new Error('Duplicate snapshot profile directory');
    names.add(name);
    const destination = join(root, name);
    await mkdir(destination, { mode: 0o700 });
    progress(`Snapshotting approved memory and learned skills for agent ${mapping.agentId}.`);
    const bundle = await readProfile(mapping, false);
    for (const memory of bundle.memory)
      await privateFile(join(destination, memory.file), memory.content);
    for (const skill of bundle.skills) {
      for (const file of [{ path: 'SKILL.md', content: skill.markdown }, ...skill.files]) {
        await privateFile(join(destination, 'skills', skill.path, file.path), file.content);
      }
    }
    const state = join(resolve(mapping.profile), 'state.db');
    if (await Bun.file(state).exists()) {
      await assertRealPath(state);
      if (!(await lstat(state)).isFile()) throw new Error('State must be a regular SQLite file');
      for (const suffix of ['-wal', '-shm']) {
        try {
          await assertRealPath(`${state}${suffix}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      const output = join(destination, 'state.db');
      await privateFile(output, '');
      progress(`SQLite read-only backup for agent ${mapping.agentId}.`);
      const child = Bun.spawn(['python3', '-I', '-c', backupCode, state, output], {
        stdout: 'ignore',
        stderr: 'ignore',
      });
      onClose(async () => {
        if (child.exitCode === null) child.kill();
        await child.exited;
      });
      if ((await child.exited) !== 0)
        throw new Error(`SQLite backup failed for agent ${mapping.agentId}`);
    } else if (await Bun.file(join(mapping.profile, 'sessions.json')).exists()) {
      await privateFile(
        join(destination, 'sessions.json'),
        await safeFile(join(mapping.profile, 'sessions.json'), 32 * 1024 * 1024),
      );
    }
    const snapshot = { ...mapping, profile: destination };
    await readProfile(snapshot);
    snapshots.push(snapshot);
    progress(`Closed snapshot ready for agent ${mapping.agentId}.`);
  }
  await privateFile(join(root, 'mapping.json'), JSON.stringify(snapshots, null, 2) + '\n');
  progress(`Snapshot mapping ready: ${join(root, 'mapping.json')}`);
}
