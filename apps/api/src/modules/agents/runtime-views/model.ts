import { t } from 'elysia';

// The shapes a runtime answers in (packages/runner/src/readers/types.ts): transcripts are
// OpenTelemetry GenAI messages with typed parts, token counts are gen_ai.usage.*.

const usage = t.Object({
  inputTokens: t.Number(),
  outputTokens: t.Number(),
  cacheReadTokens: t.Number(),
  cacheWriteTokens: t.Number(),
  reasoningTokens: t.Number(),
});

export const SessionSummary = t.Object({
  id: t.String(),
  title: t.Nullable(t.String()),
  preview: t.Nullable(t.String()),
  source: t.Nullable(t.String()),
  model: t.Nullable(t.String()),
  startedAt: t.Nullable(t.Number()),
  endedAt: t.Nullable(t.Number()),
  lastActiveAt: t.Nullable(t.Number()),
  endReason: t.Nullable(t.String()),
  messageCount: t.Number(),
  toolCallCount: t.Number(),
  usage,
  estimatedCostUsd: t.Nullable(t.Number()),
  parentSessionId: t.Nullable(t.String()),
});

export const SessionPageResponse = t.Object({
  sessions: t.Array(SessionSummary),
  total: t.Number(),
});

export const SessionSearchResponse = t.Array(
  t.Object({
    sessionId: t.String(),
    role: t.Nullable(t.String()),
    snippet: t.String(),
    session: t.Nullable(SessionSummary),
  }),
);

const part = t.Union([
  t.Object({ type: t.Literal('text'), content: t.String() }),
  t.Object({ type: t.Literal('reasoning'), content: t.String() }),
  t.Object({
    type: t.Literal('tool_call'),
    id: t.Nullable(t.String()),
    name: t.String(),
    arguments: t.Unknown(),
  }),
  t.Object({
    type: t.Literal('tool_call_response'),
    id: t.Nullable(t.String()),
    name: t.Nullable(t.String()),
    response: t.Unknown(),
    isError: t.Optional(t.Boolean()),
  }),
  t.Object({ type: t.Literal('compaction'), content: t.Nullable(t.String()) }),
]);

export const TranscriptResponse = t.Object({
  session: SessionSummary,
  messages: t.Array(
    t.Object({
      id: t.String(),
      role: t.Union([
        t.Literal('system'),
        t.Literal('user'),
        t.Literal('assistant'),
        t.Literal('tool'),
      ]),
      parts: t.Array(part),
      timestamp: t.Nullable(t.Number()),
      model: t.Optional(t.Nullable(t.String())),
      finishReason: t.Optional(t.Nullable(t.String())),
    }),
  ),
  offset: t.Number(),
  totalMessages: t.Number(),
  truncated: t.Boolean(),
});

export const LogLinesResponse = t.Object({ lines: t.Array(t.String()), truncated: t.Boolean() });

export const HealthResponse = t.Object({
  ok: t.Boolean(),
  report: t.String(),
  checkedAt: t.Number(),
});

export const VersionResponse = t.Object({
  runtime: t.String(),
  version: t.Nullable(t.String()),
  detail: t.Nullable(t.String()),
});

export const CuratorStatusResponse = t.Object({
  paused: t.Nullable(t.Boolean()),
  report: t.String(),
});

export const curatorActionBody = t.Object({
  action: t.Union([t.Literal('pin'), t.Literal('unpin')]),
  skill: t.String({
    pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$',
    description: 'The skill to pin or unpin, by name.',
  }),
});

export const RuntimeRequestStateResponse = t.Object({
  id: t.Number(),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('claimed'),
    t.Literal('answered'),
    t.Literal('failed'),
  ]),
  result: t.Unknown(),
  error: t.Nullable(t.String()),
});

export const QueuedResponse = t.Object({ requestId: t.Number() });

export const sessionsQuery = t.Object({
  q: t.Optional(t.String({ maxLength: 200, description: 'Search words; omit to list.' })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  offset: t.Optional(t.Numeric({ minimum: 0 })),
});

export const sessionParams = t.Object({
  teamId: t.Numeric(),
  agentId: t.Numeric(),
  sessionId: t.String({ minLength: 1, maxLength: 200 }),
});

export const transcriptQuery = t.Object({
  offset: t.Optional(t.Numeric({ minimum: 0 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1000 })),
});

export const logsQuery = t.Object({
  sessionId: t.Optional(t.String({ maxLength: 200 })),
  lines: t.Optional(t.Numeric({ minimum: 1, maximum: 2000 })),
  level: t.Optional(
    t.Union([t.Literal('DEBUG'), t.Literal('INFO'), t.Literal('WARNING'), t.Literal('ERROR')]),
  ),
});

export const requestParams = t.Object({
  teamId: t.Numeric(),
  agentId: t.Numeric(),
  requestId: t.Numeric(),
});

export const SessionsResponse = t.Object({
  page: t.Optional(SessionPageResponse),
  hits: t.Optional(SessionSearchResponse),
});
