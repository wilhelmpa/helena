import path from 'node:path';
import { db, issue, issueAttachment, project } from '@repo/db';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { numberedName, safeFileName } from '#modules/project-files/paths';
import { fileSha256 } from '#modules/project-files/resolver';
import { projectRoot, projectVaultPath } from '#modules/project-files/roots';
import { sha256, writeUniqueFile } from '#modules/project-files/service';
import { deleteObject, getObject } from '#shared/s3';
import { num } from '#shared/lib';

export interface VaultMigrationReceipt {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  pending: number;
  pendingBytes: number;
  moved: { id: number; publicId: string; from: string; to: string; sha256: string }[];
  failed: { id: number; publicId: string; from: string; error: string }[];
}

// The file an interrupted earlier run already wrote for this attachment: one of the
// names it would have been given, holding the same bytes.
async function writtenBefore(
  folderPath: string,
  filename: string,
  hash: string,
): Promise<string | null> {
  for (let number = 1; number <= 100; number += 1) {
    const candidate = path.join(folderPath, numberedName(safeFileName(filename), number));
    const matches = await fileSha256(candidate).then(
      (existing) => existing === hash,
      () => null,
    );
    if (matches === null) return null;
    if (matches) return path.basename(candidate);
  }
  return null;
}

// Moves the issue attachments still stored in the object store into their task folder
// of the vault: Projects/<KEY>/Files/Tasks/<KEY>-<n>/. The row is updated before the
// object is deleted, and a file an earlier run wrote is reused, so a run can be
// repeated at any point.
export async function moveAttachmentsToVault({
  dryRun = false,
} = {}): Promise<VaultMigrationReceipt> {
  const startedAt = new Date().toISOString();
  const rows = await db
    .select({
      attachment: issueAttachment,
      projectKey: project.key,
      sequenceNumber: issue.sequenceNumber,
    })
    .from(issueAttachment)
    .innerJoin(issue, eq(issue.id, issueAttachment.issueId))
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(and(isNotNull(issueAttachment.s3Key), isNull(issueAttachment.vaultPath)))
    .orderBy(asc(issueAttachment.id));
  const receipt: VaultMigrationReceipt = {
    startedAt,
    finishedAt: startedAt,
    dryRun,
    pending: rows.length,
    pendingBytes: rows.reduce((total, row) => total + num(row.attachment.sizeBytes), 0),
    moved: [],
    failed: [],
  };
  if (dryRun) return receipt;

  for (const { attachment, projectKey, sequenceNumber } of rows) {
    const from = attachment.s3Key as string;
    try {
      const object = await getObject(from);
      const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
      const hash = sha256(bytes);
      const root = projectRoot(projectKey);
      const folder = `Files/Tasks/${projectKey}-${sequenceNumber}`;
      const name =
        (await writtenBefore(path.join(root.directory, folder), attachment.filename, hash)) ??
        path.basename(await writeUniqueFile(root, folder, attachment.filename, bytes));
      const to = `${projectVaultPath(projectKey)}/${folder}/${name}`;
      await db
        .update(issueAttachment)
        .set({ vaultPath: to, sha256: hash, s3Key: null, filename: name })
        .where(and(eq(issueAttachment.id, attachment.id), eq(issueAttachment.s3Key, from)));
      await deleteObject(from).catch((error) => {
        console.error(`[attachments-to-vault] could not delete object ${from}:`, error);
      });
      receipt.moved.push({
        id: attachment.id,
        publicId: attachment.publicId,
        from,
        to,
        sha256: hash,
      });
    } catch (error) {
      receipt.failed.push({
        id: attachment.id,
        publicId: attachment.publicId,
        from,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  receipt.finishedAt = new Date().toISOString();
  return receipt;
}
