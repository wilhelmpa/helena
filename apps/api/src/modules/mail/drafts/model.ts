import { t } from 'elysia';
import { MailAddress, MailAddressList } from '../model';

export { teamParams } from '../model';

export const DraftMode = t.Union([
  t.Literal('new'),
  t.Literal('reply'),
  t.Literal('reply_all'),
  t.Literal('forward'),
]);

export const DraftStatus = t.Union([
  t.Literal('draft'),
  t.Literal('pending_approval'),
  t.Literal('queued'),
  t.Literal('sending'),
  t.Literal('sent'),
  t.Literal('failed'),
]);

const DraftAttachment = t.Object({
  source: t.Union([t.Literal('storage'), t.Literal('vault')]),
  ref: t.String({ maxLength: 1024 }),
  filename: t.String(),
  contentType: t.String(),
  size: t.Number(),
});

export const DraftResponse = t.Object({
  id: t.Number(),
  teamId: t.Number(),
  accountId: t.Number(),
  accountAddress: t.String(),
  threadId: t.Nullable(t.Number()),
  replyToMessageId: t.Nullable(t.Number()),
  issueId: t.Nullable(t.Number()),
  mode: DraftMode,
  to: t.Array(MailAddress),
  cc: t.Array(MailAddress),
  bcc: t.Array(MailAddress),
  subject: t.String(),
  // Markdown, sent as the text part.
  bodyText: t.String(),
  bodyHtml: t.String(),
  attachments: t.Array(DraftAttachment),
  status: DraftStatus,
  sendAt: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
  createdByUserId: t.Nullable(t.String()),
  createdByName: t.Nullable(t.String()),
  approvalRequestId: t.Nullable(t.Number()),
  updatedAt: t.String(),
});

export const DraftListResponse = t.Array(DraftResponse);

export const createDraftBody = t.Object({
  mode: DraftMode,
  // The account to send from; a reply or a forward defaults to the account of the
  // message, a new mail must name one.
  accountId: t.Optional(t.Integer({ minimum: 1 })),
  // The message answered or forwarded.
  messageId: t.Optional(t.Integer({ minimum: 1 })),
  issueId: t.Optional(t.Integer({ minimum: 1 })),
  to: t.Optional(MailAddressList),
});

export const updateDraftBody = t.Object({
  accountId: t.Optional(t.Integer({ minimum: 1 })),
  to: t.Optional(MailAddressList),
  cc: t.Optional(MailAddressList),
  bcc: t.Optional(MailAddressList),
  subject: t.Optional(t.String({ maxLength: 998 })),
  bodyText: t.Optional(t.String({ maxLength: 500_000 })),
  bodyHtml: t.Optional(t.String({ maxLength: 2_000_000 })),
  // The attachments to keep, by reference; new ones are added through their routes.
  attachments: t.Optional(
    t.Array(
      t.Object({
        source: t.Union([t.Literal('storage'), t.Literal('vault')]),
        ref: t.String({ maxLength: 1024 }),
      }),
      { maxItems: 50 },
    ),
  ),
});

export const draftParams = t.Object({ draftId: t.Numeric() });

export const uploadDraftAttachmentBody = t.Object({ file: t.File() });

export const vaultAttachmentBody = t.Object({
  path: t.String({ minLength: 1, maxLength: 1024, description: 'Relative to the vault root.' }),
});

export const draftReplyParams = t.Object({
  projectKey: t.String(),
  threadId: t.Union([t.String({ minLength: 1, maxLength: 200 }), t.Numeric()]),
});

export const draftReplyBody = t.Object({
  body: t.String({
    minLength: 1,
    maxLength: 100_000,
    description: 'The text of the answer. The quoted mail is added below it.',
  }),
  replyAll: t.Optional(
    t.Boolean({ description: 'Answer everyone the last message went to, not only its sender.' }),
  ),
});

export const projectDraftParams = t.Object({ projectKey: t.String(), draftId: t.Numeric() });

export const SendRequestResponse = t.Object({
  draftId: t.Number(),
  approvalId: t.Number(),
  status: DraftStatus,
});
