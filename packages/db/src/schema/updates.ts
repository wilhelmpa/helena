// The update center (docs/helena-decisions/update-center.md): every component Helena runs on
// with its installed and newest version as its update source read them, the summary a small
// model wrote of what a new version changes, and each update the owner applied. The version
// facts come from the sources (@helena/sdk updates.ts), never from a model.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { LocalizedText } from '@helena/sdk';
import { agentRun } from './app';
import { user } from './auth';

export const helenaUpdate = pgTable(
  'helena_update',
  {
    id: serial('id').primaryKey(),
    // The update source (registry id) and its component: `cli-runtimes` / `claude`.
    source: text('source').notNull(),
    component: text('component').notNull(),
    name: text('name').notNull(),
    // runtime | system | tool | app, the source's kind.
    kind: text('kind').notNull(),
    installed: text('installed'),
    available: text('available'),
    updateAvailable: boolean('update_available').notNull().default(false),
    security: boolean('security').notNull().default(false),
    sourceUrl: text('source_url'),
    notesUrl: text('notes_url'),
    // Components of one group (the Debian packages) share one summary.
    groupKey: text('group_key'),
    applicable: boolean('applicable').notNull().default(false),
    hint: jsonb('hint').$type<LocalizedText | null>(),
    detail: text('detail'),
    error: text('error'),
    // What the source needs back when applying.
    data: jsonb('data').$type<Record<string, unknown> | null>(),
    // The summary of what `summaryFor` brings: German text, the risk (low | medium | high)
    // and whether it breaks something, as the model rated it; the run that wrote it and the
    // model it ran on. A new available version makes it stale (summary_for differs).
    summary: text('summary'),
    highlights: jsonb('highlights').$type<string[]>(),
    risk: text('risk'),
    breaking: boolean('breaking'),
    summaryFor: text('summary_for'),
    summaryRunId: integer('summary_run_id').references(() => agentRun.id, {
      onDelete: 'set null',
    }),
    // What the queued run is about (the key `summary_for` gets once its answer is stored);
    // null once the run's outcome was read.
    summaryRunFor: text('summary_run_for'),
    summaryModel: text('summary_model'),
    summaryError: text('summary_error'),
    summarizedAt: timestamp('summarized_at', { withTimezone: true }),
    // When the newest version was first seen, and when the component was last checked. A
    // component a source no longer reports is removed at the next complete check.
    availableSince: timestamp('available_since', { withTimezone: true }),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('helena_update_component_uq').on(t.source, t.component),
    check(
      'helena_update_risk_check',
      sql`${t.risk} IS NULL OR ${t.risk} IN ('low', 'medium', 'high')`,
    ),
    check('helena_update_kind_check', sql`${t.kind} IN ('runtime', 'system', 'tool', 'app')`),
  ],
);

// One update the owner started: what, from which version to which, how it went, the log of
// the helper that did it, the database dump taken before, and the health afterwards.
export const helenaUpdateAction = pgTable(
  'helena_update_action',
  {
    id: serial('id').primaryKey(),
    source: text('source').notNull(),
    component: text('component').notNull(),
    name: text('name').notNull(),
    // Every component the update covers (all packages of a Debian security run).
    components: jsonb('components').$type<string[]>().notNull().default([]),
    fromVersion: text('from_version'),
    toVersion: text('to_version'),
    // running -> done | failed
    state: text('state').notNull().default('running'),
    // The source's handle on the work (the helper's request id, the Hermes proposal).
    ref: text('ref'),
    backupPath: text('backup_path'),
    log: text('log'),
    error: text('error'),
    result: jsonb('result').$type<Record<string, unknown> | null>(),
    // The services' state right after the update finished.
    health: jsonb('health').$type<Record<string, unknown> | null>(),
    requestedByUserId: text('requested_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check('helena_update_action_state_check', sql`${t.state} IN ('running', 'done', 'failed')`),
    index('helena_update_action_requested_idx').on(t.requestedAt),
    // One running update per component at a time.
    uniqueIndex('helena_update_action_running_uq')
      .on(t.source, t.component)
      .where(sql`${t.state} = 'running'`),
  ],
);

// The engine's instance-level jobs (engine/system-jobs.ts): up to which scheduled time each
// is handled, the schedule that was in force then, and how its last run went.
export const helenaSystemJob = pgTable('helena_system_job', {
  id: text('id').primaryKey(),
  // The scheduled times up to here are handled; set to the moment a job is first seen or
  // gets another schedule, so it starts afresh then.
  firedThrough: timestamp('fired_through', { withTimezone: true }).notNull().defaultNow(),
  // `<cron>|<time zone>` the times were computed with.
  scheduleKey: text('schedule_key').notNull().default(''),
  lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
  lastFinishedAt: timestamp('last_finished_at', { withTimezone: true }),
  // running | succeeded | failed
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  lastWorkflowId: text('last_workflow_id'),
  lastTrigger: text('last_trigger'),
});
