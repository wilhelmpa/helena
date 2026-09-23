import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
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
  setAgentAssignmentBody,
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
