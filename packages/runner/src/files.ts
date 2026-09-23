import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

// Writes into a Hermes home, where the agent can replace a directory with a link while the
// runner works in it: no path is followed through a link, and a file is replaced whole.

export function digest(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function ensureRoot(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('managed root is unsafe');
}

function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    if (target !== root) throw new Error('managed path escapes its root');
  }
}

export async function ensureSafeParent(root: string, target: string): Promise<void> {
  await ensureRoot(root);
  assertInside(root, target);
  const parent = dirname(target);
  const rel = relative(root, parent);
  let current = root;
  if (rel && rel !== '.') {
    for (const segment of rel.split(sep)) {
      current = join(current, segment);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink() || !info.isDirectory()) {
          throw new Error('managed path contains an unsafe directory');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await mkdir(current, { mode: 0o700 });
      }
    }
  }
}

export async function atomicWrite(root: string, target: string, content: string): Promise<void> {
  await ensureSafeParent(root, target);
  const temp = join(dirname(target), `.itsaplan-${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await ensureSafeParent(root, target);
    const targetInfo = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (targetInfo?.isSymbolicLink() || (targetInfo && !targetInfo.isFile())) {
      throw new Error('managed target is unsafe');
    }
    await rename(temp, target);
    await chmod(target, 0o600);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
