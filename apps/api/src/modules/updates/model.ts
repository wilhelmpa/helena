import { t } from 'elysia';

// A label a source or a hint carries: a string, an i18n key (`{ i18n }`) or one text per
// locale.
const localized = t.Union([t.String(), t.Record(t.String(), t.String())]);

const kind = t.Union([
  t.Literal('runtime'),
  t.Literal('system'),
  t.Literal('tool'),
  t.Literal('app'),
]);

export const ModelNotice = t.Object({
  repository: t.Nullable(t.String()),
  revision: t.Nullable(t.String()),
  sizeBytes: t.Nullable(t.Number()),
  license: t.Nullable(t.String()),
  date: t.Nullable(t.String()),
  fits: t.Boolean(),
  reason: t.Nullable(t.String()),
  baseline: t.Nullable(t.String()),
});

export const UpdateItem = t.Object({
  id: t.Number(),
  source: t.String({ description: 'The update source: `hermes`, `cli-runtimes`, `apt`, …' }),
  sourceLabel: localized,
  kind,
  component: t.String(),
  name: t.String(),
  installed: t.Nullable(t.String()),
  available: t.Nullable(t.String({ description: 'The newest version the vendor publishes' })),
  updateAvailable: t.Boolean(),
  security: t.Boolean({
    description: 'The update fixes a vulnerability (a security archive, an advisory)',
  }),
  risk: t.Nullable(
    t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high')], {
      description: 'How risky the update looks, as the summary rated it',
    }),
  ),
  mode: t.Union([t.Literal('auto'), t.Literal('manual')]),
  autoAllowed: t.Boolean(),
  breaking: t.Nullable(t.Boolean()),
  summary: t.Nullable(t.String({ description: 'What the new version changes, in German' })),
  highlights: t.Array(t.String()),
  summaryCurrent: t.Boolean(),
  summaryPending: t.Boolean({ description: 'A digest run is writing the summary' }),
  summaryModel: t.Nullable(t.String()),
  summaryRunId: t.Nullable(t.Number()),
  summaryError: t.Nullable(t.String()),
  summarizedAt: t.Nullable(t.String({ format: 'date-time' })),
  sourceUrl: t.Nullable(t.String()),
  notesUrl: t.Nullable(t.String()),
  group: t.Nullable(t.String()),
  applicable: t.Boolean({ description: '{appName} can apply it (a helper does the work)' }),
  hint: t.Nullable(localized),
  detail: t.Nullable(t.String()),
  modelNotice: t.Optional(t.Nullable(ModelNotice)),
  error: t.Nullable(t.String()),
  availableSince: t.Nullable(t.String({ format: 'date-time' })),
  checkedAt: t.String({ format: 'date-time' }),
});

export const UpdateAction = t.Object({
  id: t.Number(),
  source: t.String(),
  component: t.String(),
  name: t.String(),
  components: t.Array(t.String()),
  fromVersion: t.Nullable(t.String()),
  toVersion: t.Nullable(t.String()),
  state: t.Union([t.Literal('running'), t.Literal('done'), t.Literal('failed')]),
  automatic: t.Boolean(),
  backupPath: t.Nullable(t.String({ description: 'The database dump taken before' })),
  log: t.Nullable(t.String()),
  error: t.Nullable(t.String()),
  result: t.Nullable(t.Record(t.String(), t.Unknown())),
  health: t.Nullable(t.Record(t.String(), t.Unknown())),
  requestedAt: t.String({ format: 'date-time' }),
  finishedAt: t.Nullable(t.String({ format: 'date-time' })),
});

export const UpdateSettings = t.Object({
  enabled: t.Boolean(),
  cron: t.String(),
  timezone: t.String(),
  summarize: t.Boolean(),
  agentId: t.Nullable(t.Number()),
  model: t.Nullable(t.String()),
  reasoning: t.String(),
  claudeChannel: t.Union([t.Literal('latest'), t.Literal('stable')]),
  modes: t.Record(t.String(), t.Union([t.Literal('auto'), t.Literal('manual')])),
});

export const updateSettingsBody = t.Partial(
  t.Object({
    enabled: t.Boolean(),
    cron: t.String({ minLength: 9, maxLength: 120 }),
    timezone: t.String({ minLength: 1, maxLength: 64 }),
    summarize: t.Boolean(),
    agentId: t.Nullable(t.Integer({ minimum: 1 })),
    model: t.Nullable(t.String({ minLength: 1, maxLength: 128 })),
    reasoning: t.String({ minLength: 2, maxLength: 16 }),
    claudeChannel: t.Union([t.Literal('latest'), t.Literal('stable')]),
    modes: t.Record(t.String(), t.Union([t.Literal('auto'), t.Literal('manual')])),
  }),
);

export const UpdateJob = t.Object({
  lastStartedAt: t.Nullable(t.String({ format: 'date-time' })),
  lastFinishedAt: t.Nullable(t.String({ format: 'date-time' })),
  lastStatus: t.Nullable(
    t.Union([t.Literal('running'), t.Literal('succeeded'), t.Literal('failed')]),
  ),
  lastError: t.Nullable(t.String()),
  lastTrigger: t.Nullable(t.String()),
  nextRunAt: t.Nullable(t.String({ format: 'date-time' })),
});

export const UpdateCenterResponse = t.Object({
  checkedAt: t.Nullable(t.String({ format: 'date-time' })),
  apt: t.Nullable(
    t.Object({
      listsUpdatedAt: t.Nullable(t.String({ format: 'date-time' })),
      refreshedAt: t.Nullable(t.String({ format: 'date-time' })),
      refreshAttemptedAt: t.Nullable(t.String({ format: 'date-time' })),
      refreshError: t.Nullable(t.String()),
    }),
  ),
  helper: t.Object({
    installed: t.Boolean({ description: 'The root helper (helena-update) is installed' }),
    error: t.Nullable(t.String()),
  }),
  counts: t.Object({ updates: t.Number(), security: t.Number(), applicable: t.Number() }),
  sources: t.Array(
    t.Object({
      id: t.String(),
      label: localized,
      kind,
      pluginId: t.String(),
      checkedAt: t.Nullable(t.String({ format: 'date-time' })),
      error: t.Nullable(t.String()),
    }),
  ),
  items: t.Array(UpdateItem),
  newModels: t.Array(UpdateItem),
  actions: t.Array(UpdateAction),
  settings: UpdateSettings,
  digest: t.Object({
    agentId: t.Nullable(t.Number({ description: 'The agent the summaries run on now' })),
    agentName: t.Nullable(t.String()),
    model: t.Nullable(
      t.String({ description: 'The model they run on now (null: the agent’s own)' }),
    ),
    reasoning: t.Nullable(t.String()),
    agents: t.Array(t.Object({ id: t.Number(), username: t.String(), name: t.String() })),
    models: t.Array(
      t.Object({ id: t.String(), name: t.String(), thinkingLevels: t.Array(t.String()) }),
    ),
  }),
  job: UpdateJob,
});

export const applyBody = t.Object({
  scope: t.Optional(
    t.Union([t.Literal('item'), t.Literal('group'), t.Literal('security')], {
      description:
        '`item`: this component. `group`: every component of its group (all Debian ' +
        'packages). `security`: the security updates of its group.',
    }),
  ),
});

export const itemParams = t.Object({ itemId: t.Numeric() });
export const actionParams = t.Object({ actionId: t.Numeric() });
