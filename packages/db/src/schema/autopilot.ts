import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { agentChatMessage, agentRun, aiAgent, approvalRequest, project, team } from './app';

// Helena's Autopilot (docs/helena-decisions/policy-engine.md): the price table the cost of
// a model call is estimated from, the budgets that stop agents, and the log of every
// decision the policy engine made. The Autopilot level itself is a column of project and
// ai_agent.

// What a model costs, in euros per million tokens, for estimating what agents spend. Rows
// come from models.dev (converted from dollars with the owner's rate) unless the owner
// entered them by hand, which an import never overwrites. `model` is the id a runtime
// reports, lower-cased.
export const helenaModelPrice = pgTable(
  'helena_model_price',
  {
    model: text('model').primaryKey(),
    provider: text('provider'),
    inputEurPerM: numeric('input_eur_per_m', { precision: 14, scale: 6, mode: 'number' }).notNull(),
    outputEurPerM: numeric('output_eur_per_m', {
      precision: 14,
      scale: 6,
      mode: 'number',
    }).notNull(),
    cacheReadEurPerM: numeric('cache_read_eur_per_m', { precision: 14, scale: 6, mode: 'number' }),
    cacheWriteEurPerM: numeric('cache_write_eur_per_m', {
      precision: 14,
      scale: 6,
      mode: 'number',
    }),
    // 'models.dev' or 'manual'.
    source: text('source').notNull(),
    // The dollar prices the row was converted from, for an imported row.
    sourceUsd: jsonb('source_usd'),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('helena_model_price_source_check', sql`${t.source} IN ('models.dev', 'manual')`),
    check(
      'helena_model_price_positive_check',
      sql`${t.inputEurPerM} >= 0 AND ${t.outputEurPerM} >= 0
        AND coalesce(${t.cacheReadEurPerM}, 0) >= 0 AND coalesce(${t.cacheWriteEurPerM}, 0) >= 0`,
    ),
  ],
);

// A budget of one agent or one project: tokens, euros (estimated from the price table) or
// seconds of work, per UTC day or month. At 80 % the owner is told once per period; at
// 100 % the agent (or the project's work) stops and the owner gets a card in Freigaben to
// raise the budget or let the work continue once.
export const helenaBudget = pgTable(
  'helena_budget',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    // 'tokens', 'cost' (euros) or 'time' (seconds).
    metric: text('metric').notNull(),
    // 'day' or 'month', in UTC.
    period: text('period').notNull(),
    limitValue: numeric('limit_value', { precision: 18, scale: 4, mode: 'number' }).notNull(),
    // The start of the period whose 80 % warning went out, and of the period in which the
    // limit was reached (its card filed), so each is sent once per period.
    warnedFor: timestamp('warned_for', { withTimezone: true }),
    reachedFor: timestamp('reached_for', { withTimezone: true }),
    // "Einmalig fortsetzen": this many more runs may start past the limit in the period
    // that starts at grace_for.
    graceFor: timestamp('grace_for', { withTimezone: true }),
    graceRuns: integer('grace_runs').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('helena_budget_target_check', sql`(${t.agentId} IS NULL) <> (${t.projectId} IS NULL)`),
    check('helena_budget_metric_check', sql`${t.metric} IN ('tokens', 'cost', 'time')`),
    check('helena_budget_period_check', sql`${t.period} IN ('day', 'month')`),
    check('helena_budget_limit_check', sql`${t.limitValue} > 0`),
    uniqueIndex('helena_budget_agent_uq')
      .on(t.agentId, t.metric, t.period)
      .where(sql`${t.agentId} IS NOT NULL`),
    uniqueIndex('helena_budget_project_uq')
      .on(t.projectId, t.metric, t.period)
      .where(sql`${t.projectId} IS NOT NULL`),
  ],
);

// Every decision of the policy engine that is not a plain read: who asked (the adapter:
// hermes, claude, codex, mcp, gateway, workflow, approval, budget), for which agent,
// project and run, what category the action had, which Autopilot level applied and where
// it came from, the outcome and why. `reported_at` is set once the run report of a level-2
// agent listed an action it took without approval.
export const helenaPolicyDecision = pgTable(
  'helena_policy_decision',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    teamId: integer('team_id').references(() => team.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'cascade' }),
    runId: integer('run_id').references(() => agentRun.id, { onDelete: 'set null' }),
    chatMessageId: integer('chat_message_id').references(() => agentChatMessage.id, {
      onDelete: 'set null',
    }),
    adapter: text('adapter').notNull(),
    tool: text('tool'),
    category: text('category').notNull(),
    scope: text('scope'),
    outcome: text('outcome').notNull(),
    level: smallint('level').notNull(),
    levelSource: text('level_source').notNull(),
    reason: text('reason').notNull(),
    policyIds: jsonb('policy_ids').$type<string[]>().notNull().default([]),
    // What was attempted, in one line.
    summary: text('summary'),
    approvalId: integer('approval_id').references(() => approvalRequest.id, {
      onDelete: 'set null',
    }),
    reportedAt: timestamp('reported_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'helena_policy_decision_outcome_check',
      sql`${t.outcome} IN ('allow', 'needs-approval', 'deny')`,
    ),
    index('helena_policy_decision_project_idx').on(t.projectId, t.id.desc()),
    index('helena_policy_decision_agent_idx').on(t.agentId, t.id.desc()),
    index('helena_policy_decision_run_idx').on(t.runId),
    index('helena_policy_decision_created_idx').on(t.createdAt),
  ],
);
