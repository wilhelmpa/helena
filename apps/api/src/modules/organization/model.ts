import { t } from 'elysia';

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

const DepartmentResponse = t.Object({
  id: t.Number(),
  name: t.String(),
  description: t.String(),
  parentId: nullableId,
  position: t.Number(),
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
  kind: t.Union([t.Literal('external'), t.Literal('internal')]),
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
});

const OrganizationProjectResponse = t.Object({
  id: t.Number(),
  key: t.String(),
  name: t.String(),
  description: t.String(),
  departmentId: nullableId,
  instructions: t.String(),
});

export const OrganizationResponse = t.Object({
  teamId: t.Number(),
  departments: t.Array(DepartmentResponse),
  goals: t.Array(GoalResponse),
  agents: t.Array(OrganizationAgentResponse),
  projects: t.Array(OrganizationProjectResponse),
});

export { DepartmentResponse, GoalResponse, OrganizationAgentResponse, OrganizationProjectResponse };
