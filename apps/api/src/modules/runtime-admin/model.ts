import { t } from 'elysia';

const fallbackModel = t.Object({
  provider: t.String({ minLength: 1, maxLength: 100 }),
  model: t.String({ minLength: 1, maxLength: 200 }),
});

export const AgentRuntimeDefaultsResponse = t.Object({
  fallbackModels: t.Array(fallbackModel),
});

export const agentRuntimeDefaultsBody = t.Object({
  fallbackModels: t.Optional(t.Array(fallbackModel, { maxItems: 8 })),
});

const versionRef = t.Object({
  commit: t.String(),
  describe: t.Nullable(t.String()),
  version: t.Nullable(t.String()),
});
const commitLine = t.Object({ commit: t.String(), date: t.String(), subject: t.String() });

export const HermesUpdateStateResponse = t.Object({
  checkedAt: t.Nullable(t.String()),
  check: t.Nullable(
    t.Object({
      current: versionRef,
      latest: versionRef,
      commits: t.Array(commitLine),
      localPatches: t.Array(commitLine),
    }),
  ),
  proposal: t.Nullable(
    t.Object({
      id: t.Number(),
      status: t.String(),
      title: t.String(),
      error: t.Nullable(t.String()),
      decidedAt: t.Nullable(t.String()),
      createdAt: t.String(),
      log: t.Nullable(t.String()),
    }),
  ),
});

export const HermesUpdateRequestResponse = t.Object({ proposalId: t.Number() });
