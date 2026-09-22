import { t } from 'elysia';

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
    timezone: t.String({ minLength: 1, maxLength: 80 }),
    payload: t.Record(t.String(), t.Unknown()),
  },
  { additionalProperties: false },
);

export const scheduleUpdateBody = t.Object(
  {
    cron: t.String({ minLength: 5, maxLength: 120 }),
    timezone: t.String({ minLength: 1, maxLength: 80 }),
  },
  { additionalProperties: false },
);

export const runQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 0, maximum: 10000 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
});

export const ControlPlaneResponse = t.Unknown();
