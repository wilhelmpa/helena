import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { requireUser } from '#shared/access';
import { accessErrors, commonErrors } from '#shared/responses';
import {
  ControlPlaneResponse,
  approvalBody,
  assignmentBody,
  runQuery,
  scheduleBody,
  scheduleUpdateBody,
  startWorkflowBody,
  workflowParams,
  workflowRunParams,
  workflowScheduleParams,
} from './model';
import {
  cancelWorkflowRun,
  createWorkflowSchedule,
  decideWorkflowApproval,
  getWorkflowRun,
  listProjectWorkflows,
  listWorkflowRuns,
  listWorkflowSchedules,
  listWorkflowScheduleTriggers,
  retryWorkflowRun,
  scheduleAction,
  setProjectWorkflowAssignment,
  startWorkflow,
  updateWorkflowSchedule,
} from './service';

export const controlPlaneWorkflowRoutes = new Elysia({
  name: 'control-plane-workflows',
  detail: { tags: ['Workflows'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/projects/:projectKey/control-plane/workflows',
    ({ project }) => listProjectWorkflows(project.id),
    {
      permission: ['actions', 'read'],
      response: { 200: ControlPlaneResponse, ...accessErrors },
    },
  )
  .put(
    '/projects/:projectKey/control-plane/workflows/:workflowId',
    ({ project, params, body, user }) =>
      setProjectWorkflowAssignment({
        projectId: project.id,
        workflowId: params.workflowId,
        createdBy: requireUser(user).id,
        ...body,
      }),
    {
      params: workflowParams,
      body: assignmentBody,
      permission: ['actions', 'edit'],
      response: { 200: ControlPlaneResponse, ...commonErrors },
    },
  )
  .get(
    '/projects/:projectKey/control-plane/workflows/:workflowId/runs',
    ({ project, params, query }) =>
      listWorkflowRuns(project, params.workflowId, query.page, query.pageSize),
    {
      params: workflowParams,
      query: runQuery,
      permission: ['actions', 'read'],
      response: { 200: ControlPlaneResponse, ...accessErrors },
    },
  )
  .get(
    '/projects/:projectKey/control-plane/workflows/:workflowId/runs/:runId',
    ({ project, params }) => getWorkflowRun(project, params.workflowId, params.runId),
    {
      params: workflowRunParams,
      permission: ['actions', 'read'],
      response: { 200: ControlPlaneResponse, ...accessErrors },
    },
  )
  .post(
    '/projects/:projectKey/control-plane/workflows/:workflowId/runs',
    ({ project, params, body, user }) =>
      startWorkflow(project, params.workflowId, requireUser(user).id, body),
    {
      params: workflowParams,
      body: startWorkflowBody,
      permission: ['actions', 'edit'],
      response: { 200: ControlPlaneResponse, ...commonErrors },
    },
  )
  .post(
    '/projects/:projectKey/control-plane/workflows/:workflowId/runs/:runId/retry',
    ({ project, params }) => retryWorkflowRun(project, params.workflowId, params.runId),
    {
      params: workflowRunParams,
      permission: ['actions', 'edit'],
      response: { 200: ControlPlaneResponse, ...commonErrors },
    },
  )
  .post(
    '/projects/:projectKey/control-plane/workflows/:workflowId/runs/:runId/approval',
    ({ project, params, body, user }) =>
      decideWorkflowApproval(project, params.workflowId, params.runId, requireUser(user).id, body),
    {
      params: workflowRunParams,
      body: approvalBody,
      permission: ['actions', 'edit'],
      response: { 200: ControlPlaneResponse, ...commonErrors },
    },
  )
  .patch(
    '/projects/:projectKey/control-plane/workflows/:workflowId/schedules/:scheduleId',
    ({ project, params, body }) =>
      updateWorkflowSchedule(project, params.workflowId, params.scheduleId, body),
    {
      params: workflowScheduleParams,
      body: scheduleUpdateBody,
      permission: ['actions', 'edit'],
      response: { 200: ControlPlaneResponse, ...commonErrors },
    },
  )
  .get(
    '/projects/:projectKey/control-plane/workflows/:workflowId/schedules/:scheduleId/triggers',
    ({ project, params }) =>
      listWorkflowScheduleTriggers(project, params.workflowId, params.scheduleId),
    {
      params: workflowScheduleParams,
      permission: ['actions', 'read'],
      response: { 200: ControlPlaneResponse, ...accessErrors },
    },
  )
  .post(
    '/projects/:projectKey/control-plane/workflows/:workflowId/runs/:runId/cancel',
    ({ project, params }) => cancelWorkflowRun(project, params.workflowId, params.runId),
    {
      params: workflowRunParams,
      permission: ['actions', 'edit'],
      response: { 200: ControlPlaneResponse, ...commonErrors },
    },
  )
  .get(
    '/projects/:projectKey/control-plane/workflows/:workflowId/schedules',
    ({ project, params }) => listWorkflowSchedules(project, params.workflowId),
    {
      params: workflowParams,
      permission: ['actions', 'read'],
      response: { 200: ControlPlaneResponse, ...accessErrors },
    },
  )
  .post(
    '/projects/:projectKey/control-plane/workflows/:workflowId/schedules',
    ({ project, params, body }) => createWorkflowSchedule(project, params.workflowId, body),
    {
      params: workflowParams,
      body: scheduleBody,
      permission: ['actions', 'edit'],
      response: { 200: ControlPlaneResponse, ...commonErrors },
    },
  )
  .post(
    '/projects/:projectKey/control-plane/workflows/:workflowId/schedules/:scheduleId/:action',
    ({ project, params }) =>
      scheduleAction(
        project,
        params.workflowId,
        params.scheduleId,
        `${params.action}-schedule` as 'pause-schedule' | 'resume-schedule' | 'run-schedule',
      ),
    {
      params: t.Object({
        ...workflowScheduleParams.properties,
        action: t.Union([t.Literal('pause'), t.Literal('resume'), t.Literal('run')]),
      }),
      permission: ['actions', 'edit'],
      response: { 200: ControlPlaneResponse, ...commonErrors },
    },
  )
  .delete(
    '/projects/:projectKey/control-plane/workflows/:workflowId/schedules/:scheduleId',
    ({ project, params }) =>
      scheduleAction(project, params.workflowId, params.scheduleId, 'delete-schedule'),
    {
      params: workflowScheduleParams,
      permission: ['actions', 'edit'],
      response: { 200: ControlPlaneResponse, ...commonErrors },
    },
  );
