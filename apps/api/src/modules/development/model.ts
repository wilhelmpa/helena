import { t } from 'elysia';

export const developmentTaskBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 64, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
  body: t.String({ minLength: 1, maxLength: 32000 }),
  model: t.Union(
    ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol'].map((value) =>
      t.Literal(value),
    ),
  ),
  effort: t.Union(
    ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map((value) => t.Literal(value)),
  ),
});
export const developmentNumberParams = t.Object({
  number: t.Numeric({ minimum: 1, maximum: 999999999, multipleOf: 1 }),
});
export const DevelopmentTaskResponse = t.Object({ number: t.Number(), file: t.String() });
export const DevelopmentReportResponse = t.Object({ number: t.Number(), content: t.String() });
export const DevelopmentStatusResponse = t.Object({
  queue: t.Array(t.String()),
  log: t.String(),
  running: t.Array(t.Object({ pid: t.Number(), number: t.Number() })),
});
export const DevelopmentReleaseResponse = t.Object({
  liveSha: t.Nullable(t.String()),
  gates: t.Array(
    t.Object({
      file: t.String(),
      summary: t.Array(t.String()),
      available: t.Boolean(),
      modifiedAt: t.Nullable(t.String()),
    }),
  ),
});
