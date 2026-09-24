import { t } from 'elysia';

const op = t.Union([
  t.Literal('sessions.list'),
  t.Literal('sessions.search'),
  t.Literal('sessions.transcript'),
  t.Literal('logs.read'),
  t.Literal('health.check'),
  t.Literal('version.read'),
  t.Literal('curator.status'),
  t.Literal('curator.run'),
  t.Literal('estop.set'),
  t.Literal('runtime.update'),
]);

export const RuntimeRequestClaimResponse = t.Object({
  request: t.Nullable(
    t.Object({
      id: t.Number(),
      request: t.Object({ op }, { additionalProperties: true }),
    }),
  ),
});

export const runtimeRequestParams = t.Object({ requestId: t.Numeric() });

export const runtimeRequestAnswerBody = t.Union([
  t.Object({ ok: t.Literal(true), result: t.Unknown() }),
  t.Object({ ok: t.Literal(false), error: t.String({ maxLength: 2000 }) }),
]);
