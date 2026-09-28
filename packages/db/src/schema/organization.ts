import { sql } from 'drizzle-orm';
import {
  check,
  type AnyPgColumn,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { aiAgent, initiative, issue, project, team } from './app';
import { user } from './auth';

export const organizationDepartment = pgTable(
  'organization_department',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    parentId: integer('parent_id').references((): AnyPgColumn => organizationDepartment.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('organization_department_team_name_uq').on(t.teamId, t.name),
    index('organization_department_team_parent_idx').on(t.teamId, t.parentId),
    check(
      'organization_department_not_self_parent_check',
      sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`,
    ),
  ],
);

export const organizationGoal = pgTable(
  'organization_goal',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    departmentId: integer('department_id').references(() => organizationDepartment.id, {
      onDelete: 'set null',
    }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'set null' }),
    parentGoalId: integer('parent_goal_id').references((): AnyPgColumn => organizationGoal.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('planned'),
    targetDate: date('target_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('organization_goal_team_idx').on(t.teamId),
    index('organization_goal_department_idx').on(t.departmentId),
    index('organization_goal_project_idx').on(t.projectId),
    index('organization_goal_parent_idx').on(t.teamId, t.parentGoalId),
    check(
      'organization_goal_not_self_parent_check',
      sql`${t.parentGoalId} IS NULL OR ${t.parentGoalId} <> ${t.id}`,
    ),
    check(
      'organization_goal_status_check',
      sql`${t.status} IN ('planned', 'active', 'achieved', 'paused')`,
    ),
  ],
);

export const organizationAgentAssignment = pgTable(
  'organization_agent_assignment',
  {
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    departmentId: integer('department_id').references(() => organizationDepartment.id, {
      onDelete: 'set null',
    }),
    reportsToAgentId: integer('reports_to_agent_id').references(() => aiAgent.id, {
      onDelete: 'set null',
    }),
    roleTitle: text('role_title').notNull().default(''),
    // What the agent does in an agent team: 'coordinator', 'specialist' or 'reviewer'.
    // Null for an agent that takes no part in one.
    role: text('role'),
    // Short lower-case keywords matched against issue labels to route work to a
    // specialist.
    capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]),
    runtimeAgentId: text('runtime_agent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.agentId] }),
    check(
      'organization_agent_role_check',
      sql`${t.role} IS NULL OR ${t.role} IN ('coordinator', 'specialist', 'reviewer')`,
    ),
    index('organization_agent_department_idx').on(t.teamId, t.departmentId),
    index('organization_agent_manager_idx').on(t.teamId, t.reportsToAgentId),
    check(
      'organization_agent_not_self_manager_check',
      sql`${t.reportsToAgentId} IS NULL OR ${t.reportsToAgentId} <> ${t.agentId}`,
    ),
  ],
);

export const organizationProjectAssignment = pgTable(
  'organization_project_assignment',
  {
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    departmentId: integer('department_id').references(() => organizationDepartment.id, {
      onDelete: 'set null',
    }),
    instructions: text('instructions').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.projectId] }),
    index('organization_project_department_idx').on(t.teamId, t.departmentId),
  ],
);

// The goal a task serves (docs/helena-decisions/agent-context.md §7): at most one per task,
// which is what "a task references a goal" means. Kept apart from the issue row so the
// goals stay a module of their own; the goal's page shows the tasks and their progress.
export const helenaGoalTask = pgTable(
  'helena_goal_task',
  {
    issueId: integer('issue_id')
      .primaryKey()
      .references(() => issue.id, { onDelete: 'cascade' }),
    goalId: integer('goal_id')
      .notNull()
      .references(() => organizationGoal.id, { onDelete: 'cascade' }),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    // Who linked it: a member or an agent's user.
    linkedByUserId: text('linked_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('helena_goal_task_goal_idx').on(t.goalId)],
);

// Progress notes on a goal, written by its agents (add_goal_note) or by people. A note may
// propose a new status; the goal changes only when a team owner or manager accepts it
// (`decision`), so an agent never marks a goal achieved on its own.
export const helenaGoalNote = pgTable(
  'helena_goal_note',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    goalId: integer('goal_id')
      .notNull()
      .references(() => organizationGoal.id, { onDelete: 'cascade' }),
    authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    proposedStatus: text('proposed_status'),
    // Null while a proposal waits; 'accepted' or 'rejected' once a person decided it.
    decision: text('decision'),
    decidedByUserId: text('decided_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('helena_goal_note_goal_idx').on(t.goalId, t.createdAt),
    check(
      'helena_goal_note_status_check',
      sql`${t.proposedStatus} IS NULL OR ${t.proposedStatus} IN ('planned', 'active', 'achieved', 'paused')`,
    ),
    check(
      'helena_goal_note_decision_check',
      sql`${t.decision} IS NULL OR ${t.decision} IN ('accepted', 'rejected')`,
    ),
  ],
);

// Existing project initiatives may contribute to an existing organization goal.
export const helenaProjectGoalLink = pgTable(
  'helena_project_goal_link',
  {
    initiativeId: integer('initiative_id')
      .primaryKey()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    goalId: integer('goal_id')
      .notNull()
      .references(() => organizationGoal.id, { onDelete: 'cascade' }),
  },
  (t) => [index('helena_project_goal_link_goal_idx').on(t.goalId)],
);
