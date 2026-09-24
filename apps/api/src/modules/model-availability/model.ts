import { t } from 'elysia';

// Why a run or chat answer failed, as the runner read it from the runtime's words
// (@helena/sdk RuntimeFailure).
export const runFailure = t.Object(
  {
    code: t.String({
      maxLength: 60,
      description:
        "'model-unavailable': the provider does not serve the model to this account; " +
        "'provider-rejected': the provider refused the request for good; a plugin runtime " +
        'may name codes of its own.',
    }),
    retryable: t.Boolean({
      description: 'False when the same request cannot pass when sent again: it is run once.',
    }),
    model: t.Optional(
      t.Nullable(t.String({ maxLength: 200, description: 'The model the provider refused.' })),
    ),
    detail: t.Optional(t.String({ maxLength: 500, description: "The provider's own words." })),
  },
  {
    description:
      "Why the run failed, where the runtime's words said. Null for a success and for a " +
      'failure they did not explain.',
  },
);

export const modelAvailabilityState = t.Union([t.Literal('unavailable'), t.Literal('works')], {
  description:
    "'unavailable': the provider refused the model for this account, so the pickers leave it " +
    "out; 'works': a run or chat answer on it succeeded.",
});

// An agent whose runtime is set to a model its provider refused.
export const ModelAgentRef = t.Object({
  id: t.Number(),
  teamId: t.Number(),
  username: t.String(),
  name: t.String(),
  template: t.Boolean(),
});

export const ModelAvailabilityEntry = t.Object({
  id: t.Number(),
  runtime: t.String({
    description: "The runtime that reached the model ('hermes', 'claude', 'codex').",
  }),
  provider: t.String({
    description: "The provider it reached it through ('openai-codex', 'anthropic'; '' when none).",
  }),
  model: t.String(),
  state: modelAvailabilityState,
  reason: t.Nullable(t.String()),
  detail: t.Nullable(t.String()),
  agentId: t.Nullable(t.Number()),
  runId: t.Nullable(t.Number()),
  chatMessageId: t.Nullable(t.Number()),
  since: t.String({ description: 'When the model entered this state.' }),
  observedAt: t.String({ description: 'When it was last seen in it.' }),
  agents: t.Array(ModelAgentRef, {
    description: 'For a refused model: the agents (and templates) set to run on it.',
  }),
});

export const ModelAvailabilityResponse = t.Object({
  entries: t.Array(ModelAvailabilityEntry),
});

export const modelAvailabilityParams = t.Object({
  teamId: t.Numeric(),
  entryId: t.Numeric(),
});

export const replaceModelBody = t.Object({
  from: t.String({ minLength: 1, maxLength: 200, description: 'The model to move agents off.' }),
  to: t.Nullable(
    t.String({
      minLength: 1,
      maxLength: 200,
      description: "The model they run instead; null runs each agent on its runtime's default.",
    }),
  ),
  dryRun: t.Optional(t.Boolean({ description: 'Report what would change, change nothing.' })),
});

export const ReplaceModelResponse = t.Object({
  changed: t.Array(
    t.Object({
      id: t.Number(),
      username: t.String(),
      template: t.Boolean(),
      reasoning: t.Nullable(t.String({ description: 'The reasoning effort it keeps, or null.' })),
    }),
    { description: 'The agents set to the new model (templates carry it to their copies).' },
  ),
  followTemplate: t.Array(t.Object({ id: t.Number(), username: t.String() }), {
    description: 'Copies that follow their template and get the new model with it.',
  }),
  dryRun: t.Boolean(),
});

// What the chat catalog says about a model the pickers leave out.
export const unavailableCatalogModel = t.Object({
  id: t.String(),
  provider: t.Optional(t.String()),
  detail: t.Nullable(t.String()),
  since: t.String(),
  findingId: t.Number({ description: 'The finding behind it, which "try again" forgets.' }),
});
