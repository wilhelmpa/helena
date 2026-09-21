import { Elysia, t } from 'elysia';
import { noContent } from '#shared/http';
import { guards, entityGuard } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { requireUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { accessErrors, commonErrors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import {
  ViewFolderResponse,
  ViewResponse,
  createViewBody,
  reorderViewsBody,
  updateViewBody,
  viewParams,
  viewFolderBody,
  viewFolderParams,
  reorderViewFoldersBody,
} from './model';
import {
  listViewFolders,
  getViewFolder,
  createViewFolder,
  updateViewFolder,
  deleteViewFolder,
  reorderViewFolders,
  listViews,
  createView,
  getView,
  updateView,
  deleteView,
  reorderViews,
  isFavoriteView,
  addFavoriteView,
  removeFavoriteView,
  backfillDefaultProjectViews,
} from './service';

export const viewRoutes = new Elysia({ name: 'views', detail: { tags: ['Views'] } })
  .use(authContext)
  .use(guards)
  .macro({
    savedView: entityGuard(
      'views',
      'View not found',
      async (p) => (await getView(Number(p.viewId)))?.projectId ?? null,
    ),
    savedViewFolder: entityGuard(
      'views',
      'View folder not found',
      async (p) => (await getViewFolder(Number(p.folderId)))?.projectId ?? null,
    ),
  })
  .get('/projects/:projectKey/view-folders', ({ project }) => listViewFolders(project.id), {
    permission: ['views', 'read'],
    response: { 200: t.Array(ViewFolderResponse), ...accessErrors },
    detail: { summary: 'List saved view folders' },
  })

  .post(
    '/projects/:projectKey/view-folders',
    async ({ project, body, set }) => {
      set.status = 201;
      return createViewFolder(project.id, body.name);
    },
    {
      body: viewFolderBody,
      permission: ['views', 'create'],
      response: { 201: ViewFolderResponse, ...commonErrors },
      detail: { summary: 'Create a saved view folder' },
    },
  )

  .put(
    '/projects/:projectKey/view-folders/reorder',
    ({ project, body }) => reorderViewFolders(project.id, body.orderedIds),
    {
      body: reorderViewFoldersBody,
      permission: ['views', 'edit'],
      response: { 200: t.Array(ViewFolderResponse), ...commonErrors },
      detail: { summary: 'Reorder saved view folders' },
    },
  )

  .patch(
    '/view-folders/:folderId',
    async ({ params, body }) => {
      const folder = await updateViewFolder(params.folderId, body.name);
      if (!folder) throw new HttpError(404, 'View folder not found');
      return folder;
    },
    {
      params: viewFolderParams,
      body: viewFolderBody,
      savedViewFolder: 'edit',
      response: { 200: ViewFolderResponse, ...commonErrors },
      detail: { summary: 'Rename a saved view folder' },
    },
  )

  .delete(
    '/view-folders/:folderId',
    async ({ params }) => {
      await deleteViewFolder(params.folderId);
      return noContent();
    },
    {
      params: viewFolderParams,
      savedViewFolder: 'delete',
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Delete a saved view folder' },
    },
  )
  .get(
    '/projects/:projectKey/views',
    async ({ project, user }) => {
      return listViews(project.id, requireUser(user).id);
    },
    {
      permission: ['views', 'read'],
      response: { 200: t.Array(ViewResponse), ...accessErrors },
      detail: {
        summary: 'List saved views',
        description: "List a project's saved views.",
        ...mcpTool('list_views'),
      },
    },
  )

  .post(
    '/projects/:projectKey/views',
    async ({ project, body, set }) => {
      set.status = 201;
      return { ...(await createView({ projectId: project.id, ...body })), favorite: false };
    },
    {
      body: createViewBody,
      permission: ['views', 'create'],
      response: { 201: ViewResponse, ...commonErrors },
      detail: {
        summary: 'Create a saved view',
        description: 'Create a saved view in a project.',
        ...mcpTool('create_view'),
      },
    },
  )

  .post(
    '/projects/:projectKey/views/defaults',
    ({ project, user }) => backfillDefaultProjectViews(project.id, requireUser(user).id),
    {
      permission: ['views', 'edit'],
      response: { 200: t.Array(ViewResponse), ...commonErrors },
      detail: {
        summary: 'Ensure default saved views',
        description: 'Ensure the project has Kanban and List saved views.',
      },
    },
  )

  .put(
    '/projects/:projectKey/views/reorder',
    async ({ project, body, user }) => {
      return reorderViews(project.id, body.folderId ?? null, body.orderedIds, requireUser(user).id);
    },
    {
      body: reorderViewsBody,
      permission: ['views', 'edit'],
      response: { 200: t.Array(ViewResponse), ...commonErrors },
      detail: {
        summary: 'Reorder saved views',
        description: "Set the display order of a project's saved views.",
        ...mcpTool('reorder_views'),
      },
    },
  )

  .patch(
    '/views/:viewId',
    async ({ params, body, user }) => {
      const view = await updateView(params.viewId, body);
      if (!view) throw new HttpError(404, 'View not found');
      return { ...view, favorite: await isFavoriteView(view.id, requireUser(user).id) };
    },
    {
      body: updateViewBody,
      params: viewParams,
      savedView: 'edit',
      response: { 200: ViewResponse, ...commonErrors },
      detail: {
        summary: 'Update a saved view',
        description: 'Update an existing saved view.',
        ...mcpTool('update_view'),
      },
    },
  )

  // Favorites are the caller's own, so reading the view is enough to mark one.
  .put(
    '/views/:viewId/favorite',
    async ({ params, user }) => {
      await addFavoriteView(params.viewId, requireUser(user).id);
      return noContent();
    },
    {
      params: viewParams,
      savedView: 'read',
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Favorite a saved view',
        description: "Add a saved view to the caller's favorites.",
      },
    },
  )

  .delete(
    '/views/:viewId/favorite',
    async ({ params, user }) => {
      await removeFavoriteView(params.viewId, requireUser(user).id);
      return noContent();
    },
    {
      params: viewParams,
      savedView: 'read',
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Unfavorite a saved view',
        description: "Remove a saved view from the caller's favorites.",
      },
    },
  )

  .delete(
    '/views/:viewId',
    async ({ params }) => {
      await deleteView(params.viewId);
      return noContent();
    },
    {
      params: viewParams,
      savedView: 'delete',
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Delete a saved view',
        description: 'Delete a saved view. Irreversible.',
        ...mcpTool('delete_view'),
      },
    },
  );
