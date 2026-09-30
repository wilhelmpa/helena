import { t } from 'elysia';

export const teamParams = t.Object({ teamId: t.Numeric({ minimum: 1 }) });
const days = t.Integer({ minimum: 0, maximum: 3650 });
export const teamRetentionBody = t.Object({ days });
export const projectRetentionBody = t.Object({ days: t.Nullable(days) });
export const teamRetentionResponse = teamRetentionBody;
export const projectRetentionResponse = t.Object({ days: t.Nullable(days), effectiveDays: days });
export const teamTrashParams = t.Object({
  teamId: t.Numeric(),
  kind: t.Union([t.Literal('chat'), t.Literal('vault')]),
});
export const projectTrashParams = t.Object({
  projectKey: t.String(),
  kind: t.Union([t.Literal('chat'), t.Literal('vault')]),
});
export const emptyTrashBody = t.Object({
  confirmed: t.Literal(true),
  dryRun: t.Optional(t.Boolean()),
});
export const purgeResponse = t.Object({
  dryRun: t.Boolean(),
  count: t.Integer(),
  counts: t.Array(
    t.Object({
      kind: t.Union([t.Literal('chat'), t.Literal('vault')]),
      teamId: t.Nullable(t.Number()),
      projectId: t.Nullable(t.Number()),
      count: t.Integer(),
    }),
  ),
});
export const historyQuery = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
});

export const trashHistoryResponse = t.Array(
  t.Object({
    batchId: t.String(),
    kind: t.Union([t.Literal('chat'), t.Literal('vault')]),
    teamId: t.Nullable(t.Number()),
    projectId: t.Nullable(t.Number()),
    trigger: t.Union([t.Literal('manual'), t.Literal('schedule')]),
    count: t.Integer(),
    at: t.String(),
  }),
);
