import { t } from 'elysia';

const state = t.Union(
  [t.Literal('ok'), t.Literal('near'), t.Literal('limited'), t.Literal('unknown')],
  {
    description:
      '`limited`: a window is full or the provider blocks ordinary use. `near`: a window ' +
      "passed the owner's threshold or the provider flags it. `unknown`: no numbers.",
  },
);

export const ProviderLimitWindow = t.Object({
  id: t.String({ description: '`session`, `weekly`, or `<model>:<kind>` for a model window' }),
  kind: t.Union([
    t.Literal('session'),
    t.Literal('weekly'),
    t.Literal('model'),
    t.Literal('monthly'),
    t.Literal('other'),
  ]),
  label: t.Nullable(t.String({ description: "The provider's name of a model or feature window" })),
  usedPercent: t.Nullable(t.Number({ description: 'Share used when measured, 0–100' })),
  currentPercent: t.Nullable(
    t.Number({ description: 'Share used now: 0 once the reset time has passed' }),
  ),
  windowMinutes: t.Nullable(t.Number()),
  resetsAt: t.Nullable(t.String({ format: 'date-time' })),
  severity: t.Nullable(t.String()),
  limited: t.Nullable(t.Boolean()),
  state,
  agentTokens: t.Nullable(
    t.Number({
      description:
        "Tokens {appName}'s agents on this account spent since the window started (agent_usage)",
    }),
  ),
});

export const ProviderLimitAccount = t.Object({
  id: t.Number(),
  provider: t.String({
    description: '`openai-codex` (ChatGPT plan), `anthropic` (Claude plan), …',
  }),
  account: t.String({ description: "A hash of the provider's account id; never the id" }),
  source: t.String({
    description: 'The usage-limit source: `hermes`, `codex`, `claude-code`, `spool`, …',
  }),
  login: t.Nullable(t.String({ description: '`hermes`, `codex`, `claude-code`, `owner`' })),
  plan: t.Nullable(t.String()),
  windows: t.Array(ProviderLimitWindow),
  extra: t.Nullable(
    t.Object({
      kind: t.String(),
      enabled: t.Boolean(),
      unlimited: t.Boolean(),
      balance: t.Nullable(t.Number()),
      used: t.Nullable(t.Number()),
      limit: t.Nullable(t.Number()),
      currency: t.Nullable(t.String()),
    }),
  ),
  resetCredits: t.Nullable(t.Number()),
  allowed: t.Nullable(t.Boolean()),
  via: t.String(),
  unavailable: t.Nullable(t.String()),
  observedAt: t.String({ format: 'date-time' }),
  state,
  stale: t.Boolean({ description: 'Probed numbers older than three intervals' }),
  nextResetAt: t.Nullable(
    t.String({ format: 'date-time', description: 'When the window that limits resets' }),
  ),
  agents: t.Array(t.Object({ id: t.Number(), name: t.String() })),
});

export const ProviderLimitSettings = t.Object({
  enabled: t.Boolean({ description: 'Ask the runners for the limits by themselves' }),
  intervalMinutes: t.Integer({ minimum: 5, maximum: 60 }),
  nearPercent: t.Integer({ minimum: 50, maximum: 99 }),
});

export const ProviderLimitsResponse = t.Object({
  accounts: t.Array(ProviderLimitAccount),
  settings: ProviderLimitSettings,
  // When Helena last asked the runners on its own.
  probedAt: t.Nullable(t.String({ format: 'date-time' })),
  state,
});

export const providerLimitSettingsBody = t.Partial(ProviderLimitSettings);

export const providerLimitParams = t.Object({ limitId: t.Numeric() });

// What a runner sends: snapshots in the @helena/sdk shape, checked field by field by
// normalizeUsageLimitSnapshot; anything else in them is dropped.
export const runnerLimitsBody = t.Object({
  snapshots: t.Array(t.Record(t.String(), t.Unknown()), { maxItems: 32 }),
});
