import { t } from 'elysia';
import { modelCheck } from '../runtime-sync/model';
import { runFailure } from '#modules/model-availability/model';

export const runEventsBody = t.Object({
  events: t.Array(t.Unknown(), { maxItems: 500 }),
});

export const runEventsRunnerParams = t.Object({ runId: t.Numeric() });

export const runEventsRunnerQuery = t.Object({
  claim: t.Optional(t.Numeric({ minimum: 1 })),
});

export const RunEventsAckResponse = t.Object({
  canceled: t.Boolean(),
  hold: t.Optional(t.Boolean()),
});

export const agentRunParams = t.Object({
  teamId: t.Numeric(),
  agentId: t.Numeric(),
  runId: t.Numeric(),
});

export const runEventsQuery = t.Object({
  after: t.Optional(t.Numeric({ minimum: 0, description: 'The `next` of the previous page.' })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1000 })),
});

export const RunEventPageResponse = t.Object({
  events: t.Array(
    t.Object({
      id: t.Number(),
      claim: t.Number(),
      payload: t.Unknown(),
      createdAt: t.String(),
    }),
  ),
  next: t.Number(),
});

const usageRow = t.Object({
  kind: t.String(),
  runtime: t.Nullable(t.String()),
  model: t.Nullable(t.String()),
  provider: t.Nullable(t.String()),
  inputTokens: t.Number(),
  outputTokens: t.Number(),
  cacheReadTokens: t.Number(),
  cacheWriteTokens: t.Number(),
  reasoningTokens: t.Number(),
  durationMs: t.Nullable(t.Number()),
  costEur: t.Nullable(
    t.Number({ description: 'Euro by the price of the model, null without one.' }),
  ),
});

export const RunDetailResponse = t.Object({
  id: t.Number(),
  agentId: t.Number(),
  agentName: t.String(),
  agentUsername: t.String(),
  projectId: t.Number(),
  projectKey: t.String(),
  status: t.String(),
  trigger: t.String(),
  issueId: t.Nullable(t.Number()),
  issueIdentifier: t.Nullable(t.String()),
  issueTitle: t.Nullable(t.String()),
  prompt: t.String(),
  output: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
  attempts: t.Number(),
  resumes: t.Number(),
  sessionId: t.Nullable(t.String()),
  model: t.Nullable(t.String()),
  continuedFromRunId: t.Nullable(t.Number()),
  blockedQuestion: t.Nullable(t.String()),
  reflection: t.Unknown({
    description: 'The follow-up turn in which the agent kept what the run taught it, or null.',
  }),
  modelCheck: t.Nullable(modelCheck),
  failure: t.Nullable(runFailure),
  startedAt: t.Nullable(t.String()),
  finishedAt: t.Nullable(t.String()),
  createdAt: t.String(),
  usage: t.Array(usageRow),
});

export const continueRunBody = t.Object({
  instruction: t.String({
    minLength: 1,
    maxLength: 8000,
    description: "What the agent does next, in the run's session.",
  }),
});

export const ContinueRunResponse = t.Object({ runId: t.Number() });
