import { t } from 'elysia';
import { pageQueryFields, pageResponse } from '#shared/pagination';

export const ActionCategorySchema = t.Union(
  [
    t.Literal('read'),
    t.Literal('report'),
    t.Literal('write'),
    t.Literal('send'),
    t.Literal('delete'),
    t.Literal('pay'),
    t.Literal('publish'),
    t.Literal('execute'),
    t.Literal('credentials'),
  ],
  { description: 'The kind of action (docs/helena-decisions/policy-engine.md).' },
);

export const ActionScopeSchema = t.Union([t.Literal('workspace'), t.Literal('external')]);

const Outcome = t.Union([t.Literal('allow'), t.Literal('needs-approval'), t.Literal('deny')]);

const Reason = t.Union([
  t.Literal('always-allowed'),
  t.Literal('level-allows'),
  t.Literal('approved'),
  t.Literal('level-requires-approval'),
  t.Literal('hard-block'),
  t.Literal('budget-exhausted'),
  t.Literal('policy'),
]);

const LevelSource = t.Union([
  t.Literal('project'),
  t.Literal('agent'),
  t.Literal('agent-raised'),
  t.Literal('default'),
]);

export const autopilotLevel = t.Integer({ minimum: 0, maximum: 3 });

const Metric = t.Union([t.Literal('tokens'), t.Literal('cost'), t.Literal('time')]);
const Period = t.Union([t.Literal('day'), t.Literal('month')]);

export const LevelRuleSchema = t.Object({
  category: ActionCategorySchema,
  scope: t.Nullable(ActionScopeSchema),
  outcome: Outcome,
  reason: Reason,
});

export const LevelRulesSchema = t.Array(
  t.Object({ level: autopilotLevel, key: t.String(), rules: t.Array(LevelRuleSchema) }),
  { description: 'What each level allows, category by category, as the policy engine decides.' },
);

export const BudgetStatusSchema = t.Object({
  id: t.Number(),
  scope: t.Union([t.Literal('agent'), t.Literal('project')]),
  agentId: t.Nullable(t.Number()),
  projectId: t.Nullable(t.Number()),
  metric: Metric,
  period: Period,
  limit: t.Number(),
  used: t.Number(),
  remaining: t.Number(),
  ratio: t.Number(),
  periodStart: t.String(),
  warned: t.Boolean(),
  reached: t.Boolean(),
  graceRuns: t.Number(),
  unpricedTokens: t.Number(),
});

export const EffectiveLevelSchema = t.Object({ level: autopilotLevel, source: LevelSource });

export const ProjectAutopilotResponse = t.Object({
  level: autopilotLevel,
  levels: LevelRulesSchema,
  budgets: t.Array(BudgetStatusSchema),
  agents: t.Array(
    t.Object({
      id: t.Number(),
      name: t.String(),
      username: t.String(),
      agentLevel: t.Nullable(autopilotLevel),
      raise: t.Boolean(),
      effective: EffectiveLevelSchema,
      paused: t.Boolean(),
    }),
  ),
});

export const setLevelBody = t.Object({ level: autopilotLevel });

export const budgetsBody = t.Object({
  budgets: t.Array(
    t.Object({
      metric: Metric,
      period: Period,
      limit: t.Nullable(
        t.Number({
          exclusiveMinimum: 0,
          maximum: 1e15,
          description: 'Tokens, euros or seconds. Null removes the budget.',
        }),
      ),
    }),
    { maxItems: 6 },
  ),
});

export const UsageSchema = t.Object({
  tokens: t.Number(),
  cost: t.Number(),
  unpricedTokens: t.Number(),
  seconds: t.Number(),
});

export const AgentAutopilotResponse = t.Object({
  agentLevel: t.Nullable(autopilotLevel),
  raise: t.Boolean(),
  paused: t.Boolean(),
  pauseReason: t.Nullable(t.String()),
  projects: t.Array(
    t.Object({
      id: t.Number(),
      key: t.String(),
      name: t.String(),
      projectLevel: autopilotLevel,
      effective: EffectiveLevelSchema,
      budgets: t.Array(BudgetStatusSchema),
    }),
  ),
  budgets: t.Array(BudgetStatusSchema),
  usage: t.Object({ today: UsageSchema, month: UsageSchema }),
  levels: LevelRulesSchema,
});

export const setAgentLevelBody = t.Object({
  level: t.Nullable(autopilotLevel),
  raise: t.Optional(
    t.Boolean({
      description:
        "Let the agent's own level exceed its project's. Only the team's owner may allow it.",
    }),
  ),
});

export const DecisionLogItem = t.Object({
  id: t.Number(),
  agentId: t.Nullable(t.Number()),
  agentName: t.Nullable(t.String()),
  runId: t.Nullable(t.Number()),
  chatMessageId: t.Nullable(t.Number()),
  adapter: t.String(),
  tool: t.Nullable(t.String()),
  category: ActionCategorySchema,
  scope: t.Nullable(ActionScopeSchema),
  outcome: Outcome,
  level: autopilotLevel,
  levelSource: LevelSource,
  reason: Reason,
  summary: t.Nullable(t.String()),
  createdAt: t.String(),
});

export const DecisionPageResponse = pageResponse(DecisionLogItem);

export const decisionsQuery = t.Object({
  outcome: t.Optional(Outcome),
  ...pageQueryFields,
});

export const decideBody = t.Object({
  runId: t.Optional(t.Integer({ description: 'The run the tool call belongs to.' })),
  messageId: t.Optional(t.Integer({ description: 'The chat answer the tool call belongs to.' })),
  projectKey: t.Optional(t.String({ description: 'The project, when neither names one.' })),
  runtime: t.String({
    minLength: 1,
    maxLength: 32,
    description: 'hermes, claude, codex, gateway…',
  }),
  tool: t.String({ minLength: 1, maxLength: 200 }),
  command: t.Optional(t.String({ maxLength: 32000, description: 'The shell command or code.' })),
  path: t.Optional(t.String({ maxLength: 4096, description: 'The file a file tool writes.' })),
  mcp: t.Optional(
    t.Object({
      server: t.String({ minLength: 1, maxLength: 128 }),
      annotations: t.Optional(
        t.Nullable(
          t.Object({
            readOnlyHint: t.Optional(t.Boolean()),
            destructiveHint: t.Optional(t.Boolean()),
            idempotentHint: t.Optional(t.Boolean()),
            openWorldHint: t.Optional(t.Boolean()),
          }),
        ),
      ),
    }),
  ),
  dangerous: t.Optional(t.Boolean({ description: "The runtime's own verdict on a command." })),
  workspace: t.Optional(t.String({ maxLength: 4096, description: 'The working directory.' })),
  intent: t.Optional(ActionCategorySchema),
  summary: t.Optional(t.String({ maxLength: 500 })),
});

export const DecideResponse = t.Object({
  outcome: Outcome,
  category: ActionCategorySchema,
  scope: ActionScopeSchema,
  level: autopilotLevel,
  levelSource: LevelSource,
  reason: Reason,
  policyIds: t.Array(t.String()),
  detail: t.Optional(t.String()),
  decisionId: t.Nullable(t.Number()),
  message: t.String({ description: 'What the agent reads when the action is not allowed.' }),
});

export const budgetDecisionBody = t.Object({
  action: t.Union([t.Literal('raise'), t.Literal('once'), t.Literal('keep')], {
    description:
      'raise: set a new limit (above what is used); once: let one more run start past the ' +
      'limit in this period; keep: leave the work stopped.',
  }),
  limit: t.Optional(t.Number({ exclusiveMinimum: 0, maximum: 1e15 })),
  note: t.Optional(t.String({ maxLength: 2000 })),
});
