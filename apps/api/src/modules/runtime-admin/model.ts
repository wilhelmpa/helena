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
