import { t } from 'elysia';

const ActivityKind = t.Union([
  t.Literal('chat'),
  t.Literal('agent-run'),
  t.Literal('agent-team-run'),
  t.Literal('workflow-run'),
]);

export type ActivityKind = typeof ActivityKind.static;

export const activityQuery = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, description: 'Default 25.' })),
  cursor: t.Optional(t.String({ description: 'nextCursor from the previous page, as JSON.' })),
  kind: t.Optional(ActivityKind),
  agentId: t.Optional(t.Numeric({ minimum: 1 })),
});

// One entry of the timeline (ActivityEntry in entry.ts). The fields a kind does not
// have are null: a chat answer has no task and no counts, a workflow run no agent.
export const ActivityEntryResponse = t.Object({
  id: t.String(),
  kind: ActivityKind,
  at: t.String(),
  status: t.String(),
  project: t.Nullable(t.Object({ id: t.Number(), key: t.String(), name: t.String() })),
  agent: t.Nullable(t.Object({ id: t.Number(), username: t.String(), name: t.String() })),
  issue: t.Nullable(
    t.Object({
      id: t.Number(),
      identifier: t.String(),
      sequenceNumber: t.Number(),
      title: t.String(),
    }),
  ),
  trigger: t.Nullable(t.String()),
  maxTurns: t.Nullable(t.Number()),
  runBudgetSeconds: t.Nullable(t.Number()),
  workflowId: t.Nullable(t.String()),
  workflowRunId: t.Nullable(t.String()),
  threadId: t.Nullable(t.String()),
  durationMs: t.Nullable(t.Number()),
  inputTokens: t.Nullable(t.Number()),
  outputTokens: t.Nullable(t.Number()),
});

export const ActivityCursor = t.Object({ at: t.String(), id: t.String() });

export const ActivityPageResponse = t.Object({
  items: t.Array(ActivityEntryResponse),
  nextCursor: t.Nullable(ActivityCursor),
  notice: t.Nullable(
    t.Union([t.Literal('workflow-runs-unavailable'), t.Literal('workflow-runs-limited')], {
      description:
        'Why workflow runs may be missing from the page. The engine keeps them in Helena, ' +
        'so this is null; kept for clients that read it.',
    }),
  ),
});

export const AgentUsageResponse = t.Object({
  since: t.String({ description: 'The start of the current month, UTC.' }),
  inputTokens: t.Number(),
  outputTokens: t.Number(),
  closedTasks: t.Number(),
  tokensPerClosedTask: t.Nullable(t.Number()),
});
