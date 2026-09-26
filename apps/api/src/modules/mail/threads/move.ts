import { db, helenaReceipt, mailAttachment, mailMessage, mailThread, project } from '@repo/db';
import { moveMailPath, moveVaultFolder } from '@repo/mail';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';

// Files a thread under another project (or Home, with null). The attachment folders
// of its messages move along to the same place under the new project's Files/Mail,
// so the vault and the thread's project agree, and so does which agents reach it.
export async function moveThread(threadId: number, projectId: number | null): Promise<void> {
  const [thread] = await db.select().from(mailThread).where(eq(mailThread.id, threadId));
  if (!thread) throw new HttpError(404, 'Mail thread not found');
  let projectKey: string | null = null;
  if (projectId != null) {
    const [target] = await db
      .select({ key: project.key })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.teamId, thread.teamId)));
    if (!target) throw new HttpError(400, 'The project must belong to this team');
    projectKey = target.key;
  }
  if (thread.projectId === projectId) {
    await db
      .update(mailThread)
      .set({ suggestedProjectId: null })
      .where(eq(mailThread.id, threadId));
    return;
  }
  // A receipt may point directly at a mail file. Moving that file would leave the
  // receipt in the old project with a broken (or cross-project) vault reference.
  const [linkedReceipt] = await db
    .select({ id: helenaReceipt.id })
    .from(helenaReceipt)
    .where(
      sql`EXISTS (
      SELECT 1 FROM ${mailMessage} m
      LEFT JOIN ${mailAttachment} a ON a.message_id = m.id
      WHERE m.thread_id = ${threadId}
        AND (
          ${helenaReceipt.mailAttachmentId} = a.id
          OR (m.attachment_folder IS NOT NULL AND
              left(${helenaReceipt.vaultPath}, length(m.attachment_folder) + 1) =
                m.attachment_folder || '/')
        )
    )`,
    )
    .limit(1);
  if (linkedReceipt)
    throw new HttpError(
      409,
      'This mail has a receipt. Remove or refile the receipt before moving the mail.',
    );

  const messages = await db
    .select({ id: mailMessage.id, folder: mailMessage.attachmentFolder })
    .from(mailMessage)
    .where(and(eq(mailMessage.threadId, threadId), isNotNull(mailMessage.attachmentFolder)));
  for (const message of messages) {
    const from = message.folder!;
    const to = await moveVaultFolder(from, moveMailPath(from, projectKey));
    await db.transaction(async (tx) => {
      await tx
        .update(mailMessage)
        .set({ attachmentFolder: to })
        .where(eq(mailMessage.id, message.id));
      await tx
        .update(mailAttachment)
        .set({ vaultPath: sql`${to} || substr(${mailAttachment.vaultPath}, ${from.length + 1})` })
        .where(eq(mailAttachment.messageId, message.id));
    });
  }
  await db
    .update(mailThread)
    .set({ projectId, suggestedProjectId: null, updatedAt: new Date() })
    .where(eq(mailThread.id, threadId));
}
