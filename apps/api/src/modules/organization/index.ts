import { Elysia, t } from 'elysia';
import { db, organizationDepartment, organizationGoal } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { requireUser } from '#shared/access';
import { mcpTool } from '#mcp/generate';
import { budgetStatuses, setBudgets } from '#modules/autopilot/budgets';
import { departmentSkills, setDepartmentSkills } from './skills';
import { BudgetStatusSchema, budgetsBody } from '#modules/autopilot/model';
import { commonErrors, errors } from '#shared/responses';
import {
  DepartmentResponse,
  GoalResponse,
  OrganizationResponse,
  createDepartmentBody,
  createGoalBody,
  organizationAgentParams,
  organizationAgentProjectParams,
  organizationDepartmentParams,
  organizationGoalParams,
  organizationProjectParams,
  organizationQuery,
  organizationTeamParams,
  pauseAgentBody,
  setAgentAssignmentBody,
  setAgentTokenCeilingsBody,
  setProjectTokenCeilingBody,
  setAgentProjectInstructionsBody,
  setProjectAssignmentBody,
  updateDepartmentBody,
  updateGoalBody,
} from './model';
import {
  clearAgentAssignment,
  clearProjectAssignment,
  createDepartment,
  createGoal,
  deleteDepartment,
  deleteGoal,
  getOrganization,
  setAgentAssignment,
  setAgentProjectInstructions,
  setProjectAssignment,
  updateDepartment,
  updateGoal,
} from './service';
import {
  pauseAgent,
  resumeAgent,
  setAgentTokenCeilings,
  setProjectTokenCeiling,
} from '#modules/agents/governance';

export const organizationRoutes = new Elysia({
  name: 'organization',
  detail: { tags: ['Organization'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/teams/:teamId/organization',
    ({ membership, query }) => getOrganization(membership.teamId, query.projectId),
    {
      params: organizationTeamParams,
      query: organizationQuery,
      teamManager: true,
      response: { 200: OrganizationResponse, ...commonErrors },
      detail: {
        summary: 'Get the team organization',
        description:
          'Get departments, goals, agents, reporting lines, project ownership and project instructions. Only team owners and managers can read the full organization.',
      },
    },
  )
  .post(
    '/teams/:teamId/organization/departments',
    async ({ membership, body, set }) => {
      set.status = 201;
      return createDepartment(membership.teamId, body);
    },
    {
      params: organizationTeamParams,
      body: createDepartmentBody,
      teamManager: true,
      response: { 201: DepartmentResponse, ...commonErrors, ...errors(409) },
      detail: { summary: 'Create an organization department' },
    },
  )
  .patch(
    '/teams/:teamId/organization/departments/:departmentId',
    ({ membership, params, body }) =>
      updateDepartment(membership.teamId, params.departmentId, body),
    {
      params: organizationDepartmentParams,
      body: updateDepartmentBody,
      teamManager: true,
      response: { 200: DepartmentResponse, ...commonErrors, ...errors(409) },
      detail: { summary: 'Update an organization department' },
    },
  )
  .delete(
    '/teams/:teamId/organization/departments/:departmentId',
    async ({ membership, params }) => {
      if (!(await deleteDepartment(membership.teamId, params.departmentId))) {
        throw new HttpError(404, 'Department not found');
      }
      return noContent();
    },
    {
      params: organizationDepartmentParams,
      teamManager: true,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Delete an organization department' },
    },
  )
  .get(
    '/teams/:teamId/organization/departments/:departmentId/budgets',
    async ({ membership, params }) => {
      const [department] = await db
        .select({ id: organizationDepartment.id })
        .from(organizationDepartment)
        .where(
          and(
            eq(organizationDepartment.id, params.departmentId),
            eq(organizationDepartment.teamId, membership.teamId),
          ),
        );
      if (!department) throw new HttpError(404, 'Department not found');
      return budgetStatuses({ departmentIds: [department.id] });
    },
    {
      params: organizationDepartmentParams,
      teamManager: true,
      response: { 200: t.Array(BudgetStatusSchema), ...commonErrors },
      detail: { summary: 'Get department budgets and consumption' },
    },
  )
  .put(
    '/teams/:teamId/organization/departments/:departmentId/budgets',
    async ({ membership, params, body, user }) => {
      const [department] = await db
        .select({ id: organizationDepartment.id })
        .from(organizationDepartment)
        .where(
          and(
            eq(organizationDepartment.id, params.departmentId),
            eq(organizationDepartment.teamId, membership.teamId),
          ),
        );
      if (!department) throw new HttpError(404, 'Department not found');
      await setBudgets(
        membership.teamId,
        { departmentId: department.id },
        body.budgets,
        requireUser(user).id,
      );
      return budgetStatuses({ departmentIds: [department.id] });
    },
    {
      params: organizationDepartmentParams,
      body: budgetsBody,
      teamManager: true,
      response: { 200: t.Array(BudgetStatusSchema), ...commonErrors },
      detail: { summary: 'Set department budgets' },
    },
  )
  .get(
    '/teams/:teamId/organization/departments/:departmentId/skills',
    ({ membership, params }) => departmentSkills(membership.teamId, params.departmentId),
    {
      params: organizationDepartmentParams,
      teamManager: true,
      response: {
        200: t.Object({
          restricted: t.Boolean(),
          skills: t.Array(t.Object({ id: t.Number(), name: t.String() })),
        }),
        ...commonErrors,
      },
      detail: {
        summary: 'Get the department skill policy',
        ...mcpTool('get_department_skills', { readOnlyHint: true }),
      },
    },
  )
  .put(
    '/teams/:teamId/organization/departments/:departmentId/skills',
    ({ membership, params, body }) =>
      setDepartmentSkills(membership.teamId, params.departmentId, body),
    {
      params: organizationDepartmentParams,
      body: t.Object({ restricted: t.Boolean(), skillIds: t.Array(t.Number()) }),
      teamManager: true,
      response: {
        200: t.Object({
          restricted: t.Boolean(),
          skills: t.Array(t.Object({ id: t.Number(), name: t.String() })),
        }),
        ...commonErrors,
      },
      detail: {
        summary: 'Set the department skill policy',
        ...mcpTool('set_department_skills'),
      },
    },
  )
  .post(
    '/teams/:teamId/organization/goals',
    async ({ membership, body, set }) => {
      set.status = 201;
      return createGoal(membership.teamId, body);
    },
    {
      params: organizationTeamParams,
      body: createGoalBody,
      teamManager: true,
      response: { 201: GoalResponse, ...commonErrors },
      detail: { summary: 'Create an organization goal' },
    },
  )
  .patch(
    '/teams/:teamId/organization/goals/:goalId',
    ({ membership, params, body }) => updateGoal(membership.teamId, params.goalId, body),
    {
      params: organizationGoalParams,
      body: updateGoalBody,
      teamManager: true,
      response: { 200: GoalResponse, ...commonErrors },
      detail: { summary: 'Update an organization goal' },
    },
  )
  .get(
    '/teams/:teamId/organization/goals/:goalId/budgets',
    async ({ membership, params }) => {
      const [goal] = await db
        .select({ id: organizationGoal.id })
        .from(organizationGoal)
        .where(
          and(
            eq(organizationGoal.id, params.goalId),
            eq(organizationGoal.teamId, membership.teamId),
          ),
        );
      if (!goal) throw new HttpError(404, 'Goal not found');
      return budgetStatuses({ goalIds: [goal.id] });
    },
    {
      params: organizationGoalParams,
      teamManager: true,
      response: { 200: t.Array(BudgetStatusSchema), ...commonErrors },
      detail: { summary: 'Get goal budgets and consumption' },
    },
  )
  .put(
    '/teams/:teamId/organization/goals/:goalId/budgets',
    async ({ membership, params, body, user }) => {
      const [goal] = await db
        .select({ id: organizationGoal.id })
        .from(organizationGoal)
        .where(
          and(
            eq(organizationGoal.id, params.goalId),
            eq(organizationGoal.teamId, membership.teamId),
          ),
        );
      if (!goal) throw new HttpError(404, 'Goal not found');
      await setBudgets(membership.teamId, { goalId: goal.id }, body.budgets, requireUser(user).id);
      return budgetStatuses({ goalIds: [goal.id] });
    },
    {
      params: organizationGoalParams,
      body: budgetsBody,
      teamManager: true,
      response: { 200: t.Array(BudgetStatusSchema), ...commonErrors },
      detail: { summary: 'Set goal budgets' },
    },
  )
  .delete(
    '/teams/:teamId/organization/goals/:goalId',
    async ({ membership, params }) => {
      if (!(await deleteGoal(membership.teamId, params.goalId))) {
        throw new HttpError(404, 'Goal not found');
      }
      return noContent();
    },
    {
      params: organizationGoalParams,
      teamManager: true,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Delete an organization goal' },
    },
  )
  .put(
    '/teams/:teamId/organization/agents/:agentId',
    async ({ membership, params, body }) => {
      await setAgentAssignment(membership.teamId, params.agentId, body);
      return noContent();
    },
    {
      params: organizationAgentParams,
      body: setAgentAssignmentBody,
      teamManager: true,
      response: { 204: t.Void(), ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Set an agent organization assignment',
        description:
          'Set an existing team agent role title, department, reporting line, runtime agent reference, agent-team role and capabilities. The agent-team role and capabilities keep their stored values when omitted. Runtime policy is configured on the agent itself.',
      },
    },
  )
  .delete(
    '/teams/:teamId/organization/agents/:agentId',
    async ({ membership, params }) => {
      if (!(await clearAgentAssignment(membership.teamId, params.agentId))) {
        throw new HttpError(404, 'Agent organization assignment not found');
      }
      return noContent();
    },
    {
      params: organizationAgentParams,
      teamManager: true,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Clear an agent organization assignment' },
    },
  )
  .post(
    '/teams/:teamId/organization/agents/:agentId/pause',
    async ({ membership, params, body, user }) => {
      const reason = body.reason?.trim() || `Paused by ${user?.name ?? 'a team manager'}.`;
      if (!(await pauseAgent(membership.teamId, params.agentId, reason))) {
        throw new HttpError(404, 'Agent not found');
      }
      return noContent();
    },
    {
      params: organizationAgentParams,
      body: pauseAgentBody,
      teamManager: true,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Pause an agent',
        description:
          'Stop the agent from taking new work: its queued runs and chat answers wait, a ' +
          'mention or a delegation does not start it, and an agent-team stage for it is ' +
          'refused. Work it is doing now finishes.',
      },
    },
  )
  .post(
    '/teams/:teamId/organization/agents/:agentId/resume',
    async ({ membership, params }) => {
      if (!(await resumeAgent(membership.teamId, params.agentId))) {
        throw new HttpError(404, 'Agent not found');
      }
      return noContent();
    },
    {
      params: organizationAgentParams,
      teamManager: true,
      response: { 204: t.Void(), ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Resume an agent',
        description:
          'Let a paused agent take work again. Refused while its daily or monthly token ' +
          'ceiling is still reached.',
      },
    },
  )
  .put(
    '/teams/:teamId/organization/agents/:agentId/token-ceilings',
    async ({ membership, params, body }) => {
      if (!(await setAgentTokenCeilings(membership.teamId, params.agentId, body))) {
        throw new HttpError(404, 'Agent not found');
      }
      return noContent();
    },
    {
      params: organizationAgentParams,
      body: setAgentTokenCeilingsBody,
      teamManager: true,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: "Set an agent's token ceilings",
        description:
          'Set how many tokens the agent runs may use per day and per calendar month (UTC), ' +
          'or null for no ceiling. Reaching one pauses the agent and notifies its owner.',
      },
    },
  )
  .put(
    '/teams/:teamId/organization/projects/:projectId/token-ceiling',
    async ({ membership, params, body }) => {
      if (!(await setProjectTokenCeiling(membership.teamId, params.projectId, body.monthly))) {
        throw new HttpError(404, 'Project not found');
      }
      return noContent();
    },
    {
      params: organizationProjectParams,
      body: setProjectTokenCeilingBody,
      teamManager: true,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: "Set a project's token ceiling",
        description:
          'Set how many tokens the agent runs of the project may use per calendar month ' +
          '(UTC), or null for no ceiling. Reaching it pauses the agent whose run would start ' +
          'next and notifies the project owners.',
      },
    },
  )
  .put(
    '/teams/:teamId/organization/projects/:projectId',
    async ({ membership, params, body }) => {
      await setProjectAssignment(membership.teamId, params.projectId, body);
      return noContent();
    },
    {
      params: organizationProjectParams,
      body: setProjectAssignmentBody,
      teamManager: true,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Set a project organization assignment' },
    },
  )
  .delete(
    '/teams/:teamId/organization/projects/:projectId',
    async ({ membership, params }) => {
      if (!(await clearProjectAssignment(membership.teamId, params.projectId))) {
        throw new HttpError(404, 'Project organization assignment not found');
      }
      return noContent();
    },
    {
      params: organizationProjectParams,
      teamManager: true,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Clear a project organization assignment' },
    },
  )
  .patch(
    '/teams/:teamId/organization/agents/:agentId/projects/:projectId',
    async ({ membership, params, body }) => {
      await setAgentProjectInstructions(
        membership.teamId,
        params.agentId,
        params.projectId,
        body.instructions,
      );
      return noContent();
    },
    {
      params: organizationAgentProjectParams,
      body: setAgentProjectInstructionsBody,
      teamManager: true,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Set project instructions for an agent',
        description:
          "Update the existing project membership description used as this agent's project-specific instructions.",
      },
    },
  );
