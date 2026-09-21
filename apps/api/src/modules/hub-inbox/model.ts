import { t } from 'elysia';

export const HubInboxChannel = t.Union([t.Literal('mail'), t.Literal('whatsapp')]);
export const HubInboxStatus = t.Union([
  t.Literal('new'),
  t.Literal('assigned'),
  t.Literal('waiting'),
  t.Literal('done'),
]);
export const HubInboxPriority = t.Union([
  t.Literal('low'),
  t.Literal('medium'),
  t.Literal('high'),
  t.Literal('urgent'),
]);

export const HubInboxSourceResponse = t.Object({
  id: t.Number(),
  teamId: t.Number(),
  channel: HubInboxChannel,
  account: t.String(),
  enabled: t.Boolean(),
  status: t.Union([
    t.Literal('disabled'),
    t.Literal('connecting'),
    t.Literal('connected'),
    t.Literal('error'),
  ]),
  confidenceThreshold: t.Number(),
  autoCreateTasks: t.Boolean(),
  autoTaskProjectId: t.Nullable(t.Number()),
  lastSyncAt: t.Nullable(t.String()),
  lastSuccessAt: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
});

export const HubInboxSourceListResponse = t.Array(HubInboxSourceResponse);

export const HubInboxThreadResponse = t.Object({
  id: t.String(),
  teamId: t.Number(),
  sourceId: t.Number(),
  channel: HubInboxChannel,
  account: t.String(),
  externalThreadId: t.String(),
  sender: t.String(),
  subject: t.String(),
  snippet: t.String(),
  externalUrl: t.Nullable(t.String()),
  receivedAt: t.String(),
  messageCount: t.Number(),
  projectId: t.Nullable(t.Number()),
  projectKey: t.Nullable(t.String()),
  projectName: t.Nullable(t.String()),
  issueId: t.Nullable(t.Number()),
  issueSequenceNumber: t.Nullable(t.Number()),
  issueIdentifier: t.Nullable(t.String()),
  issueTitle: t.Nullable(t.String()),
  status: HubInboxStatus,
  priority: t.Nullable(HubInboxPriority),
  triageSummary: t.Nullable(t.String()),
  triageStatus: t.Union([
    t.Literal('pending'),
    t.Literal('queued'),
    t.Literal('running'),
    t.Literal('succeeded'),
    t.Literal('needs_review'),
    t.Literal('failed'),
    t.Literal('skipped'),
  ]),
  lastTriageError: t.Nullable(t.String()),
  confidence: t.Nullable(t.Number()),
  confidenceThreshold: t.Number(),
  requiresAction: t.Nullable(t.Boolean()),
  ticketStatus: t.Union([
    t.Literal('none'),
    t.Literal('pending'),
    t.Literal('running'),
    t.Literal('created'),
    t.Literal('failed'),
    t.Literal('skipped'),
  ]),
});

export const HubInboxCursor = t.Object({ ts: t.String(), id: t.String() });
export const HubInboxThreadPageResponse = t.Object({
  items: t.Array(HubInboxThreadResponse),
  nextCursor: t.Nullable(HubInboxCursor),
});

export const sourceListQuery = t.Object({ teamId: t.Numeric() });
export const sourceParams = t.Object({ sourceId: t.Numeric() });
export const updateSourceBody = t.Object({
  enabled: t.Optional(t.Boolean()),
  confidenceThreshold: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  autoCreateTasks: t.Optional(t.Boolean()),
  autoTaskProjectId: t.Optional(t.Nullable(t.Integer())),
});

export const threadListQuery = t.Object({
  teamId: t.Numeric(),
  projectId: t.Optional(t.Numeric()),
  channel: t.Optional(HubInboxChannel),
  status: t.Optional(HubInboxStatus),
  priority: t.Optional(HubInboxPriority),
  needsReview: t.Optional(t.String()),
  cursor: t.Optional(t.String()),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
});
export const threadParams = t.Object({ threadId: t.String({ format: 'uuid' }) });
export const updateThreadBody = t.Object({
  status: t.Optional(HubInboxStatus),
  projectId: t.Optional(t.Nullable(t.Integer())),
  issueId: t.Optional(t.Nullable(t.Integer())),
});
