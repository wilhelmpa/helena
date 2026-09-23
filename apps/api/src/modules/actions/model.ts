import { t } from 'elysia';

const FilterValueSchema = t.Union([
  t.String({ maxLength: 500 }),
  t.Number(),
  t.Boolean(),
  t.Null(),
]);
const FilterOperatorSchema = t.Union([
  t.Literal('is'),
  t.Literal('is_not'),
  t.Literal('before'),
  t.Literal('after'),
  t.Literal('is_set'),
  t.Literal('is_not_set'),
  t.Literal('contains'),
  t.Literal('not_contains'),
]);

export const ActionConditionSchema = t.Object(
  {
    conditions: t.Array(
      t.Object(
        {
          id: t.String({ minLength: 1, maxLength: 100 }),
          field: t.String({
            maxLength: 64,
            pattern:
              '^(status|statusType|assignee|delegate|priority|type|initiative|cycle|area|labels|dueDate|startDate|created|updated|cf:[0-9]+)$',
          }),
          op: FilterOperatorSchema,
          values: t.Array(FilterValueSchema, { maxItems: 50 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 25 },
    ),
  },
  { additionalProperties: false },
);

export const ActionEffectSchema = t.Object(
  {
    columnId: t.Optional(t.Integer({ minimum: 1 })),
    assigneeUserId: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
    priority: t.Optional(
      t.Nullable(
        t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high'), t.Literal('urgent')]),
      ),
    ),
    typeId: t.Optional(t.Nullable(t.Integer({ minimum: 1 }))),
    startDate: t.Optional(t.Nullable(t.String({ maxLength: 32 }))),
    dueDate: t.Optional(t.Nullable(t.String({ maxLength: 32 }))),
    labelIds: t.Optional(t.Array(t.Integer({ minimum: 1 }), { maxItems: 50 })),
  },
  { additionalProperties: false },
);

export const ActionTriggerSchema = t.Union([
  t.Literal('manual'),
  t.Literal('issue_state_changed'),
  t.Literal('issue_comment_added'),
]);

const WorkflowPositionSchema = t.Object(
  {
    x: t.Number({ minimum: -10000, maximum: 10000 }),
    y: t.Number({ minimum: -10000, maximum: 10000 }),
  },
  { additionalProperties: false },
);
const WorkflowNodeSchema = t.Union([
  t.Object(
    {
      id: t.String({ minLength: 1, maxLength: 64 }),
      type: t.Literal('trigger'),
      config: t.Object({ trigger: ActionTriggerSchema }, { additionalProperties: false }),
      position: WorkflowPositionSchema,
    },
    { additionalProperties: false },
  ),
  t.Object(
    {
      id: t.String({ minLength: 1, maxLength: 64 }),
      type: t.Literal('condition'),
      config: ActionConditionSchema,
      position: WorkflowPositionSchema,
    },
    { additionalProperties: false },
  ),
  t.Object(
    {
      id: t.String({ minLength: 1, maxLength: 64 }),
      type: t.Literal('action'),
      config: ActionEffectSchema,
      position: WorkflowPositionSchema,
    },
    { additionalProperties: false },
  ),
]);

export const WorkflowDefinitionSchema = t.Object(
  {
    version: t.Literal(1),
    nodes: t.Array(WorkflowNodeSchema, { minItems: 2, maxItems: 24 }),
    edges: t.Array(
      t.Object(
        {
          id: t.String({ minLength: 1, maxLength: 64 }),
          source: t.String({ minLength: 1, maxLength: 64 }),
          target: t.String({ minLength: 1, maxLength: 64 }),
          branch: t.Union([t.Literal('always'), t.Literal('true'), t.Literal('false')]),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 48 },
    ),
  },
  { additionalProperties: false },
);

export const ActionResponse = t.Object({
  id: t.Number(),
  projectId: t.Number(),
  name: t.String(),
  icon: t.String(),
  enabled: t.Boolean(),
  trigger: ActionTriggerSchema,
  condition: t.Any(),
  effect: t.Any(),
  workflow: WorkflowDefinitionSchema,
  position: t.Number(),
  createdAt: t.String(),
});

export const ActionListResponse = t.Array(ActionResponse);

export const actionParams = t.Object({ actionId: t.Numeric() });

export const createActionBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  icon: t.Optional(t.String({ maxLength: 100 })),
  enabled: t.Optional(t.Boolean()),
  trigger: t.Optional(ActionTriggerSchema),
  condition: t.Optional(ActionConditionSchema),
  effect: t.Optional(ActionEffectSchema),
  workflow: t.Optional(WorkflowDefinitionSchema),
});

export const updateActionBody = t.Partial(createActionBody);

export const reorderActionsBody = t.Object({
  orderedIds: t.Array(t.Integer({ minimum: 1 }), { minItems: 1, maxItems: 500 }),
});

export const runActionBody = t.Object({ issueId: t.Integer() });
export const previewActionBody = t.Object({
  issueId: t.Integer(),
  workflow: t.Optional(WorkflowDefinitionSchema),
});

export const ActionRunStepResponse = t.Object({
  nodeId: t.String(),
  nodeType: t.Union([t.Literal('trigger'), t.Literal('condition'), t.Literal('action')]),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('running'),
    t.Literal('succeeded'),
    t.Literal('skipped'),
    t.Literal('failed'),
  ]),
  result: t.Nullable(t.Any()),
  lastError: t.Nullable(t.String()),
  startedAt: t.Nullable(t.String()),
  finishedAt: t.Nullable(t.String()),
});

export const ActionRunResponse = t.Object({
  id: t.String(),
  actionId: t.Nullable(t.Number()),
  projectId: t.Number(),
  issueId: t.Nullable(t.Number()),
  issueIdentifier: t.Nullable(t.String()),
  actorUserId: t.Nullable(t.String()),
  actorName: t.Nullable(t.String()),
  actionName: t.String(),
  trigger: ActionTriggerSchema,
  fromColumnId: t.Number(),
  fromColumnName: t.Nullable(t.String()),
  toColumnId: t.Number(),
  toColumnName: t.Nullable(t.String()),
  depth: t.Number(),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('running'),
    t.Literal('succeeded'),
    t.Literal('skipped'),
    t.Literal('failed'),
  ]),
  attempts: t.Number(),
  lastError: t.Nullable(t.String()),
  result: t.Nullable(t.Object({ changedFields: t.Array(t.String()) })),
  startedAt: t.Nullable(t.String()),
  finishedAt: t.Nullable(t.String()),
  createdAt: t.String(),
  steps: t.Optional(t.Array(ActionRunStepResponse)),
});

export const ActionPreviewResponse = t.Object({
  matched: t.Boolean(),
  path: t.Array(
    t.Object({
      nodeId: t.String(),
      type: t.Union([t.Literal('trigger'), t.Literal('condition'), t.Literal('action')]),
      outcome: t.String(),
    }),
  ),
  effects: t.Array(ActionEffectSchema),
});

export const ActionRunListResponse = t.Array(ActionRunResponse);
