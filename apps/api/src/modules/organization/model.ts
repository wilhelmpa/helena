import { t } from 'elysia';
import { GoalProgressResponse } from '#modules/goals/model';
import { BudgetStatusSchema } from '#modules/autopilot/model';

export const organizationTeamParams = t.Object({ teamId: t.Numeric() });
export const organizationQuery = t.Object({
  projectId: t.Optional(
    t.Numeric({ description: 'Only the agents working in this project, without the Home agent.' }),
  ),
});
export const organizationDepartmentParams = t.Object({
  teamId: t.Numeric(),
  departmentId: t.Numeric(),
});
export const organizationGoalParams = t.Object({ teamId: t.Numeric(), goalId: t.Numeric() });
export const organizationAgentParams = t.Object({ teamId: t.Numeric(), agentId: t.Numeric() });
export const organizationProjectParams = t.Object({ teamId: t.Numeric(), projectId: t.Numeric() });
export const organizationAgentProjectParams = t.Object({
  teamId: t.Numeric(),
  agentId: t.Numeric(),
  projectId: t.Numeric(),
});

const nullableId = t.Nullable(t.Number());

export const createDepartmentBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 80 }),
  description: t.Optional(t.String({ maxLength: 1000 })),
  parentId: t.Optional(nullableId),
  position: t.Optional(t.Integer({ minimum: 0, maximum: 1_000_000 })),
});
export const updateDepartmentBody = t.Partial(createDepartmentBody);

export const goalStatus = t.Union([
  t.Literal('planned'),
  t.Literal('active'),
  t.Literal('achieved'),
  t.Literal('paused'),
]);
export const createGoalBody = t.Object({
  title: t.String({ minLength: 1, maxLength: 160 }),
  description: t.Optional(t.String({ maxLength: 2000 })),
  departmentId: t.Optional(nullableId),
  projectId: t.Optional(nullableId),
  parentGoalId: t.Optional(nullableId),
  status: t.Optional(goalStatus),
  targetDate: t.Optional(t.Nullable(t.String({ format: 'date' }))),
});
export const updateGoalBody = t.Partial(createGoalBody);

export const agentTeamRole = t.Union([
  t.Literal('coordinator'),
  t.Literal('specialist'),
  t.Literal('reviewer'),
]);

export const setAgentAssignmentBody = t.Object({
  departmentId: t.Optional(nullableId),
  reportsToAgentId: t.Optional(nullableId),
  roleTitle: t.Optional(t.String({ maxLength: 100 })),
  role: t.Optional(t.Nullable(agentTeamRole)),
  capabilities: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 32, pattern: '^[a-z0-9][a-z0-9-]*$' }), {
      maxItems: 16,
    }),
  ),
  runtimeAgentId: t.Optional(
    t.Nullable(
      t.String({
        minLength: 1,
        maxLength: 128,
        pattern: '^[a-z0-9][a-z0-9._-]*$',
      }),
    ),
  ),
});

export const setProjectAssignmentBody = t.Object({
  departmentId: t.Optional(nullableId),
  instructions: t.Optional(t.String({ maxLength: 4000 })),
});

export const setAgentProjectInstructionsBody = t.Object({
  instructions: t.String({ maxLength: 500 }),
});

export const pauseAgentBody = t.Object({
  reason: t.Optional(
    t.String({
      maxLength: 500,
      description: 'Why the agent is paused. Defaults to who paused it.',
    }),
  ),
});

// Null removes the ceiling.
const tokenCeiling = t.Nullable(t.Integer({ minimum: 1, maximum: 1_000_000_000_000 }));

export const setAgentTokenCeilingsBody = t.Object({
  daily: tokenCeiling,
  monthly: tokenCeiling,
});

export const setProjectTokenCeilingBody = t.Object({ monthly: tokenCeiling });

const DepartmentResponse = t.Object({
  id: t.Number(),
  name: t.String(),
  description: t.String(),
  parentId: nullableId,
  position: t.Number(),
  budgets: t.Optional(t.Array(BudgetStatusSchema)),
  createdAt: t.String(),
  updatedAt: t.String(),
});

const GoalResponse = t.Object({
  id: t.Number(),
  title: t.String(),
  description: t.String(),
  departmentId: nullableId,
  projectId: nullableId,
  parentGoalId: nullableId,
  status: goalStatus,
  targetDate: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
  // Only on the organization read: its linked tasks and who works on them
  // (modules/goals), and the status proposals of agents that wait for a decision.
  progress: t.Optional(GoalProgressResponse),
  pendingProposals: t.Optional(t.Number()),
});

const AgentProjectResponse = t.Object({
  id: t.Number(),
  key: t.String(),
  name: t.String(),
  instructions: t.String(),
});

const OrganizationAgentResponse = t.Object({
  id: t.Number(),
  userId: t.String(),
  name: t.String(),
  username: t.String(),
  kind: t.Literal('external'),
  // The Home master, root of the reporting chain; never a "pool template" or an
  // "unassigned" agent, even though it carries no organization_agent_assignment row.
  isHome: t.Boolean(),
  // A pool template (runs nowhere, joins no project). Shown as "Vorlage", never counted
  // as an unassigned agent.
  template: t.Boolean(),
  departmentId: nullableId,
  reportsToAgentId: nullableId,
  roleTitle: t.String(),
  role: t.Nullable(agentTeamRole),
  capabilities: t.Array(t.String()),
  runtimeAgentId: t.Nullable(t.String()),
  runtimeState: t.Object({
    adapter: t.Nullable(t.String()),
    status: t.Union([t.Literal('offline'), t.Literal('online'), t.Literal('degraded')]),
    appliedRevision: t.Nullable(t.String()),
    capabilities: t.Array(t.String()),
    detail: t.Nullable(t.String()),
    reportedAt: t.Nullable(t.String()),
  }),
  projects: t.Array(AgentProjectResponse),
  pausedAt: t.Nullable(t.String()),
  pauseReason: t.Nullable(t.String()),
  dailyTokenCeiling: t.Nullable(t.Number()),
  monthlyTokenCeiling: t.Nullable(t.Number()),
  // What the agent's runs used today and this month, UTC, in every project of the team.
  tokensToday: t.Number(),
  tokensThisMonth: t.Number(),
  budgets: t.Array(BudgetStatusSchema),
  throttled: t.Boolean(),
});

const OrganizationProjectResponse = t.Object({
  id: t.Number(),
  key: t.String(),
  name: t.String(),
  description: t.String(),
  departmentId: nullableId,
  instructions: t.String(),
  monthlyTokenCeiling: t.Nullable(t.Number()),
  tokensThisMonth: t.Number(),
});

export const OrganizationResponse = t.Object({
  teamId: t.Number(),
  departments: t.Array(DepartmentResponse),
  goals: t.Array(GoalResponse),
  agents: t.Array(OrganizationAgentResponse),
  projects: t.Array(OrganizationProjectResponse),
});

export { DepartmentResponse, GoalResponse, OrganizationAgentResponse, OrganizationProjectResponse };
