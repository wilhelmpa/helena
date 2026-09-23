import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { checkPermission, requireUser } from '#shared/access';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { parseActivityCursor } from './entry';
import { ActivityPageResponse, AgentUsageResponse, activityQuery } from './model';
import { getAgentUsage, listActivity, listProjectActivity } from './service';

const TIMELINE_DESCRIPTION =
  'Newest first, paged by cursor: chat answers of the caller, agent runs, and the ' +
  "agent-team and workflow runs Mastra holds. Mastra's runs are read in a bounded " +
  'number of requests; when it does not answer, they are left out and `notice` says so.';

export const agentActivityRoutes = new Elysia({
  name: 'agent-activity',
  detail: { tags: ['Agent Activity'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/projects/:projectKey/agent-activity',
    async ({ project, user, query }) => {
      const caller = requireUser(user);
      return listProjectActivity(
        project,
        caller.id,
        await checkPermission(project.id, caller, 'actions', 'read'),
        { ...query, cursor: parseActivityCursor(query.cursor) },
      );
    },
    {
      query: activityQuery,
      permission: ['ai_agents', 'read'],
      response: { 200: ActivityPageResponse, ...commonErrors },
      detail: {
        summary: 'List the agent activity of a project',
        description: `${TIMELINE_DESCRIPTION} Workflow runs need the workflows read permission.`,
      },
    },
  )
  .get('/projects/:projectKey/agent-activity/usage', ({ project }) => getAgentUsage(project.id), {
    permission: ['ai_agents', 'read'],
    response: { 200: AgentUsageResponse, ...accessErrors },
    detail: {
      summary: 'Get the token usage of the agents of a project',
      description:
        'The tokens the agent runs of the project read and wrote this month, and the ' +
        'tokens per task closed this month that agents worked on.',
    },
  })
  // The membership rows are the access check, so it needs no project guard.
  .get(
    '/agent-activity',
    ({ user, query }) =>
      listActivity(requireUser(user).id, {
        ...query,
        cursor: parseActivityCursor(query.cursor),
      }),
    {
      query: activityQuery,
      response: { 200: ActivityPageResponse, ...errors(400, 401) },
      detail: {
        summary: 'List the agent activity across projects',
        description: `${TIMELINE_DESCRIPTION} Covers every project in which you may read agents.`,
      },
    },
  );
