import {
  db,
  mailAttachment,
  mailMessage,
  mailThread,
  mailThreadIssue,
  projectColumn,
} from '@repo/db';
import { mailNotePath, writeNewVaultText } from '@repo/mail';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { createIssue } from '#modules/issues/service';
import { getProjectById } from '#modules/projects/service';
import { HttpError } from '#shared/lib';
import { moveThread } from './move';

const QUOTE_CHARS = 2000;

async function threadContent(threadId: number) {
  const [thread] = await db.select().from(mailThread).where(eq(mailThread.id, threadId));
  if (!thread) throw new HttpError(404, 'Mail thread not found');
  const messages = await db
    .select()
    .from(mailMessage)
    .where(and(eq(mailMessage.threadId, threadId), isNull(mailMessage.deletedAt)))
    .orderBy(asc(mailMessage.sentAt), asc(mailMessage.id));
  if (messages.length === 0) throw new HttpError(404, 'Mail thread not found');
  const attachments = await db
    .select()
    .from(mailAttachment)
    .where(
      inArray(
        mailAttachment.messageId,
        messages.map((message) => message.id),
      ),
    )
    .orderBy(asc(mailAttachment.id));
  return { thread, messages, attachments };
}

function sender(message: { fromName: string; fromAddress: string }): string {
  return message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress;
}

function stamp(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

function quote(text: string): string {
  const cut = text.length > QUOTE_CHARS ? `${text.slice(0, QUOTE_CHARS)}…` : text;
  return cut
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

// The inbox of the project (or Home) with the thread open.
export function threadHref(projectKey: string | null, threadId: number): string {
  return `${projectKey ? `/project/${projectKey}` : ''}/inbox?thread=${threadId}`;
}

// The Files page of the project, opened at the folder of a vault path.
function filesHref(projectKey: string, vaultPath: string): string {
  const inProject = vaultPath.replace(/^Projects\/[^/]+\//, '');
  const folder = inProject.slice(0, inProject.lastIndexOf('/'));
  return `/project/${projectKey}/files?path=${encodeURIComponent(folder)}`;
}

// A task in the thread's project, made from the thread and linked to it. A task for
// another project first moves the thread there, so task and mail stay together.
export async function createTaskFromThread(
  threadId: number,
  projectId: number | null,
  actorUserId: string,
): Promise<{ issueId: number; sequenceNumber: number; projectKey: string }> {
  const [current] = await db.select().from(mailThread).where(eq(mailThread.id, threadId));
  if (!current) throw new HttpError(404, 'Mail thread not found');
  const targetId = projectId ?? current.projectId;
  if (targetId == null) throw new HttpError(400, 'Choose the project the task belongs to');
  if (targetId !== current.projectId) await moveThread(threadId, targetId);
  const { thread, messages, attachments } = await threadContent(threadId);
  const target = await getProjectById(targetId);
  if (!target) throw new HttpError(400, 'The project no longer exists');
  const [column] = await db
    .select({ id: projectColumn.id })
    .from(projectColumn)
    .where(eq(projectColumn.projectId, target.id))
    .orderBy(asc(projectColumn.position), asc(projectColumn.id))
    .limit(1);
  if (!column) throw new HttpError(400, 'The project has no state');
  const latest = messages.at(-1)!;
  const lines = [
    `**From:** ${sender(latest)}  `,
    `**Date:** ${stamp(latest.sentAt)} UTC  `,
    `**Mail:** [${thread.subject || 'Open'}](${threadHref(target.key, thread.id)})`,
    '',
    quote(latest.textBody),
  ];
  if (attachments.length > 0) {
    lines.push('', '**Attachments:**');
    for (const attachment of attachments) {
      lines.push(
        `- [${attachment.filename}](${filesHref(target.key, attachment.vaultPath)}) \`${attachment.vaultPath}\``,
      );
    }
  }
  const title = (thread.subject.trim() || `Mail from ${sender(latest)}`).slice(0, 300);
  const created = await createIssue(
    target,
    { columnId: column.id, title, description: lines.join('\n'), labelIds: [] },
    actorUserId,
    {
      afterInsert: async (tx, issueId) => {
        await tx.insert(mailThreadIssue).values({ threadId, issueId }).onConflictDoNothing();
      },
    },
  );
  return { issueId: created.id, sequenceNumber: created.sequenceNumber, projectKey: target.key };
}

function yaml(value: string): string {
  return JSON.stringify(value);
}

// The thread as a Markdown note in the vault's Docs/Mail folder of its project (or
// Home), with frontmatter that points back to the thread and relative links to the
// attachments in Files/Mail.
export async function saveThreadNote(
  threadId: number,
): Promise<{ path: string; projectKey: string | null }> {
  const { thread, messages, attachments } = await threadContent(threadId);
  const projectKey = thread.projectId
    ? ((await getProjectById(thread.projectId))?.key ?? null)
    : null;
  const first = messages[0]!;
  const notePath = mailNotePath({ projectKey, date: first.sentAt, subject: thread.subject });
  const body = [
    '---',
    'type: mail',
    `plan_mail_thread: ${thread.id}`,
    `plan_mail: ${yaml(threadHref(projectKey, thread.id))}`,
    `subject: ${yaml(thread.subject)}`,
    `from: ${yaml(sender(first))}`,
    `date: ${first.sentAt.toISOString()}`,
    '---',
    '',
    `# ${thread.subject || 'No subject'}`,
  ];
  for (const message of messages) {
    body.push(
      '',
      `## ${sender(message)}, ${stamp(message.sentAt)} UTC`,
      '',
      message.textBody.trim(),
    );
    const files = attachments.filter((attachment) => attachment.messageId === message.id);
    if (files.length > 0) {
      body.push('', 'Attachments:');
      for (const file of files) {
        // The note is two folders below the scope root: <root>/Docs/Mail/<note>.md.
        const relative = `../../${file.vaultPath
          .split('/')
          .slice(projectKey ? 2 : 1)
          .join('/')}`;
        body.push(`- [${file.filename}](${encodeURI(relative)})`);
      }
    }
  }
  return { path: await writeNewVaultText(notePath, `${body.join('\n')}\n`), projectKey };
}
