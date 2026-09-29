import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db, noteBoard, noteBoardMember, project } from '@repo/db';
import { indexVaultPaths, trashVaultPath } from '@repo/vault';
import type { CaptureActor } from '@helena/knowledge';
import { asStickerCanvas } from './canvas';
import { createBoardFile } from './files';

// One store for boards (owner, 2026-09-29: "kein zweiter Speicher"). Every public board
// becomes its JSON Canvas file in Projects/<KEY>/Boards/ at once, instead of lazily on its
// next opening (withCanvas in ./index.ts, which stays for a board made in between). Private
// and restricted boards stay in the database on purpose: the vault's access is per folder
// and cannot keep a board to its owner and a few members; they are only reported.

export interface BoardMigrationReport {
  apply: boolean;
  // Public boards without a file: moved (apply) or to move (dry run).
  pending: { id: number; projectKey: string; name: string }[];
  migrated: { id: number; projectKey: string; name: string; vaultPath: string }[];
  failed: { id: number; projectKey: string; name: string; error: string }[];
  // Boards that stay in the database, with why.
  kept: { id: number; projectKey: string; visibility: 'private' | 'restricted' }[];
}

// The actor of the migration: Helena itself (vault_entry.last_author 'system').
const MIGRATION_ACTOR: CaptureActor = { ref: 'system' };

export async function migrateBoardsToVault({
  apply = false,
  actor = MIGRATION_ACTOR,
}: { apply?: boolean; actor?: CaptureActor } = {}): Promise<BoardMigrationReport> {
  const pending = await db
    .select({
      id: noteBoard.id,
      name: noteBoard.name,
      canvas: noteBoard.canvas,
      projectKey: project.key,
    })
    .from(noteBoard)
    .innerJoin(project, eq(project.id, noteBoard.projectId))
    .where(and(isNull(noteBoard.ownerUserId), isNull(noteBoard.vaultPath)))
    .orderBy(asc(noteBoard.id));
  const owned = await db
    .select({ id: noteBoard.id, projectKey: project.key })
    .from(noteBoard)
    .innerJoin(project, eq(project.id, noteBoard.projectId))
    .where(isNotNull(noteBoard.ownerUserId))
    .orderBy(asc(noteBoard.id));
  const shared =
    owned.length === 0
      ? []
      : await db
          .selectDistinct({ boardId: noteBoardMember.boardId })
          .from(noteBoardMember)
          .where(
            inArray(
              noteBoardMember.boardId,
              owned.map((row) => row.id),
            ),
          );
  const withMembers = new Set(shared.map((row) => row.boardId));
  const report: BoardMigrationReport = {
    apply,
    pending: pending.map(({ id, projectKey, name }) => ({ id, projectKey, name })),
    migrated: [],
    failed: [],
    kept: owned.map((row) => ({
      id: row.id,
      projectKey: row.projectKey,
      visibility: withMembers.has(row.id) ? 'restricted' : 'private',
    })),
  };
  if (!apply) return report;

  for (const board of pending) {
    try {
      const file = await createBoardFile(
        board.projectKey,
        board.name,
        asStickerCanvas(board.canvas),
        actor,
      );
      // Only a board still without its file takes this one: a board opened (and so
      // filed by withCanvas) meanwhile keeps its own, and ours goes to the trash. The
      // board keeps its updatedAt, so the migration does not reorder the switcher.
      const [taken] = await db
        .update(noteBoard)
        .set({ vaultPath: file.vaultPath, vaultSha256: file.vaultSha256, canvas: {} })
        .where(
          and(
            eq(noteBoard.id, board.id),
            isNull(noteBoard.vaultPath),
            isNull(noteBoard.ownerUserId),
          ),
        )
        .returning({ id: noteBoard.id });
      if (!taken) {
        await trashVaultPath(file.vaultPath)
          .then(() => indexVaultPaths([file.vaultPath]))
          .catch(() => undefined);
        continue;
      }
      report.migrated.push({
        id: board.id,
        projectKey: board.projectKey,
        name: board.name,
        vaultPath: file.vaultPath,
      });
    } catch (error) {
      report.failed.push({
        id: board.id,
        projectKey: board.projectKey,
        name: board.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}
