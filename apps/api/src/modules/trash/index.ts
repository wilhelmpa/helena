import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { commonErrors } from '#shared/responses';
import {
  emptyTrash,
  projectRetention,
  setProjectRetention,
  setTeamRetention,
  teamRetention,
  trashHistory,
} from './service';
import {
  emptyTrashBody,
  historyQuery,
  teamParams,
  trashHistoryResponse,
  projectRetentionBody,
  projectRetentionResponse,
  projectTrashParams,
  purgeResponse,
  teamRetentionBody,
  teamRetentionResponse,
  teamTrashParams,
} from './model';

export const trashRoutes = new Elysia({ name: 'trash', detail: { tags: ['Trash'] } })
  .use(authContext)
  .use(guards)
  .get('/teams/:teamId/trash-retention', ({ params }) => teamRetention(params.teamId), {
    teamMember: true,
    params: teamParams,
    response: { 200: teamRetentionResponse, ...commonErrors },
    detail: { summary: 'Read the team trash retention in days; zero disables automatic purging' },
  })
  .put(
    '/teams/:teamId/trash-retention',
    ({ params, body }) => setTeamRetention(params.teamId, body.days),
    {
      teamManager: true,
      params: teamParams,
      body: teamRetentionBody,
      response: { 200: teamRetentionResponse, ...commonErrors },
      detail: { summary: 'Set the team trash retention' },
    },
  )
  .get('/projects/:projectKey/trash-retention', ({ project }) => projectRetention(project.id), {
    projectMember: true,
    response: { 200: projectRetentionResponse, ...commonErrors },
    detail: { summary: 'Read project trash retention and its effective team default' },
  })
  .put(
    '/projects/:projectKey/trash-retention',
    ({ project, body }) => setProjectRetention(project.id, body.days),
    {
      projectAdmin: true,
      body: projectRetentionBody,
      response: { 200: projectRetentionResponse, ...commonErrors },
      detail: { summary: 'Set project trash retention; null inherits the team setting' },
    },
  )
  .post(
    '/teams/:teamId/trash/:kind/empty',
    ({ params, body }) =>
      emptyTrash({
        scope: { teamId: params.teamId, includeHome: params.kind === 'chat' },
        kind: params.kind,
        dryRun: body.dryRun,
      }),
    {
      teamManager: true,
      params: teamTrashParams,
      body: emptyTrashBody,
      response: { 200: purgeResponse, ...commonErrors },
      detail: { summary: 'Empty the team chat or project Vault trash after client confirmation' },
    },
  )
  .post(
    '/projects/:projectKey/trash/:kind/empty',
    ({ project, params, body }) =>
      emptyTrash({
        scope: { projectId: project.id },
        kind: params.kind,
        dryRun: body.dryRun,
      }),
    {
      projectAdmin: true,
      params: projectTrashParams,
      body: emptyTrashBody,
      response: { 200: purgeResponse, ...commonErrors },
      detail: { summary: 'Empty the project chat or Vault trash after client confirmation' },
    },
  )
  .get(
    '/teams/:teamId/trash-activity',
    ({ params, query }) => trashHistory({ teamId: params.teamId }, query.limit),
    {
      teamManager: true,
      params: teamParams,
      query: historyQuery,
      response: { 200: trashHistoryResponse, ...commonErrors },
      detail: { summary: 'Read purged counts by kind and project' },
    },
  )
  .get(
    '/projects/:projectKey/trash-activity',
    ({ project, query }) => trashHistory({ projectId: project.id }, query.limit),
    {
      projectAdmin: true,
      query: historyQuery,
      response: { 200: trashHistoryResponse, ...commonErrors },
      detail: { summary: 'Read the project trash purge activity' },
    },
  );
