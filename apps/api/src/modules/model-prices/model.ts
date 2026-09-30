import { t } from 'elysia';

const perMTok = t.Number({ minimum: 0, maximum: 100000, description: 'Euros per 1M tokens.' });
const usdPerMTok = t.Number({ description: 'Dollars per 1M tokens, as models.dev lists them.' });

export const ModelPriceSettingsResponse = t.Object({
  usdToEur: t.Number({ description: 'Euros per dollar, for the models.dev prices.' }),
  importedAt: t.Nullable(t.String()),
  importedFrom: t.Nullable(t.Union([t.Literal('snapshot'), t.Literal('models.dev')])),
});

export const ModelPriceResponse = t.Object({
  model: t.String(),
  provider: t.Nullable(t.String()),
  inputPerMTok: t.Number(),
  outputPerMTok: t.Number(),
  cacheReadPerMTok: t.Nullable(t.Number()),
  cacheWritePerMTok: t.Nullable(t.Number()),
  currency: t.Literal('EUR'),
  source: t.Union([t.Literal('models.dev'), t.Literal('manual'), t.Literal('local')]),
  estimate: t.Literal(true),
  updatedAt: t.String(),
  usd: t.Nullable(
    t.Object({
      input: usdPerMTok,
      output: usdPerMTok,
      cacheRead: t.Optional(usdPerMTok),
      cacheWrite: t.Optional(usdPerMTok),
    }),
  ),
});

export const ModelPriceListResponse = t.Object({
  items: t.Array(ModelPriceResponse),
  settings: ModelPriceSettingsResponse,
});

export const modelParams = t.Object({
  model: t.String({
    minLength: 1,
    maxLength: 128,
    pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
    description: 'The model id a runtime reports, e.g. claude-opus-5.',
  }),
});

export const manualPriceBody = t.Object({
  provider: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
  inputPerMTok: perMTok,
  outputPerMTok: perMTok,
  cacheReadPerMTok: t.Optional(t.Nullable(perMTok)),
  cacheWritePerMTok: t.Optional(t.Nullable(perMTok)),
});

export const importPricesBody = t.Object({
  from: t.Union([t.Literal('models.dev'), t.Literal('snapshot')], {
    description:
      'models.dev reads the current list from https://models.dev/api.json; snapshot the list ' +
      'that ships with {appName}.',
  }),
});

export const ImportPricesResponse = t.Object({
  imported: t.Number(),
  keptManual: t.Number(),
  settings: ModelPriceSettingsResponse,
});

export const priceSettingsBody = t.Object({
  usdToEur: t.Number({ exclusiveMinimum: 0, maximum: 100 }),
});
