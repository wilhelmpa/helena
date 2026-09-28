import { t } from 'elysia';

export const TelegramAccountResponse = t.Object({
  botUsername: t.Nullable(t.String()),
  link: t.Nullable(
    t.Object({
      username: t.Nullable(t.String()),
      firstName: t.Nullable(t.String()),
      linkedAt: t.String(),
      selectedAgentId: t.Nullable(t.Number()),
      selectedProjectId: t.Nullable(t.Number()),
    }),
  ),
});

export const TelegramLinkStartResponse = t.Object({
  url: t.String(),
  expiresAt: t.String(),
});

export const TelegramTargetBody = t.Object({
  agentId: t.Nullable(t.Integer({ minimum: 1, maximum: 2_147_483_647 })),
  projectKey: t.Nullable(t.String({ minLength: 1 })),
});

export const TelegramTargetResponse = t.Object({
  agentId: t.Nullable(t.Number()),
  projectId: t.Nullable(t.Number()),
});
