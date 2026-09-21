import { Elysia, t } from 'elysia';
import { noContent } from '#shared/http';
import { guards, entityGuard } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { HttpError } from '#shared/lib';
import { requireUser } from '#shared/access';
import { mcpTool } from '#mcp/generate';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import {
  ActionResponse,
  ActionListResponse,
  actionParams,
  createActionBody,
  updateActionBody,
  reorderActionsBody,
  runActionBody,
  ActionRunResponse,
  ActionRunListResponse,
  ActionPreviewResponse,
  previewActionBody,
} from './model';
import {
  listActions,
  createAction,
  getAction,
  updateAction,
  deleteAction,
  reorderActions,
  listActionRuns,
  getActionRun,
} from './service';
import { previewAction, runManualAction } from './runner';

export const actionRoutes = new Elysia({ name: 'actions', detail: { tags: ['Actions'] } })
  .use(authContext)
  .use(guards)
  // Guard for routes that address an action by its own id (no :projectKey in the
  // path). Set `savedAction: "<action>"` in the route options.
  .macro({
    savedAction: entityGuard(
      'actions',
      'Action not found',
      async (p) => (await getAction(Number(p.actionId)))?.projectId ?? null,
    ),
    savedActionRun: entityGuard(
      'actions',
      'Action run not found',
      async (p) => (await getActionRun(String(p.runId)))?.projectId ?? null,
    ),
  })
  .get('/projects/:projectKey/action-runs', async ({ project }) => listActionRuns(project.id), {
    permission: ['actions', 'read'],
    response: { 200: ActionRunListResponse, ...accessErrors },
    detail: {
      summary: 'List action runs',
      description: "List a project's latest manual, status, and inbox-message action runs.",
    },
  })

  .get(
    '/action-runs/:runId',
    async ({ params }) => {
      const run = await getActionRun(params.runId);
      if (!run) throw new HttpError(404, 'Action run not found');
      return run;
    },
    {
      params: t.Object({ runId: t.String({ format: 'uuid' }) }),
      savedActionRun: 'read',
      response: { 200: ActionRunResponse, ...commonErrors },
      detail: { summary: 'Get an action run and its workflow steps' },
    },
  )

  .get(
    '/projects/:projectKey/actions',
    async ({ project }) => {
      return listActions(project.id);
    },
    {
      permission: ['actions', 'read'],
      response: { 200: ActionListResponse, ...accessErrors },
      detail: {
        summary: 'List actions',
        description: "List a project's actions.",
        ...mcpTool('list_actions'),
      },
    },
  )

  // The same list, readable by any project member. The issue quick actions (board
  // context menu, issue detail) run off it, so a member who cannot manage actions
  // still sees the ones that apply to an issue.
  .get(
    '/projects/:projectKey/actions/quick',
    async ({ project }) => {
      return listActions(project.id);
    },
    {
      projectMember: true,
      response: { 200: ActionListResponse, ...accessErrors },
      detail: {
        summary: 'List quick actions',
        description: "List a project's actions for the issue quick actions.",
      },
    },
  )

  .post(
    '/projects/:projectKey/actions',
    async ({ project, body, set }) => {
      set.status = 201;
      return createAction({ projectId: project.id, ...body });
    },
    {
      body: createActionBody,
      permission: ['actions', 'create'],
      response: { 201: ActionResponse, ...commonErrors },
      detail: {
        summary: 'Create an action',
        description: 'Create an action in a project.',
        ...mcpTool('create_action'),
      },
    },
  )

  // Sets the action order to orderedIds.
  .put(
    '/projects/:projectKey/actions/reorder',
    async ({ project, body }) => {
      return reorderActions(project.id, body.orderedIds);
    },
    {
      body: reorderActionsBody,
      permission: ['actions', 'edit'],
      response: { 200: ActionListResponse, ...commonErrors },
      detail: {
        summary: 'Reorder actions',
        description: "Set the display order of a project's actions.",
        ...mcpTool('reorder_actions'),
      },
    },
  )

  .patch(
    '/actions/:actionId',
    async ({ params, body }) => {
      const action = await updateAction(params.actionId, body);
      if (!action) throw new HttpError(404, 'Action not found');
      return action;
    },
    {
      body: updateActionBody,
      params: actionParams,
      savedAction: 'edit',
      response: { 200: ActionResponse, ...commonErrors },
      detail: {
        summary: 'Update an action',
        description: 'Update an existing action.',
        ...mcpTool('update_action'),
      },
    },
  )

  .post(
    '/actions/:actionId/run',
    async ({ params, body, user }) => {
      const run = await runManualAction(params.actionId, body.issueId, requireUser(user).id);
      if (!run) throw new HttpError(404, 'Action run not found');
      return run;
    },
    {
      body: runActionBody,
      params: actionParams,
      response: { 200: ActionRunResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Run a manual action',
        description:
          'Apply a manual action to one work item and record the run. The caller must still be able to edit the work item.',
      },
    },
  )

  .post(
    '/actions/:actionId/preview',
    ({ params, body, user }) =>
      previewAction(params.actionId, body.issueId, requireUser(user).id, body.workflow),
    {
      body: previewActionBody,
      params: actionParams,
      response: { 200: ActionPreviewResponse, ...commonErrors },
      detail: {
        summary: 'Preview a workflow',
        description: 'Evaluate workflow branches for one work item without changing it.',
      },
    },
  )

  .delete(
    '/actions/:actionId',
    async ({ params }) => {
      await deleteAction(params.actionId);
      return noContent();
    },
    {
      params: actionParams,
      savedAction: 'delete',
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Delete an action',
        description: 'Delete an action. Irreversible.',
        ...mcpTool('delete_action'),
      },
    },
  );
