import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireUser } from '#shared/access';
import { guards } from '#shared/guards';
import { commonErrors, errors } from '#shared/responses';
import { DisplayDefaultsResponse, SetDisplayDefaultsBody } from './model';
import { getDisplayDefaults, setGlobalDisplayDefaults, setProjectDisplayDefaults } from './service';

// Which fields the task views of a project show by default. Any member reads them (a view
// starts from them); a project admin saves the project's; every member saves their own
// default for all projects. Views are display, not data, so none of this is an MCP tool.
export const displayDefaultsRoutes = new Elysia({
  name: 'display-defaults',
  detail: { tags: ['Views'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/projects/:projectKey/display-defaults',
    ({ project, user }) => getDisplayDefaults(project.id, requireUser(user).id),
    {
      projectMember: true,
      response: { 200: DisplayDefaultsResponse, ...commonErrors },
      detail: { summary: "Get the fields the project's task views show by default" },
    },
  )
  .put(
    '/projects/:projectKey/display-defaults',
    async ({ project, user, body }) => {
      await setProjectDisplayDefaults(project.id, body.defaults);
      return getDisplayDefaults(project.id, requireUser(user).id);
    },
    {
      body: SetDisplayDefaultsBody,
      projectAdmin: true,
      response: { 200: DisplayDefaultsResponse, ...commonErrors },
      detail: { summary: "Save the fields the project's task views show by default" },
    },
  )
  .put(
    '/projects/:projectKey/display-defaults/global',
    async ({ project, user, body }) => {
      const userId = requireUser(user).id;
      await setGlobalDisplayDefaults(userId, body.defaults);
      return getDisplayDefaults(project.id, userId);
    },
    {
      body: SetDisplayDefaultsBody,
      projectMember: true,
      response: { 200: DisplayDefaultsResponse, ...commonErrors, ...errors(400) },
      detail: { summary: "Save the member's own default fields for every project" },
    },
  );
