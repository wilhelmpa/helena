import { t } from 'elysia';

export const triageBatchBody = t.Object({
  maxMessages: t.Optional(t.Integer({ minimum: 1, maximum: 20, default: 5 })),
});

export const TriageBatchResponse = t.Object({
  accounts: t.Array(t.Object({ id: t.Number(), address: t.String() })),
  processed: t.Number(),
  hasMore: t.Boolean(),
  failed: t.Number(),
  results: t.Array(
    t.Object({
      messageId: t.Number(),
      status: t.String(),
      issueId: t.Nullable(t.Number()),
      actionFailed: t.Boolean(),
    }),
  ),
});
