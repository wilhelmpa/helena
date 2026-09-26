import { t } from 'elysia';
import { MailAddress, MailFolderRole } from '../model';

export { teamParams } from '../model';

const flag = t.Optional(t.Union([t.Literal('true'), t.Literal('false')]));

export const threadListQuery = t.Object({
  projectId: t.Optional(t.Numeric()),
  // Only the threads filed under Home.
  home: flag,
  accountId: t.Optional(t.Numeric()),
  folderId: t.Optional(t.Numeric()),
  role: t.Optional(MailFolderRole),
  unread: flag,
  attachments: flag,
  flagged: flag,
  q: t.Optional(t.String({ maxLength: 200 })),
  cursor: t.Optional(t.String({ maxLength: 200 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
});

export const ThreadRowResponse = t.Object({
  id: t.Number(),
  accountId: t.Number(),
  accountAddress: t.String(),
  accountName: t.String(),
  projectId: t.Nullable(t.Number()),
  projectKey: t.Nullable(t.String()),
  suggestedProjectId: t.Nullable(t.Number()),
  suggestedProjectKey: t.Nullable(t.String()),
  subject: t.String(),
  lastMessageAt: t.String(),
  fromName: t.String(),
  fromAddress: t.String(),
  snippet: t.String(),
  messageCount: t.Number(),
  unread: t.Boolean(),
  flagged: t.Boolean(),
  hasAttachments: t.Boolean(),
  // What the mail classifier made of it (docs/helena-decisions/decisions.md §5).
  triage: t.Optional(
    t.Nullable(
      t.Object({
        status: t.String(),
        category: t.Nullable(t.String()),
        priority: t.Nullable(t.String()),
        needsReply: t.Nullable(t.Boolean()),
      }),
    ),
  ),
});

export const ThreadPageResponse = t.Object({
  items: t.Array(ThreadRowResponse),
  nextCursor: t.Nullable(t.String()),
});

export const folderListQuery = t.Object({ accountId: t.Optional(t.Numeric()) });

export const FolderListResponse = t.Array(
  t.Object({
    id: t.Number(),
    accountId: t.Number(),
    path: t.String(),
    name: t.String(),
    role: t.Nullable(t.String()),
  }),
);

export const threadParams = t.Object({ threadId: t.Numeric() });
export const messageParams = t.Object({ messageId: t.Numeric() });
export const partParams = t.Object({
  messageId: t.Numeric(),
  contentId: t.String({ minLength: 1, maxLength: 500 }),
});
export const attachmentParams = t.Object({ attachmentId: t.Numeric() });
export const issueParams = t.Object({ issueId: t.Numeric() });
export const projectThreadParams = t.Object({
  projectKey: t.String(),
  threadId: t.Union([t.String({ minLength: 1, maxLength: 200 }), t.Numeric()]),
});

const LinkedIssue = t.Object({
  id: t.Number(),
  identifier: t.String(),
  title: t.String(),
  projectKey: t.String(),
  sequenceNumber: t.Number(),
});

const MessageAttachment = t.Object({
  id: t.Number(),
  filename: t.String(),
  contentType: t.String(),
  size: t.Number(),
  // Relative to the vault root.
  vaultPath: t.String(),
});

export const ThreadResponse = t.Object({
  id: t.Number(),
  teamId: t.Number(),
  subject: t.String(),
  projectId: t.Nullable(t.Number()),
  projectKey: t.Nullable(t.String()),
  projectName: t.Nullable(t.String()),
  suggestedProjectId: t.Nullable(t.Number()),
  suggestedProjectKey: t.Nullable(t.String()),
  suggestedProjectName: t.Nullable(t.String()),
  accountId: t.Number(),
  accountName: t.String(),
  accountAddress: t.String(),
  issues: t.Array(LinkedIssue),
  drafts: t.Array(
    t.Object({
      id: t.Number(),
      status: t.Union([
        t.Literal('draft'),
        t.Literal('pending_approval'),
        t.Literal('failed'),
        t.Literal('queued'),
      ]),
      subject: t.String(),
      updatedAt: t.String(),
      createdByName: t.Nullable(t.String()),
    }),
  ),
  messages: t.Array(
    t.Object({
      id: t.Number(),
      messageId: t.String(),
      subject: t.String(),
      fromName: t.String(),
      fromAddress: t.String(),
      to: t.Array(MailAddress),
      cc: t.Array(MailAddress),
      bcc: t.Array(MailAddress),
      replyTo: t.Array(MailAddress),
      sentAt: t.String(),
      text: t.String(),
      // Sanitized. Image sources are relative to the api origin.
      html: t.Nullable(t.String()),
      hasRemoteImages: t.Boolean(),
      allowRemoteImages: t.Boolean(),
      seen: t.Boolean(),
      flagged: t.Boolean(),
      folders: t.Array(t.String()),
      attachments: t.Array(MessageAttachment),
    }),
  ),
});

export const moveThreadBody = t.Object({ projectId: t.Nullable(t.Integer({ minimum: 1 })) });

export const threadActionBody = t.Object({
  action: t.Union([
    t.Literal('read'),
    t.Literal('unread'),
    t.Literal('flag'),
    t.Literal('unflag'),
    t.Literal('archive'),
    t.Literal('trash'),
  ]),
});

export const remoteImagesBody = t.Object({ allow: t.Boolean() });

export const createTaskBody = t.Object({
  // The task's project; the thread moves there when it is filed elsewhere.
  projectId: t.Optional(t.Integer({ minimum: 1 })),
});

export const TaskResponse = t.Object({
  issueId: t.Number(),
  sequenceNumber: t.Number(),
  projectKey: t.String(),
});

export const NoteResponse = t.Object({
  path: t.String(),
  projectKey: t.Nullable(t.String()),
});

export const contactQuery = t.Object({ q: t.String({ minLength: 1, maxLength: 200 }) });
export const ContactListResponse = t.Array(t.Object({ name: t.String(), address: t.String() }));

export const IssueThreadListResponse = t.Array(
  t.Object({
    id: t.Number(),
    subject: t.String(),
    lastMessageAt: t.String(),
    fromName: t.String(),
    fromAddress: t.String(),
    snippet: t.String(),
    accountAddress: t.String(),
    // The message an answer from the task replies to.
    latestMessageId: t.Nullable(t.Number()),
  }),
);

export const searchMailQuery = t.Object({
  q: t.Optional(
    t.String({ maxLength: 200, description: 'Words to find in subject, addresses and text.' }),
  ),
  unread: t.Optional(t.Boolean({ description: 'Only threads with unread mail.' })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 50, default: 20 })),
  // Paging: the last thread of the previous page. Without them an agent saw only the
  // newest page of a mailbox (a triage of 718 threads stopped after 50, 2026-09-25).
  beforeAt: t.Optional(
    t.String({
      format: 'date-time',
      description: 'Next page: the lastMessageAt of the last thread of the previous page.',
    }),
  ),
  beforeThreadId: t.Optional(
    t.Integer({
      minimum: 1,
      description: 'Next page: the threadId of the last thread of the previous page.',
    }),
  ),
});

export const MailSearchResponse = t.Array(
  t.Object({
    threadId: t.Number(),
    subject: t.String(),
    lastMessageAt: t.String(),
    from: t.String(),
    snippet: t.String(),
    messageCount: t.Number(),
    unread: t.Boolean(),
    hasAttachments: t.Boolean(),
  }),
);

export const AgentThreadResponse = t.Object({
  threadId: t.Number(),
  subject: t.String(),
  account: t.String(),
  messages: t.Array(
    t.Object({
      messageId: t.Number(),
      from: t.String(),
      to: t.Array(t.String()),
      cc: t.Array(t.String()),
      date: t.String(),
      subject: t.String(),
      text: t.String(),
      attachments: t.Array(
        t.Object({
          filename: t.String(),
          contentType: t.String(),
          size: t.Number(),
          vaultPath: t.String({ description: 'Relative to the vault root.' }),
          filePath: t.String({ description: 'The file on the host.' }),
        }),
      ),
    }),
  ),
});
