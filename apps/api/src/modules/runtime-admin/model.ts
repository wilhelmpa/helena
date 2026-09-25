import { t } from 'elysia';

const fallbackModel = t.Object({
  provider: t.String({ minLength: 1, maxLength: 100 }),
  model: t.String({ minLength: 1, maxLength: 200 }),
});

const bundledSkills = t.Union([t.Literal('all'), t.Literal('essential')], {
  description:
    'Which of the skills that ship with Hermes every Hermes profile carries: all of them, or ' +
    'only the one Hermes needs itself.',
});

export const AgentRuntimeDefaultsResponse = t.Object({
  fallbackModels: t.Array(fallbackModel),
  sessionRetentionDays: t.Nullable(t.Number()),
  bundledSkills,
  compressionThresholdTokens: t.Number(),
});

export const agentRuntimeDefaultsBody = t.Object({
  fallbackModels: t.Optional(t.Array(fallbackModel, { maxItems: 8 })),
  sessionRetentionDays: t.Optional(
    t.Nullable(
      t.Integer({
        minimum: 7,
        maximum: 3650,
        description: 'Days Hermes keeps ended sessions; null keeps its own 90.',
      }),
    ),
  ),
  bundledSkills: t.Optional(bundledSkills),
  compressionThresholdTokens: t.Optional(
    t.Integer({
      minimum: 16_000,
      maximum: 1_000_000,
      description:
        'Tokens from which Hermes compresses a conversation, for every agent without its own.',
    }),
  ),
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
