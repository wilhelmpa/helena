import { t } from 'elysia';

export const developmentTaskBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 64, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
  body: t.String({ minLength: 1, maxLength: 32000 }),
  model: t.Union(
    ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol'].map((value) =>
      t.Literal(value),
    ),
  ),
  effort: t.Union(
    ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map((value) => t.Literal(value)),
  ),
});
export const developmentNumberParams = t.Object({
  number: t.Numeric({ minimum: 1, maximum: 999999999, multipleOf: 1 }),
});
export const DevelopmentTaskResponse = t.Object({ number: t.Number(), file: t.String() });
export const DevelopmentReportResponse = t.Object({ number: t.Number(), content: t.String() });
export const DevelopmentStatusResponse = t.Object({
  queue: t.Array(t.String()),
  log: t.String(),
  running: t.Array(t.Object({ pid: t.Number(), number: t.Number() })),
});
export const DevelopmentReleaseResponse = t.Object({
  liveSha: t.Nullable(t.String()),
  gates: t.Array(
    t.Object({
      file: t.String(),
      summary: t.Array(t.String()),
      available: t.Boolean(),
      modifiedAt: t.Nullable(t.String()),
    }),
  ),
});

const operationFields = {
  branch: t.String({ pattern: '^hub/[a-z0-9][a-z0-9-]{0,63}$' }),
  expected: t.String({
    pattern: '^[a-f0-9]{40}$',
    description: 'Full commit SHA for every stage.',
  }),
  dryRun: t.Boolean({
    default: true,
    description: 'Plan only; dry runs never authorize a real release.',
  }),
};
const branch = operationFields.branch;
export const developmentOperationBody = t.Union([
  t.Object({
    ...operationFields,
    operation: t.Literal('worktree'),
    target: branch,
    name: developmentTaskBody.properties.name,
  }),
  t.Object({ ...operationFields, operation: t.Literal('merge'), target: branch }),
  t.Object({
    ...operationFields,
    operation: t.Literal('review'),
    evidence: t.String({
      minLength: 1,
      maxLength: 4096,
      description: 'Reviewer, changed tests, diff against assignment, checks run and findings.',
    }),
  }),
  t.Object({
    ...operationFields,
    operation: t.Literal('tests'),
    testFiles: t.Array(t.String({ maxLength: 512 }), { minItems: 1, maxItems: 20 }),
  }),
  t.Object({ ...operationFields, operation: t.Literal('gate') }),
  t.Object({ ...operationFields, operation: t.Literal('probe') }),
  t.Object({ ...operationFields, operation: t.Literal('verify') }),
  t.Object({
    ...operationFields,
    operation: t.Literal('build'),
    pauseHalogen: t.Optional(t.Boolean({ default: false })),
  }),
  t.Object({
    ...operationFields,
    operation: t.Literal('deploy'),
    pauseHalogen: t.Optional(t.Boolean({ default: false })),
  }),
]);
export const developmentJobParams = t.Object({ id: t.String({ pattern: '^[a-f0-9]{32}$' }) });
export const DevelopmentJobResponse = t.Object({
  id: t.String(),
  operation: t.String(),
  branch: t.String(),
  expected: t.String(),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('running'),
    t.Literal('success'),
    t.Literal('failed'),
    t.Literal('revoked'),
    t.Literal('conflicts'),
    t.Literal('dry-run'),
  ]),
  steps: t.Array(t.String()),
  output: t.String(),
  exitCode: t.Nullable(t.Number()),
  createdAt: t.String(),
  finishedAt: t.Nullable(t.String()),
});
export const developmentQueueBody = t.Object({
  action: t.Union([t.Literal('stop'), t.Literal('requeue')]),
});
export const DevelopmentQueueResponse = t.Object({ number: t.Number(), action: t.String() });
export const developmentMaxBody = t.Object({ maximum: t.Integer({ minimum: 1, maximum: 5 }) });
export const DevelopmentMaxResponse = developmentMaxBody;
export const developmentProjectBody = t.Object({
  runtime: t.Union([t.Literal('claude'), t.Literal('codex')]),
  dryRun: t.Boolean({ default: true }),
});
export const DevelopmentProjectResponse = t.Object({
  projectId: t.Number(),
  name: t.String(),
  runtime: t.String(),
  model: t.String(),
  coordinatorId: t.Number(),
  specialists: t.Array(t.String()),
  document: t.String(),
  handoff: t.String(),
  dryRun: t.Boolean(),
});
