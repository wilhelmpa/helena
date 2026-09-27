import path from 'node:path';
import {
  db,
  issue,
  issueAttachment,
  project,
  chatAttachment,
  initiativeAttachment,
  initiative,
} from '@repo/db';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { numberedName, safeFileName, assertNoSymlinks } from '#modules/project-files/paths';
import { fileSha256 } from '#modules/project-files/resolver';
import { projectRoot, projectVaultPath, vaultDirectory } from '#modules/project-files/roots';
import { sha256, writeUniqueFile } from '#modules/project-files/service';
import { getObject } from '#shared/s3';
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
    const matches = await assertNoSymlinks(
      vaultDirectory(),
      path.relative(vaultDirectory(), candidate),
    )
      .then(() => fileSha256(candidate))
      .then(
        (existing) => existing === hash,
        () => null,
      );
    if (matches === null) return null;
    if (matches) return path.basename(candidate);
  }
  return null;
}

// Copies legacy attachment originals into the canonical vault and switches reads to
// it. Object keys/bytes remain as rollback sources. Repeated/interrupted runs reuse
// matching files and never overwrite a conflicting name or permanently delete data.
export async function moveAttachmentsToVault({
  dryRun = false,
} = {}): Promise<VaultMigrationReceipt> {
  const startedAt = new Date().toISOString();
  const issueRows = await db
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
  const chatRows = await db
    .select({ attachment: chatAttachment, projectKey: project.key })
    .from(chatAttachment)
    .innerJoin(project, eq(project.id, chatAttachment.projectId))
    .where(and(isNotNull(chatAttachment.s3Key), isNull(chatAttachment.vaultPath)));
  const initiativeRows = await db
    .select({ attachment: initiativeAttachment, projectKey: project.key })
    .from(initiativeAttachment)
    .innerJoin(initiative, eq(initiative.id, initiativeAttachment.initiativeId))
    .innerJoin(project, eq(project.id, initiative.projectId))
    .where(and(isNotNull(initiativeAttachment.s3Key), isNull(initiativeAttachment.vaultPath)));
  const rows = [
    ...issueRows.map((row) => ({
      ...row,
      table: issueAttachment,
      folder: `Files/Tasks/${row.projectKey}-${row.sequenceNumber}`,
    })),
    ...chatRows.map((row) => ({ ...row, table: chatAttachment, folder: 'Files/Chat Attachments' })),
    ...initiativeRows.map((row) => ({
      ...row,
      table: initiativeAttachment,
      folder: `Files/Initiatives/${row.attachment.initiativeId}`,
    })),
  ];
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

  for (const { attachment, projectKey, folder, table } of rows) {
    const from = attachment.s3Key as string;
    try {
      const object = await getObject(from);
      const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
      const hash = sha256(bytes);
      const root = projectRoot(projectKey);
      const name =
        (await writtenBefore(path.join(root.directory, folder), attachment.filename, hash)) ??
        path.basename(await writeUniqueFile(root, folder, attachment.filename, bytes));
      const to = `${projectVaultPath(projectKey)}/${folder}/${name}`;
      await db
        .update(table)
        .set({ vaultPath: to, sha256: hash, filename: name })
        .where(and(eq(table.id, attachment.id), eq(table.s3Key, from), isNull(table.vaultPath)));
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
