import { t } from 'elysia';

import { runtimeConflict, runtimeInventory, runtimePolicy, runtimeState } from '../core/model';

export const RuntimePolicySnapshotResponse = t.Object({
  revision: t.String(),
  agent: t.Object({ id: t.Number(), name: t.String(), username: t.String() }),
  instructions: t.Nullable(t.String()),
  model: t.Nullable(t.String()),
  memory: t.Object({ enabled: t.Boolean(), lastMessages: t.Nullable(t.Number()) }),
  runtimePolicy,
  projects: t.Array(
    t.Object({ id: t.Number(), key: t.String(), name: t.String(), instructions: t.String() }),
  ),
  skills: t.Array(
    t.Object({
      id: t.Number(),
      slug: t.String(),
      name: t.String(),
      description: t.String(),
      markdown: t.String(),
      files: t.Array(t.Object({ path: t.String(), content: t.String() })),
    }),
  ),
  configuredTools: t.Array(
    t.Object({ id: t.Number(), toolKey: t.String(), integrationKey: t.String() }),
  ),
});

export const RuntimeStateBody = t.Object({
  adapter: t.String({ minLength: 1, maxLength: 64 }),
  status: t.Union([t.Literal('online'), t.Literal('degraded')]),
  appliedRevision: t.Nullable(t.String({ maxLength: 128 })),
  capabilities: t.Array(t.String({ minLength: 1, maxLength: 80 }), { maxItems: 64 }),
  detail: t.Nullable(t.String({ maxLength: 500 })),
  conflicts: t.Optional(t.Array(runtimeConflict, { maxItems: 8 })),
  inventory: t.Optional(runtimeInventory),
});

export const RuntimeStateResponse = runtimeState;
