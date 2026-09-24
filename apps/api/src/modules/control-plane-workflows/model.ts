import { t } from 'elysia';
import { maxTurnsLimit, runBudgetSecondsLimit } from '#modules/agents/model';

export const workflowParams = t.Object({
  projectKey: t.String(),
  workflowId: t.String({ pattern: '^[a-z0-9][a-z0-9-]{0,63}$' }),
});

export const workflowRunParams = t.Object({
  ...workflowParams.properties,
  runId: t.String({ minLength: 1, maxLength: 200 }),
});

export const assignmentBody = t.Object(
  {
    enabled: t.Boolean(),
    capabilityRefs: t.Array(t.String({ pattern: '^[a-z][a-z0-9._-]*\\.v[0-9]+$' }), {
      maxItems: 32,
    }),
    configuration: t.Optional(
      t.Object(
        {
          instructions: t.Optional(t.String({ maxLength: 4000 })),
          retryLimit: t.Optional(t.Integer({ minimum: 0, maximum: 10 })),
          // Read by agent-team only; agentTeamConfiguration in the service holds the
          // defaults.
          autonomy: t.Optional(t.Union([t.Literal('review'), t.Literal('done')])),
          reviewRequired: t.Optional(t.Boolean()),
          maxTurns: t.Optional(t.Nullable(t.Integer(maxTurnsLimit))),
          runBudgetSeconds: t.Optional(t.Nullable(t.Integer(runBudgetSecondsLimit))),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const runQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 0, maximum: 10000 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
});

export const ControlPlaneResponse = t.Unknown();

export const startAgentTeamBody = t.Object(
  {
    idempotencyKey: t.Optional(
      t.String({
        format: 'uuid',
        description: 'Starts nothing new when a run with this key exists already.',
      }),
    ),
  },
  { additionalProperties: false },
);

export const AgentTeamStartResponse = t.Object({
  runId: t.String(),
  status: t.String(),
  taskRef: t.String(),
});

// The agent run Helena queued for one stage of an agent-team run (AgentTeamStage).
export const AgentTeamStageResponse = t.Object({
  phase: t.Union([t.Literal('coordinate'), t.Literal('specialize'), t.Literal('review')]),
  assignmentId: t.Nullable(t.String()),
  agentRunId: t.Number(),
  agent: t.Object({ id: t.Number(), username: t.String(), name: t.String() }),
  status: t.String(),
  startedAt: t.Nullable(t.String()),
  finishedAt: t.Nullable(t.String()),
  durationMs: t.Nullable(t.Number()),
  inputTokens: t.Nullable(t.Number()),
  outputTokens: t.Nullable(t.Number()),
});

// One agent-team run of an issue: where each of its steps is, the agent run of each
// stage, and once it finished the result (summary, evidence, stage history, the state it
// set on the task) or the error it failed with.
export const AgentTeamRunResponse = t.Object({
  runId: t.String(),
  status: t.String(),
  createdAt: t.Nullable(t.String()),
  updatedAt: t.Nullable(t.String()),
  steps: t.Array(t.Object({ id: t.String(), status: t.String() })),
  stages: t.Array(AgentTeamStageResponse),
  result: t.Any(),
  error: t.Nullable(t.String()),
});
