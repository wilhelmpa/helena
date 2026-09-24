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
import { agentRun, aiAgent, issue, project, team } from './app';

// Workflows a member puts together in Helena's workflow builder, which the Helena engine
// runs (apps/api/src/modules/engine): a trigger and an ordered list of steps. A row
// without a project is a template of the team's library in Home; a row with one is a
// workflow of that project alone. The definition is versioned in pipeline_version, and a
// run pins the version it started with.
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
// with the agents that fill its roles there. A workflow with a schedule trigger has a
// helena_schedule row while it is enabled.
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
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.pipelineId] })],
);

// A recurring trigger the Helena engine fires: a routine of the Schedules page, which
// creates or reopens a task for an agent on every fire, or the schedule of a builder
// workflow with a schedule trigger while it is enabled in the project. The engine fires
// every scheduled time after `fired_through` once (engine/schedules.ts).
export const helenaSchedule = pgTable(
  'helena_schedule',
  {
    id: text('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    // routine | workflow
    kind: text('kind').notNull(),
    // The builder workflow a 'workflow' schedule runs.
    pipelineId: integer('pipeline_id').references(() => pipeline.id, { onDelete: 'cascade' }),
    // A routine's name and the title of the tasks it creates.
    title: text('title').notNull().default(''),
    // What a routine does: the agent it delegates to, the description of a created task
    // or the comment on a reopened one, and whether it creates a task on every fire or
    // reopens `taskId`. Null for a 'workflow' schedule.
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    instructions: text('instructions').notNull().default(''),
    mode: text('mode'),
    taskId: integer('task_id').references(() => issue.id, { onDelete: 'set null' }),
    // Five-field cron in `timezone`.
    cron: text('cron').notNull(),
    timezone: text('timezone').notNull().default('Europe/Berlin'),
    // What a fire that comes too late does, after downtime: 'skip' records it as missed,
    // 'once' runs the newest missed time once. Older missed times never run.
    catchUp: text('catch_up').notNull().default('skip'),
    enabled: boolean('enabled').notNull().default(true),
    // The scheduled times up to here are handled: the engine fires the times after it.
    // Set to the moment a schedule is created, switched on or given another time, so it
    // starts afresh then.
    firedThrough: timestamp('fired_through', { withTimezone: true }).notNull().defaultNow(),
    // The member the fires act for: whoever saved what the schedule does last.
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    // Makes a create idempotent within the project.
    scheduleKey: text('schedule_key'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('helena_schedule_kind_check', sql`${t.kind} IN ('routine', 'workflow')`),
    check('helena_schedule_mode_check', sql`${t.mode} IS NULL OR ${t.mode} IN ('new', 'reopen')`),
    check('helena_schedule_catch_up_check', sql`${t.catchUp} IN ('skip', 'once')`),
    check(
      'helena_schedule_target_check',
      sql`(${t.kind} = 'workflow') = (${t.pipelineId} IS NOT NULL)`,
    ),
    unique('helena_schedule_key_uq').on(t.projectId, t.scheduleKey),
    uniqueIndex('helena_schedule_pipeline_uq')
      .on(t.projectId, t.pipelineId)
      .where(sql`${t.pipelineId} IS NOT NULL`),
    index('helena_schedule_project_idx').on(t.projectId, t.createdAt),
  ],
);

// One run of the Helena engine: a run of a builder workflow (`kind` 'workflow', with its
// pinned version), of the agent team of a task ('agent_team') or one fire of a routine
// ('routine'). The last two carry their definition inline. The id is the run's own; the
// engine executes it as the DBOS workflow `workflowId`, which a retry replaces with a
// fork of the failed run. These rows and their steps are the run history Helena shows.
export const pipelineRun = pgTable(
  'pipeline_run',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull().default('workflow'),
    pipelineId: integer('pipeline_id').references(() => pipeline.id, { onDelete: 'cascade' }),
    versionId: integer('version_id').references(() => pipelineVersion.id, {
      onDelete: 'cascade',
    }),
    // The definition of a run without a version, pinned when it was created.
    definition: jsonb('definition'),
    // The name a run without a workflow is shown with (the routine's title).
    title: text('title'),
    // What the trigger handed the run: the task it creates before its first step
    // (`{ task: { title, description } }`) and the event or request data.
    input: jsonb('input'),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    issueId: integer('issue_id').references(() => issue.id, { onDelete: 'cascade' }),
    // The agent that leads the run: the coordinator of an agent team, the agent of a
    // routine.
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    // The schedule that fired the run and the time it was due.
    scheduleId: text('schedule_id').references(() => helenaSchedule.id, { onDelete: 'set null' }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    trigger: text('trigger').notNull(),
    dryRun: boolean('dry_run').notNull().default(false),
    status: text('status').notNull().default('pending'),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    // The DBOS workflow executing the run; null until it started.
    workflowId: text('workflow_id'),
    // What the run produced: the agent team's summary and evidence, a routine's outcome.
    result: jsonb('result'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check('pipeline_run_kind_check', sql`${t.kind} IN ('workflow', 'agent_team', 'routine')`),
    check(
      'pipeline_run_source_check',
      sql`(${t.kind} = 'workflow') = (${t.pipelineId} IS NOT NULL AND ${t.versionId} IS NOT NULL)
        AND (${t.kind} = 'workflow' OR ${t.definition} IS NOT NULL)`,
    ),
    // Trigger types come from the engine's registry, so a plugin can add one.
    // A built-in trigger name or a plugin's trigger id (@helena/sdk registry ids).
    check('pipeline_run_trigger_check', sql`${t.trigger} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'`),
    check(
      'pipeline_run_status_check',
      sql`${t.status} IN ('pending', 'running', 'waiting', 'succeeded', 'failed', 'canceled', 'rejected', 'skipped')`,
    ),
    // One active run of a workflow per task, so a trigger that fires again while the
    // workflow still works on the task starts nothing.
    uniqueIndex('pipeline_run_active_uq')
      .on(t.pipelineId, t.issueId)
      .where(sql`${t.status} IN ('pending', 'running', 'waiting') AND NOT ${t.dryRun}`),
    // One active agent team per coordinator and task.
    uniqueIndex('pipeline_run_team_active_uq')
      .on(t.issueId, t.agentId)
      .where(
        sql`${t.kind} = 'agent_team' AND ${t.status} IN ('pending', 'running', 'waiting') AND NOT ${t.dryRun}`,
      ),
    // A schedule fires each of its times once.
    uniqueIndex('pipeline_run_fire_uq')
      .on(t.scheduleId, t.scheduledFor)
      .where(sql`${t.scheduleId} IS NOT NULL`),
    index('pipeline_run_project_idx').on(t.projectId, t.createdAt.desc()),
    index('pipeline_run_pipeline_idx').on(t.pipelineId, t.createdAt.desc()),
    index('pipeline_run_issue_idx').on(t.issueId, t.createdAt.desc()),
    index('pipeline_run_schedule_idx').on(t.scheduleId, t.scheduledFor.desc()),
    index('pipeline_run_status_idx').on(t.status, t.updatedAt),
  ],
);

// One execution of a step of a run. A step a rework loop reaches again gets another
// iteration. A step that runs parts of its own (the stages of an agent team) records each
// part as a row whose `stepId` is `<step>.<part>`. `agentRunId` is the agent run of an
// agent step or stage.
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
    // The step type from the engine's registry.
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
    agentRunId: integer('agent_run_id').references(() => agentRun.id, { onDelete: 'set null' }),
    decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
    note: text('note'),
    wakeAt: timestamp('wake_at', { withTimezone: true }),
    // What a step type keeps of an execution besides the columns above.
    state: jsonb('state'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.stepId, t.iteration] }),
    // A built-in step type or a plugin's step type id (@helena/sdk registry ids).
    check('pipeline_run_step_kind_check', sql`${t.kind} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'`),
    check(
      'pipeline_run_step_status_check',
      sql`${t.status} IN ('running', 'waiting', 'succeeded', 'failed', 'canceled', 'simulated', 'skipped')`,
    ),
    index('pipeline_run_step_waiting_idx').on(t.kind, t.status),
    index('pipeline_run_step_agent_run_idx').on(t.agentRunId),
    // The executions of plugin steps that wait for a signal (engine/plugins.ts), by key.
    index('pipeline_run_step_wait_key_idx')
      .on(sql`(${t.state}->'wait'->>'key')`)
      .where(sql`${t.status} = 'waiting' AND (${t.state}->'wait') IS NOT NULL`),
  ],
);

// The inbound webhook of a builder workflow with a webhook trigger in one project: a
// sender POSTs to /hooks/workflows/<id> and signs the request per Standard Webhooks with
// the secret (encrypted here), or sends it as a bearer token. Every accepted request
// starts a run.
export const helenaWorkflowHook = pgTable(
  'helena_workflow_hook',
  {
    id: text('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    pipelineId: integer('pipeline_id')
      .notNull()
      .references(() => pipeline.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [unique('helena_workflow_hook_uq').on(t.projectId, t.pipelineId)],
);
