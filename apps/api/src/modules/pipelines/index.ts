import { Elysia, t, type DocumentDecoration } from 'elysia';
import { authContext } from '#shared/auth-context';
import { assertPermission, requireTeamPermission, requireUser } from '#shared/access';
import { assertMcpAllowed, entityGuard, guards, requiresPermission } from '#shared/guards';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { paginate } from '#shared/pagination';
import type { PermissionAction } from '#shared/permissions';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { isAgentUser } from '#modules/agents/core/service';
import { getIssueProjectId } from '#modules/issues/service';
import { getProjectByKey } from '#modules/projects/service';
import { BUILTIN_TEMPLATES } from './builtin';
import {
  BuiltinTemplateResponse,
  createPipelineBody,
  decisionBody,
  issueParams,
  PipelineApprovalResponse,
  PipelineContextResponse,
  pipelineParams,
  PipelineResponse,
  PipelineRunLimitResponse,
  pipelineRunParams,
  PipelineRunPageResponse,
  PipelineRunResponse,
  PipelineVersionDetailResponse,
  pipelineVersionParams,
  PipelineVersionResponse,
  projectPipelineBody,
  projectPipelineParams,
  ProjectPipelineResponse,
  runsQuery,
  StartablePipelineResponse,
  startRunBody,
  teamParams,
  updatePipelineBody,
  updatePipelineRunLimitBody,
  validateBody,
  ValidationResponse,
} from './model';
import { getPipelineRunLimit, setPipelineRunLimit } from './rate-limit';
import {
  cancelRun,
  decideApproval,
  getRun,
  listIssueRuns,
  listPipelineRuns,
  listWaitingApprovals,
  readableProjectIds,
  retryRun,
  runAccess,
  startablePipelines,
  startRun,
} from './runs';
import {
  createPipeline,
  deletePipeline,
  editorContext,
  getPipeline,
  getPipelineRow,
  getVersion,
  listProjectPipelines,
  listTemplates,
  listVersions,
  setProjectPipeline,
  updatePipeline,
  validateForEditor,
} from './service';

// The workflow builder: templates in the team's library in Home, a project's own
// workflows, their use in a project and their runs, which the Helena engine executes
// (modules/engine). The run routes serve every kind of engine run: a routine's runs are
// governed by the agents permission like the routine, every other run by the actions
// permission.
export const pipelineRoutes = new Elysia({
  name: 'pipelines',
  detail: { tags: ['Workflow builder'] },
})
  .use(authContext)
  .use(guards)
  .macro({
    // A template is the team's, a project workflow its project's. Both are governed by
    // the actions permission.
    pipeline(action: PermissionAction) {
      return {
        detail: requiresPermission(['actions', action]) as DocumentDecoration,
        async resolve({ params, user, request }) {
          const row = await getPipelineRow(Number((params as { pipelineId: string }).pipelineId));
          if (!row) throw new HttpError(404, 'Workflow not found');
          if (row.projectId !== null) {
            await assertPermission(row.projectId, user, 'actions', action);
            await assertMcpAllowed(row.projectId, request.headers);
          } else await requireTeamPermission(row.teamId, user, 'actions', action);
          return { pipelineRow: row };
        },
      };
    },
    pipelineRun(action: PermissionAction) {
      return {
        detail: requiresPermission(['actions', action]) as DocumentDecoration,
        async resolve({ params, user, request }) {
          const run = await runAccess((params as { runId: string }).runId);
          if (!run) throw new HttpError(404, 'Workflow run not found');
          const resource = run.kind === 'routine' ? 'ai_agents' : 'actions';
          await assertPermission(run.projectId, user, resource, action);
          await assertMcpAllowed(run.projectId, request.headers);
          return { projectId: run.projectId };
        },
      };
    },
    workItem: entityGuard('work_items', 'Issue not found', (p) =>
      getIssueProjectId(Number(p.issueId)),
    ),
  })
  .get('/teams/:teamId/pipelines', ({ params }) => listTemplates(params.teamId), {
    teamPermission: ['actions', 'read'],
    params: teamParams,
    response: { 200: t.Array(PipelineResponse), ...accessErrors },
    detail: {
      summary: 'List workflow templates',
      description: "The templates of the team's workflow library in Home.",
    },
  })
  .post(
    '/teams/:teamId/pipelines',
    async ({ params, body, user, set }) => {
      set.status = 201;
      return createPipeline({
        teamId: params.teamId,
        projectId: null,
        ...body,
        userId: requireUser(user).id,
      });
    },
    {
      teamPermission: ['actions', 'create'],
      params: teamParams,
      body: createPipelineBody,
      response: { 201: PipelineResponse, ...commonErrors },
      detail: {
        summary: 'Create a workflow template',
        description: "Adds a template to the team's library. Its roles are filled per project.",
      },
    },
  )
  .get('/teams/:teamId/pipeline-builtins', () => BUILTIN_TEMPLATES, {
    teamPermission: ['actions', 'read'],
    params: teamParams,
    response: { 200: t.Array(BuiltinTemplateResponse), ...accessErrors },
    detail: {
      summary: 'List the built-in workflow templates',
      description: 'The templates {appName} ships, to add to the library.',
    },
  })
  .get('/teams/:teamId/pipeline-context', ({ params }) => editorContext(params.teamId, null), {
    teamPermission: ['actions', 'read'],
    params: teamParams,
    response: { 200: PipelineContextResponse, ...accessErrors },
    detail: {
      summary: 'Get the workflow editor context of the library',
      description: "The team's models and template agents a template can name.",
    },
  })
  .post(
    '/teams/:teamId/pipelines/validate',
    ({ body }) => validateForEditor({ ...body, template: true }, null),
    {
      teamPermission: ['actions', 'read'],
      params: teamParams,
      body: validateBody,
      response: { 200: ValidationResponse, ...commonErrors },
      detail: {
        summary: 'Validate a workflow template',
        description: 'Every problem of the definition, with the step and field it belongs to.',
      },
    },
  )
  .get('/projects/:projectKey/pipelines', ({ project }) => listProjectPipelines(project), {
    permission: ['actions', 'read'],
    response: { 200: t.Array(ProjectPipelineResponse), ...accessErrors },
    detail: {
      summary: 'List the workflows of a project',
      description:
        "The templates of the team's library and the project's own workflows, with whether " +
        'the project runs each, the agents of its roles and what keeps it from running.',
    },
  })
  .post(
    '/projects/:projectKey/pipelines',
    async ({ project, body, user, set }) => {
      set.status = 201;
      return createPipeline({
        teamId: project.teamId,
        projectId: project.id,
        ...body,
        userId: requireUser(user).id,
      });
    },
    {
      permission: ['actions', 'create'],
      body: createPipelineBody,
      response: { 201: PipelineResponse, ...commonErrors },
      detail: {
        summary: 'Create a project workflow',
        description: 'A workflow of this project alone. It runs once it is enabled.',
      },
    },
  )
  .put(
    '/projects/:projectKey/pipelines/:pipelineId',
    ({ project, params, body, user }) =>
      setProjectPipeline(project, params.pipelineId, body, requireUser(user).id),
    {
      permission: ['actions', 'edit'],
      params: projectPipelineParams,
      body: projectPipelineBody,
      response: { 200: ProjectPipelineResponse, ...commonErrors, ...errors(409, 502, 503) },
      detail: {
        summary: 'Use a workflow in a project',
        description:
          'Enables or disables a template or the project workflow, and names the agents of ' +
          'its roles. A workflow that cannot run in the project is refused with 409. A ' +
          'schedule trigger gets a schedule of the engine while the workflow is enabled.',
      },
    },
  )
  .get(
    '/projects/:projectKey/pipeline-context',
    ({ project }) => editorContext(project.teamId, project),
    {
      permission: ['actions', 'read'],
      response: { 200: PipelineContextResponse, ...accessErrors },
      detail: {
        summary: 'Get the workflow editor context of a project',
        description: 'The agents, members, statuses, labels, areas and models a workflow can name.',
      },
    },
  )
  .post(
    '/projects/:projectKey/pipelines/validate',
    ({ project, body }) => validateForEditor(body, project),
    {
      permission: ['actions', 'read'],
      body: validateBody,
      response: { 200: ValidationResponse, ...commonErrors },
      detail: {
        summary: 'Validate a workflow in a project',
        description:
          'Every problem of the definition, and what keeps it from running in the project ' +
          'with the given role mapping.',
      },
    },
  )
  .get(
    '/projects/:projectKey/pipeline-run-limit',
    ({ project }) => getPipelineRunLimit(project.id),
    {
      permission: ['actions', 'read'],
      response: { 200: PipelineRunLimitResponse, ...accessErrors },
      detail: {
        summary: "Get a project's workflow run limit",
        description:
          'The guard against workflows re-triggering each other without end: at most maxRuns ' +
          'runs of any workflow may start on one task within windowMinutes.',
      },
    },
  )
  .patch(
    '/projects/:projectKey/pipeline-run-limit',
    ({ project, body }) => setPipelineRunLimit(project.id, body.maxRuns),
    {
      permission: ['actions', 'edit'],
      body: updatePipelineRunLimitBody,
      response: { 200: PipelineRunLimitResponse, ...commonErrors },
      detail: {
        summary: "Update a project's workflow run limit",
        description: 'Changes maxRuns; the window stays a fixed hour.',
      },
    },
  )
  .get('/pipelines/:pipelineId', ({ params }) => getPipeline(params.pipelineId), {
    pipeline: 'read',
    params: pipelineParams,
    response: { 200: PipelineResponse, ...accessErrors },
    detail: { summary: 'Get a workflow', description: 'The workflow and its newest definition.' },
  })
  .patch(
    '/pipelines/:pipelineId',
    ({ params, body, user }) => updatePipeline(params.pipelineId, body, requireUser(user).id),
    {
      pipeline: 'edit',
      params: pipelineParams,
      body: updatePipelineBody,
      response: { 200: PipelineResponse, ...commonErrors, ...errors(409, 502, 503) },
      detail: {
        summary: 'Update a workflow',
        description:
          'A changed definition is saved as a new version; runs keep the version they started ' +
          'with. With baseVersion, a save on top of a newer version is refused with 409.',
      },
    },
  )
  .delete(
    '/pipelines/:pipelineId',
    async ({ params }) => {
      await deletePipeline(params.pipelineId);
      return noContent();
    },
    {
      pipeline: 'delete',
      params: pipelineParams,
      response: { 204: t.Void(), ...accessErrors, ...errors(502, 503) },
      detail: {
        summary: 'Delete a workflow',
        description: 'Deletes the workflow with its versions, runs and schedules.',
      },
    },
  )
  .get('/pipelines/:pipelineId/versions', ({ params }) => listVersions(params.pipelineId), {
    pipeline: 'read',
    params: pipelineParams,
    response: { 200: t.Array(PipelineVersionResponse), ...accessErrors },
    detail: { summary: 'List the versions of a workflow', description: 'Newest first.' },
  })
  .get(
    '/pipelines/:pipelineId/versions/:version',
    ({ params }) => getVersion(params.pipelineId, params.version),
    {
      pipeline: 'read',
      params: pipelineVersionParams,
      response: { 200: PipelineVersionDetailResponse, ...accessErrors },
      detail: { summary: 'Get a version of a workflow', description: 'The definition it holds.' },
    },
  )
  .get(
    '/pipelines/:pipelineId/runs',
    async ({ pipelineRow, query, user }) => {
      const project = query.projectKey ? await getProjectByKey(query.projectKey) : null;
      if (query.projectKey && !project) throw new HttpError(404, 'Project not found');
      const projectIds = await readableProjectIds(requireUser(user).id, pipelineRow, project?.id);
      return paginate(query, (window) =>
        listPipelineRuns(
          pipelineRow.id,
          projectIds,
          { status: query.status, dryRun: query.dryRun },
          window,
        ),
      );
    },
    {
      pipeline: 'read',
      params: pipelineParams,
      query: runsQuery,
      response: { 200: PipelineRunPageResponse, ...commonErrors },
      detail: {
        summary: 'List the runs of a workflow',
        description:
          'Newest first, in the projects whose workflows you may read, optionally of one ' +
          'project, one status or test runs only.',
      },
    },
  )
  .get('/issues/:issueId/pipelines', ({ params }) => startablePipelines(params.issueId), {
    workItem: 'read',
    params: issueParams,
    response: { 200: t.Array(StartablePipelineResponse), ...accessErrors },
    detail: {
      summary: 'List the workflows to start on an issue',
      description: 'The workflows its project runs.',
    },
  })
  .get('/issues/:issueId/pipeline-runs', ({ params }) => listIssueRuns(params.issueId), {
    workItem: 'read',
    params: issueParams,
    response: { 200: t.Array(PipelineRunResponse), ...accessErrors },
    detail: {
      summary: 'List the workflow runs of an issue',
      description: 'The newest 20, with every step they executed.',
    },
  })
  .post(
    '/issues/:issueId/pipeline-runs',
    ({ params, body, user }) =>
      startRun(params.issueId, body.pipelineId, body.dryRun ?? false, requireUser(user).id),
    {
      workItem: 'edit',
      params: issueParams,
      body: startRunBody,
      response: { 200: PipelineRunResponse, ...commonErrors, ...errors(409, 502, 503) },
      detail: {
        summary: 'Start a workflow on an issue',
        description:
          'Starts an enabled workflow of the project on the issue, or with dryRun a test run ' +
          'of any workflow the project can use: agent steps are simulated, conditions ' +
          'evaluated, and nothing is queued or changed.',
      },
    },
  )
  .get('/pipeline-runs/:runId', ({ params }) => getRun(params.runId), {
    pipelineRun: 'read',
    params: pipelineRunParams,
    response: { 200: PipelineRunResponse, ...accessErrors },
    detail: { summary: 'Get a workflow run', description: 'The run with every step it executed.' },
  })
  .post('/pipeline-runs/:runId/cancel', ({ params }) => cancelRun(params.runId), {
    pipelineRun: 'edit',
    params: pipelineRunParams,
    response: { 200: PipelineRunResponse, ...commonErrors, ...errors(409, 502, 503) },
    detail: {
      summary: 'Cancel a workflow run',
      description: 'Stops the run and cancels the agent run it waits for.',
    },
  })
  .post('/pipeline-runs/:runId/retry', ({ params }) => retryRun(params.runId), {
    pipelineRun: 'edit',
    params: pipelineRunParams,
    response: { 200: PipelineRunResponse, ...commonErrors, ...errors(409, 502, 503) },
    detail: {
      summary: 'Retry a failed workflow run',
      description: 'Runs the failed step again; the steps before it keep their results.',
    },
  })
  .post(
    '/pipeline-runs/:runId/approval',
    async ({ params, body, user }) => {
      const userId = requireUser(user).id;
      if (await isAgentUser(userId))
        throw new HttpError(403, 'Only a person can decide an approval step');
      return decideApproval(params.runId, userId, body);
    },
    {
      pipelineRun: 'edit',
      params: pipelineRunParams,
      body: decisionBody,
      response: { 200: PipelineRunResponse, ...commonErrors, ...errors(409, 502, 503) },
      detail: {
        summary: 'Decide the approval step of a workflow run',
        description:
          'Approves or rejects the step the run waits at, with an optional note the later ' +
          'steps read.',
      },
    },
  )
  .get('/pipeline-approvals', ({ user }) => listWaitingApprovals(requireUser(user).id), {
    response: { 200: t.Array(PipelineApprovalResponse), ...errors(401) },
    detail: {
      summary: 'List the waiting workflow approvals',
      description:
        'The approval steps of workflow runs that wait for a person, in every project in ' +
        'which you may decide them.',
    },
  });
