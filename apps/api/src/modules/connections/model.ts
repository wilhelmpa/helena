import { t } from 'elysia';

export const ConnectionStatus = t.Union([
  t.Literal('connected'),
  t.Literal('available'),
  t.Literal('configured'),
  t.Literal('disabled'),
  t.Literal('unavailable'),
  t.Literal('unsupported'),
  t.Literal('error'),
]);

export const ConnectionItem = t.Object({
  id: t.String(),
  kind: t.Union([t.Literal('mcp'), t.Literal('channel'), t.Literal('service'), t.Literal('mail')]),
  provider: t.String(),
  label: t.String(),
  accountId: t.Optional(t.String()),
  status: ConnectionStatus,
  configured: t.Boolean(),
  connected: t.Boolean(),
  running: t.Boolean(),
  lastCheckedAt: t.Nullable(t.String()),
  lastSuccessAt: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
  canProbe: t.Boolean(),
  canReconnect: t.Boolean(),
  canPair: t.Boolean(),
  toolCount: t.Optional(t.Number()),
  manageUrl: t.Optional(t.Nullable(t.String())),
});

export const ConnectionsResponse = t.Object({
  checkedAt: t.String(),
  items: t.Array(ConnectionItem),
});
export const ConnectionActionBody = t.Object({
  id: t.String({ minLength: 1, maxLength: 300 }),
  action: t.Union([t.Literal('probe'), t.Literal('reconnect')]),
});
export const MailAccountResponse = t.Object({
  account: t.String(),
  status: ConnectionStatus,
  lastCheckedAt: t.String(),
  lastError: t.Nullable(t.String()),
});
export const MailAccountsResponse = t.Object({ accounts: t.Array(MailAccountResponse) });
export const MailSearchBody = t.Object({
  account: t.String(),
  query: t.String({ maxLength: 500 }),
  maxResults: t.Optional(t.Integer({ minimum: 1, maximum: 50 })),
  page: t.Optional(t.String({ maxLength: 2048 })),
});
export const MailAccountBody = t.Object({ account: t.String() });
export const MailThreadBody = t.Object({ account: t.String(), threadId: t.String() });
export const MailLabelsBody = t.Object({
  account: t.String(),
  threadId: t.String(),
  add: t.Optional(t.Array(t.String(), { maxItems: 40 })),
  remove: t.Optional(t.Array(t.String(), { maxItems: 40 })),
});
export const MailDraftBody = t.Object({
  account: t.String(),
  to: t.Array(t.String(), { maxItems: 50 }),
  cc: t.Optional(t.Array(t.String(), { maxItems: 50 })),
  bcc: t.Optional(t.Array(t.String(), { maxItems: 50 })),
  subject: t.String({ maxLength: 998 }),
  body: t.String({ maxLength: 100_000 }),
  replyToMessageId: t.Optional(t.String()),
  threadId: t.Optional(t.String()),
  replyAll: t.Optional(t.Boolean()),
});
export const MailDraftListBody = t.Object({
  account: t.String(),
  maxResults: t.Optional(t.Integer({ minimum: 1, maximum: 50 })),
});
export const MailDraftActionBody = t.Object({ account: t.String(), draftId: t.String() });
export const MailSendBody = t.Object({
  account: t.String(),
  draftId: t.String(),
  confirmationToken: t.String(),
});
export const MailAttachmentBody = t.Object({
  account: t.String(),
  messageId: t.String(),
  attachmentId: t.String(),
  filename: t.String({ maxLength: 500 }),
});

export const MailPayload = t.Any();
