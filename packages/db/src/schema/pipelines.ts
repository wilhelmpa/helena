import { sql } from 'drizzle-orm';
import {
  boolean,
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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { aiAgent, issue, project, team } from './app';

// Workflows a member puts together in Plan and Mastra's `plan-pipeline` workflow runs:
// a trigger and an ordered list of steps. A row without a project is a template of the
// team's library in Home; a row with one is a workflow of that project alone. The
// definition is versioned in pipeline_version, and a run pins the version it started
// with.
export const pipeline = pgTable(
  'pipeline',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    // The newest version of the definition.
    version: integer('version').notNull().default(1),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('pipeline_team_project_idx').on(t.teamId, t.projectId)],
);

export const pipelineVersion = pgTable(
  'pipeline_version',
  {
    id: serial('id').primaryKey(),
    pipelineId: integer('pipeline_id')
      .notNull()
      .references(() => pipeline.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    definition: jsonb('definition').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('pipeline_version_uq').on(t.pipelineId, t.version)],
);

// A workflow a project uses: a template of the library or the project's own workflow,
// with the agents that fill its roles there. `scheduleId` is the Mastra schedule of a
// workflow with a schedule trigger.
export const projectPipeline = pgTable(
  'project_pipeline',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    pipelineId: integer('pipeline_id')
      .notNull()
      .references(() => pipeline.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    // Role key → agent id.
    roles: jsonb('roles').$type<Record<string, number>>().notNull().default({}),
    scheduleId: text('schedule_id'),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.pipelineId] })],
);

// One run of a workflow on a task. The id is the Mastra run id. Mastra reports every
// step it executes through Plan's control API; these rows are the run history Plan
// shows. A run stays 'pending' until Mastra accepted its start: the api retries the
// start at `nextStartAt`.
export const pipelineRun = pgTable(
  'pipeline_run',
  {
    id: text('id').primaryKey(),
    pipelineId: integer('pipeline_id')
      .notNull()
      .references(() => pipeline.id, { onDelete: 'cascade' }),
    versionId: integer('version_id')
      .notNull()
      .references(() => pipelineVersion.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    issueId: integer('issue_id').references(() => issue.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull(),
    dryRun: boolean('dry_run').notNull().default(false),
    status: text('status').notNull().default('pending'),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    error: text('error'),
    startAttempts: integer('start_attempts').notNull().default(0),
    nextStartAt: timestamp('next_start_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'pipeline_run_trigger_check',
      sql`${t.trigger} IN ('manual', 'task_created', 'task_assigned', 'status_changed', 'label_added', 'schedule')`,
    ),
    check(
      'pipeline_run_status_check',
      sql`${t.status} IN ('pending', 'running', 'waiting', 'succeeded', 'failed', 'canceled', 'rejected')`,
    ),
    // One active run of a workflow per task, so a trigger that fires again while the
    // workflow still works on the task starts nothing.
    uniqueIndex('pipeline_run_active_uq')
      .on(t.pipelineId, t.issueId)
      .where(sql`${t.status} IN ('pending', 'running', 'waiting') AND NOT ${t.dryRun}`),
    index('pipeline_run_project_idx').on(t.projectId, t.createdAt.desc()),
    index('pipeline_run_pipeline_idx').on(t.pipelineId, t.createdAt.desc()),
    index('pipeline_run_issue_idx').on(t.issueId, t.createdAt.desc()),
    index('pipeline_run_start_idx').on(t.status, t.nextStartAt),
  ],
);

// One execution of a step of a run. A step a rework loop reaches again gets another
// iteration. `idempotencyKey` names the Plan agent run of an agent step, under which
// `/internal/orchestration/agent-run` stored it.
export const pipelineRunStep = pgTable(
  'pipeline_run_step',
  {
    runId: text('run_id')
      .notNull()
      .references(() => pipelineRun.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    iteration: integer('iteration').notNull(),
    // The order in which the run reached its step executions.
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    // agent: success | failed | blocked; approval: approved | rejected; condition: true |
    // false; action and wait: success.
    outcome: text('outcome'),
    summary: text('summary'),
    attempt: integer('attempt').notNull().default(1),
    idempotencyKey: text('idempotency_key'),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
    note: text('note'),
    wakeAt: timestamp('wake_at', { withTimezone: true }),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.stepId, t.iteration] }),
    check(
      'pipeline_run_step_kind_check',
      sql`${t.kind} IN ('agent', 'approval', 'condition', 'action', 'wait')`,
    ),
    check(
      'pipeline_run_step_status_check',
      sql`${t.status} IN ('running', 'waiting', 'succeeded', 'failed', 'canceled', 'simulated')`,
    ),
    index('pipeline_run_step_waiting_idx').on(t.kind, t.status),
  ],
);
