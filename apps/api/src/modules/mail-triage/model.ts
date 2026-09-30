import { t } from 'elysia';

export const triageBatchBody = t.Object({
  maxMessages: t.Optional(t.Integer({ minimum: 1, maximum: 20, default: 5 })),
});

export const TriageBatchResponse = t.Object({
  accounts: t.Array(t.Object({ id: t.Number(), address: t.String() })),
  processed: t.Number(),
  receiptRetries: t.Number(),
  receiptIds: t.Array(t.Integer({ minimum: 1 })),
  receiptCount: t.Integer({ minimum: 0 }),
  hasMore: t.Boolean(),
  failed: t.Number(),
  reviewRequired: t.Number(),
  results: t.Array(
    t.Object({
      messageId: t.Number(),
      receiptIds: t.Array(t.Integer({ minimum: 1 })),
      receiptCount: t.Integer({ minimum: 0 }),
      threadId: t.Number(),
      threadHref: t.String(),
      status: t.String(),
      issueId: t.Nullable(t.Number()),
      actionFailed: t.Boolean(),
      error: t.Optional(t.String()),
    }),
  ),
});
