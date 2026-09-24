import { sql } from 'drizzle-orm';
import {
  check,
  boolean,
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
import { project, projectActionRun, team } from './app';

// The settings of a built-in workflow in one project (Settings → Workflows). Today that is
// the agent team, which the Helena engine starts for a task delegated to a coordinator.
export interface ProjectWorkflowConfiguration {
  instructions?: string;
  retryLimit?: number;
  // Read by the agent-team workflow only.
  autonomy?: 'review' | 'done';
  reviewRequired?: boolean;
  maxTurns?: number | null;
  runBudgetSeconds?: number | null;
}

export const projectWorkflowAssignment = pgTable(
  'project_workflow_assignment',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    configuration: jsonb('configuration')
      .$type<ProjectWorkflowConfiguration>()
      .notNull()
      .default({}),
    capabilityRefs: jsonb('capability_refs').$type<string[]>().notNull().default([]),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.workflowId] }),
    check(
      'project_workflow_assignment_id_check',
      sql`${t.workflowId} ~ '^[a-z0-9][a-z0-9-]{0,63}$'`,
    ),
    index('project_workflow_assignment_project_idx').on(t.projectId, t.enabled, t.workflowId),
  ],
);

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
