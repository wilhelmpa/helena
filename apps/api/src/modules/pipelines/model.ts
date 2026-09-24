import { t } from 'elysia';
import { pageQueryFields, pageResponse } from '#shared/pagination';

// The definition is checked by validateDefinition (definition.ts), which names every
// problem with the step and field it belongs to; a schema here would reject a draft
// with one generic message instead.
const Definition = t.Any({
  description:
    'Workflow definition: { schemaVersion: 1, trigger, roles, steps }. See the Workflow builder in docs/volition.',
});

export const teamParams = t.Object({ teamId: t.Numeric() });
export const pipelineParams = t.Object({ pipelineId: t.Numeric() });
export const pipelineVersionParams = t.Object({
  pipelineId: t.Numeric(),
  version: t.Numeric({ minimum: 1 }),
});
export const projectPipelineParams = t.Object({ projectKey: t.String(), pipelineId: t.Numeric() });
export const pipelineRunParams = t.Object({
  runId: t.String({ pattern: '^[A-Za-z0-9_-]{1,200}$' }),
});
export const issueParams = t.Object({ issueId: t.Numeric() });

const pipelineFields = {
  name: t.String({ minLength: 1, maxLength: 120 }),
  description: t.Optional(t.String({ maxLength: 2_000 })),
  definition: Definition,
};

export const createPipelineBody = t.Object(pipelineFields, { additionalProperties: false });

export const updatePipelineBody = t.Object(
  {
    ...t.Partial(t.Object(pipelineFields)).properties,
    // The version the editor started from. A save on top of a newer one is refused, so
    // two editors do not overwrite each other.
    baseVersion: t.Optional(t.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const validateBody = t.Object(
  {
    definition: Definition,
    // A template names roles only; a project workflow may name agents and members.
    template: t.Boolean(),
    // The agents of the roles in the project, as the project's settings name them.
    roles: t.Optional(t.Record(t.String(), t.Integer({ minimum: 1 }))),
  },
  { additionalProperties: false },
);

export const projectPipelineBody = t.Object(
  {
    enabled: t.Boolean(),
    // Role key → agent id. A role left out is filled by its own rule.
    roles: t.Record(t.String({ pattern: '^[a-z][a-z0-9-]{0,31}$' }), t.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const startRunBody = t.Object(
  {
    pipelineId: t.Integer({ minimum: 1 }),
    // A test run: agent steps are simulated, conditions evaluated, and nothing is
    // queued or changed.
    dryRun: t.Optional(t.Boolean()),
  },
  { additionalProperties: false },
);

export const decisionBody = t.Object(
  {
    approved: t.Boolean(),
    note: t.Optional(t.String({ maxLength: 2_000 })),
  },
  { additionalProperties: false },
);

export const RunStatus = t.Union([
  t.Literal('pending'),
  t.Literal('running'),
  t.Literal('waiting'),
  t.Literal('succeeded'),
  t.Literal('failed'),
  t.Literal('canceled'),
  t.Literal('rejected'),
  t.Literal('skipped'),
]);

export const runsQuery = t.Object({
  projectKey: t.Optional(t.String()),
  status: t.Optional(RunStatus),
  dryRun: t.Optional(t.BooleanString()),
  ...pageQueryFields,
});

export const DefinitionIssueResponse = t.Object({
  code: t.String(),
  stepId: t.Nullable(t.String()),
  field: t.Nullable(t.String()),
  params: t.Optional(t.Record(t.String(), t.Union([t.String(), t.Number()]))),
  message: t.String(),
});

export const ValidationResponse = t.Object({ issues: t.Array(DefinitionIssueResponse) });

export const PipelineResponse = t.Object({
  id: t.Number(),
  teamId: t.Number(),
  // Null for a template of the Home library.
  projectId: t.Nullable(t.Number()),
  projectKey: t.Nullable(t.String()),
  name: t.String(),
  description: t.String(),
  version: t.Number(),
  definition: t.Any(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const PipelineVersionResponse = t.Object({
  id: t.Number(),
  version: t.Number(),
  createdByName: t.Nullable(t.String()),
  createdAt: t.String(),
});

export const PipelineVersionDetailResponse = t.Object({
  version: t.Number(),
  definition: t.Any(),
  createdAt: t.String(),
});

export const BuiltinTemplateResponse = t.Object({
  key: t.String(),
  name: t.String(),
  description: t.String(),
  definition: t.Any(),
});

const ContextAgentResponse = t.Object({
  id: t.Number(),
  username: t.String(),
  name: t.String(),
  role: t.Nullable(t.String()),
  capabilities: t.Array(t.String()),
});

// What the editor offers in its pickers. A team's library knows its template agents and
// models; a project adds its agents, members, statuses, labels and areas.
export const PipelineContextResponse = t.Object({
  models: t.Array(t.String()),
  templates: t.Array(t.Object({ id: t.Number(), username: t.String(), name: t.String() })),
  agents: t.Array(ContextAgentResponse),
  members: t.Array(t.Object({ id: t.String(), name: t.String() })),
  statuses: t.Array(t.Object({ id: t.Number(), name: t.String(), stateType: t.String() })),
  labels: t.Array(t.Object({ id: t.Number(), name: t.String() })),
  areas: t.Array(t.Object({ id: t.Number(), name: t.String() })),
});

export const ProjectPipelineResponse = t.Object({
  pipeline: PipelineResponse,
  // 'template' for a template of the library, 'project' for the project's own workflow.
  source: t.Union([t.Literal('template'), t.Literal('project')]),
  enabled: t.Boolean(),
  roles: t.Record(t.String(), t.Number()),
  resolvedRoles: t.Array(
    t.Object({
      key: t.String(),
      name: t.String(),
      agent: t.Nullable(ContextAgentResponse),
      source: t.Nullable(t.Union([t.Literal('mapping'), t.Literal('match')])),
    }),
  ),
  // What keeps the workflow from running in the project.
  issues: t.Array(DefinitionIssueResponse),
});

export const PipelineRunStepResponse = t.Object({
  stepId: t.String(),
  parentStepId: t.Nullable(
    t.String({ description: 'The step a part belongs to, e.g. a stage of an agent team.' }),
  ),
  iteration: t.Number(),
  seq: t.Number(),
  kind: t.String(),
  name: t.String(),
  status: t.String(),
  outcome: t.Nullable(t.String()),
  summary: t.Nullable(t.String()),
  attempt: t.Number(),
  agent: t.Nullable(t.Object({ id: t.Number(), username: t.String(), name: t.String() })),
  agentRun: t.Nullable(
    t.Object({
      id: t.Number(),
      status: t.String(),
      inputTokens: t.Nullable(t.Number()),
      outputTokens: t.Nullable(t.Number()),
    }),
  ),
  decidedByName: t.Nullable(t.String()),
  note: t.Nullable(t.String()),
  wakeAt: t.Nullable(t.String()),
  error: t.Nullable(t.String()),
  startedAt: t.String(),
  finishedAt: t.Nullable(t.String()),
});

export const PipelineRunResponse = t.Object({
  id: t.String(),
  kind: t.Union([t.Literal('workflow'), t.Literal('agent_team'), t.Literal('routine')], {
    description: 'A run of a builder workflow, of the agent team of a task, or of a routine.',
  }),
  pipelineId: t.Nullable(t.Number()),
  pipelineName: t.String(),
  version: t.Nullable(t.Number()),
  projectId: t.Number(),
  projectKey: t.String(),
  issueId: t.Nullable(t.Number()),
  issueIdentifier: t.Nullable(t.String()),
  issueTitle: t.Nullable(t.String()),
  scheduleId: t.Nullable(t.String()),
  scheduledFor: t.Nullable(t.String()),
  trigger: t.String(),
  dryRun: t.Boolean(),
  status: RunStatus,
  error: t.Nullable(t.String()),
  result: t.Unknown({ description: 'What the run produced, e.g. the outcome of a routine.' }),
  actorName: t.Nullable(t.String()),
  inputTokens: t.Nullable(t.Number()),
  outputTokens: t.Nullable(t.Number()),
  createdAt: t.String(),
  updatedAt: t.String(),
  finishedAt: t.Nullable(t.String()),
  steps: t.Array(PipelineRunStepResponse),
});

export const PipelineRunPageResponse = pageResponse(PipelineRunResponse);

export const StartablePipelineResponse = t.Object({
  id: t.Number(),
  name: t.String(),
  description: t.String(),
});

// An approval step of a run that waits for a person.
export const PipelineApprovalResponse = t.Object({
  runId: t.String(),
  stepId: t.String(),
  iteration: t.Number(),
  stepName: t.String(),
  message: t.Nullable(t.String()),
  pipelineId: t.Number(),
  pipelineName: t.String(),
  projectKey: t.String(),
  projectName: t.String(),
  issueId: t.Nullable(t.Number()),
  issueIdentifier: t.Nullable(t.String()),
  issueTitle: t.Nullable(t.String()),
  waitingSince: t.String(),
});

// The project's guard against workflows re-triggering each other without end (see
// modules/pipelines/rate-limit.ts): at most maxRuns runs of any workflow may start
// on one task within windowMinutes, a fixed hour.
export const PipelineRunLimitResponse = t.Object({
  maxRuns: t.Number(),
  windowMinutes: t.Number(),
});

export const updatePipelineRunLimitBody = t.Object({
  maxRuns: t.Integer({ minimum: 1, maximum: 1000 }),
});
