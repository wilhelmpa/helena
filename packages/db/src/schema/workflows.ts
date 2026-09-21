import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { projectActionRun, team } from './app';

export const projectTemplate = pgTable(
  'project_template',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    definition: jsonb('definition').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('project_template_kind_check', sql`${t.kind} IN ('project', 'board')`),
    unique('project_template_team_kind_name_uq').on(t.teamId, t.kind, t.name),
    index('project_template_team_idx').on(t.teamId, t.kind, t.name),
  ],
);

export const projectActionRunStep = pgTable(
  'project_action_run_step',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => projectActionRun.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    nodeType: text('node_type').notNull(),
    status: text('status').notNull().default('pending'),
    result: jsonb('result'),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.nodeId] }),
    check(
      'project_action_run_step_type_check',
      sql`${t.nodeType} IN ('trigger', 'condition', 'action')`,
    ),
    check(
      'project_action_run_step_status_check',
      sql`${t.status} IN ('pending', 'running', 'succeeded', 'skipped', 'failed')`,
    ),
    index('project_action_run_step_run_idx').on(t.runId, t.updatedAt),
  ],
);
