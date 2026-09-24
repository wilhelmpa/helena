import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { requireUser } from '#shared/access';
import { paginate } from '#shared/pagination';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { PipelineRunPageResponse, PipelineRunResponse } from '#modules/pipelines/model';
import {
  AssignmentResponse,
  ProjectWorkflowResponse,
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
      response: { 200: t.Array(ProjectWorkflowResponse), ...accessErrors },
      detail: {
        summary: 'List the built-in workflows of a project',
        description:
          'The workflows Helena builds in (the agent team), each with its steps and whether ' +
          'and how the project uses it.',
      },
    },
  )
  .put(
    '/projects/:projectKey/control-plane/workflows/:workflowId',
    async ({ project, params, body, user }) => {
      const row = await setProjectWorkflowAssignment({
        projectId: project.id,
        workflowId: params.workflowId,
        createdBy: requireUser(user).id,
        ...body,
      });
      return { projectId: row!.projectId, workflowId: row!.workflowId, enabled: row!.enabled };
    },
    {
      params: workflowParams,
      body: assignmentBody,
      permission: ['actions', 'edit'],
      response: { 200: AssignmentResponse, ...commonErrors },
      detail: {
        summary: 'Switch a built-in workflow on or off and configure it',
        description:
          'Turns the workflow on or off in the project and saves its settings (for the agent ' +
          'team: autonomy, coordinator review, turn and time limits).',
      },
    },
  )
  .get(
    '/projects/:projectKey/control-plane/workflows/:workflowId/runs',
    ({ project, params, query }) =>
      paginate(query, (window) => listWorkflowRuns(project, params.workflowId, window)),
    {
      params: workflowParams,
      query: runQuery,
      permission: ['actions', 'read'],
      response: { 200: PipelineRunPageResponse, ...accessErrors },
      detail: {
        summary: 'List the runs of a built-in workflow',
        description: 'One page of the runs of the workflow in the project, newest first.',
      },
    },
  )
  .get(
    '/projects/:projectKey/control-plane/workflows/:workflowId/runs/:runId',
    ({ project, params }) => getWorkflowRun(project, params.workflowId, params.runId),
    {
      params: workflowRunParams,
      permission: ['actions', 'read'],
      response: { 200: PipelineRunResponse, ...accessErrors },
      detail: {
        summary: 'Get a run of a built-in workflow',
        description: 'The run with every step and stage it executed.',
      },
    },
  )
  .post(
    '/projects/:projectKey/control-plane/workflows/:workflowId/runs/:runId/retry',
    ({ project, params }) => controlRun(project, params.workflowId, params.runId, 'retry'),
    {
      params: workflowRunParams,
      permission: ['actions', 'edit'],
      response: { 200: PipelineRunResponse, ...commonErrors, ...errors(409, 503) },
      detail: {
        summary: 'Retry a failed run of a built-in workflow',
        description:
          'Runs the failed stage again; the stages that finished keep their results. The same ' +
          'as retrying it through /pipeline-runs.',
      },
    },
  )
  .post(
    '/projects/:projectKey/control-plane/workflows/:workflowId/runs/:runId/cancel',
    ({ project, params }) => controlRun(project, params.workflowId, params.runId, 'cancel'),
    {
      params: workflowRunParams,
      permission: ['actions', 'edit'],
      response: { 200: PipelineRunResponse, ...commonErrors, ...errors(409, 503) },
      detail: {
        summary: 'Cancel a run of a built-in workflow',
        description: 'Stops the run and cancels the agent runs of its stages.',
      },
    },
  );
