import { t } from 'elysia';

const kind = t.Union([
  t.Literal('coding'),
  t.Literal('architecture'),
  t.Literal('security'),
  t.Literal('legal'),
  t.Literal('external-text'),
]);
const failure = t.Union([
  t.Literal('tests-failed'),
  t.Literal('loop'),
  t.Literal('timeout'),
  t.Literal('error'),
]);
const modelId = t.String({ maxLength: 200, description: 'A model id of the runtimes’ catalogs' });

const kindRule = t.Object({ kind, enabled: t.Boolean(), model: t.Nullable(modelId) });
const pin = t.Object({
  scope: t.Union([t.Literal('agent'), t.Literal('project'), t.Literal('task')]),
  id: t.Integer({ minimum: 1 }),
  mode: t.Union([t.Literal('auto'), t.Literal('local'), t.Literal('strong')], {
    description: '`local`: never escalate; `strong`: always the strong model; `auto`: the rules',
  }),
  model: t.Nullable(modelId),
});

export const EscalationSettings = t.Object({
  enabled: t.Boolean({ description: 'Off: nothing escalates (and nothing acts on it yet)' }),
  defaultModel: modelId,
  kinds: t.Array(kindRule),
  uncertainty: t.Object({
    enabled: t.Boolean(),
    threshold: t.Number({ description: 'Below this confidence (0–1) the strong model answers' }),
    model: t.Nullable(modelId),
  }),
  failure: t.Object({
    enabled: t.Boolean(),
    on: t.Array(failure),
    localAttempts: t.Integer({ minimum: 0, maximum: 5 }),
    model: t.Nullable(modelId),
  }),
  pins: t.Array(pin),
});

export const escalationBody = t.Object({
  enabled: t.Optional(t.Boolean()),
  defaultModel: t.Optional(modelId),
  kinds: t.Optional(t.Array(kindRule)),
  uncertainty: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      threshold: t.Optional(t.Number({ exclusiveMinimum: 0, exclusiveMaximum: 1 })),
      model: t.Optional(t.Nullable(modelId)),
    }),
  ),
  failure: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      on: t.Optional(t.Array(failure)),
      localAttempts: t.Optional(t.Integer({ minimum: 0, maximum: 5 })),
      model: t.Optional(t.Nullable(modelId)),
    }),
  ),
  pins: t.Optional(t.Array(pin, { maxItems: 500 })),
});
