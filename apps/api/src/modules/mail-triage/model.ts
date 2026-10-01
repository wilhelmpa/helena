import { DecisionClassView } from '#modules/decisions/model';
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

export const TriageOverviewResponse = t.Object({
  projectId: t.Number(),
  accountId: t.Nullable(t.Number()),
  accounts: t.Array(t.Object({ id: t.Number(), address: t.String(), enabled: t.Boolean() })),
  total: t.Number(),
  counts: t.Object({
    status: t.Record(t.String(), t.Number()),
    category: t.Record(t.String(), t.Number()),
    priority: t.Record(t.String(), t.Number()),
  }),
  unresolved: t.Object({
    total: t.Number(),
    hasMore: t.Boolean(),
    items: t.Array(
      t.Object({
        threadId: t.Number(),
        accountId: t.Number(),
        subject: t.String(),
        snippet: t.String(),
        lastMessageAt: t.String(),
        status: t.String(),
      }),
    ),
  }),
  runsScope: t.Literal('project'),
  lastRuns: t.Array(
    t.Object({
      id: t.String(),
      status: t.String(),
      createdAt: t.String(),
      finishedAt: t.Nullable(t.String()),
      error: t.Nullable(t.String()),
      triage: t.Any(),
    }),
  ),
  settings: DecisionClassView,
});
