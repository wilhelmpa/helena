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
import { aiAgent, issue, project, projectActionRun, team } from './app';

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

// The start of the agent-team workflow for an issue delegated to a coordinator. The row
// is written before the control plane is asked, so a start that Mastra did not answer is
// asked for again with the same event id, which is the run id of the start in Mastra.
// pending -> started | refused | superseded. A refused start queues a run of the
// coordinator instead; a superseded one was dropped because the issue no longer waits
// for it.
export const agentTeamStart = pgTable(
  'agent_team_start',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    issueId: integer('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    // The coordinator the issue was delegated to.
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    eventId: text('event_id').notNull().unique(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'agent_team_start_status_check',
      sql`${t.status} IN ('pending', 'started', 'refused', 'superseded')`,
    ),
    index('agent_team_start_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    index('agent_team_start_issue_idx').on(t.issueId, t.id),
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
