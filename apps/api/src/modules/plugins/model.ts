import { t } from 'elysia';

const Text = t.Union([t.String(), t.Record(t.String(), t.String())]);

const LocalizedText = t.Union([t.String(), t.Record(t.String(), t.String())]);

export const PluginViewSchema = t.Object({
  id: t.String(),
  name: LocalizedText,
  version: t.String(),
  description: t.Nullable(LocalizedText),
  author: t.Nullable(t.String()),
  license: t.Nullable(t.String()),
  homepage: t.Nullable(t.String()),
  source: t.Union([t.Literal('builtin'), t.Literal('external')]),
  status: t.String(),
  error: t.Nullable(t.String()),
  problem: t.Nullable(t.String()),
  digest: t.Nullable(t.String()),
  approved: t.Boolean(),
  restartRequired: t.Boolean(),
  provides: t.Record(t.String(), t.Array(t.String())),
  permissions: t.Object({
    actions: t.Array(t.String()),
    events: t.Array(t.String()),
    network: t.Array(t.String()),
    credentials: t.Boolean(),
  }),
});

export const PluginsOverviewResponse = t.Object({
  externalEnabled: t.Boolean(),
  pluginsDir: t.Nullable(t.String()),
  plugins: t.Array(PluginViewSchema),
});

export const PluginSettingsBody = t.Object({ externalEnabled: t.Boolean() });

export const PluginParams = t.Object({ pluginId: t.String({ minLength: 1, maxLength: 200 }) });

export const UiSlotDescriptorSchema = t.Object({
  key: t.String(),
  pluginId: t.String(),
  slot: t.String(),
  id: t.String(),
  label: t.Union([Text, t.Object({ i18n: t.String() })]),
  icon: t.Optional(t.String()),
  order: t.Optional(t.Number()),
  render: t.Optional(
    t.Object({
      kind: t.Literal('frame'),
      src: t.String(),
      sandbox: t.Optional(t.Array(t.String())),
    }),
  ),
  options: t.Record(t.String(), t.Unknown()),
});

export const UiSlotsResponse = t.Array(UiSlotDescriptorSchema);
