import { db, issue, issueAttachment, issueFieldValue } from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';
import { iso, num } from '#shared/lib';
import {
  assertAttachmentStorageCapacity,
  lockAttachmentStorage,
  stripAttachmentEmbeds,
} from './storage';

// Data access for issue attachments. The file is in the project's vault folder
// (vaultPath) or, for a row stored before that, in the object store (s3Key); these rows
// hold the metadata. publicId is the unguessable id used in the public download URL.

export interface AttachmentRow {
  id: number;
  publicId: string;
  issueId: number;
  s3Key: string | null;
  vaultPath: string | null;
  sha256: string | null;
  linked: boolean;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export function mapAttachment(row: typeof issueAttachment.$inferSelect): AttachmentRow {
  return {
    id: row.id,
    publicId: row.publicId,
    issueId: row.issueId,
    s3Key: row.s3Key,
    vaultPath: row.vaultPath,
    sha256: row.sha256,
    linked: row.linked,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: num(row.sizeBytes),
    createdAt: iso(row.createdAt),
  };
}

export interface AttachmentFile {
  vaultPath: string;
  sha256: string;
  linked: boolean;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

// A linked file was in the vault before the attachment, so it does not count towards
// the storage quota.
export async function createAttachment(
  input: AttachmentFile & { projectId: number; issueId: number },
): Promise<AttachmentRow> {
  return db.transaction(async (tx) => {
    if (!input.linked) {
      await lockAttachmentStorage(tx, input.projectId);
      await assertAttachmentStorageCapacity(input.projectId, input.sizeBytes, 0, tx);
    }
    const [row] = await tx
      .insert(issueAttachment)
      .values({
        issueId: input.issueId,
        vaultPath: input.vaultPath,
        sha256: input.sha256,
        linked: input.linked,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      })
      .returning();
    return mapAttachment(row);
  });
}

export async function listAttachments(issueId: number): Promise<AttachmentRow[]> {
  const rows = await db
    .select()
    .from(issueAttachment)
    .where(eq(issueAttachment.issueId, issueId))
    .orderBy(issueAttachment.createdAt);
  return rows.map(mapAttachment);
}

export async function getAttachmentByPublicId(publicId: string): Promise<AttachmentRow | null> {
  const rows = await db
    .select()
    .from(issueAttachment)
    .where(eq(issueAttachment.publicId, publicId));
  return rows[0] ? mapAttachment(rows[0]) : null;
}

// Points an attachment at another file, keeping its row and its publicId. An embed
// of it in a description keeps working and shows the new file, which is what makes
// editing an attachment in place possible. Returns the row as it was before, whose
// file the caller removes, or null if no row matched.
export async function replaceAttachmentFile(
  publicId: string,
  projectId: number,
  input: AttachmentFile,
): Promise<{ attachment: AttachmentRow; replaced: AttachmentRow } | null> {
  return db.transaction(async (tx) => {
    await lockAttachmentStorage(tx, projectId);
    const [current] = await tx
      .select({ attachment: issueAttachment })
      .from(issueAttachment)
      .innerJoin(issue, eq(issue.id, issueAttachment.issueId))
      .where(and(eq(issueAttachment.publicId, publicId), eq(issue.projectId, projectId)));
    if (!current) return null;
    if (!input.linked) {
      const replacedBytes = current.attachment.linked ? 0 : num(current.attachment.sizeBytes);
      await assertAttachmentStorageCapacity(projectId, input.sizeBytes, replacedBytes, tx);
    }
    const rows = await tx
      .update(issueAttachment)
      .set({ ...input, s3Key: null })
      .where(eq(issueAttachment.id, current.attachment.id))
      .returning();
    if (!rows[0]) return null;
    return { attachment: mapAttachment(rows[0]), replaced: mapAttachment(current.attachment) };
  });
}

export async function setAttachmentVaultPath(id: number, vaultPath: string): Promise<void> {
  await db.update(issueAttachment).set({ vaultPath }).where(eq(issueAttachment.id, id));
}

// Deletes the row and returns it (with its s3Key) so the caller can remove the
// object from the store. Returns null if no row matched.
export async function deleteAttachmentByPublicId(publicId: string): Promise<AttachmentRow | null> {
  const rows = await db
    .delete(issueAttachment)
    .where(eq(issueAttachment.publicId, publicId))
    .returning();
  return rows[0] ? mapAttachment(rows[0]) : null;
}

// Remove embeds of one attachment from the issue description and its markdown
// custom field values. Called on delete so a removed attachment leaves no broken
// image behind.
export async function removeAttachmentEmbeds(issueId: number, publicId: string): Promise<void> {
  let changed = false;

  const [row] = await db
    .select({ description: issue.description })
    .from(issue)
    .where(eq(issue.id, issueId));
  if (row) {
    const next = stripAttachmentEmbeds(row.description, publicId);
    if (next !== row.description) {
      await db.update(issue).set({ description: next }).where(eq(issue.id, issueId));
      changed = true;
    }
  }

  const values = await db
    .select({ id: issueFieldValue.id, valueText: issueFieldValue.valueText })
    .from(issueFieldValue)
    .where(eq(issueFieldValue.issueId, issueId));
  for (const v of values) {
    if (v.valueText == null) continue;
    const next = stripAttachmentEmbeds(v.valueText, publicId);
    if (next !== v.valueText) {
      await db.update(issueFieldValue).set({ valueText: next }).where(eq(issueFieldValue.id, v.id));
      changed = true;
    }
  }

  // Stripping an embed is an edit of the issue, and sorting by "recently updated"
  // has to place it accordingly.
  if (changed) {
    await db
      .update(issue)
      .set({ updatedAt: sql`now()` })
      .where(eq(issue.id, issueId));
  }
}
