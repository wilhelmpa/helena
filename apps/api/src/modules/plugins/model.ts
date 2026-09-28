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

// A project's extensions (Projekt › Einstellungen › Erweiterungen).
const Value = t.Union([t.String(), t.Number(), t.Boolean()]);

export const ExtensionConnectionSchema = t.Object({
  id: t.Number(),
  label: t.Nullable(t.String()),
  values: t.Record(t.String(), Value),
  secrets: t.Record(t.String(), t.Boolean()),
});

export const ProjectExtensionsResponse = t.Array(
  t.Object({
    id: t.String(),
    name: LocalizedText,
    version: t.String(),
    status: t.String(),
    connectors: t.Array(
      t.Object({
        id: t.String(),
        label: LocalizedText,
        description: t.Nullable(LocalizedText),
        fields: t.Array(
          t.Object({
            key: t.String(),
            label: LocalizedText,
            type: t.String(),
            required: t.Boolean(),
            placeholder: t.Nullable(t.String()),
            help: t.Nullable(LocalizedText),
          }),
        ),
        connections: t.Array(ExtensionConnectionSchema),
      }),
    ),
  }),
);

export const ProjectExtensionParams = t.Object({
  projectKey: t.String(),
  credentialId: t.Numeric(),
});

export const ProjectExtensionBody = t.Object({ values: t.Record(t.String(), Value) });

export const ExtensionProjectsResponse = t.Record(
  t.String(),
  t.Array(t.Object({ key: t.String(), name: t.String() })),
);
