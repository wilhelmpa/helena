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
import { aiAgent, project, team } from './app';

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
