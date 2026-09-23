import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '#shared/lib';
import { assertNoSymlinks, isMissing, relativePath } from './paths';
import { vaultDirectory } from './roots';

const MAX_SCANNED_ENTRIES = 5000;

export async function fileSha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function isVaultFile(vaultPath: string): Promise<boolean> {
  try {
    const safe = relativePath(vaultPath);
    await assertNoSymlinks(vaultDirectory(), safe);
    return (await lstat(path.join(vaultDirectory(), safe))).isFile();
  } catch (error) {
    if (isMissing(error) || error instanceof HttpError) return false;
    throw error;
  }
}

// Walks the folders breadth-first for a file of this size and content, looking at no
// more than MAX_SCANNED_ENTRIES entries. Hidden folders and symbolic links are skipped.
async function scanForContent(folders: string[], sizeBytes: number, sha256: string) {
  const vault = vaultDirectory();
  const queue = [...folders];
  const seen = new Set<string>();
  let scanned = 0;
  while (queue.length > 0 && scanned < MAX_SCANNED_ENTRIES) {
    const folder = queue.shift()!;
    if (seen.has(folder)) continue;
    seen.add(folder);
    const entries = await readdir(path.join(vault, folder), { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      scanned += 1;
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const candidate = `${folder}/${entry.name}`;
      if (entry.isDirectory()) queue.push(candidate);
      if (!entry.isFile()) continue;
      const file = path.join(vault, candidate);
      const info = await lstat(file).catch(() => null);
      if (info?.size === sizeBytes && (await fileSha256(file)) === sha256) return candidate;
    }
  }
  return null;
}

// The current vault path of a file recorded at `vaultPath` with this content, or null
// when it is gone. A file moved outside Plan (in Obsidian, by an agent) is found by its
// sha256 in `searchFolders`, the nearest first. This is the one place that answers the
// question; the vault index will answer it from its (path, sha256) records.
export async function resolveVaultFile(input: {
  vaultPath: string;
  sha256: string | null;
  sizeBytes: number;
  searchFolders: string[];
}): Promise<string | null> {
  if (await isVaultFile(input.vaultPath)) return input.vaultPath;
  if (!input.sha256) return null;
  return scanForContent(input.searchFolders, input.sizeBytes, input.sha256);
}
