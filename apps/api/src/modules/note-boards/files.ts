import { lstat } from 'node:fs/promises';
import { and, eq, inArray, like } from 'drizzle-orm';
import { db, noteBoard, vaultEntry } from '@repo/db';
import {
  absoluteVaultPath,
  baseName,
  belowPattern,
  BOARDS_DIR,
  CanvasFormatError,
  EMPTY_CANVAS,
  isCanvasPath,
  joinVaultPath,
  moveEntries,
  moveVaultPath,
  parentPath,
  parseCanvas,
  projectFolder,
  readVaultFile,
  resolveVaultPath,
  serializeCanvas,
  trashVaultPath,
  VaultError,
  writeVaultFile,
  type JsonCanvas,
} from '@repo/vault';
import {
  recordActorWrite,
  reindexVaultPaths,
  safeNoteName,
  type CaptureActor,
} from '@helena/knowledge';
import { HttpError } from '#shared/lib';
import { mergeStickers, toStickers, type StickerCanvas } from './canvas';

// The files behind public boards: JSON Canvas in Projects/<KEY>/Boards/ (see
// packages/db note_board). Every change is written through the vault (atomic write,
// index, one commit per save session with the actor as trailer) and reaches the search
// at once. A canvas that appears in the project's folder from outside (Obsidian, an
// agent's file tools) becomes a board; one that disappears takes its board with it.

const MAX_CANVAS_BYTES = 5 * 1024 * 1024;

export interface BoardFileRef {
  id: number;
  vaultPath: string | null;
  vaultSha256: string | null;
}

async function withVaultErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof VaultError) throw new HttpError(error.status, error.message, error.code);
    if (error instanceof CanvasFormatError) throw new HttpError(409, error.message);
    throw error;
  }
}

async function after(paths: string[], message: string, actor: CaptureActor, session = false) {
  await recordActorWrite(paths, message, actor, { continueSession: session });
  await reindexVaultPaths(paths).catch(() => undefined);
}

// Writes a new board file under a name not taken yet: "Plan.canvas", "Plan 2.canvas".
async function writeNewBoardFile(folder: string, name: string, content: string): Promise<string> {
  const stem = safeNoteName(name);
  for (let number = 1; number < 1000; number += 1) {
    const candidate = joinVaultPath(folder, `${number === 1 ? stem : `${stem} ${number}`}.canvas`);
    try {
      await writeVaultFile(candidate, Buffer.from(content), null);
      return candidate;
    } catch (error) {
      if (error instanceof VaultError && error.code === 'exists') continue;
      throw error;
    }
  }
  throw new HttpError(409, 'Too many boards with this name');
}

export async function createBoardFile(
  projectKey: string,
  name: string,
  stickers: StickerCanvas,
  actor: CaptureActor,
): Promise<{ vaultPath: string; vaultSha256: string }> {
  return withVaultErrors(async () => {
    const content = serializeCanvas(mergeStickers(EMPTY_CANVAS, stickers));
    const path = await writeNewBoardFile(
      joinVaultPath(projectFolder(projectKey), BOARDS_DIR),
      name,
      content,
    );
    await after([path], `Create board ${path}`, actor);
    const file = await readVaultFile(path, MAX_CANVAS_BYTES);
    return { vaultPath: path, vaultSha256: file.sha256 };
  });
}

// The board's file where it is now: at its path, else where it was moved to (the vault
// records moves), else null when it is gone. A moved file updates the board.
async function currentPath(board: BoardFileRef): Promise<string | null> {
  if (!board.vaultPath) return null;
  const onDisk = await lstat(absoluteVaultPath(board.vaultPath)).catch(() => null);
  if (onDisk?.isFile()) return board.vaultPath;
  const path = await resolveVaultPath(board.vaultPath, board.vaultSha256);
  if (path && path !== board.vaultPath) {
    await db.update(noteBoard).set({ vaultPath: path }).where(eq(noteBoard.id, board.id));
  }
  return path;
}

export async function readBoardFile(
  board: BoardFileRef,
): Promise<{ path: string; sha256: string; canvas: JsonCanvas } | null> {
  const path = await currentPath(board);
  if (!path) return null;
  return withVaultErrors(async () => {
    let file;
    try {
      file = await readVaultFile(path, MAX_CANVAS_BYTES);
    } catch (error) {
      if (error instanceof VaultError && error.status === 404) return null;
      throw error;
    }
    return { path, sha256: file.sha256, canvas: parseCanvas(file.bytes.toString('utf8')) };
  });
}

export async function readBoardStickers(board: BoardFileRef): Promise<StickerCanvas | null> {
  const file = await readBoardFile(board);
  return file ? toStickers(file.canvas) : null;
}

// Saves the stickers into the file. The web sends the whole board on every change; the
// file keeps what Helena does not draw. A change made outside Helena since the read is
// merged the same way, node by node, so nothing another app added is lost.
export async function writeBoardStickers(
  board: BoardFileRef,
  stickers: StickerCanvas,
  actor: CaptureActor,
): Promise<string> {
  return withVaultErrors(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const file = await readBoardFile(board);
      if (!file) throw new HttpError(404, 'The file of this board is gone');
      const content = serializeCanvas(mergeStickers(file.canvas, stickers));
      try {
        const written = await writeVaultFile(file.path, Buffer.from(content), file.sha256);
        await db
          .update(noteBoard)
          .set({ vaultPath: file.path, vaultSha256: written.sha256 })
          .where(eq(noteBoard.id, board.id));
        await after([file.path], `Update board ${file.path}`, actor, true);
        return written.sha256;
      } catch (error) {
        if (error instanceof VaultError && error.code === 'conflict') continue;
        throw error;
      }
    }
    throw new HttpError(409, 'The board kept changing; reload it');
  });
}

export async function renameBoardFile(
  board: BoardFileRef,
  name: string,
  actor: CaptureActor,
): Promise<string | null> {
  const from = await currentPath(board);
  if (!from) return null;
  return withVaultErrors(async () => {
    const folder = parentPath(from);
    const stem = safeNoteName(name);
    for (let number = 1; number < 1000; number += 1) {
      const to = joinVaultPath(folder, `${number === 1 ? stem : `${stem} ${number}`}.canvas`);
      if (to === from) return from;
      try {
        await moveVaultPath(from, to);
      } catch (error) {
        if (error instanceof VaultError && error.code === 'exists') continue;
        throw error;
      }
      await moveEntries(from, to);
      await db.update(noteBoard).set({ vaultPath: to }).where(eq(noteBoard.id, board.id));
      await after([from, to], `Rename board ${from} to ${to}`, actor);
      return to;
    }
    throw new HttpError(409, 'Too many boards with this name');
  });
}

// Moves the board's file to the vault trash, where Obsidian and the Files page can bring
// it back.
export async function trashBoardFile(board: BoardFileRef, actor: CaptureActor): Promise<void> {
  const path = await currentPath(board);
  if (!path) return;
  await withVaultErrors(async () => {
    await trashVaultPath(path);
    await after([path], `Trash board ${path}`, actor);
  });
}

// The canvas files in a project's folder that no board points at yet: made by Obsidian
// or an agent. Each becomes a public board named after its file.
export async function adoptBoardFiles(projectId: number, projectKey: string): Promise<number> {
  const files = await db
    .select({ path: vaultEntry.path, sha256: vaultEntry.sha256 })
    .from(vaultEntry)
    .where(
      and(
        eq(vaultEntry.kind, 'file'),
        like(vaultEntry.path, belowPattern(projectFolder(projectKey))),
      ),
    );
  const canvases = files.filter((file) => isCanvasPath(file.path));
  if (canvases.length === 0) return 0;
  const linked = await db
    .select({ vaultPath: noteBoard.vaultPath })
    .from(noteBoard)
    .where(
      inArray(
        noteBoard.vaultPath,
        canvases.map((file) => file.path),
      ),
    );
  const known = new Set(linked.map((row) => row.vaultPath));
  const fresh = canvases.filter((file) => !known.has(file.path));
  if (fresh.length === 0) return 0;
  await db
    .insert(noteBoard)
    .values(
      fresh.map((file) => ({
        projectId,
        ownerUserId: null,
        createdByUserId: null,
        name: baseName(file.path).replace(/\.canvas$/i, ''),
        vaultPath: file.path,
        vaultSha256: file.sha256,
      })),
    )
    .onConflictDoNothing();
  return fresh.length;
}

// The public boards whose file is gone (deleted outside Helena and not moved). Their
// rows go too: the file was the board.
export async function dropOrphanedBoards(projectId: number): Promise<number> {
  const rows = await db
    .select({
      id: noteBoard.id,
      vaultPath: noteBoard.vaultPath,
      vaultSha256: noteBoard.vaultSha256,
    })
    .from(noteBoard)
    .where(eq(noteBoard.projectId, projectId));
  let dropped = 0;
  for (const row of rows) {
    if (!row.vaultPath) continue;
    if ((await currentPath(row)) === null) {
      await db.delete(noteBoard).where(eq(noteBoard.id, row.id));
      dropped += 1;
    }
  }
  return dropped;
}
