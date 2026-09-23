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

export const workflowScheduleParams = t.Object({
  ...workflowParams.properties,
  scheduleId: t.String({ minLength: 1, maxLength: 200 }),
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

export const startWorkflowBody = t.Object(
  {
    idempotencyKey: t.String({ format: 'uuid' }),
    correlationId: t.Optional(t.String({ maxLength: 200 })),
    dryRun: t.Boolean({ default: true }),
    payload: t.Record(t.String(), t.Unknown()),
  },
  { additionalProperties: false },
);

export const approvalBody = t.Object(
  {
    approved: t.Boolean(),
    note: t.Optional(t.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);

export const scheduleBody = t.Object(
  {
    cron: t.String({ minLength: 5, maxLength: 120 }),
    timezone: t.Optional(
      t.String({
        minLength: 1,
        maxLength: 80,
        description: 'IANA time zone. Default Europe/Berlin.',
      }),
    ),
    payload: t.Record(t.String(), t.Unknown()),
  },
  { additionalProperties: false },
);

export const scheduleUpdateBody = t.Object(
  {
    cron: t.String({ minLength: 5, maxLength: 120 }),
    timezone: t.Optional(
      t.String({ minLength: 1, maxLength: 80, description: 'IANA time zone. Kept when left out.' }),
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

// One agent-team run of an issue as Mastra stores it: the status of each step in
// execution order, and once it finished the workflow output (summary, evidence, stage
// history, the Plan state it set) or the error it failed with.
export const AgentTeamRunResponse = t.Object({
  runId: t.String(),
  status: t.String(),
  createdAt: t.Nullable(t.String()),
  updatedAt: t.Nullable(t.String()),
  steps: t.Array(t.Object({ id: t.String(), status: t.String() })),
  result: t.Any(),
  error: t.Nullable(t.String()),
});
