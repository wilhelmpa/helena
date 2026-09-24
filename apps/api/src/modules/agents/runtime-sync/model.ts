import { t } from 'elysia';

export { agentParams } from '../model';

const name = t.String({ minLength: 1, maxLength: 200 });

export const runtimeDefaults = t.Object({
  model: t.Nullable(t.String({ maxLength: 200 })),
  provider: t.Nullable(t.String({ maxLength: 100 })),
  reasoning: t.Nullable(t.String({ maxLength: 40 })),
});

export const profileDriftCode = t.Union([
  t.Literal('not-linked'),
  t.Literal('managed-config'),
  t.Literal('mcp-unmanaged'),
  t.Literal('mcp-missing'),
  t.Literal('mcp-differs'),
  t.Literal('mcp-unsupported'),
  t.Literal('setting-differs'),
  t.Literal('approval-guard'),
  t.Literal('probe-failed'),
]);

// What the runner found when it read back the agent's runtime profile: a digest of it, what
// differs from Helena's settings and could not be put right, the runtime's own defaults and
// the MCP servers it will start. Names only, never a value.
export const profileReport = t.Object({
  hash: t.String({ maxLength: 100 }),
  checkedAt: t.String({ maxLength: 40 }),
  drift: t.Array(
    t.Object({
      key: name,
      code: profileDriftCode,
      detail: t.Optional(t.String({ maxLength: 300 })),
    }),
    { maxItems: 64 },
  ),
  defaults: t.Nullable(runtimeDefaults),
  mcpServers: t.Array(t.Object({ name, enabled: t.Boolean(), managed: t.Boolean() }), {
    maxItems: 128,
  }),
});

// Why an agent's runtime cannot do its work, or only part of it (the runner's
// RuntimeIssue): its program is missing, no login reaches it ('missing') or its login was
// refused ('rejected'), or Codex runs read-only without agent isolation.
export const runtimeIssue = t.Object({
  code: t.Union([
    t.Literal('runtime-missing'),
    t.Literal('not-signed-in'),
    t.Literal('sandbox-unavailable'),
  ]),
  detail: t.Optional(t.String({ maxLength: 100 })),
  // The command the owner runs in the owner terminal to put it right (sign the runtime in).
  command: t.Optional(t.String({ maxLength: 600 })),
});

// Where a runtime with a sandbox of its own (Codex) runs the model's commands: its own
// sandbox with writes in the working folder, read-only, or none inside agent isolation,
// whose unit is the sandbox then.
export const runtimeSandbox = t.Union([
  t.Literal('workspace-write'),
  t.Literal('read-only'),
  t.Literal('danger-full-access'),
]);

// What a run or chat answer reports about its model (the runner's RunModelReport).
export const runModelReport = t.Object({
  requested: t.Object({
    model: t.Nullable(t.String({ maxLength: 200 })),
    reasoning: t.Nullable(t.String({ maxLength: 40 })),
    // The provider the runner routed the model to; absent from an older runner.
    provider: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  }),
  defaults: t.Nullable(runtimeDefaults),
  used: t.Nullable(
    t.Object({
      model: t.Nullable(t.String({ maxLength: 200 })),
      reasoning: t.Nullable(t.String({ maxLength: 40 })),
      provider: t.Nullable(t.String({ maxLength: 100 })),
    }),
  ),
});

// The configured model and reasoning of a run next to what really ran.
export const modelCheck = t.Object(
  {
    configured: t.Object({
      model: t.Nullable(t.String()),
      reasoning: t.Nullable(t.String()),
      source: t.Union([t.Literal('run'), t.Literal('agent'), t.Literal('default')], {
        description:
          "'run' when the run names its own model (a workflow step), 'agent' when the " +
          "agent's settings do, 'default' when the runtime's own default applies.",
      }),
    }),
    used: t.Nullable(
      t.Object({
        model: t.Nullable(t.String()),
        reasoning: t.Nullable(t.String()),
        provider: t.Nullable(t.String()),
      }),
    ),
    mismatch: t.Array(t.Union([t.Literal('model'), t.Literal('reasoning')])),
  },
  {
    description:
      'What the run was configured to run on and what its session really used. Null for a ' +
      'run whose runner reports neither.',
  },
);

export const RuntimeSyncResponse = t.Object({
  state: t.Union(
    [
      t.Literal('synced'),
      t.Literal('drift'),
      t.Literal('pending'),
      t.Literal('degraded'),
      t.Literal('offline'),
      t.Literal('unknown'),
    ],
    {
      description:
        "'synced' when the runner applied the current settings and found no drift, 'drift' " +
        "when it found some, 'pending' while it has not applied the current settings yet, " +
        "'degraded' when it could not apply them, 'offline' without a runner, 'unknown' for " +
        'a runner that reads no profile back.',
    },
  ),
  revision: t.String({ description: "The revision of the agent's current settings." }),
  appliedRevision: t.Nullable(t.String()),
  adapter: t.Nullable(t.String()),
  detail: t.Nullable(t.String()),
  profile: t.Nullable(profileReport),
  // The runtime's version, what keeps it from its work, and its sandbox.
  version: t.Nullable(t.String()),
  issues: t.Array(runtimeIssue),
  sandbox: t.Nullable(runtimeSandbox),
  // A "Neu schreiben" the runner has not carried out yet.
  rewritePending: t.Boolean(),
  reportedAt: t.Nullable(t.String()),
});

export const runnerHealthBody = t.Object({
  error: t.Nullable(t.String({ maxLength: 500 })),
});

const syncStateName = t.Union([
  t.Literal('synced'),
  t.Literal('drift'),
  t.Literal('pending'),
  t.Literal('degraded'),
  t.Literal('offline'),
  t.Literal('unknown'),
]);

// Every running agent's sync state, for the health overview.
export const agentSyncSummary = t.Object({
  total: t.Number(),
  synced: t.Number(),
  drift: t.Number(),
  pending: t.Number(),
  degraded: t.Number(),
  offline: t.Number(),
  unknown: t.Number(),
  // The agents that are not in sync, at most 50.
  agents: t.Array(
    t.Object({
      id: t.Number(),
      teamId: t.Number(),
      username: t.String(),
      state: syncStateName,
      adapter: t.Nullable(t.String()),
      drift: t.Array(t.String(), { description: 'The keys that drifted.' }),
      issues: t.Array(runtimeIssue),
    }),
  ),
});
