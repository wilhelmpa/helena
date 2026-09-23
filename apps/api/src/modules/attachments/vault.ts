import { rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { db, issue, project } from '@repo/db';
import { eq } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { resolveVaultFile } from '#modules/project-files/resolver';
import { projectRoot, projectVaultPath, vaultDirectory } from '#modules/project-files/roots';
import { contentTypeOf } from '#modules/project-files/serve';
import { safeFileName } from '#modules/project-files/paths';
import {
  describeVaultFile,
  replaceVaultFile,
  sha256,
  trashVaultFile,
  writeUniqueFile,
} from '#modules/project-files/service';
import { setAttachmentVaultPath, type AttachmentFile, type AttachmentRow } from './service';
import { deleteAttachmentObject } from './storage';

// Where an issue's attachments are stored: Projects/<KEY>/Files/Tasks/<KEY>-<n>/.
export async function issueFolder(issueId: number) {
  const [row] = await db
    .select({ key: project.key, sequenceNumber: issue.sequenceNumber })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(eq(issue.id, issueId));
  if (!row) throw new HttpError(404, 'Issue not found');
  return { projectKey: row.key, folder: `Files/Tasks/${row.key}-${row.sequenceNumber}` };
}

export async function storeAttachmentFile(
  issueId: number,
  filename: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<AttachmentFile> {
  const { projectKey, folder } = await issueFolder(issueId);
  const relative = await writeUniqueFile(projectRoot(projectKey), folder, filename, bytes);
  return {
    vaultPath: `${projectVaultPath(projectKey)}/${relative}`,
    sha256: sha256(bytes),
    linked: false,
    filename: path.basename(relative),
    contentType,
    sizeBytes: bytes.length,
  };
}

// The new version of an attachment's file. Under the same name it replaces the file in
// place, which keeps links to it from notes working; the previous version goes to the
// trash. Under another name, or when the file is gone, it is stored as a new file.
export async function storeReplacement(
  row: AttachmentRow,
  filename: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<AttachmentFile> {
  const current = await currentAttachmentPath(row);
  if (!current || path.posix.basename(current) !== safeFileName(filename)) {
    return storeAttachmentFile(row.issueId, filename, contentType, bytes);
  }
  await replaceVaultFile(current, bytes);
  return {
    vaultPath: current,
    sha256: sha256(bytes),
    linked: row.linked,
    filename: path.posix.basename(current),
    contentType,
    sizeBytes: bytes.length,
  };
}

// A file an attachment links to must be in the issue's project folder: the attachment
// makes it readable to everyone who can read the issue.
export async function linkedAttachmentFile(
  issueId: number,
  relative: string,
): Promise<AttachmentFile> {
  const { projectKey } = await issueFolder(issueId);
  const file = await describeVaultFile(projectRoot(projectKey), relative);
  return {
    vaultPath: file.vaultPath,
    sha256: file.sha256,
    linked: true,
    filename: file.name,
    contentType: contentTypeOf(file.name),
    sizeBytes: file.sizeBytes,
  };
}

// Removes a file that was stored for an attachment row that then was not written.
export async function discardAttachmentFile(file: AttachmentFile): Promise<void> {
  await rm(path.join(vaultDirectory(), file.vaultPath), { force: true });
}

// The current vault path of an attachment's file: where it was stored, or where it
// was moved to, looked for in its folder first and then in the whole project folder
// (Projects/<KEY>, the first two segments of the path).
export async function currentAttachmentPath(row: AttachmentRow): Promise<string | null> {
  if (!row.vaultPath) return null;
  const current = await resolveVaultFile({
    vaultPath: row.vaultPath,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    searchFolders: [
      path.posix.dirname(row.vaultPath),
      row.vaultPath.split('/').slice(0, 2).join('/'),
    ],
  });
  if (current && current !== row.vaultPath) await setAttachmentVaultPath(row.id, current);
  return current;
}

// The attachment's file state as the DTO reports it: its current path, and whether
// the file is gone.
export async function withFileState(row: AttachmentRow) {
  if (!row.vaultPath) return { ...row, missing: false };
  const current = await currentAttachmentPath(row);
  return { ...row, vaultPath: current ?? row.vaultPath, missing: current === null };
}

// Removes the files of deleted attachment rows: an object from the store, a stored
// vault file to the trash. A linked file stays. Best-effort: the rows are gone already.
export async function purgeAttachmentFiles(rows: AttachmentRow[]): Promise<void> {
  for (const row of rows) {
    if (row.s3Key) {
      await deleteAttachmentObject(row.s3Key);
      continue;
    }
    if (!row.vaultPath || row.linked) continue;
    try {
      await trashVaultFile(row.vaultPath);
      const folder = path.posix.dirname(row.vaultPath);
      // A task folder goes once it holds nothing more.
      if (folder.includes('/Files/Tasks/')) {
        await rmdir(path.join(vaultDirectory(), folder)).catch(() => {});
      }
    } catch (error) {
      console.error(
        `[planner] failed to move ${row.vaultPath} to the trash:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}
