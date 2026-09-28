import { t } from 'elysia';

const dimension = t.Union([
  t.Literal('issue'),
  t.Literal('agent'),
  t.Literal('model'),
  t.Literal('project'),
  t.Literal('goal'),
  t.Literal('department'),
  t.Literal('day'),
  t.Literal('kind'),
]);

export const usageQuery = t.Object({
  from: t.Optional(t.String({ format: 'date', description: 'First day (UTC), inclusive.' })),
  to: t.Optional(t.String({ format: 'date', description: 'Last day (UTC), inclusive.' })),
  agentId: t.Optional(t.Numeric()),
  projectId: t.Optional(t.Numeric()),
  by: t.Optional(
    t.String({
      description:
        'Comma-separated: issue, agent, model, project, goal, department, day, kind. Default agent,model.',
    }),
  ),
});

export const teamParams = t.Object({ teamId: t.Numeric() });

const totals = {
  inputTokens: t.Number(),
  outputTokens: t.Number(),
  cacheReadTokens: t.Number(),
  cacheWriteTokens: t.Number(),
  reasoningTokens: t.Number(),
  durationMs: t.Number(),
  entries: t.Number(),
};

export const UsageResponse = t.Object({
  from: t.String(),
  to: t.String(),
  by: t.Array(dimension),
  currency: t.Literal('EUR'),
  // Some groups had no price, so the cost is a lower bound.
  unpriced: t.Boolean(),
  total: t.Object({ ...totals, costEur: t.Nullable(t.Number()) }),
  rows: t.Array(
    t.Object({
      ...totals,
      issueId: t.Nullable(t.Number()),
      issueTitle: t.Nullable(t.String()),
      agentId: t.Nullable(t.Number()),
      agentName: t.Nullable(t.String()),
      model: t.Nullable(t.String()),
      provider: t.Nullable(t.String()),
      projectId: t.Nullable(t.Number()),
      projectKey: t.Nullable(t.String()),
      goalId: t.Nullable(t.Number()),
      goalTitle: t.Nullable(t.String()),
      departmentId: t.Nullable(t.Number()),
      departmentName: t.Nullable(t.String()),
      day: t.Nullable(t.String()),
      kind: t.Nullable(t.String()),
      costEur: t.Nullable(t.Number()),
    }),
  ),
});

export type UsageDimensionName = typeof dimension.static;
