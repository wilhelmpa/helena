import { lstat, readdir, rmdir } from 'node:fs/promises';
import {
  absoluteVaultPath,
  baseName,
  commitVaultPaths,
  HOME_DIR,
  indexVaultPaths,
  joinVaultPath,
  moveEntries,
  moveVaultPath,
  parentPath,
  PLAN_AUTHOR,
  PROJECTS_DIR,
  VaultError,
} from '@repo/vault';
import { reindexVaultPaths } from '@helena/knowledge';
import { numberedName } from '#modules/project-files/paths';

// Every file a chat brings in lives in one folder of its root, next to the root's other
// files (owner, 2026-09-29: "kein zweiter Speicher"): Projects/<KEY>/Files/Chat or
// Home/Files/Chat. The composer's uploads (apps/web useVaultUpload) and the attachments an
// agent or the issue import stores (POST /projects/:key/chat-attachments) both go there.
export const CHAT_FILES_FOLDER = 'Files/Chat';

// Where chat files went before, relative to a project's or Home's folder.
export const LEGACY_CHAT_FOLDERS = ['Chat Uploads', 'Files/Chat Attachments'];

const MAX_NAME_ATTEMPTS = 1000;

export interface ChatFolderMove {
  from: string;
  to: string;
}

export interface ChatFolderReport {
  apply: boolean;
  // The files to move (dry run) or moved (apply), vault-relative.
  moves: ChatFolderMove[];
  // Source folders removed because they were empty afterwards.
  removedFolders: string[];
  // Links, and files that failed; left where they are.
  skipped: { path: string; reason: string }[];
  failed: { path: string; error: string }[];
}

async function statOf(relative: string) {
  return lstat(absoluteVaultPath(relative)).catch(() => null);
}

// The roots that can hold chat files: Home and every project folder on disk (a folder can
// outlive its project row; its files still belong in one place).
async function chatRoots(): Promise<string[]> {
  const roots = [HOME_DIR];
  const projects = await readdir(absoluteVaultPath(PROJECTS_DIR), { withFileTypes: true }).catch(
    () => [],
  );
  for (const entry of projects) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      roots.push(joinVaultPath(PROJECTS_DIR, entry.name));
    }
  }
  return roots.sort();
}

// The files below a folder, relative to it; hidden entries stay (they are not the owner's
// documents), links are reported and left alone.
async function filesBelow(
  folder: string,
  skipped: ChatFolderReport['skipped'],
  relative = '',
): Promise<string[]> {
  const here = relative ? joinVaultPath(folder, relative) : folder;
  const entries = await readdir(absoluteVaultPath(here), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const inner = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) skipped.push({ path: joinVaultPath(folder, inner), reason: 'link' });
    else if (entry.isDirectory()) files.push(...(await filesBelow(folder, skipped, inner)));
    else if (entry.isFile()) files.push(inner);
  }
  return files;
}

// A free path for `wanted`: itself, else "name (2).ext", "name (3).ext" … Paths already
// promised to an earlier file of the same run count as taken.
async function freePath(wanted: string, taken: Set<string>): Promise<string> {
  const folder = parentPath(wanted);
  const name = baseName(wanted);
  for (let number = 1; number <= MAX_NAME_ATTEMPTS; number += 1) {
    const candidate = joinVaultPath(folder, numberedName(name, number));
    if (!taken.has(candidate) && !(await statOf(candidate))) return candidate;
  }
  throw new VaultError(409, 'No free file name is left in this folder');
}

// Removes the folders below and at `folder` that are empty now, deepest first. A folder that
// still holds something (a hidden file, a link) stays.
async function removeEmptyFolders(folder: string): Promise<string[]> {
  const removed: string[] = [];
  const entries = await readdir(absoluteVaultPath(folder), { withFileTypes: true }).catch(
    () => null,
  );
  if (!entries) return removed;
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      removed.push(...(await removeEmptyFolders(joinVaultPath(folder, entry.name))));
    }
  }
  try {
    await rmdir(absoluteVaultPath(folder));
    removed.push(folder);
  } catch {
    // Not empty: it stays.
  }
  return removed;
}

// Moves the chat files from the old folders (Chat Uploads, Files/Chat Attachments) into
// Files/Chat of the same root. Each move goes through the vault's move, which rewrites the
// references (chat_attachment.vault_path, the file items of agent_chat_message.attachments)
// and records it in vault_move, so an old link still finds the file. A name already taken
// gets a number. Files keep who made them (vault_entry.last_author). Repeatable: once the old
// folders are gone there is nothing left to move.
export async function moveChatFilesToFolder({
  apply = false,
}: { apply?: boolean } = {}): Promise<ChatFolderReport> {
  const report: ChatFolderReport = {
    apply,
    moves: [],
    removedFolders: [],
    skipped: [],
    failed: [],
  };
  for (const root of await chatRoots()) {
    const target = joinVaultPath(root, CHAT_FILES_FOLDER);
    const taken = new Set<string>();
    for (const legacy of LEGACY_CHAT_FOLDERS) {
      const source = joinVaultPath(root, legacy);
      const info = await statOf(source);
      if (!info) continue;
      if (info.isSymbolicLink() || !info.isDirectory()) {
        report.skipped.push({ path: source, reason: info.isSymbolicLink() ? 'link' : 'not a folder' });
        continue;
      }
      const files = await filesBelow(source, report.skipped);
      if (apply) {
        // The index must know the files so their moves are recorded for old links.
        await indexVaultPaths([source]);
      }
      const moved: ChatFolderMove[] = [];
      for (const relative of files) {
        const from = joinVaultPath(source, relative);
        try {
          const to = await freePath(joinVaultPath(target, relative), taken);
          taken.add(to);
          if (apply) {
            await moveVaultPath(from, to);
            try {
              await moveEntries(from, to);
            } catch (error) {
              await moveVaultPath(to, from);
              throw error;
            }
          }
          moved.push({ from, to });
        } catch (error) {
          report.failed.push({
            path: from,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      report.moves.push(...moved);
      if (!apply) continue;
      const removed = await removeEmptyFolders(source);
      report.removedFolders.push(...removed);
      if (moved.length > 0 || removed.length > 0) {
        const paths = [source, target];
        // Drops the index rows of the removed folders and adds the target folder's own.
        await indexVaultPaths(paths);
        await commitVaultPaths(paths, `Move chat files from ${source} to ${target}`, PLAN_AUTHOR, {
          trailers: { 'Helena-Actor': 'system' },
        });
        await reindexVaultPaths(paths).catch(() => undefined);
      }
    }
  }
  return report;
}
