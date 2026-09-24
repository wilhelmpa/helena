import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { requireUser } from '#shared/access';
import { accessErrors, commonErrors } from '#shared/responses';
import {
  ControlPlaneResponse,
  assignmentBody,
  runQuery,
  workflowParams,
  workflowRunParams,
} from './model';
import {
  getWorkflowRun,
  listProjectWorkflows,
  listWorkflowRuns,
  setProjectWorkflowAssignment,
} from './service';
import { cancelEngineRun, retryEngineRun } from '#modules/engine/runs';

// The built-in workflows of a project (the agent team) as the Helena engine runs them:
// the project's settings and the runs, which a member cancels or retries.
async function controlRun(
  project: { id: number; key: string; teamId: number },
  workflowId: string,
  runId: string,
  action: 'cancel' | 'retry',
) {
  await getWorkflowRun(project, workflowId, runId);
  if (action === 'cancel') await cancelEngineRun(runId);
  else await retryEngineRun(runId);
  return getWorkflowRun(project, workflowId, runId);
}

export const controlPlaneWorkflowRoutes = new Elysia({
  name: 'control-plane-workflows',
  detail: {
    tags: ['Workflows'],
    description:
      'Switch on and configure the built-in workflows of a project and control their runs.',
  },
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
    '/projects/:projectKey/control-plane/workflows/:workflowId/runs/:runId/retry',
    ({ project, params }) => controlRun(project, params.workflowId, params.runId, 'retry'),
    {
      params: workflowRunParams,
      permission: ['actions', 'edit'],
      response: { 200: ControlPlaneResponse, ...commonErrors },
    },
  )
  .post(
    '/projects/:projectKey/control-plane/workflows/:workflowId/runs/:runId/cancel',
    ({ project, params }) => controlRun(project, params.workflowId, params.runId, 'cancel'),
    {
      params: workflowRunParams,
      permission: ['actions', 'edit'],
      response: { 200: ControlPlaneResponse, ...commonErrors },
    },
  );
