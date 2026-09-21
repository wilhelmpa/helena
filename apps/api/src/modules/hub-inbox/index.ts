import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { assertPermission, requireTeamPermission, requireUser } from '#shared/access';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import {
  HubInboxSourceListResponse,
  HubInboxSourceResponse,
  HubInboxThreadPageResponse,
  sourceListQuery,
  sourceParams,
  threadListQuery,
  threadParams,
  updateSourceBody,
  updateThreadBody,
} from './model';
import {
  getHubInboxSource,
  getHubInboxThread,
  listHubInboxSources,
  listHubInboxThreads,
  parseHubInboxCursor,
  resolveInboxIssue,
  resolveInboxProject,
  retryHubInboxTriage,
  updateHubInboxSource,
  updateHubInboxThread,
} from './service';
import { createInboxTask } from './tasks';

export const hubInboxRoutes = new Elysia({
  name: 'hub-inbox',
  detail: { tags: ['Hub Inbox'] },
})
  .use(authContext)
  .get(
    '/hub-inbox/sources',
    async ({ query, user }) => {
      const teamId = Number(query.teamId);
      await requireTeamPermission(teamId, user, 'integrations', 'read');
      return listHubInboxSources(teamId);
    },
    {
      query: sourceListQuery,
      response: { 200: HubInboxSourceListResponse, ...errors(401, 403, 404) },
      detail: { summary: 'List connected inbox sources' },
    },
  )
  .patch(
    '/hub-inbox/sources/:sourceId',
    async ({ params, body, user }) => {
      const current = requireUser(user);
      const source = await getHubInboxSource(Number(params.sourceId));
      if (!source) throw new HttpError(404, 'Inbox source not found');
      await requireTeamPermission(source.teamId, user, 'integrations', 'edit');
      if (body.autoTaskProjectId != null) {
        const project = await resolveInboxProject(source.teamId, body.autoTaskProjectId);
        if (!project) throw new HttpError(400, 'Automatic task project must belong to this team');
      }
      const autoCreateTasks = body.autoCreateTasks ?? source.autoCreateTasks;
      const autoTaskProjectId =
        body.autoTaskProjectId === undefined ? source.autoTaskProjectId : body.autoTaskProjectId;
      if (autoCreateTasks && autoTaskProjectId == null) {
        throw new HttpError(400, 'Select an automatic task project before enabling task creation');
      }
      const updated = await updateHubInboxSource(source.id, {
        ...body,
        automationActorUserId:
          body.autoCreateTasks === false
            ? null
            : autoCreateTasks &&
                (body.autoCreateTasks === true || body.autoTaskProjectId !== undefined)
              ? current.id
              : undefined,
      });
      if (!updated) throw new HttpError(404, 'Inbox source not found');
      return updated;
    },
    {
      params: sourceParams,
      body: updateSourceBody,
      response: { 200: HubInboxSourceResponse, ...commonErrors },
      detail: { summary: 'Update an inbox source' },
    },
  )
  .get(
    '/hub-inbox/threads',
    async ({ query, user }) => {
      const teamId = Number(query.teamId);
      await requireTeamPermission(teamId, user, 'integrations', 'read');
      const projectId = query.projectId == null ? undefined : Number(query.projectId);
      if (projectId != null) {
        const target = await resolveInboxProject(teamId, projectId);
        if (!target) throw new HttpError(404, 'Project not found');
        await assertPermission(projectId, user, 'work_items', 'read');
      }
      return listHubInboxThreads({
        teamId,
        projectId,
        channel: query.channel,
        status: query.status,
        priority: query.priority,
        needsReview: query.needsReview === 'true',
        cursor: parseHubInboxCursor(query.cursor),
        limit: query.limit == null ? undefined : Number(query.limit),
      });
    },
    {
      query: threadListQuery,
      response: { 200: HubInboxThreadPageResponse, ...errors(400, 401, 403, 404) },
      detail: { summary: 'List unified inbox threads' },
    },
  )
  .patch(
    '/hub-inbox/threads/:threadId',
    async ({ params, body, user }) => {
      const thread = await requireThread(params.threadId, user, 'edit');
      if (
        thread.issueId != null &&
        body.projectId !== undefined &&
        body.issueId === undefined &&
        body.projectId !== thread.projectId
      ) {
        throw new HttpError(409, 'Detach the linked task before changing the project');
      }
      let projectId = body.projectId;
      const issueId = body.issueId;
      if (issueId !== undefined && issueId !== null) {
        const target = await resolveInboxIssue(thread.teamId, issueId);
        if (!target) throw new HttpError(400, 'Issue must belong to this team');
        await assertPermission(target.projectId, user, 'work_items', 'edit');
        projectId = target.projectId;
      } else if (projectId !== undefined && projectId !== null) {
        const target = await resolveInboxProject(thread.teamId, projectId);
        if (!target) throw new HttpError(400, 'Project must belong to this team');
        await assertPermission(projectId, user, 'work_items', 'edit');
      }
      await updateHubInboxThread(thread.id, { ...body, projectId, issueId });
      return noContent();
    },
    {
      params: threadParams,
      body: updateThreadBody,
      response: { 204: t.Void(), ...commonErrors, ...errors(409) },
      detail: { summary: 'Update an inbox thread' },
    },
  )
  .post(
    '/hub-inbox/threads/:threadId/retry-triage',
    async ({ params, user }) => {
      const thread = await requireThread(params.threadId, user, 'edit');
      if (!(await retryHubInboxTriage(thread.id))) {
        throw new HttpError(409, 'Only failed or review-required triage can be retried');
      }
      return noContent();
    },
    {
      params: threadParams,
      response: { 204: t.Void(), ...errors(401, 403, 404, 409) },
      detail: { summary: 'Retry inbox triage' },
    },
  )
  .post(
    '/hub-inbox/threads/:threadId/create-task',
    async ({ params, user }) => {
      const current = requireUser(user);
      const thread = await requireThread(params.threadId, user, 'read');
      if (thread.projectId == null) throw new HttpError(400, 'Assign a project first');
      await assertPermission(thread.projectId, user, 'work_items', 'create');
      return createInboxTask(thread.id, current.id);
    },
    {
      params: threadParams,
      response: {
        200: t.Object({ issueId: t.Number(), sequenceNumber: t.Number() }),
        ...commonErrors,
        ...errors(409),
      },
      detail: { summary: 'Create a task from an inbox thread' },
    },
  );

async function requireThread(
  threadId: string,
  user: Parameters<typeof requireUser>[0],
  action: 'read' | 'edit',
) {
  const thread = await getHubInboxThread(threadId);
  if (!thread) throw new HttpError(404, 'Inbox thread not found');
  await requireTeamPermission(thread.teamId, user, 'integrations', action);
  return thread;
}
