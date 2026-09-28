// browser_task (docs/helena-decisions/browser-task.md §3.4–3.5): one row per task the browser
// gateway ran for an agent (browser_task, browser_check, browser_choose) and per run of the test
// area "Browser 2.0". It keeps what the comparison and the owner need: the backend as it was
// configured (never its key), the steps (operation, element label, value key — never a typed
// value), status, time, tokens and cost. The tokens also go into agent_usage (kind 'tool').
//
// `token_hash` is the SHA-256 of the task's one-time token: the gateway's decisions, and a
// jev-browser run's calls to Helena's System One proxy, travel under that token while the task
// runs; it stops working when the task ends or expires.
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { agentChatMessage, agentRun, aiAgent, integrationCredential, project, team } from './app';

export const helenaBrowserTaskRun = pgTable(
  'helena_browser_task_run',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    // Null for Home's own browser.
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    // 'agent': an agent's tool call; 'lab': a run the owner started in Browser 2.0.
    source: text('source').notNull(),
    // 'task' | 'check' | 'choose'.
    kind: text('kind').notNull().default('task'),
    // 'decision' (a decision model through the gateway), 'standard' (the agent itself, step by
    // step: a chat message in Browser 2.0) or 'jev-browser' (the comparison harness).
    backend: text('backend').notNull(),
    credentialId: integer('credential_id').references(() => integrationCredential.id, {
      onDelete: 'set null',
    }),
    // "Jev (TypeSafe)", "Standard (Coder VOL)": what the owner reads.
    backendLabel: text('backend_label').notNull().default(''),
    // 'typesafe' | 'vercel' | 'local' — gen_ai.provider.name of the tokens.
    provider: text('provider'),
    // The loop's policy.
    policy: text('policy'),
    // The model configured, and the one the backend reported (model_check-like provenance).
    modelConfigured: text('model_configured'),
    modelReported: text('model_reported'),
    firstStageScope: jsonb('first_stage_scope').$type<{
      revision: string | null;
      chatRevision: number | null;
      connectionVersion: string;
    }>(),
    goal: text('goal').notNull(),
    mode: text('mode').notNull().default('act'),
    maxSteps: integer('max_steps').notNull().default(20),
    startUrl: text('start_url'),
    // The keys of the values the task was given (never the values).
    valueKeys: jsonb('value_keys').$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('queued'),
    summary: text('summary'),
    steps: jsonb('steps').$type<unknown[]>().notNull().default([]),
    // Final URL/title, candidates, pending action, approval card — what the result shows.
    result: jsonb('result').$type<Record<string, unknown>>(),
    decisions: integer('decisions').notNull().default(0),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    decisionMs: integer('decision_ms').notNull().default(0),
    durationMs: integer('duration_ms'),
    // What the backend itself billed, when it says (Vercel's provider_metadata.gateway.cost).
    providerCostUsd: doublePrecision('provider_cost_usd'),
    runId: integer('run_id').references(() => agentRun.id, { onDelete: 'set null' }),
    chatMessageId: integer('chat_message_id').references(() => agentChatMessage.id, {
      onDelete: 'set null',
    }),
    chatThreadId: text('chat_thread_id'),
    // A small picture of the page at the end (jev-browser's throwaway browser has no live view).
    finalFrame: text('final_frame'),
    tokenHash: text('token_hash'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check('helena_browser_task_run_source_check', sql`${t.source} IN ('agent', 'lab')`),
    check('helena_browser_task_run_kind_check', sql`${t.kind} IN ('task', 'check', 'choose')`),
    check(
      'helena_browser_task_run_backend_check',
      sql`${t.backend} IN ('decision', 'standard', 'jev-browser')`,
    ),
    uniqueIndex('helena_browser_task_run_token_idx').on(t.tokenHash),
    uniqueIndex('helena_browser_first_stage_chat_idx')
      .on(t.chatMessageId)
      .where(sql`${t.firstStageScope} IS NOT NULL AND ${t.chatMessageId} IS NOT NULL`),
    uniqueIndex('helena_browser_first_stage_run_idx')
      .on(t.runId)
      .where(sql`${t.firstStageScope} IS NOT NULL AND ${t.runId} IS NOT NULL`),
    index('helena_browser_task_run_project_idx').on(t.projectId, t.id),
    index('helena_browser_task_run_team_idx').on(t.teamId, t.id),
  ],
);
